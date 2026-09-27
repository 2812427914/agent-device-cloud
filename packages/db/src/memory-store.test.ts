import { describe, expect, it } from "vitest";
import {
  InvocationSchema,
  ReceiptSchema,
  ResultSchema,
  createId,
  type Invocation
} from "@adc/protocol";
import { MemoryStore } from "./memory-store.ts";
import type { DispatchRecord } from "./types.ts";

function makeInvocation(idempotencyKey = "write-once"): Invocation {
  return InvocationSchema.parse({
    schemaVersion: "0.1",
    invocationId: createId("inv"),
    attemptId: createId("att"),
    accountId: "acct_primary",
    actor: { type: "agent", id: "actor_testagent" },
    target: { nodeId: "node_macbook" },
    authorization: {
      projectId: "proj_example",
      rootIds: ["root_workspace"],
      grantId: "grant_example"
    },
    tool: "file.write",
    args: { rootId: "root_workspace", path: "result.txt", content: "ok" },
    issuedAt: "2026-09-24T00:00:00.000Z",
    expiresAt: "2026-09-24T01:00:00.000Z",
    idempotencyKey,
    metadata: { source: "sdk" }
  });
}

function makeDispatch(invocation = makeInvocation()): DispatchRecord {
  return {
    dispatchId: createId("dsp"),
    invocation,
    nodeId: "node_macbook",
    policyDecision: {
      outcome: "allow",
      reasonCode: "policy.allowed",
      explanation: "Allowed by test.",
      evaluatedLayers: ["account", "agent", "node", "root", "capability"],
      profile: "workspace-write",
      decisionHash: `sha256:${"a".repeat(64)}`
    },
    status: "queued",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z"
  };
}

describe("MemoryStore", () => {
  it("consumes a pairing code exactly once", async () => {
    const store = new MemoryStore();
    await store.putAccount({
      accountId: "acct_primary",
      ownerTokenHash: "hash",
      createdAt: "2026-09-24T00:00:00.000Z"
    });
    await store.putPairingCode({
      codeHash: "code",
      accountId: "acct_primary",
      expiresAt: "2026-09-24T00:10:00.000Z"
    });
    const input = {
      codeHash: "code",
      now: new Date("2026-09-24T00:01:00.000Z"),
      node: {
        nodeId: "node_macbook",
        accountId: "acct_primary",
        label: "MacBook",
        publicKey: "pem",
        platform: "darwin" as const,
        status: "active" as const,
        createdAt: "2026-09-24T00:01:00.000Z"
      }
    };
    await expect(store.pairNode(input)).resolves.toMatchObject({ nodeId: "node_macbook" });
    await expect(store.pairNode(input)).resolves.toBeUndefined();
  });

  it("deduplicates side effects by actor and idempotency key", async () => {
    const store = new MemoryStore();
    const first = makeDispatch();
    const audit = {
      eventId: createId("dsp"),
      accountId: "acct_primary",
      invocationId: first.invocation.invocationId,
      type: "dispatch.queued",
      payload: {},
      createdAt: first.createdAt
    };
    await store.enqueue(first, audit);
    const duplicate = makeDispatch(makeInvocation("write-once"));
    const returned = await store.enqueue(duplicate, {
      ...audit,
      eventId: createId("dsp"),
      invocationId: duplicate.invocation.invocationId
    });
    expect(returned.dispatchId).toBe(first.dispatchId);
  });

  it("leases atomically and never regresses a terminal result", async () => {
    const store = new MemoryStore();
    const dispatch = makeDispatch();
    await store.enqueue(dispatch, {
      eventId: createId("dsp"),
      accountId: "acct_primary",
      invocationId: dispatch.invocation.invocationId,
      type: "dispatch.queued",
      payload: {},
      createdAt: dispatch.createdAt
    });
    const lease = await store.claim("node_macbook", new Date("2026-09-24T00:00:01.000Z"), 30_000);
    expect(lease?.status).toBe("leased");
    await expect(
      store.claim("node_macbook", new Date("2026-09-24T00:00:02.000Z"), 30_000)
    ).resolves.toBeUndefined();
    const running = await store.acknowledge(
      dispatch.dispatchId,
      lease!.leaseToken!,
      new Date("2026-09-24T00:00:03.000Z")
    );
    expect(running?.status).toBe("running");
    const renewed = await store.renewLease(
      dispatch.dispatchId,
      lease!.leaseToken!,
      new Date("2026-09-24T00:00:10.000Z"),
      30_000
    );
    expect(renewed?.leaseExpiresAt).toBe("2026-09-24T00:00:40.000Z");

    const receipt = ReceiptSchema.parse({
      schemaVersion: "0.1",
      receiptId: createId("rcpt"),
      invocationId: dispatch.invocation.invocationId,
      attemptId: dispatch.invocation.attemptId,
      nodeId: "node_macbook",
      tool: "file.write",
      terminalStatus: "succeeded",
      sideEffect: true,
      replayed: false,
      idempotencyKeyHash: `sha256:${"b".repeat(64)}`,
      argsHash: `sha256:${"c".repeat(64)}`,
      policyDecisionHash: dispatch.policyDecision.decisionHash,
      outputHash: `sha256:${"d".repeat(64)}`,
      startedAt: "2026-09-24T00:00:03.000Z",
      completedAt: "2026-09-24T00:00:04.000Z",
      durationMs: 1000,
      artifactRefs: []
    });
    const result = ResultSchema.parse({
      schemaVersion: "0.1",
      invocationId: dispatch.invocation.invocationId,
      attemptId: dispatch.invocation.attemptId,
      status: "succeeded",
      output: { bytesWritten: 2 },
      receipt
    });
    const completed = await store.complete(
      dispatch.dispatchId,
      lease!.leaseToken!,
      result,
      receipt,
      new Date("2026-09-24T00:00:04.000Z")
    );
    expect(completed?.status).toBe("succeeded");

    const retry = await store.complete(
      dispatch.dispatchId,
      "wrong-token",
      result,
      receipt,
      new Date("2026-09-24T00:00:05.000Z")
    );
    expect(retry?.status).toBe("succeeded");
  });
});
