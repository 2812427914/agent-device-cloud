import { describe, expect, it } from "vitest";
import {
  CapabilitySchema,
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
  it("keeps presence and capability updates monotonic", async () => {
    const store = new MemoryStore();
    await store.putAccount({
      accountId: "acct_primary",
      ownerTokenHash: "hash",
      createdAt: "2026-09-24T00:00:00.000Z"
    });
    await store.putPairingCode({
      codeHash: "presence-code",
      accountId: "acct_primary",
      expiresAt: "2026-09-24T00:10:00.000Z"
    });
    await store.pairNode({
      codeHash: "presence-code",
      now: new Date("2026-09-24T00:01:00.000Z"),
      node: {
        nodeId: "node_presence",
        accountId: "acct_primary",
        label: "Presence",
        publicKey: "pem",
        platform: "linux",
        status: "active",
        createdAt: "2026-09-24T00:01:00.000Z"
      }
    });
    const capability = (nodeVersion: string) =>
      CapabilitySchema.parse({
        schemaVersion: "0.1",
        nodeId: "node_presence",
        tools: [],
        roots: [],
        platform: "linux",
        nodeVersion,
        advertisedAt: "2026-09-24T00:00:00.000Z"
      });
    await store.updateNodePresence(
      "node_presence",
      capability("new"),
      new Date("2026-09-24T00:03:00.000Z")
    );
    await store.updateNodePresence(
      "node_presence",
      capability("old"),
      new Date("2026-09-24T00:02:00.000Z")
    );
    await store.rotateNodeKey("node_presence", "new-key", new Date("2026-09-24T00:02:30.000Z"));

    await expect(store.getNode("node_presence")).resolves.toMatchObject({
      lastSeenAt: "2026-09-24T00:03:00.000Z",
      capability: { nodeVersion: "new" },
      publicKey: "new-key"
    });
  });

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
    await expect(store.pairNode(input)).resolves.toMatchObject({
      node: { nodeId: "node_macbook" },
      replacedNodeIds: []
    });
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

  it("paginates audit events with stable cursors and account isolation", async () => {
    const store = new MemoryStore();
    const createdAt = "2026-09-24T00:00:00.000Z";
    for (const eventId of ["evt_01", "evt_02", "evt_03", "evt_04", "evt_05"]) {
      await store.putAudit({
        eventId,
        accountId: "acct_primary",
        type: eventId === "evt_03" ? "approval.requested" : "dispatch.queued",
        payload: {},
        createdAt
      });
    }
    await store.putAudit({
      eventId: "evt_other",
      accountId: "acct_other",
      type: "dispatch.queued",
      payload: {},
      createdAt
    });

    const first = await store.listAuditPage("acct_primary", { limit: 2 });
    expect(first.events.map((event) => event.eventId)).toEqual(["evt_05", "evt_04"]);
    await store.putAudit({
      eventId: "evt_06",
      accountId: "acct_primary",
      type: "dispatch.queued",
      payload: {},
      createdAt
    });
    const second = await store.listAuditPage("acct_primary", {
      limit: 2,
      before: first.nextCursor!
    });
    const third = await store.listAuditPage("acct_primary", {
      limit: 2,
      before: second.nextCursor!
    });
    expect(
      [...first.events, ...second.events, ...third.events].map((event) => event.eventId)
    ).toEqual(["evt_05", "evt_04", "evt_03", "evt_02", "evt_01"]);
    await expect(
      store.listAuditPage("acct_primary", { limit: 10, eventTypePrefix: "approval" })
    ).resolves.toMatchObject({ events: [{ eventId: "evt_03" }] });
  });

  it("paginates approvals by effective status and reports the pending total", async () => {
    const store = new MemoryStore();
    const createdAt = "2026-09-24T00:00:00.000Z";
    const now = "2026-09-24T00:30:00.000Z";
    const statuses = [
      ["apr_01", "approved", "2026-09-24T01:00:00.000Z"],
      ["apr_02", "pending", "2026-09-24T00:10:00.000Z"],
      ["apr_03", "denied", "2026-09-24T01:00:00.000Z"],
      ["apr_04", "pending", "2026-09-24T01:00:00.000Z"]
    ] as const;
    for (const [approvalId, status, expiresAt] of statuses) {
      const dispatch = makeDispatch();
      await store.putApproval({
        approvalId,
        accountId: "acct_primary",
        invocation: dispatch.invocation,
        nodeId: dispatch.nodeId,
        placementReason: "explicit_node",
        policyDecision: dispatch.policyDecision,
        status,
        createdAt,
        expiresAt
      });
    }

    await expect(
      store.listApprovalsPage("acct_primary", { limit: 10, status: "pending", now })
    ).resolves.toMatchObject({
      approvals: [{ approvalId: "apr_04", status: "pending" }],
      pendingCount: 1
    });
    const resolved = await store.listApprovalsPage("acct_primary", {
      limit: 2,
      status: "resolved",
      now
    });
    expect(resolved.approvals).toMatchObject([
      { approvalId: "apr_03", status: "denied" },
      { approvalId: "apr_02", status: "expired" }
    ]);
    await expect(
      store.listApprovalsPage("acct_primary", {
        limit: 2,
        status: "resolved",
        now,
        before: resolved.nextCursor!
      })
    ).resolves.toMatchObject({
      approvals: [{ approvalId: "apr_01", status: "approved" }],
      pendingCount: 1
    });
  });
});
