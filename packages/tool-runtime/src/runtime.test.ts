import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InvocationSchema, createId, type Invocation, type PolicyDecision } from "@adc/protocol";
import { ReceiptLedger } from "./receipt-ledger.ts";
import { ToolRuntime } from "./runtime.ts";

const temporaryDirectories: string[] = [];
const allowed: PolicyDecision = {
  outcome: "allow",
  reasonCode: "policy.allowed",
  explanation: "Allowed by test.",
  evaluatedLayers: ["account", "agent", "node", "root", "capability"],
  profile: "workspace-write",
  decisionHash: `sha256:${"a".repeat(64)}`
};

async function fixture() {
  const base = await mkdtemp(resolve(tmpdir(), "adc-runtime-"));
  temporaryDirectories.push(base);
  const root = resolve(base, "workspace");
  const outside = resolve(base, "outside");
  const state = resolve(base, "state");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(resolve(root, "source.txt"), "hello\nAPI_KEY=super-secret-value\n");
  await writeFile(resolve(outside, "secret.txt"), "outside");
  const runtime = new ToolRuntime({
    nodeId: "node_macbook",
    roots: [{ rootId: "root_workspace", path: root, writable: true }],
    templates: [
      {
        projectId: "proj_example",
        templateId: "test",
        rootId: "root_workspace",
        command: "printf 'tests passed'",
        timeoutMs: 5000,
        readOnly: true
      }
    ],
    stateDirectory: state,
    outputLimitBytes: 128
  });
  return { base, root, outside, state, runtime };
}

