import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMemoryServer } from "postgres-memory-server";
import type { FastifyInstance } from "fastify";
import { IdentityStore, PostgresStore } from "../packages/db/src/index.ts";
import { createAuthentication } from "../apps/control-plane/src/auth.ts";
import { createAccessService } from "../apps/control-plane/src/access.ts";
import { createControlPlane } from "../apps/control-plane/src/app.ts";

describe("released device installer over HTTP", () => {
  let directory: string;
  let releases: string;
  let origin: string;
  let cookie: string;
  let postgres: PostgresMemoryServer;
  let app: FastifyInstance;
  let daemon: ChildProcess | undefined;
  let env: NodeJS.ProcessEnv;
  let corruptArchive = false;
  const projectRoot = resolve(import.meta.dirname, "..");
  const run = (binary: string, args: string[], input = "", environment = env) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
      const child = spawn(binary, args, {
        env: environment,
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => child.kill("SIGKILL"), 90_000);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        done({ code, stdout, stderr });
      });
      child.stdin.end(input);
    });
  const node = (args: string[]) => run(resolve(env.ADC_BIN_DIR!, "adc-node"), args);
  const cli = (args: string[], input = "") => run(resolve(env.ADC_BIN_DIR!, "adc"), args, input);
  const post = async (path: string, body: object) => {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { origin, cookie: cookie ?? "", "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const value = (await response.json()) as any;
    expect(response.status, JSON.stringify(value)).toBe(200);
    return { response, value };
  };
  const getNodes = async () => {
    const response = await fetch(`${origin}/api/v1/nodes`, { headers: { cookie } });
    expect(response.status).toBe(200);
    return ((await response.json()) as any).nodes as any[];
  };
  const install = async (args: string[]) => {
    const response = await fetch(`${origin}/install.sh`);
    expect(response.status).toBe(200);
    return run("/bin/sh", ["-s", "--", "--url", origin, ...args], await response.text());
  };
  const stopDaemon = async () => {
    if (!daemon || daemon.exitCode !== null || daemon.signalCode !== null) return;
    const current = daemon;
    await new Promise<void>((done) => {
      const timeout = setTimeout(() => current.kill("SIGKILL"), 10_000);
      current.once("exit", () => {
        clearTimeout(timeout);
        done();
      });
      current.kill("SIGTERM");
    });
    daemon = undefined;
  };
  const startDaemon = () => {
    daemon = spawn(resolve(env.ADC_BIN_DIR!, "adc-node"), ["run"], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    daemon.stdout?.resume();
    daemon.stderr?.resume();
  };

  beforeAll(async () => {
    await mkdir(resolve(projectRoot, ".adc"), { recursive: true });
    directory = await mkdtemp(resolve(projectRoot, ".adc/install-e2e-"));
    const user = resolve(directory, "user ' $literal & spaces");
    releases = resolve(directory, "releases");
    env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("ADC_"))),
      // The installed program must work without Node.js, pnpm or a checkout on PATH.
      PATH: "/usr/bin:/bin",
      ADC_INSTALL_DIR: resolve(user, "program"),
      ADC_BIN_DIR: resolve(user, "bin"),
      ADC_NODE_CONFIG: resolve(user, "config/node.json"),
      ADC_CONFIG: resolve(user, "config/cli.json"),
      ADC_SERVICE_DIR: resolve(user, "services")
    };
    await mkdir(resolve(user, "workspace"), { recursive: true });
    await writeFile(resolve(user, "workspace/hello.txt"), "Installed client reads this file.\n");
    const build = await run(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/build-node.ts",
        "--targets",
        `${process.platform}-${process.arch}`,
        "--out-dir",
        releases
      ],
      "",
      process.env
    );
    expect(build.code, build.stderr).toBe(0);
    const socket = createServer();
    await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
    const address = socket.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP port");
    origin = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((done, reject) =>
      socket.close((error) => (error ? reject(error) : done()))
    );
    postgres = await PostgresMemoryServer.create({
      database: "adc_install",
      username: "adc_install",
      password: "adc_install"
    });
    const store = new PostgresStore(postgres.getUri());
    app = await createControlPlane({
      store,
      nodeDistribution: { directory: releases, publicUrl: origin },
      access: createAccessService(
        createAuthentication({
          pool: store.pool,
          baseURL: origin,
          secret: randomBytes(48).toString("base64url")
        }),
        new IdentityStore(store.pool)
      )
    });
    app.addHook("onRequest", async (request, reply) => {
      if (corruptArchive && request.url.endsWith(".tar.gz"))
        return reply.send("corrupted download");
    });
    await app.listen({ host: "127.0.0.1", port: address.port });
    const signup = await post("/api/auth/sign-up/email", {
      name: "Installer user",
      email: "installer@example.com",
      password: "Installer E2E isolated password"
    });
    cookie = signup.response.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; ");
  }, 120_000);

  afterAll(async () => {
    await stopDaemon();
    if (env && existsSync(resolve(env.ADC_BIN_DIR!, "adc-node"))) {
      const cleanup = await node(["uninstall"]);
      expect(cleanup.code, cleanup.stderr).toBe(0);
    }
    await app?.close();
    await postgres?.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 30_000);

  it("downloads, verifies, pairs, invokes, upgrades without changing identity, rejects corruption and uninstalls", async () => {
    const pairing = (await post("/api/v1/pairing-codes", { ttlSeconds: 600 })).value;
    const response = await fetch(`${origin}/api/v1/node-installation`, { headers: { cookie } });
    expect(await response.json()).toMatchObject({
      available: true,
      installerUrl: `${origin}/downloads/node/install.sh`
    });
    expect((await fetch(`${origin}/downloads/node/missing.tar.gz`)).status).toBe(404);
    const rootPath = resolve(directory, "user ' $literal & spaces/workspace");
    await mkdir(resolve(env.ADC_INSTALL_DIR!, ".install-lock"), { recursive: true });
    await writeFile(resolve(env.ADC_INSTALL_DIR!, ".adc-installation"), "Agent Device Cloud\n");
    const installed = await install([
      "--code",
      pairing.code,
      "--label",
      "Installed device",
      "--root-path",
      rootPath,
      "--no-service"
    ]);
    expect(installed.code, `${installed.stderr}\n${installed.stdout}`).toBe(0);
    const original = await readFile(env.ADC_NODE_CONFIG!, "utf8");
    expect((await stat(env.ADC_NODE_CONFIG!)).mode & 0o777).toBe(0o600);
    expect((await node(["--version"])).stdout.trim()).toBe("0.1.0");
    expect((await cli(["--help"])).code).toBe(0);
    startDaemon();
    await expect.poll(async () => (await getNodes())[0]?.online, { timeout: 15_000 }).toBe(true);
    const nodeId = JSON.parse(original).nodeId as string;
    const project = (await post("/api/v1/projects", { label: "Installed project" })).value;
    await post(`/api/v1/projects/${project.projectId}/roots`, {
      rootId: "root_workspace",
      nodeId,
      label: "Workspace",
      writable: true
    });
    const grant = (
      await post("/api/v1/grants", {
        name: "Installed reader",
        projectId: project.projectId,
        profile: "read-only",
        nodeIds: [nodeId],
        rootIds: ["root_workspace"],
        allowedTools: ["file.read", "task.result"]
      })
    ).value;
    const credential = (
      await post("/api/v1/credentials", { grantId: grant.grantId, name: "Installer CLI" })
    ).value;
    const imported = await cli(
      ["auth", "token", "--url", origin, "--stdin", "--json"],
      `${credential.token}\n`
    );
    expect(imported.code, imported.stderr).toBe(0);
    const call = await cli([
      "invoke",
      "file.read",
      "--node",
      nodeId,
      "--args",
      JSON.stringify({ path: resolve(rootPath, "hello.txt") }),
      "--json"
    ]);
    expect(call.code, call.stderr).toBe(0);
    const job = JSON.parse(call.stdout);
    await expect
      .poll(
        async () => {
          const result = await cli(["task", "result", job.jobId, "--json"]);
          expect(result.code, result.stderr).toBe(0);
          return JSON.parse(result.stdout);
        },
        { timeout: 15_000 }
      )
      .toMatchObject({
        status: "succeeded",
        output: { content: "Installed client reads this file.\n" }
      });
    await stopDaemon();
    const upgraded = await install(["--no-service"]);
    expect(upgraded.code, upgraded.stderr).toBe(0);
    expect(await readFile(env.ADC_NODE_CONFIG!, "utf8")).toBe(original);
    expect(await getNodes()).toHaveLength(1);
    const current = await readlink(resolve(env.ADC_INSTALL_DIR!, "current"));
    corruptArchive = true;
    const broken = await install(["--no-service"]);
    corruptArchive = false;
    expect(broken.code).not.toBe(0);
    expect(broken.stderr).toContain("checksum mismatch");
    expect(await readlink(resolve(env.ADC_INSTALL_DIR!, "current"))).toBe(current);
    expect(await readFile(env.ADC_NODE_CONFIG!, "utf8")).toBe(original);
    const previousSeen = (await getNodes())[0]?.lastSeenAt;
    startDaemon();
    await expect
      .poll(async () => (await getNodes())[0]?.lastSeenAt, { timeout: 15_000 })
      .not.toBe(previousSeen);
    await stopDaemon();
    const removed = await node(["uninstall"]);
    expect(removed.code, removed.stderr).toBe(0);
    expect(existsSync(env.ADC_INSTALL_DIR!)).toBe(false);
    expect(existsSync(resolve(env.ADC_BIN_DIR!, "adc"))).toBe(false);
    expect(await readFile(env.ADC_NODE_CONFIG!, "utf8")).toBe(original);
  }, 120_000);

  it.skipIf(process.platform !== "darwin" || process.env.ADC_TEST_LAUNCHD !== "1")(
    "registers launchd, restarts the actual installed daemon, and removes the service",
    async () => {
      const installed = await install(["--no-service"]);
      expect(installed.code, installed.stderr).toBe(0);
      const setup = await node(["setup"]);
      expect(setup.code, setup.stderr).toBe(0);
      const status = async () => JSON.parse((await node(["status"])).stdout);
      await expect
        .poll(status, { timeout: 15_000 })
        .toMatchObject({ registered: true, running: true });
      const serviceFile = (await status()).serviceFile as string;
      expect((await run("/usr/bin/plutil", ["-lint", serviceFile])).code).toBe(0);
      expect((await node(["stop"])).code).toBe(0);
      expect(await status()).toMatchObject({ registered: true, running: false });
      expect((await node(["start"])).code).toBe(0);
      await expect.poll(status, { timeout: 15_000 }).toMatchObject({ running: true });
      expect((await node(["restart"])).code).toBe(0);
      await expect.poll(status, { timeout: 15_000 }).toMatchObject({ running: true });
      expect((await node(["uninstall"])).code).toBe(0);
      expect(existsSync(serviceFile)).toBe(false);
      expect(existsSync(env.ADC_NODE_CONFIG!)).toBe(true);
    },
    60_000
  );
});
