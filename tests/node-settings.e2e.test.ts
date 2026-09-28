import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { AdcClient, buildInvocation } from "../packages/client/src/index.ts";
import { MemoryStore } from "../packages/db/src/index.ts";
import { createControlPlane } from "../apps/control-plane/src/app.ts";
import { accessFixture } from "./helpers/access-fixture.ts";

describe("connector folder management", () => {
  it("pairs without a folder and reloads added or removed folders in a running connector", async () => {
    const base = await mkdtemp(resolve(tmpdir(), "adc-settings-"));
    const configPath = resolve(base, "node.json");
    const rootPath = resolve(base, "work");
    await mkdir(rootPath);
    await writeFile(resolve(rootPath, "hello.txt"), "hot reload works\n");
    const store = new MemoryStore();
    const cookie = "adc.session_token=settings";
    const access = accessFixture({
      cookie,
      agents: {
        "settings-agent": { accountId: "acct_primary", grantId: "grant_settings" }
      }
    });
    const app = await createControlPlane({ store, access });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    access.origin = address;
    const env = { ...process.env, ADC_NODE_CONFIG: configPath };
    const run = async (...args: string[]) =>
      JSON.parse(
        (
          await promisify(execFile)(
            process.execPath,
            ["--import", "tsx", "apps/node/src/main.ts", ...args],
            { env }
          )
        ).stdout
      );
    let daemon: ChildProcess | undefined;
    try {
      const owner = new AdcClient(address, { cookie });
      const code = (await owner.createPairingCode()).code;
      const paired = await run(
        "pair",
        "--url",
        address,
        "--code",
        code,
        "--label",
        "No folder yet"
      );
      const before = JSON.parse(await readFile(configPath, "utf8"));
      expect(before.accessMode).toBe("none");
      expect(before.roots).toEqual([]);
      daemon = spawn(process.execPath, ["--import", "tsx", "apps/node/src/main.ts", "run"], {
        env,
        stdio: ["ignore", "ignore", "pipe"]
      });
      let stderr = "";
      daemon.stderr?.on("data", (data) => {
        stderr += data;
      });
      await expect
        .poll(async () => (await store.getNode(paired.nodeId))?.capability?.accessMode, {
          timeout: 10_000
        })
        .toBe("none");
      const grant = await app.inject({
        method: "POST",
        url: "/api/v1/grants",
        headers: { cookie, origin: address },
        payload: {
          grantId: "grant_settings",
          nodeIds: [paired.nodeId],
          rootAccess: "all",
          allowedTools: ["file.read", "task.result"],
          approvalPolicy: "never"
        }
      });
      expect(grant.statusCode).toBe(200);
      await run("roots", "add", rootPath, "--root-id", "root_hot", "--label", "Work");
      await run(
        "templates",
        "add",
        "test",
        "--root",
        "root_hot",
        "--command",
        "pnpm test",
        "--timeout",
        "120000"
      );
      expect(await run("templates", "list")).toEqual({
        templates: [
          {
            templateId: "test",
            rootId: "root_hot",
            command: "pnpm test",
            timeoutMs: 120000,
            readOnly: false
          }
        ]
      });
      await run("templates", "remove", "test");
      expect(await run("templates", "list")).toEqual({ templates: [] });
      const repeated = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/node/src/main.ts",
          "setup",
          "--url",
          address,
          "--access",
          "none",
          "--no-service"
        ],
        { env }
      );
      expect(repeated.stdout).toContain("Identity and folders preserved");
      const updatedConfig = JSON.parse(await readFile(configPath, "utf8"));
      expect(updatedConfig.roots).toHaveLength(1);
      await expect
        .poll(async () => (await store.getNode(paired.nodeId))?.capability?.roots, {
          timeout: 10_000
        })
        .toEqual([
          {
            rootId: "root_hot",
            path: updatedConfig.roots[0].path,
            label: "Work",
            writable: true
          }
        ]);
      const agent = new AdcClient(address, "settings-agent");
      const me = await agent.me();
      if (me.kind !== "agent") throw new Error("agent expected");
      const result = await agent.invoke(
        buildInvocation({
          context: me.context,
          tool: "file.read",
          args: { rootId: "root_hot", path: "hello.txt" },
          source: "sdk"
        })
      );
      expect(result.status).toBe("queued");
      await expect
        .poll(() => agent.taskStatus(result.jobId!), { timeout: 10_000 })
        .toMatchObject({ status: "succeeded", output: { content: "hot reload works\n" } });
      await run("roots", "remove", "root_hot");
      await expect
        .poll(async () => (await store.getNode(paired.nodeId))?.capability?.roots, {
          timeout: 10_000
        })
        .toEqual([]);
      const after = JSON.parse(await readFile(configPath, "utf8"));
      expect(after.nodeId).toBe(before.nodeId);
      expect(after.privateKey).toBe(before.privateKey);
      expect(daemon.exitCode, stderr).toBeNull();
    } finally {
      if (daemon && daemon.exitCode === null) {
        const ended = new Promise<void>((done) => daemon!.once("exit", () => done()));
        daemon.kill("SIGTERM");
        await ended;
      }
      await app.close();
      await rm(base, { recursive: true, force: true });
    }
  }, 30_000);

  it("unpairs only with the exact device ID, preserves receipts and permits a fresh pairing", async () => {
    const base = await mkdtemp(resolve(tmpdir(), "adc-unpair-"));
    const configPath = resolve(base, "node.json");
    const store = new MemoryStore();
    const cookie = "adc.session_token=unpair";
    const access = accessFixture({ cookie });
    const app = await createControlPlane({ store, access });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    access.origin = address;
    const env = { ...process.env, ADC_NODE_CONFIG: configPath };
    const exec = (...args: string[]) =>
      promisify(execFile)(process.execPath, ["--import", "tsx", "apps/node/src/main.ts", ...args], {
        env
      });
    try {
      const owner = new AdcClient(address, { cookie });
      const first = JSON.parse(
        (
          await exec(
            "pair",
            "--url",
            address,
            "--code",
            (await owner.createPairingCode()).code,
            "--label",
            "Replaceable Mac"
          )
        ).stdout
      );
      const config = JSON.parse(await readFile(configPath, "utf8"));
      await mkdir(config.stateDirectory, { recursive: true });
      const receipt = resolve(config.stateDirectory, "receipt-kept.json");
      await writeFile(receipt, "{}");
      await expect(exec("unpair", "--confirm", "node_wrong")).rejects.toThrow(
        "Confirmation must exactly match"
      );
      expect(JSON.parse(await readFile(configPath, "utf8")).nodeId).toBe(first.nodeId);
      const removed = await app.inject({
        method: "DELETE",
        url: `/api/v1/nodes/${first.nodeId}`,
        headers: { cookie, origin: address },
        payload: { revision: 1 }
      });
      expect(removed.statusCode, removed.body).toBe(200);
      const unpaired = JSON.parse((await exec("unpair", "--confirm", first.nodeId)).stdout);
      expect(unpaired).toMatchObject({ unpaired: true, nodeId: first.nodeId });
      await expect(readFile(configPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(receipt, "utf8")).toBe("{}");
      const second = JSON.parse(
        (
          await exec(
            "pair",
            "--url",
            address,
            "--code",
            (await owner.createPairingCode()).code,
            "--label",
            "Replaceable Mac"
          )
        ).stdout
      );
      expect(second.nodeId).not.toBe(first.nodeId);
    } finally {
      await app.close();
      await rm(base, { recursive: true, force: true });
    }
  }, 30_000);
});
