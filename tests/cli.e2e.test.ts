import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMemoryServer } from "postgres-memory-server";
import type { FastifyInstance } from "fastify";
import { IdentityStore, PostgresStore } from "../packages/db/src/index.ts";
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
      authenticated: true,
      kind: "session",
      user: { email }
    });
    const sessionPath = resolve(directory, "config.json.session");
    expect((await stat(sessionPath)).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(await readFile(sessionPath, "utf8"));
    expect(saved.cookie).toContain("adc.session_token=");
    const noAgent = await command(["mcp"]);
    expect(noAgent.code).not.toBe(0);
    expect(noAgent.stderr).toContain("agent token");
    const pair = await command(["node", "pairing-code", "--json"]);
    expect(pair.code, pair.stderr).toBe(0);
    expect(JSON.parse(pair.stdout).code).toBeTruthy();
    const project = await post("/api/v1/projects", { label: "CLI project" }, saved.cookie);
    const grant = await post(
      "/api/v1/grants",
      {
        projectId: project.body.projectId,
        name: "CLI reader",
        profile: "read-only",
        nodeIds: [],
        rootIds: [],
        allowedTools: ["device.list"]
      },
      saved.cookie
    );
    const credential = await post(
      "/api/v1/credentials",
      { grantId: grant.body.grantId, name: "CLI" },
      saved.cookie
    );
    const token = credential.body.token;
    const imported = await command(
      ["auth", "token", "--url", origin, "--stdin", "--json"],
      `${token}\n`
    );
    expect(imported.code, imported.stderr).toBe(0);
    expect(imported.stdout).not.toContain(token);
    expect((await stat(resolve(directory, "config.json"))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(resolve(directory, "config.json"), "utf8"))).toEqual({
      url: origin,
      token
    });
    const nodes = await command(["node", "list", "--json"]);
    expect(nodes.code, nodes.stderr).toBe(0);
    expect(JSON.parse(nodes.stdout).nodes).toEqual([]);
    const status = await command(["auth", "status", "--json"]);
    expect(status.code, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      session: { authenticated: true },
      agent: { authenticated: true }
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
    const logout = await command(["auth", "logout", "--json"]);
    expect(logout.code, logout.stderr).toBe(0);
    expect((await fetch(`${origin}/api/v1/me`, { headers: { cookie: saved.cookie } })).status).toBe(
      401
    );
    await expect(stat(sessionPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(resolve(directory, "config.json"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);
});