function invocation(
  tool: string,
  args: Record<string, unknown>,
  options: { key?: string; invocationId?: string } = {}
): Invocation {
  const now = new Date();
  return InvocationSchema.parse({
    schemaVersion: "0.1",
    invocationId: options.invocationId ?? createId("inv"),
    attemptId: createId("att"),
    accountId: "acct_primary",
    actor: { type: "agent", id: "actor_testagent" },
    target: { nodeId: "node_macbook" },
    authorization: {
      projectId: "proj_example",
      rootIds: ["root_workspace"],
      grantId: "grant_example"
    },
    tool,
    args,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    ...(options.key ? { idempotencyKey: options.key } : {}),
    metadata: { source: "sdk" }
  });
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe("ToolRuntime", () => {
  it("preserves relative paths and URLs when exposing the filesystem root", async () => {
    const { root, state } = await fixture();
    const content = "src/index.ts\nhttps://example.com/docs\n";
    await writeFile(resolve(root, "paths.txt"), content);
    const runtime = new ToolRuntime({
      nodeId: "node_macbook",
      roots: [{ rootId: "root_workspace", path: "/", writable: false }],
      stateDirectory: state
    });
    const result = await runtime.execute(
      invocation("file.read", {
        rootId: "root_workspace",
        path: (await realpath(resolve(root, "paths.txt"))).slice(1)
      }),
      allowed
    );
    expect(result.status).toBe("succeeded");
    expect((result.output as any).content).toBe(content);
  });

  it("resolves absolute paths locally and keeps physical paths visible in output", async () => {
    const { root, runtime } = await fixture();
    const read = await runtime.execute(
      invocation("file.read", { path: resolve(root, "source.txt") }),
      allowed
    );
    expect(read).toMatchObject({
      status: "succeeded",
      output: { content: expect.stringContaining("hello") }
    });

    const shell = await runtime.execute(
      invocation(
        "shell.exec",
        { cwd: root, command: "pwd", timeoutMs: 1000 },
        { key: "absolute-cwd" }
      ),
      allowed
    );
    expect(shell).toMatchObject({ status: "succeeded" });
    expect((shell.output as any).stdout.trim()).toBe(await realpath(root));
  });

  it("reads within a selected root and redacts likely secrets", async () => {
    const { runtime } = await fixture();
    const result = await runtime.execute(
      invocation("file.read", { rootId: "root_workspace", path: "source.txt" }),
      allowed
    );
    expect(result.status).toBe("succeeded");
    expect((result.output as any).content).toContain("API_KEY=[REDACTED]");
    expect((result.output as any).content).not.toContain("super-secret-value");
  });

  it("allows protected filenames and ordinary OS commands only with explicit full trust", async () => {
    const { root, runtime } = await fixture();
    await writeFile(resolve(root, ".env"), "DEMO=local-fixture\n");
    const read = invocation("file.read", { rootId: "root_workspace", path: ".env" });
    expect((await runtime.execute(read, allowed)).status).toBe("denied");
    runtime.updateAccess([{ rootId: "root_workspace", path: root, writable: true }], [], true);
    expect(await runtime.execute(read, allowed)).toMatchObject({
      status: "succeeded",
      output: { content: "DEMO=local-fixture\n" }
    });
    const result = await runtime.execute(
      invocation(
        "shell.exec",
        {
          rootId: "root_workspace",
          cwd: "",
          command: "/usr/bin/printf '%s' \"$ADC_TEST_VALUE\"",
          env: { ADC_TEST_VALUE: "os-command-ok", NODE_OPTIONS: "" }
        },
        { key: "full-trust-shell" }
      ),
      allowed
    );
    expect(result).toMatchObject({ status: "succeeded", output: { stdout: "os-command-ok" } });
  });

  it("applies removed roots immediately without discarding durable receipts", async () => {
    const { runtime } = await fixture();
    const write = invocation(
      "file.write",
      {
        rootId: "root_workspace",
        path: "receipt.txt",
        content: "once"
      },
      { key: "reload-receipt" }
    );
    expect((await runtime.execute(write, allowed)).status).toBe("succeeded");
    runtime.updateAccess([], [], false);
    expect(await runtime.execute(write, allowed)).toMatchObject({
      status: "succeeded",
      receipt: { replayed: true }
    });
    expect(
      await runtime.execute(
        invocation("file.read", { rootId: "root_workspace", path: "receipt.txt" }),
        allowed
      )
    ).toMatchObject({ status: "denied", error: { code: "denied" } });
  });

  it("keeps a local read-only root read-only even with full trust", async () => {
    const { root, runtime } = await fixture();
    runtime.updateAccess([{ rootId: "root_workspace", path: root, writable: false }], [], true);
    expect(
      await runtime.execute(
        invocation(
          "shell.exec",
          {
            rootId: "root_workspace",
            cwd: "",
            command: "/usr/bin/printf denied"
          },
          { key: "full-trust-read-only" }
        ),
        allowed
      )
    ).toMatchObject({ status: "denied" });
  });

  it("blocks symlink escapes on read and write", async () => {
    const { root, outside, runtime } = await fixture();
    await symlink(resolve(outside, "secret.txt"), resolve(root, "escape.txt"));
    const read = await runtime.execute(
      invocation("file.read", { rootId: "root_workspace", path: "escape.txt" }),
      allowed
    );
    expect(read).toMatchObject({ status: "denied", error: { code: "denied" } });

    await symlink(outside, resolve(root, "outside-link"));
    const write = await runtime.execute(
      invocation(
        "file.write",
        { rootId: "root_workspace", path: "outside-link/new.txt", content: "bad" },
        { key: "symlink-write" }
      ),
      allowed
    );
    expect(write).toMatchObject({ status: "denied", error: { code: "denied" } });
  });

  it("persists side-effect idempotency and replays the first receipt", async () => {
    const { root, runtime } = await fixture();
    const args = { rootId: "root_workspace", path: "output.txt", content: "first" };
    const first = await runtime.execute(
      invocation("file.write", args, { key: "same-write" }),
      allowed
    );
    expect(first.status).toBe("succeeded");

    const replay = await runtime.execute(
      invocation("file.write", args, { key: "same-write" }),
      allowed
    );
    expect(replay.status).toBe("succeeded");
    expect(replay.receipt?.replayed).toBe(true);
    await expect(readFile(resolve(root, "output.txt"), "utf8")).resolves.toBe("first");

    const conflict = await runtime.execute(
      invocation(
        "file.write",
        { rootId: "root_workspace", path: "output.txt", content: "different" },
        { key: "same-write" }
      ),
      allowed
    );
    expect(conflict).toMatchObject({ status: "failed", error: { code: "conflict" } });
  });

  it("returns unknown_outcome for an orphaned started ledger entry", async () => {
    const { state, runtime } = await fixture();
    const pending = invocation(
      "file.write",
      { rootId: "root_workspace", path: "orphan.txt", content: "uncertain" },
      { key: "orphaned-write" }
    );
    await new ReceiptLedger(resolve(state, "receipts")).begin({
      scope: `${pending.accountId}:${pending.actor.id}`,
      idempotencyKey: pending.idempotencyKey!,
      input: { tool: pending.tool, args: pending.args, target: pending.target },
      invocationId: pending.invocationId,
      attemptId: pending.attemptId,
      now: new Date()
    });
    const result = await runtime.execute(pending, allowed);
    expect(result).toMatchObject({
      status: "unknown_outcome",
      error: { code: "unknown_outcome" },
      receipt: { terminalStatus: "unknown_outcome" }
    });
  });

  it("runs approved templates and rejects dangerous shell commands", async () => {
    const { root, runtime } = await fixture();
    const testResult = await runtime.execute(
      invocation("test.run", { projectId: "proj_example", cwd: root }, { key: "test-template" }),
      allowed
    );
    expect(testResult.status).toBe("succeeded");
    expect((testResult.output as any).stdout).toBe("tests passed");

    const denied = await runtime.execute(
      invocation(
        "shell.exec",
        {
          rootId: "root_workspace",
          cwd: "",
          command: "curl https://example.com",
          timeoutMs: 1000
        },
        { key: "network-command" }
      ),
      allowed
    );
    expect(denied).toMatchObject({
      status: "denied",
      error: { details: { reasonCode: "shell.network" } }
    });

    const absolutePath = await runtime.execute(
      invocation(
        "shell.exec",
        {
          rootId: "root_workspace",
          cwd: "",
          command: "cat /etc/passwd",
          timeoutMs: 1000
        },
        { key: "absolute-command" }
      ),
      allowed
    );
    expect(absolutePath).toMatchObject({
      status: "denied",
      error: { details: { reasonCode: "shell.absolute_path" } }
    });
  });

  it("truncates large shell output and stores an opaque artifact reference", async () => {
    const { runtime } = await fixture();
    const result = await runtime.execute(
      invocation(
        "shell.exec",
        {
          rootId: "root_workspace",
          cwd: "",
          command: "printf '%0200d' 1",
          timeoutMs: 1000
        },
        { key: "large-output" }
      ),
      allowed
    );
    expect(result.status).toBe("succeeded");
    expect((result.output as any).truncated).toBe(true);
    expect(result.receipt?.artifactRefs[0]).toMatch(/^artifact_/);
    expect(result.receipt?.artifactRefs[0]).not.toContain("/");
  });

  it("cancels a running process group and records a cancelled receipt", async () => {
    const { runtime } = await fixture();
    const cancellation = new AbortController();
    setTimeout(() => cancellation.abort(), 50);
    const result = await runtime.execute(
      invocation(
        "shell.exec",
        {
          rootId: "root_workspace",
          cwd: "",
          command: "sleep 5",
          timeoutMs: 10_000
        },
        { key: "cancel-shell" }
      ),
      allowed,
      cancellation.signal
    );
    expect(result).toMatchObject({
      status: "cancelled",
      error: { code: "cancelled" },
      receipt: { terminalStatus: "cancelled", sideEffect: true }
    });
  });

  it("executes a custom provider tool once and replays its durable receipt", async () => {
    const base = await mkdtemp(resolve(tmpdir(), "adc-runtime-provider-"));
    temporaryDirectories.push(base);
    let calls = 0;
    const runtime = new ToolRuntime({
      nodeId: "node_macbook",
      roots: [],
      stateDirectory: resolve(base, "state"),
      externalExecutor: async (tool, args) => {
        calls++;
        return {
          output: { tool, args, content: [{ type: "text", text: "ok" }] },
          artifactRefs: [],
          succeeded: true
        };
      }
    });
    const tool = "mcp.github.search.1234abcd";
    const first = await runtime.execute(
      invocation(
        tool,
        { query: "is:open", rootId: "provider_owned_value" },
        { key: "search-once" }
      ),
      allowed
    );
    const replay = await runtime.execute(
      invocation(
        tool,
        { query: "is:open", rootId: "provider_owned_value" },
        { key: "search-once" }
      ),
      allowed
    );
    expect(first).toMatchObject({
      status: "succeeded",
      receipt: { tool, sideEffect: true, replayed: false }
    });
    expect(replay).toMatchObject({
      status: "succeeded",
      receipt: { tool, sideEffect: true, replayed: true }
    });
    expect(calls).toBe(1);
  });
});
