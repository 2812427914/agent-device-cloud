import { describe, expect, it, vi } from "vitest";
import { buildInvocation, generateNodeKeyPair } from "@adc/client";
import type { PolicyDecision } from "@adc/protocol";
import { NodeDaemon } from "./daemon.ts";
import type { McpProviderManager } from "./mcp-providers.ts";
import type { NodeWakeSource } from "./wake.ts";

const root = { rootId: "root_workspace", path: "/workspace", writable: true, label: "Work" };
const allowed: PolicyDecision = {
  outcome: "allow",
  reasonCode: "policy.allowed",
  explanation: "Allowed",
  profile: "workspace-write",
  evaluatedLayers: ["node"],
  decisionHash: `sha256:${"a".repeat(64)}`
};

class TestWakeSource implements NodeWakeSource {
  connected = true;
  private onWake: (() => void) | undefined;

  run(onWake: () => void, signal: AbortSignal): Promise<void> {
    this.onWake = onWake;
    return new Promise((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  wake(): void {
    this.onWake?.();
  }
}

describe("NodeDaemon access reload", () => {
  it("continues refreshing Providers when local configuration is unchanged", async () => {
    const updateProviders = vi.fn().mockResolvedValue(undefined);
    const providers = {
      update: updateProviders,
      capabilities: vi.fn().mockReturnValue([]),
      execute: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined)
    } as unknown as McpProviderManager;
    const daemon = new NodeDaemon({
      controlPlaneUrl: "http://localhost:8787",
      nodeId: "node_example",
      privateKey: generateNodeKeyPair().privateKey,
      roots: [],
      stateDirectory: "/unused/state",
      mcpProviderManager: providers
    });
    vi.spyOn(daemon.api, "poll").mockResolvedValue({});

    await daemon.runOnce();
    await daemon.runOnce();

    expect(updateProviders).toHaveBeenCalledTimes(2);
  });

  it("polls immediately when the wake connection signals queued work", async () => {
    const wakeSource = new TestWakeSource();
    const daemon = new NodeDaemon({
      controlPlaneUrl: "http://localhost:8787",
      nodeId: "node_example",
      privateKey: generateNodeKeyPair().privateKey,
      roots: [],
      stateDirectory: "/unused/state",
      pollIntervalMs: 60_000,
      wakeSource
    });
    const poll = vi.spyOn(daemon.api, "poll").mockResolvedValue({});
    const controller = new AbortController();
    const running = daemon.run(controller.signal);

    await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(1));
    wakeSource.wake();
    await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(2));
    controller.abort();
    await running;
  });

  it("polls immediately when local access changes while otherwise idle", async () => {
    let roots = [] as (typeof root)[];
    const daemon = new NodeDaemon({
      controlPlaneUrl: "http://localhost:8787",
      nodeId: "node_example",
      privateKey: generateNodeKeyPair().privateKey,
      roots,
      stateDirectory: "/unused/state",
      pollIntervalMs: 60_000,
      configReloadIntervalMs: 5,
      loadAccess: async () => ({ roots, accessMode: "selected" }),
      wakeSource: new TestWakeSource()
    });
    const poll = vi.spyOn(daemon.api, "poll").mockResolvedValue({});
    const controller = new AbortController();
    const running = daemon.run(controller.signal);

    await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(1));
    roots = [root];
    await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(2));
    expect(poll.mock.calls[1]?.[0].roots).toEqual([
      { rootId: root.rootId, path: "/workspace", writable: true, label: "Work" }
    ]);
    controller.abort();
    await running;
  });

  it("advertises physical paths for review on the next poll", async () => {
    let roots = [root];
    const daemon = new NodeDaemon({
      controlPlaneUrl: "http://localhost:8787",
      nodeId: "node_example",
      privateKey: generateNodeKeyPair().privateKey,
      roots: [],
      stateDirectory: "/unused/state",
      loadAccess: async () => ({ roots, accessMode: "selected" })
    });
    const poll = vi.spyOn(daemon.api, "poll").mockResolvedValue({});
    await daemon.runOnce();
    expect(poll.mock.calls[0]?.[0].roots).toEqual([
      { rootId: root.rootId, path: "/workspace", writable: true, label: "Work" }
    ]);
    roots = [];
    await daemon.runOnce();
    expect(poll.mock.calls[1]?.[0].roots).toEqual([]);
  });

  it("does not poll with stale permissions when local configuration is invalid", async () => {
    const daemon = new NodeDaemon({
      controlPlaneUrl: "http://localhost:8787",
      nodeId: "node_example",
      privateKey: generateNodeKeyPair().privateKey,
      roots: [root],
      stateDirectory: "/unused/state",
      loadAccess: async () => {
        throw new Error("invalid local config");
      }
    });
    const poll = vi.spyOn(daemon.api, "poll");
    await expect(daemon.runOnce()).rejects.toThrow("invalid local config");
    expect(poll).not.toHaveBeenCalled();
  });

  it("cancels running work when its local folder is removed", async () => {
    let roots = [root];
    const daemon = new NodeDaemon({
      controlPlaneUrl: "http://localhost:8787",
      nodeId: "node_example",
      privateKey: generateNodeKeyPair().privateKey,
      roots,
      stateDirectory: "/unused/state",
      configReloadIntervalMs: 5,
      loadAccess: async () => ({ roots, accessMode: "selected" })
    });
    const invocation = buildInvocation({
      context: {
        accountId: "acct_example",
        actorId: "actor_example",
        grantId: "grant_example",
        nodeIds: ["node_example"],
        resourcesByNode: {
          node_example: [{ rootId: root.rootId, path: root.path }]
        },
        rootIds: [root.rootId]
      },
      tool: "shell.exec",
      args: { cwd: root.path, command: "long-running-command" },
      idempotencyKey: "daemon-cancellation",
      source: "sdk"
    });
    vi.spyOn(daemon.api, "poll").mockResolvedValue({
      dispatch: {
        invocation,
        policyDecision: allowed,
        dispatchId: "dsp_example",
        leaseToken: "test-lease"
      }
    });
    vi.spyOn(daemon.api, "acknowledge").mockResolvedValue({
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    const complete = vi.spyOn(daemon.api, "complete").mockResolvedValue({});
    vi.spyOn(daemon.runtime, "execute").mockImplementation(
      async (_invocation, _decision, signal) => {
        roots = [];
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          schemaVersion: "0.1",
          invocationId: invocation.invocationId,
          attemptId: invocation.attemptId,
          status: "cancelled"
        };
      }
    );
    expect(await daemon.runOnce()).toBe(true);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ status: "cancelled" })
      })
    );
  });
});
