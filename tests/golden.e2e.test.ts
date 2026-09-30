import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AdcClient, buildInvocation } from "../packages/client/src/index.ts";
import { NodeApiClient, generateNodeKeyPair } from "../packages/client/src/node.ts";
import { MemoryStore } from "../packages/db/src/index.ts";
import { createControlPlane } from "../apps/control-plane/src/app.ts";
import { NodeDaemon } from "../apps/node/src/daemon.ts";
import { accessFixture } from "./helpers/access-fixture.ts";

const cleanup: Array<() => Promise<void>> = [];
const cookie = "adc.session_token=golden-path-session";

function fetchFor(
  app: Awaited<ReturnType<typeof createControlPlane>>,
  before?: (path: string) => "drop-before" | "drop-after" | undefined
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const behavior = before?.(url.pathname);
    if (behavior === "drop-before") throw new TypeError("simulated connection loss");
    const injection: InjectOptions = {
      method: (init?.method ?? "GET") as any,
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(typeof init?.body === "string" ? { payload: init.body } : {})
    };
    const response: LightMyRequestResponse = await app.inject(injection);
    if (behavior === "drop-after") throw new TypeError("simulated response loss");
    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers as unknown as Record<string, string>
    });
  }) as typeof fetch;
}

async function ownerPost(
  app: Awaited<ReturnType<typeof createControlPlane>>,
  path: string,
  payload: unknown
) {
  return app.inject({
    method: "POST",
    url: path,
    headers: { cookie, origin: "http://adc.test" },
    payload: payload as any
  });
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((operation) => operation()));
});

