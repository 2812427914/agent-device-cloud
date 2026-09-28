import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMemoryServer } from "postgres-memory-server";
import type { FastifyInstance } from "fastify";
import { NodeApiClient, generateNodeKeyPair } from "../packages/client/src/index.ts";
import { IdentityStore, PostgresStore } from "../packages/db/src/index.ts";
import { CapabilitySchema } from "../packages/protocol/src/index.ts";
import { createAuthentication } from "../apps/control-plane/src/auth.ts";
import { createAccessService } from "../apps/control-plane/src/access.ts";
import { createControlPlane } from "../apps/control-plane/src/app.ts";

describe("public signup and CLI authentication over HTTP", () => {
  let postgres: PostgresMemoryServer;
  let app: FastifyInstance;
  let origin: string;
  let directory: string;
  const mails: { to: string; text: string }[] = [];
  const email = "cli-user@example.com";
  const password = "A long password for a real CLI process";
  const command = (args: string[], input = "") =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolveCommand, reject) => {
        const env = Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.startsWith("ADC_"))
        );
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "apps/cli/src/main.ts", ...args],
          {
            cwd: resolve(import.meta.dirname, ".."),
            env: {
              ...env,
              ADC_CONFIG: resolve(directory, "config.json"),
              PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`
            },
            stdio: ["pipe", "pipe", "pipe"]
          }
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("error", reject);
        child.on("close", (code) => resolveCommand({ code, stdout, stderr }));
        child.stdin.end(input);
      }
    );
  const post = async (path: string, body: object, cookie = "") => {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual"
    });
    return { response, body: (await response.json()) as any };
  };
  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), "adc-cli-"));
    const socket = createServer();
    await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
    const address = socket.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP port.");
    origin = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((done, reject) =>
      socket.close((error) => (error ? reject(error) : done()))
    );
    postgres = await PostgresMemoryServer.create({
      database: "adc_cli",
      username: "adc_cli",
      password: "adc_cli"
    });
    const store = new PostgresStore(postgres.getUri());
    app = await createControlPlane({
      store,
      access: createAccessService(
        createAuthentication({
          pool: store.pool,
          baseURL: origin,
          secret: randomBytes(48).toString("base64url"),
          requireEmailVerification: true,
          sendMail: async (mail) => {
            mails.push(mail);
          }
        }),
        new IdentityStore(store.pool)
      )
    });
    await app.listen({ host: "127.0.0.1", port: address.port });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("verifies email, signs in without exposing a password, separates management from Agent execution and revokes logout", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "CLI user",
      email,
      password,
      callbackURL: `${origin}/login`
    });
    expect(signup.response.status, JSON.stringify(signup.body)).toBe(200);
    expect(signup.response.headers.getSetCookie().join("")).not.toContain("adc.session_token");
    const unverified = await command(
      ["auth", "login", "--url", origin, "--email", email, "--password-stdin", "--json"],
      `${password}\n`
    );
    expect(unverified.code).not.toBe(0);
    expect(unverified.stderr).not.toContain(password);
    const verificationURL = mails.findLast((mail) => mail.to === email)!.text.match(/http\S+/)![0];
    const verification = await fetch(verificationURL, { redirect: "manual" });
    expect(verification.status).toBe(302);
    expect(new URL(verification.headers.get("location")!, origin).pathname).toBe("/login");
    const login = await command(
      ["auth", "login", "--url", origin, "--email", email, "--password-stdin", "--json"],
      `${password}\n`
    );
    expect(login.code, login.stderr).toBe(0);
    expect(login.stdout).not.toContain(password);
    expect(JSON.parse(login.stdout)).toMatchObject({
      loggedIn: true,
      user: { email }
    });
    const sessionPath = resolve(directory, "config.json.session");
    expect((await stat(sessionPath)).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(await readFile(sessionPath, "utf8"));
    expect(saved.cookie).toContain("adc.session_token=");
    const noAgent = await command(["mcp"]);
    expect(noAgent.code).not.toBe(0);
    expect(noAgent.stderr).toContain("Agent connection");
    const pair = await command(["device", "add", "--name", "CLI Mac", "--json"]);
    expect(pair.code, pair.stderr).toBe(0);
    expect(JSON.parse(pair.stdout)).toMatchObject({
      schemaVersion: "0.1",
      installCommand: expect.stringContaining("--label 'CLI Mac'")
    });
    const pairing = await command(["node", "pairing-code", "--json"]);
    const keys = generateNodeKeyPair();
    const paired = await new NodeApiClient(origin, undefined, keys.privateKey).pair({
      code: JSON.parse(pairing.stdout).code,
      label: "Connected Mac",
      platform: "darwin",
      publicKey: keys.publicKey
    });
    await new NodeApiClient(origin, paired.nodeId, keys.privateKey).poll(
      CapabilitySchema.parse({
        schemaVersion: "0.1",
        nodeId: paired.nodeId,
        platform: "darwin",
        accessMode: "selected",
        nodeVersion: "0.1.0",
        advertisedAt: new Date().toISOString(),
        roots: [
          {
            rootId: "root_workspace",
            path: "/workspace",
            label: "Workspace",
            writable: true
          }
        ],
        tools: ["device.list", "file.read", "file.write"].map((name) => ({
          name,
          version: "0.1.0",
          risk: name === "file.write" ? "write" : "read",
          sandboxProfiles: ["restricted-process"]
        }))
      })
    );
    const devices = await command(["device", "list", "--json"]);
    expect(devices.code, devices.stderr).toBe(0);
    expect(JSON.parse(devices.stdout).devices).toContainEqual(
      expect.objectContaining({ id: paired.nodeId, name: "Connected Mac", online: true })
    );
    expect(devices.stdout).not.toContain("publicKey");
    const deviceUpdated = await command([
      "device",
      "update",
      "Connected Mac",
      "--name",
      "CLI Mac",
      "--folders",
      "/workspace",
      "--read-only",
      "/workspace",
      "--execution",
      "off",
      "--json"
    ]);
    expect(deviceUpdated.code, deviceUpdated.stderr).toBe(0);
    expect(JSON.parse(deviceUpdated.stdout).device).toMatchObject({
      id: paired.nodeId,
      name: "CLI Mac",
      revision: 2,
      policy: {
        rootAccess: "selected",
        rootIds: ["root_workspace"],
        readOnlyRootIds: ["root_workspace"],
        allowExecution: false
      }
    });
    const project = await command(["project", "create", "--name", "CLI project", "--json"]);
    expect(project.code, project.stderr).toBe(0);
    expect(JSON.parse(project.stdout).project.name).toBe("CLI project");
    const access = await command([
      "access",
      "create",
      "--name",
      "CLI reader",
      "--devices",
      "CLI Mac",
      "--folders",
      "/workspace",
      "--tools",
      "device.list",
      "--json"
    ]);
    expect(access.code, access.stderr).toBe(0);
    const accessId = JSON.parse(access.stdout).access.id;
    const connected = await command([
      "connect",
      "CLI reader",
      "--name",
      "CLI test connection",
      "--expires",
      "7",
      "--json"
    ]);
    expect(connected.code, connected.stderr).toBe(0);
    expect(JSON.parse(connected.stdout)).toMatchObject({
      connected: true,
      access: { id: accessId, name: "CLI reader" },
      connection: { name: "CLI test connection" }
    });
    expect(connected.stdout).not.toContain("adc_");
    const agentConfig = JSON.parse(await readFile(resolve(directory, "config.json"), "utf8"));
    expect(agentConfig).toMatchObject({ url: origin });
    expect(agentConfig.token).toMatch(/^adc_/);
    expect((await stat(resolve(directory, "config.json"))).mode & 0o777).toBe(0o600);
    const accessUpdated = await command([
      "access",
      "update",
      accessId,
      "--name",
      "CLI reader updated",
      "--json"
    ]);
    expect(accessUpdated.code, accessUpdated.stderr).toBe(0);
    expect(JSON.parse(accessUpdated.stdout).access).toMatchObject({
      id: accessId,
      name: "CLI reader updated",
      revision: 2
    });
    const listedAccess = await command(["access", "list", "--json"]);
    expect(JSON.parse(listedAccess.stdout).access).toContainEqual(
      expect.objectContaining({ id: accessId, name: "CLI reader updated" })
    );
    const connections = await command(["connection", "list", "--json"]);
    expect(connections.code, connections.stderr).toBe(0);
    const connection = JSON.parse(connections.stdout).connections.find(
      (item: { name?: string }) => item.name === "CLI test connection"
    );
    expect(connection).toMatchObject({ type: "cli", accessId, status: "active" });
    const nodes = await command(["node", "list", "--json"]);
    expect(nodes.code, nodes.stderr).toBe(0);
    expect(JSON.parse(nodes.stdout).nodes).toContainEqual(
      expect.objectContaining({ nodeId: paired.nodeId, label: "CLI Mac" })
    );
    const status = await command(["auth", "status", "--json"]);
    expect(status.code, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      login: { authenticated: true },
      connection: { authenticated: true }
    });
    const adminInvoke = await command(["invoke", "device.list", "--session"]);
    expect(adminInvoke.code).not.toBe(0);
    const update = await post("/api/auth/update-user", { name: "Updated name" }, saved.cookie);
    expect(update.response.status, JSON.stringify(update.body)).toBe(200);
    const sessions = await fetch(`${origin}/api/auth/list-sessions`, {
      headers: { cookie: saved.cookie }
    });
    expect(sessions.status).toBe(200);
    expect(((await sessions.json()) as unknown[]).length).toBeGreaterThan(0);
    const revoked = await command(["connection", "revoke", connection.id, "--yes", "--json"]);
    expect(revoked.code, revoked.stderr).toBe(0);
    expect(JSON.parse(revoked.stdout)).toMatchObject({ revoked: true, id: connection.id });
    const revokedAgent = await command(["node", "list", "--json"]);
    expect(revokedAgent.code).not.toBe(0);
    const logout = await command(["auth", "logout", "--json"]);
    expect(logout.code, logout.stderr).toBe(0);
    expect((await fetch(`${origin}/api/v1/me`, { headers: { cookie: saved.cookie } })).status).toBe(
      401
    );
    await expect(stat(sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(resolve(directory, "config.json"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);
});
