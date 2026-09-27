import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdcClient,
  NodeApiClient,
  buildInvocation,
  generateNodeKeyPair
} from "../packages/client/src/index.ts";
import { MemoryStore } from "../packages/db/src/index.ts";
import { createControlPlane } from "../apps/control-plane/src/app.ts";
import { NodeDaemon } from "../apps/node/src/daemon.ts";
import { accessFixture } from "./helpers/access-fixture.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const operation of cleanup.splice(0).reverse()) await operation();
});

async function fixture() {
  const base = await mkdtemp(resolve(tmpdir(), "adc-node-boundaries-"));
  cleanup.push(() => rm(base, { recursive: true, force: true }));
  const workspace = resolve(base, "workspace");
  const privateRoot = resolve(base, "private");
  const readOnly = resolve(base, "readonly");
  await Promise.all([workspace, privateRoot, readOnly].map((path) => mkdir(path)));
  const stateDirectory = resolve(base, "state");
  const store = new MemoryStore();
  const cookie = "adc.session_token=node-boundaries";
  const app = await createControlPlane({
    store,
    access: accessFixture({ cookie }),
    leaseMs: 150,
    presenceTtlMs: 60_000
  });
  cleanup.push(() => app.close());
  let dropRenewals = false;
  let dropReceipts = false;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (
      (dropRenewals && url.pathname.endsWith("/leases/renew")) ||
      (dropReceipts && url.pathname.endsWith("/receipts"))
    ) {
      throw new TypeError("simulated disconnected device");
    }
    const response = await app.inject({
      method: (init?.method ?? "GET") as any,
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(new Headers(init?.headers)),
      ...(typeof init?.body === "string" ? { payload: init.body } : {})
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers as Record<string, string>
    });
  }) as typeof fetch;
  const owner = new AdcClient("http://adc.test", { cookie }, fetcher);
  const pairing = await owner.createPairingCode();
  const keys = generateNodeKeyPair();
  const paired = await new NodeApiClient(
    "http://adc.test",
    undefined,
    keys.privateKey,
    fetcher
  ).pair({
    code: pairing.code,
    label: "Boundaries",
    platform: "darwin",
    publicKey: keys.publicKey
  });
  const options = {
    controlPlaneUrl: "http://adc.test",
    nodeId: paired.nodeId,
    privateKey: keys.privateKey,
    roots: [
      { rootId: "root_workspace", path: workspace, writable: true },
      { rootId: "root_private", path: privateRoot, writable: true },
      { rootId: "root_readonly", path: readOnly, writable: false }
    ],
    templates: [
      {
        projectId: "proj_example",
        templateId: "hidden",
        rootId: "root_private",
        command: "printf wrong > touched",
        timeoutMs: 5000,
        readOnly: false
      },
      {
        projectId: "proj_example",
        templateId: "test",
        rootId: "root_workspace",
        command: "printf ok",
        timeoutMs: 5000,
        readOnly: true
      }
    ],
    stateDirectory,
    fetcher,
    leaseRenewIntervalMs: 30
  };
  const daemon = new NodeDaemon(options);
  await daemon.runOnce();
  const post = async (path: string, payload: object) => {
    const response = await app.inject({
      method: "POST",
      url: path,
      headers: { cookie, origin: "http://adc.test" },
      payload
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };
  await post("/api/v1/projects", { projectId: "proj_example", label: "Example" });
  for (const root of options.roots.filter((r) => r.rootId !== "root_private")) {
    await post("/api/v1/projects/proj_example/roots", {
      rootId: root.rootId,
      nodeId: paired.nodeId,
      label: root.rootId,
      writable: root.writable
    });
  }
  await post("/api/v1/grants", {
    grantId: "grant_example",
    actorId: "actor_example",
    projectId: "proj_example",
    profile: "workspace-write",
    nodeIds: [paired.nodeId],
    rootIds: ["root_workspace", "root_readonly"],
    allowedTools: [
      "file.read",
      "file.write",
      "file.edit",
      "shell.exec",
      "test.run",
      "command.template.list",
      "command.template.run"
    ]
  });
  const invocation = (tool: string, args: unknown, timeoutMs = 60_000) =>
    buildInvocation({
      context: {
        accountId: "acct_primary",
        actorId: "actor_example",
        grantId: "grant_example",
        projectId: "proj_example",
        rootIds: ["root_workspace", "root_readonly"]
      },
      target: { nodeId: paired.nodeId },
      source: "sdk",
      tool,
      args,
      idempotencyKey: crypto.randomUUID(),
      timeoutMs
    });
  const run = async (tool: string, args: unknown) => {
    const queued = await owner.invoke(invocation(tool, args));
    if (!queued.jobId) return queued;
    await daemon.runOnce();
    return owner.taskStatus(queued.jobId);
  };
  return {
    app,
    base,
    workspace,
    privateRoot,
    stateDirectory,
    options,
    owner,
    daemon,
    invocation,
    run,
    disconnect: (renewals: boolean, receipts: boolean) => {
      dropRenewals = renewals;
      dropReceipts = receipts;
    }
  };
}

describe("device execution through dispatch APIs", () => {
  it("enforces actual template roots, execution permissions and a clean shell environment", async () => {
    const f = await fixture();
    const templates = await f.run("command.template.list", { projectId: "proj_example" });
    expect(templates.output).toEqual({
      templates: [
        {
          templateId: "test",
          rootId: "root_workspace",
          cwd: f.workspace,
          timeoutMs: 5000,
          readOnly: true
        }
      ]
    });
    expect(
      await f.run("command.template.run", {
        projectId: "proj_example",
        rootId: "root_workspace",
        templateId: "hidden"
      })
    ).toMatchObject({ status: "denied" });
    await expect(readFile(resolve(f.privateRoot, "touched"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(
      await f.run("test.run", {
        projectId: "proj_example",
        rootId: "root_readonly",
        templateId: "test"
      })
    ).toMatchObject({ status: "denied" });
    expect(
      await f.run("shell.exec", {
        rootId: "root_workspace",
        cwd: "",
        command: "printf bad",
        env: { BASH_ENV: "startup.sh" }
      })
    ).toMatchObject({ status: "denied" });
    await writeFile(resolve(f.workspace, ".bash_profile"), "printf profile-ran");
    expect(
      await f.run("shell.exec", {
        rootId: "root_workspace",
        cwd: "",
        command: "printf clean"
      })
    ).toMatchObject({ status: "succeeded", output: { stdout: "clean" } });
    const missing = await f.run("file.read", { rootId: "root_workspace", path: "missing" });
    expect(missing.status).toBe("failed");
    expect(JSON.stringify(missing)).not.toContain(f.base);
    await writeFile(resolve(f.workspace, ".env"), "PRIVATE=value");
    await symlink(resolve(f.workspace, ".env"), resolve(f.workspace, "alias.txt"));
    expect(
      await f.run("file.read", {
        rootId: "root_workspace",
        path: "alias.txt"
      })
    ).toMatchObject({ status: "denied" });
  });

  it("publishes createOnly atomically across workers and leaves a verifiable receipt", async () => {
    const f = await fixture();
    const jobs = await Promise.all(
      ["first", "second"].map((content) =>
        f.owner.invoke(
          f.invocation("file.write", {
            rootId: "root_workspace",
            path: "race.txt",
            content,
            createOnly: true
          })
        )
      )
    );
    await Promise.all([f.daemon.runOnce(), new NodeDaemon(f.options).runOnce()]);
    const results = await Promise.all(jobs.map((job) => f.owner.taskStatus(job.jobId!)));
    expect(results.filter((result) => result.status === "succeeded")).toHaveLength(1);
    expect(results.filter((result) => result.error?.code === "conflict")).toHaveLength(1);
    const winner = results.findIndex((result) => result.status === "succeeded");
    expect(await readFile(resolve(f.workspace, "race.txt"), "utf8")).toBe(
      ["first", "second"][winner]
    );
    const entries = await readdir(resolve(f.stateDirectory, "receipts"));
    expect(entries).toHaveLength(2);
    for (const file of entries) {
      expect(
        JSON.parse(await readFile(resolve(f.stateDirectory, "receipts", file), "utf8"))
      ).toMatchObject({ state: "completed" });
    }
  });

  it("stops on lost lease and reconciles a cancelled task after reconnecting", async () => {
    const f = await fixture();
    const job = await f.owner.invoke(
      f.invocation("shell.exec", {
        rootId: "root_workspace",
        cwd: "",
        command: "sleep 1; printf bad > late.txt",
        timeoutMs: 5000
      })
    );
    f.disconnect(true, true);
    await expect(f.daemon.runOnce()).rejects.toThrow("simulated disconnected");
    await f.owner.cancelTask(job.jobId!);
    f.disconnect(false, false);
    await expect(new NodeDaemon(f.options).runOnce()).resolves.toBe(true);
    expect(await f.owner.taskStatus(job.jobId!)).toMatchObject({
      status: "cancelled",
      receipt: { replayed: true, terminalStatus: "cancelled" }
    });
    await expect(readFile(resolve(f.workspace, "late.txt"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("replays a completed effect after invocation expiry and refuses expired new work", async () => {
    const f = await fixture();
    const invocation = f.invocation(
      "shell.exec",
      {
        rootId: "root_workspace",
        cwd: "",
        command: "printf x >> once.txt",
        timeoutMs: 5000
      },
      250
    );
    const job = await f.owner.invoke(invocation);
    f.disconnect(false, true);
    await expect(f.daemon.runOnce()).rejects.toThrow("simulated disconnected");
    const expiredJob = await f.owner.invoke(
      f.invocation(
        "file.write",
        {
          rootId: "root_workspace",
          path: "expired.txt",
          content: "bad"
        },
        100
      )
    );
    await new Promise((done) => setTimeout(done, 300));
    f.disconnect(false, false);
    const restarted = new NodeDaemon(f.options);
    await restarted.runOnce();
    await restarted.runOnce();
    expect(await f.owner.taskStatus(job.jobId!)).toMatchObject({
      status: "succeeded",
      receipt: { replayed: true }
    });
    expect(await readFile(resolve(f.workspace, "once.txt"), "utf8")).toBe("x");
    expect(await f.owner.taskStatus(expiredJob.jobId!)).toMatchObject({
      status: "failed",
      error: { code: "expired" }
    });
    await expect(readFile(resolve(f.workspace, "expired.txt"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("propagates shutdown to an active process and persists cancellation", async () => {
    const f = await fixture();
    const job = await f.owner.invoke(
      f.invocation("shell.exec", {
        rootId: "root_workspace",
        cwd: "",
        command: "sleep 2; printf bad > stopped.txt",
        timeoutMs: 5000
      })
    );
    const running = f.daemon.runOnce();
    await new Promise((done) => setTimeout(done, 50));
    f.daemon.stop();
    await running;
    expect(await f.owner.taskStatus(job.jobId!)).toMatchObject({ status: "cancelled" });
    await expect(readFile(resolve(f.workspace, "stopped.txt"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
