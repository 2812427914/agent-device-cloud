import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMemoryServer } from "postgres-memory-server";
import { CapabilitySchema, InvocationSchema, createId } from "@adc/protocol";
import { PostgresStore } from "./postgres-store.ts";
import type { DispatchRecord } from "./types.ts";

function dispatch(index: number): DispatchRecord {
  const now = new Date().toISOString();
  const invocation = InvocationSchema.parse({
    schemaVersion: "0.1",
    invocationId: createId("inv"),
    attemptId: createId("att"),
    accountId: "acct_primary",
    actor: { type: "agent", id: "actor_testagent" },
    target: { nodeId: "node_postgres" },
    authorization: {
      projectId: "proj_example",
      rootIds: ["root_workspace"],
      grantId: "grant_example"
    },
    tool: "file.read",
    args: { rootId: "root_workspace", path: `file-${index}.txt` },
    issuedAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    metadata: { source: "sdk" }
  });
  return {
    dispatchId: createId("dsp"),
    invocation,
    nodeId: "node_postgres",
    policyDecision: {
      outcome: "allow",
      reasonCode: "policy.allowed",
      explanation: "Allowed in integration test.",
      evaluatedLayers: ["account", "agent", "node", "root", "capability"],
      profile: "read-only",
      decisionHash: `sha256:${"a".repeat(64)}`
    },
    status: "queued",
    createdAt: now,
    updatedAt: now
  };
}