describe("Agent Device Cloud golden path", () => {
  it("pairs, places, executes, audits and recovers without duplicating a side effect", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "adc-e2e-"));
    const stateDirectory = resolve(workspace, ".node-state");
    await mkdir(stateDirectory);
    cleanup.push(() => rm(workspace, { recursive: true, force: true }));

    const store = new MemoryStore();
    const app = await createControlPlane({
      store,
      access: accessFixture({ cookie }),
      leaseMs: 25,
      presenceTtlMs: 60_000
    });
    cleanup.push(() => app.close());
    const normalFetch = fetchFor(app);
    const owner = new AdcClient("http://adc.test", { cookie }, normalFetch);

    const pairing = await owner.createPairingCode();
    const keys = generateNodeKeyPair();
    const paired = await new NodeApiClient(
      "http://adc.test",
      undefined,
      keys.privateKey,
      normalFetch
    ).pair({
      code: pairing.code,
      label: "golden-node",
      platform: "darwin",
      publicKey: keys.publicKey
    });

    const daemonOptions = {
      controlPlaneUrl: "http://adc.test",
      nodeId: paired.nodeId,
      privateKey: keys.privateKey,
      roots: [{ rootId: "root_workspace", path: workspace, writable: true }],
      templates: [
        {
          projectId: "proj_example",
          templateId: "test",
          rootId: "root_workspace",
          command: "test -f run.log",
          timeoutMs: 5000,
          readOnly: true
        }
      ],
      stateDirectory
    };
    const daemon = new NodeDaemon({ ...daemonOptions, fetcher: normalFetch });
    await expect(daemon.runOnce()).resolves.toBe(false);

    for (const [path, body] of [
      ["/api/v1/projects", { projectId: "proj_example", label: "Example" }],
      [
        "/api/v1/projects/proj_example/roots",
        {
          rootId: "root_workspace",
          nodeId: paired.nodeId,
          label: "Workspace",
          writable: true
        }
      ],
      [
        "/api/v1/grants",
        {
          grantId: "grant_example",
          projectId: "proj_example",
          actorId: "actor_testagent",
          profile: "workspace-write",
          nodeIds: [paired.nodeId],
          rootIds: ["root_workspace"],
          allowedTools: ["file.read", "file.write", "file.edit", "shell.exec", "test.run"]
        }
      ]
    ] as const) {
      const response = await ownerPost(app, path, body);
      expect(response.statusCode, response.body).toBe(200);
    }

    const invokeContext = {
      accountId: "acct_primary",
      actorId: "actor_testagent",
      grantId: "grant_example",
      projectId: "proj_example",
      nodeIds: [paired.nodeId],
      resourcesByNode: {
        [paired.nodeId]: [{ rootId: "root_workspace", path: workspace }]
      },
      rootIds: ["root_workspace"]
    };
    const shellInvocation = buildInvocation({
      context: invokeContext,
      tool: "shell.exec",
      args: {
        cwd: workspace,
        command: "printf x >> run.log",
        timeoutMs: 5000
      },
      target: { nodeId: paired.nodeId },
      source: "skill",
      idempotencyKey: "golden-append-once"
    });
    const queued = await owner.invoke(shellInvocation);
    expect(queued.status).toBe("queued");

    let dropCompletion = true;
    const lossyFetch = fetchFor(app, (path) => {
      if (dropCompletion && path.endsWith("/receipts")) {
        dropCompletion = false;
        return "drop-before";
      }
      return undefined;
    });
    const firstAttempt = new NodeDaemon({ ...daemonOptions, fetcher: lossyFetch });
    await expect(firstAttempt.runOnce()).rejects.toThrow("simulated connection loss");
    await expect(readFile(resolve(workspace, "run.log"), "utf8")).resolves.toBe("x");

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 35));
    const restarted = new NodeDaemon({ ...daemonOptions, fetcher: normalFetch });
    await expect(restarted.runOnce()).resolves.toBe(true);
    await expect(readFile(resolve(workspace, "run.log"), "utf8")).resolves.toBe("x");
    const shellResult = await owner.taskStatus(queued.jobId!);
    expect(shellResult).toMatchObject({
      status: "succeeded",
      receipt: { replayed: true, sideEffect: true }
    });

    const testInvocation = buildInvocation({
      context: invokeContext,
      tool: "test.run",
      args: {
        projectId: "proj_example",
        rootId: "root_workspace",
        templateId: "test",
        timeoutMs: 5000
      },
      target: { projectId: "proj_example" },
      source: "mcp",
      idempotencyKey: "golden-test-once"
    });
    const testQueued = await owner.invoke(testInvocation);
    await expect(restarted.runOnce()).resolves.toBe(true);
    await expect(owner.taskStatus(testQueued.jobId!)).resolves.toMatchObject({
      status: "succeeded",
      output: { exitCode: 0 }
    });

    const artifactInvocation = buildInvocation({
      context: invokeContext,
      tool: "shell.exec",
      args: {
        rootId: "root_workspace",
        cwd: "",
        command: "printf '%070000d' 1",
        timeoutMs: 5000
      },
      target: { projectId: "proj_example" },
      source: "sdk",
      idempotencyKey: "golden-artifact-once"
    });
    const artifactQueued = await owner.invoke(artifactInvocation);
    await expect(restarted.runOnce()).resolves.toBe(true);
    const artifactResult = await owner.taskStatus(artifactQueued.jobId!);
    const artifactId = artifactResult.receipt?.artifactRefs[0];
    expect(artifactResult).toMatchObject({
      status: "succeeded",
      output: { truncated: true }
    });
    expect(artifactId).toMatch(/^artifact_/);
    await expect(owner.artifact(artifactId!)).resolves.toHaveLength(70_015);

    const cancellationInvocation = buildInvocation({
      context: invokeContext,
      tool: "shell.exec",
      args: {
        rootId: "root_workspace",
        cwd: "",
        command: "sleep 5",
        timeoutMs: 10_000
      },
      target: { projectId: "proj_example" },
      source: "sdk",
      idempotencyKey: "golden-cancel-once"
    });
    const cancellationQueued = await owner.invoke(cancellationInvocation);
    const cancellableNode = new NodeDaemon({
      ...daemonOptions,
      fetcher: normalFetch,
      leaseRenewIntervalMs: 10
    });
    const running = cancellableNode.runOnce();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
    await expect(owner.cancelTask(cancellationQueued.jobId!)).resolves.toMatchObject({
      status: "running"
    });
    await expect(running).resolves.toBe(true);
    await expect(owner.taskStatus(cancellationQueued.jobId!)).resolves.toMatchObject({
      status: "cancelled",
      error: { code: "cancelled" },
      receipt: { terminalStatus: "cancelled" }
    });

    const audit = await owner.audit();
    expect(audit.map((event: any) => event.type)).toEqual([
      "grant.saved",
      "dispatch.queued",
      "dispatch.completed",
      "dispatch.queued",
      "dispatch.completed",
      "dispatch.queued",
      "dispatch.completed",
      "dispatch.queued",
      "task.cancel_requested",
      "dispatch.completed"
    ]);
    expect((audit[1] as any).payload.policyDecision.outcome).toBe("allow");
    expect((audit[1] as any).payload).toMatchObject({
      nodeId: paired.nodeId,
      tool: "shell.exec",
      path: workspace
    });
    expect(shellInvocation.args).toEqual({
      cwd: workspace,
      command: "printf x >> run.log",
      timeoutMs: 5000,
      env: {}
    });
  });
});