describe("PostgresStore", () => {
  let store: PostgresStore;
  let embedded: PostgresMemoryServer | undefined;
  let databaseUrl: string;

  beforeAll(async () => {
    databaseUrl =
      process.env.ADC_TEST_DATABASE_URL ??
      (await PostgresMemoryServer.create({
        database: "adc_test",
        username: "adc_test",
        password: "adc_test"
      }).then((server) => {
        embedded = server;
        return server.getUri();
      }));
    store = new PostgresStore(databaseUrl);
    await store.migrate();
    await store.pool.query(`
      TRUNCATE adc_node_nonces, adc_audit_events, adc_dispatches, adc_agent_grants,
        adc_roots, adc_projects, adc_nodes, adc_pairing_codes, adc_accounts CASCADE
    `);
    await store.putAccount({
      accountId: "acct_primary",
      ownerTokenHash: "hash",
      createdAt: new Date().toISOString()
    });
    await store.putPairingCode({
      codeHash: "pair-code",
      accountId: "acct_primary",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    await store.pairNode({
      codeHash: "pair-code",
      now: new Date(),
      node: {
        nodeId: "node_postgres",
        accountId: "acct_primary",
        label: "postgres-node",
        publicKey: "test-key",
        platform: "linux",
        status: "active",
        createdAt: new Date().toISOString()
      }
    });
    await store.putProject({
      projectId: "proj_example",
      accountId: "acct_primary",
      label: "Example",
      createdAt: new Date().toISOString()
    });
    await store.putRoot({
      rootId: "root_workspace",
      projectId: "proj_example",
      nodeId: "node_postgres",
      label: "Workspace",
      writable: true,
      createdAt: new Date().toISOString()
    });
    await store.putGrant({
      grantId: "grant_example",
      accountId: "acct_primary",
      actorId: "actor_testagent",
      profile: "workspace-write",
      nodeIds: ["node_postgres"],
      rootIds: ["root_workspace"],
      allowedTools: ["file.read", "file.write"],
      createdAt: new Date().toISOString()
    });
  });

  afterAll(async () => {
    await store.close();
    await embedded?.stop();
  });

  it("reports nodes replaced during same-label pairing", async () => {
    const now = new Date();
    await store.putPairingCode({
      codeHash: "replace-old",
      accountId: "acct_primary",
      expiresAt: new Date(now.getTime() + 60_000).toISOString()
    });
    await store.pairNode({
      codeHash: "replace-old",
      now,
      node: {
        nodeId: "node_replace_old",
        label: "replace-me",
        publicKey: "old-key",
        platform: "linux",
        status: "active",
        createdAt: now.toISOString()
      }
    });
    await store.putPairingCode({
      codeHash: "replace-new",
      accountId: "acct_primary",
      expiresAt: new Date(now.getTime() + 60_000).toISOString()
    });

    await expect(
      store.pairNode({
        codeHash: "replace-new",
        now,
        node: {
          nodeId: "node_replace_new",
          label: "replace-me",
          publicKey: "new-key",
          platform: "linux",
          status: "active",
          createdAt: now.toISOString()
        }
      })
    ).resolves.toMatchObject({
      node: { nodeId: "node_replace_new" },
      replacedNodeIds: ["node_replace_old"]
    });
  });

  it("keeps presence and capability updates monotonic", async () => {
    const capability = (nodeVersion: string) =>
      CapabilitySchema.parse({
        schemaVersion: "0.1",
        nodeId: "node_postgres",
        tools: [],
        roots: [],
        platform: "linux",
        nodeVersion,
        advertisedAt: "2026-09-24T00:00:00.000Z"
      });
    await store.updateNodePresence(
      "node_postgres",
      capability("new"),
      new Date("2026-09-24T00:03:00.000Z")
    );
    await store.updateNodePresence(
      "node_postgres",
      capability("old"),
      new Date("2026-09-24T00:02:00.000Z")
    );
    await store.rotateNodeKey("node_postgres", "new-key", new Date("2026-09-24T00:02:30.000Z"));

    await expect(store.getNode("node_postgres")).resolves.toMatchObject({
      lastSeenAt: "2026-09-24T00:03:00.000Z",
      capability: { nodeVersion: "new" },
      publicKey: "new-key"
    });
  });

  it("claims queued work once across concurrent pollers", async () => {
    const first = dispatch(1);
    const second = dispatch(2);
    for (const item of [first, second]) {
      await store.enqueue(item, {
        eventId: createId("dsp"),
        accountId: "acct_primary",
        invocationId: item.invocation.invocationId,
        type: "dispatch.queued",
        payload: {},
        createdAt: item.createdAt
      });
    }
    const claims = await Promise.all([
      store.claim("node_postgres", new Date(), 30_000),
      store.claim("node_postgres", new Date(), 30_000)
    ]);
    expect(new Set(claims.map((claim) => claim?.dispatchId)).size).toBe(2);
    await expect(store.claim("node_postgres", new Date(), 30_000)).resolves.toBeUndefined();
  });

  it("retains dispatch and audit state across store instances", async () => {
    const item = dispatch(3);
    await store.enqueue(item, {
      eventId: createId("dsp"),
      accountId: "acct_primary",
      invocationId: item.invocation.invocationId,
      type: "dispatch.queued",
      payload: { persisted: true },
      createdAt: item.createdAt
    });
    await store.putArtifact({
      artifactId: "artifact_0123456789abcdef0123456789abcdef.log",
      accountId: "acct_primary",
      invocationId: item.invocation.invocationId,
      nodeId: "node_postgres",
      contentType: "text/plain",
      sha256: `sha256:${"b".repeat(64)}`,
      data: Buffer.from("artifact-body"),
      createdAt: item.createdAt
    });
    const restarted = new PostgresStore(databaseUrl!);
    try {
      await expect(restarted.getGrant("grant_example")).resolves.toMatchObject({
        nodeIds: ["node_postgres"],
        rootIds: ["root_workspace"],
        allowedTools: ["file.read", "file.write"]
      });
      await expect(restarted.getDispatchById(item.dispatchId)).resolves.toMatchObject({
        dispatchId: item.dispatchId,
        status: "queued"
      });
      await expect(
        restarted.listAudit("acct_primary", item.invocation.invocationId)
      ).resolves.toHaveLength(1);
      const artifact = await restarted.getArtifact("artifact_0123456789abcdef0123456789abcdef.log");
      expect(artifact?.data.toString("utf8")).toBe("artifact-body");
    } finally {
      await restarted.close();
    }
  });

  it("uses stable keyset pagination for filtered audit timelines", async () => {
    const createdAt = "2030-09-24T00:00:00.000Z";
    for (const eventId of [
      "evt_page_01",
      "evt_page_02",
      "evt_page_03",
      "evt_page_04",
      "evt_page_05"
    ]) {
      await store.putAudit({
        eventId,
        accountId: "acct_primary",
        type: "credential.page_test",
        payload: {},
        createdAt
      });
    }

    const first = await store.listAuditPage("acct_primary", {
      limit: 2,
      eventTypePrefix: "credential"
    });
    expect(first.events.map((event) => event.eventId)).toEqual(["evt_page_05", "evt_page_04"]);
    await store.putAudit({
      eventId: "evt_page_06",
      accountId: "acct_primary",
      type: "credential.page_test",
      payload: {},
      createdAt
    });
    const second = await store.listAuditPage("acct_primary", {
      limit: 2,
      eventTypePrefix: "credential",
      before: first.nextCursor!
    });
    const third = await store.listAuditPage("acct_primary", {
      limit: 2,
      eventTypePrefix: "credential",
      before: second.nextCursor!
    });
    expect(
      [...first.events, ...second.events, ...third.events].map((event) => event.eventId)
    ).toEqual(["evt_page_05", "evt_page_04", "evt_page_03", "evt_page_02", "evt_page_01"]);
  });

  it("persists and resolves approvals once", async () => {
    const item = dispatch(4);
    const createdAt = new Date();
    const approval = await store.putApproval({
      approvalId: createId("apr"),
      accountId: "acct_primary",
      invocation: item.invocation,
      nodeId: "node_postgres",
      placementReason: "explicit_node",
      policyDecision: {
        ...item.policyDecision,
        outcome: "approval_required",
        reasonCode: "approval.required"
      },
      status: "pending",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 60_000).toISOString()
    });
    await expect(
      store.getApprovalByInvocation(item.invocation.invocationId)
    ).resolves.toMatchObject({ approvalId: approval.approvalId });
    await expect(
      store.resolveApproval(approval.approvalId, "approved", new Date())
    ).resolves.toMatchObject({ status: "approved" });
    await expect(
      store.resolveApproval(approval.approvalId, "denied", new Date())
    ).resolves.toBeUndefined();
  });

  it("filters approval pages by effective status", async () => {
    const createdAt = "2031-09-24T00:00:00.000Z";
    const now = "2031-09-24T00:30:00.000Z";
    const statuses = [
      ["apr_page_01", "approved", "2031-09-24T01:00:00.000Z"],
      ["apr_page_02", "pending", "2031-09-24T00:10:00.000Z"],
      ["apr_page_03", "denied", "2031-09-24T01:00:00.000Z"],
      ["apr_page_04", "pending", "2031-09-24T01:00:00.000Z"]
    ] as const;
    for (const [approvalId, status, expiresAt] of statuses) {
      const item = dispatch(Number(approvalId.at(-1)));
      await store.putApproval({
        approvalId,
        accountId: "acct_primary",
        invocation: item.invocation,
        nodeId: item.nodeId,
        placementReason: "explicit_node",
        policyDecision: item.policyDecision,
        status,
        createdAt,
        expiresAt
      });
    }

    await expect(
      store.listApprovalsPage("acct_primary", { limit: 10, status: "pending", now })
    ).resolves.toMatchObject({
      approvals: [{ approvalId: "apr_page_04", status: "pending" }],
      pendingCount: 1
    });
    const resolved = await store.listApprovalsPage("acct_primary", {
      limit: 2,
      status: "resolved",
      now
    });
    expect(resolved.approvals).toMatchObject([
      { approvalId: "apr_page_03", status: "denied" },
      { approvalId: "apr_page_02", status: "expired" }
    ]);
    const next = await store.listApprovalsPage("acct_primary", {
      limit: 2,
      status: "resolved",
      now,
      before: resolved.nextCursor!
    });
    expect(next.approvals[0]).toMatchObject({
      approvalId: "apr_page_01",
      status: "approved"
    });
    expect(
      new Set([...resolved.approvals, ...next.approvals].map((approval) => approval.approvalId))
        .size
    ).toBe(resolved.approvals.length + next.approvals.length);
  });
});
