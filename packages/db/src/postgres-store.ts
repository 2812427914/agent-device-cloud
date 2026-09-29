import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  ErrorCodes,
  ProtocolError,
  createId,
  isSideEffectTool,
  type CapabilityAdvertisement,
  type InvocationResult,
  type Receipt
} from "@adc/protocol";
import type {
  AccountRecord,
  AgentGrantRecord,
  ApprovalRecord,
  ArtifactRecord,
  AuditEvent,
  DispatchRecord,
  NodeRecord,
  PairNodeInput,
  PairNodeResult,
  PairingCodeRecord,
  ProjectRecord,
  RootBindingRecord,
  Store
} from "./types.ts";
import { assertSameInvocation, invocationInputHash } from "./dispatch-identity.ts";

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nodeFromRow(row: QueryResultRow): NodeRecord {
  return {
    nodeId: row.node_id,
    accountId: row.account_id,
    label: row.label,
    publicKey: row.public_key,
    platform: row.platform,
    status: row.status,
    revision: row.revision,
    ...(row.access_policy ? { accessPolicy: row.access_policy } : {}),
    ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}),
    ...(row.capability ? { capability: row.capability } : {}),
    ...(row.last_seen_at ? { lastSeenAt: iso(row.last_seen_at) } : {}),
    createdAt: iso(row.created_at)
  };
}

function dispatchFromRow(row: QueryResultRow): DispatchRecord {
  return {
    dispatchId: row.dispatch_id,
    invocation: row.invocation,
    nodeId: row.node_id,
    policyDecision: row.policy_decision,
    status: row.status,
    ...(row.lease_token ? { leaseToken: row.lease_token } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: iso(row.lease_expires_at) } : {}),
    ...(row.result ? { result: row.result } : {}),
    ...(row.receipt ? { receipt: row.receipt } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function auditFromRow(row: QueryResultRow): AuditEvent {
  return {
    eventId: row.event_id,
    accountId: row.account_id,
    ...(row.invocation_id ? { invocationId: row.invocation_id } : {}),
    type: row.event_type,
    payload: row.payload,
    createdAt: iso(row.created_at)
  };
}

function approvalFromRow(row: QueryResultRow): ApprovalRecord {
  return {
    approvalId: row.approval_id,
    accountId: row.account_id,
    invocation: row.invocation,
    nodeId: row.node_id,
    placementReason: row.placement_reason,
    policyDecision: row.policy_decision,
    status: row.status,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    ...(row.resolved_at ? { resolvedAt: iso(row.resolved_at) } : {})
  };
}

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresStore implements Store {
  readonly pool: Pool;

  constructor(connectionStringOrPool: string | Pool) {
    this.pool =
      typeof connectionStringOrPool === "string"
        ? new Pool({ connectionString: connectionStringOrPool, max: 10 })
        : connectionStringOrPool;
  }

  async migrate(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const directory = resolve(here, "../migrations");
    await transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(728194032)");
      await client.query(`CREATE TABLE IF NOT EXISTS adc_schema_migrations (
        name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT NOW()
      )`);
      for (const name of (await readdir(directory))
        .filter((name) => /^\d+.*\.sql$/.test(name))
        .sort()) {
        const sql = await readFile(resolve(directory, name), "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        const existing = await client.query<{ checksum: string }>(
          "SELECT checksum FROM adc_schema_migrations WHERE name = $1",
          [name]
        );
        if (existing.rows[0]) {
          if (existing.rows[0].checksum !== checksum) throw new Error(`Migration changed: ${name}`);
          continue;
        }
        await client.query(sql);
        await client.query("INSERT INTO adc_schema_migrations (name, checksum) VALUES ($1, $2)", [
          name,
          checksum
        ]);
      }
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async putAccount(account: AccountRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO adc_accounts (account_id, owner_token_hash, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id) DO UPDATE SET owner_token_hash = EXCLUDED.owner_token_hash`,
      [account.accountId, account.ownerTokenHash, account.createdAt]
    );
  }

  async getAccount(accountId: string): Promise<AccountRecord | undefined> {
    const result = await this.pool.query(
      "SELECT account_id, owner_token_hash, created_at FROM adc_accounts WHERE account_id = $1",
      [accountId]
    );
    const row = result.rows[0];
    return row
      ? {
          accountId: row.account_id,
          ownerTokenHash: row.owner_token_hash,
          createdAt: iso(row.created_at)
        }
      : undefined;
  }

  async putPairingCode(code: PairingCodeRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO adc_pairing_codes (code_hash, account_id, expires_at, used_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code_hash) DO NOTHING`,
      [code.codeHash, code.accountId, code.expiresAt, code.usedAt ?? null]
    );
  }

  async pairNode(input: PairNodeInput): Promise<PairNodeResult | undefined> {
    return transaction(this.pool, async (client) => {
      const consumed = await client.query(
        `UPDATE adc_pairing_codes
         SET used_at = $2
         WHERE code_hash = $1 AND used_at IS NULL AND expires_at > $2
         RETURNING account_id`,
        [input.codeHash, input.now.toISOString()]
      );
      if (!consumed.rowCount) {
        return undefined;
      }
      // Pairing can reach the server before the installer persists its private key.
      // A same-account device that never completed one poll is safe to replace.
      const replaced = await client.query(
        `UPDATE adc_nodes
         SET status = 'revoked', deleted_at = $3, revision = revision + 1
         WHERE account_id = $1 AND label = $2 AND status = 'active'
           AND last_seen_at IS NULL AND deleted_at IS NULL
         RETURNING node_id`,
        [consumed.rows[0]!.account_id, input.node.label, input.now.toISOString()]
      );
      try {
        const inserted = await client.query(
          `INSERT INTO adc_nodes
           (node_id, account_id, label, public_key, platform, status, capability, last_seen_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            input.node.nodeId,
            consumed.rows[0]!.account_id,
            input.node.label,
            input.node.publicKey,
            input.node.platform,
            input.node.status,
            input.node.capability ?? null,
            input.node.lastSeenAt ?? null,
            input.node.createdAt
          ]
        );
        return {
          node: nodeFromRow(inserted.rows[0]!),
          replacedNodeIds: replaced.rows.map((row) => String(row.node_id))
        };
      } catch (error: any) {
        if (error?.code === "23505") {
          throw new ProtocolError(ErrorCodes.CONFLICT, "node label already exists", false);
        }
        throw error;
      }
    });
  }

  async getNode(nodeId: string): Promise<NodeRecord | undefined> {
    const result = await this.pool.query("SELECT * FROM adc_nodes WHERE node_id = $1", [nodeId]);
    return result.rows[0] ? nodeFromRow(result.rows[0]) : undefined;
  }

  async listNodes(accountId: string): Promise<NodeRecord[]> {
    const result = await this.pool.query(
      "SELECT * FROM adc_nodes WHERE account_id = $1 AND deleted_at IS NULL ORDER BY created_at",
      [accountId]
    );
    return result.rows.map(nodeFromRow);
  }

  async updateNodePresence(
    nodeId: string,
    capability: CapabilityAdvertisement,
    now: Date
  ): Promise<NodeRecord | undefined> {
    const result = await this.pool.query(
      `UPDATE adc_nodes
       SET capability = CASE
             WHEN last_seen_at IS NULL OR last_seen_at <= $3 THEN $2
             ELSE capability
           END,
           last_seen_at = CASE
             WHEN last_seen_at IS NULL OR last_seen_at <= $3 THEN $3
             ELSE last_seen_at
           END
       WHERE node_id = $1 AND status = 'active'
       RETURNING *`,
      [nodeId, capability, now.toISOString()]
    );
    return result.rows[0] ? nodeFromRow(result.rows[0]) : undefined;
  }

  async touchNodePresences(nodeIds: string[], now: Date): Promise<void> {
    if (!nodeIds.length) return;
    await this.pool.query(
      `UPDATE adc_nodes
       SET last_seen_at = CASE
         WHEN last_seen_at IS NULL OR last_seen_at < $2 THEN $2
         ELSE last_seen_at
       END
       WHERE node_id = ANY($1::text[]) AND status = 'active' AND capability IS NOT NULL`,
      [[...new Set(nodeIds)], now.toISOString()]
    );
  }

  async rotateNodeKey(nodeId: string, publicKey: string, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE adc_nodes
       SET public_key = $2,
           last_seen_at = CASE
             WHEN last_seen_at IS NULL OR last_seen_at < $3 THEN $3
             ELSE last_seen_at
           END
       WHERE node_id = $1 AND status = 'active'`,
      [nodeId, publicKey, now.toISOString()]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revokeNode(nodeId: string, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE adc_nodes SET status = 'revoked', last_seen_at = $2, revision = revision + 1
       WHERE node_id = $1 AND status = 'active'`,
      [nodeId, now.toISOString()]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async putProject(project: ProjectRecord): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO adc_projects (project_id, account_id, label, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id) DO UPDATE SET label = EXCLUDED.label
       WHERE adc_projects.account_id = EXCLUDED.account_id RETURNING project_id`,
      [project.projectId, project.accountId, project.label, project.createdAt]
    );
    if (!result.rowCount) throw new ProtocolError("conflict", "Project ID is unavailable.", false);
  }

  async updateNode(
    accountId: string,
    nodeId: string,
    changes: Pick<NodeRecord, "label" | "accessPolicy">,
    revision: number,
    audit: AuditEvent
  ): Promise<NodeRecord> {
    try {
      return await transaction(this.pool, async (client) => {
        const result = await client.query(
          `UPDATE adc_nodes SET label = $3, access_policy = $4, revision = revision + 1
           WHERE account_id = $1 AND node_id = $2 AND revision = $5
             AND deleted_at IS NULL AND status = 'active' RETURNING *`,
          [accountId, nodeId, changes.label, changes.accessPolicy ?? null, revision]
        );
        if (!result.rowCount)
          throw new ProtocolError("conflict", "Device changed. Refresh and try again.", false);
        await insertAudit(client, audit);
        return nodeFromRow(result.rows[0]!);
      });
    } catch (error: any) {
      if (error?.code === "23505")
        throw new ProtocolError("conflict", "A device with this name already exists.", false);
      throw error;
    }
  }

  async deleteNode(
    accountId: string,
    nodeId: string,
    revision: number,
    audit: AuditEvent
  ): Promise<void> {
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE adc_nodes SET status = 'revoked', deleted_at = $4, revision = revision + 1
         WHERE account_id = $1 AND node_id = $2 AND revision = $3 AND deleted_at IS NULL`,
        [accountId, nodeId, revision, audit.createdAt]
      );
      if (!result.rowCount)
        throw new ProtocolError("conflict", "Device changed. Refresh and try again.", false);
      await cancelResourceWork(client, accountId, "node", nodeId, audit.createdAt);
      await insertAudit(client, audit);
    });
  }

  async getProject(projectId: string): Promise<ProjectRecord | undefined> {
    const result = await this.pool.query("SELECT * FROM adc_projects WHERE project_id = $1", [
      projectId
    ]);
    const row = result.rows[0];
    return row
      ? {
          projectId: row.project_id,
          accountId: row.account_id,
          label: row.label,
          createdAt: iso(row.created_at)
        }
      : undefined;
  }

  async listProjects(accountId: string): Promise<ProjectRecord[]> {
    const result = await this.pool.query(
      "SELECT * FROM adc_projects WHERE account_id = $1 ORDER BY created_at",
      [accountId]
    );
    return result.rows.map((row) => ({
      projectId: row.project_id,
      accountId: row.account_id,
      label: row.label,
      createdAt: iso(row.created_at)
    }));
  }

  async putRoot(root: RootBindingRecord): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO adc_roots (root_id, project_id, node_id, label, writable, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (root_id) DO UPDATE
       SET label = EXCLUDED.label, writable = EXCLUDED.writable
       WHERE adc_roots.project_id = EXCLUDED.project_id
         AND adc_roots.node_id = EXCLUDED.node_id
       RETURNING root_id`,
      [root.rootId, root.projectId, root.nodeId, root.label, root.writable, root.createdAt]
    );
    if (!result.rowCount) {
      throw new ProtocolError(
        ErrorCodes.CONFLICT,
        "root id is already bound to another project or device",
        false
      );
    }
  }

  async listRoots(projectId: string): Promise<RootBindingRecord[]> {
    const result = await this.pool.query(
      "SELECT * FROM adc_roots WHERE project_id = $1 ORDER BY created_at",
      [projectId]
    );
    return result.rows.map((row) => ({
      rootId: row.root_id,
      projectId: row.project_id,
      nodeId: row.node_id,
      label: row.label,
      writable: row.writable,
      createdAt: iso(row.created_at)
    }));
  }

  async putGrant(grant: AgentGrantRecord, createOnly = false): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO adc_agent_grants
       (grant_id, account_id, actor_id, profile, node_ids, root_ids, allowed_tools, revoked_at, created_at, name, project_id, root_access, approval_policy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (grant_id) DO UPDATE SET
         profile = EXCLUDED.profile,
         node_ids = EXCLUDED.node_ids,
         root_ids = EXCLUDED.root_ids,
         allowed_tools = EXCLUDED.allowed_tools,
         name = EXCLUDED.name,
         root_access = EXCLUDED.root_access,
         approval_policy = EXCLUDED.approval_policy,
         revision = adc_agent_grants.revision + 1
       WHERE adc_agent_grants.account_id = EXCLUDED.account_id
         AND adc_agent_grants.actor_id = EXCLUDED.actor_id
         AND adc_agent_grants.project_id IS NOT DISTINCT FROM EXCLUDED.project_id
         AND adc_agent_grants.revoked_at IS NULL
         AND NOT $14
       RETURNING grant_id`,
      [
        grant.grantId,
        grant.accountId,
        grant.actorId,
        grant.profile,
        JSON.stringify(grant.nodeIds),
        JSON.stringify(grant.rootIds),
        JSON.stringify(grant.allowedTools),
        grant.revokedAt ?? null,
        grant.createdAt,
        grant.name ?? "Agent",
        grant.projectId ?? null,
        grant.rootAccess ?? "selected",
        grant.approvalPolicy ?? null,
        createOnly
      ]
    );
    if (!result.rowCount)
      throw new ProtocolError("conflict", "Grant is unavailable or revoked.", false);
  }

  async getGrant(grantId: string): Promise<AgentGrantRecord | undefined> {
    const result = await this.pool.query("SELECT * FROM adc_agent_grants WHERE grant_id = $1", [
      grantId
    ]);
    const row = result.rows[0];
    return row
      ? {
          grantId: row.grant_id,
          accountId: row.account_id,
          name: row.name,
          ...(row.project_id ? { projectId: row.project_id } : {}),
          actorId: row.actor_id,
          profile: row.profile,
          nodeIds: row.node_ids,
          rootIds: row.root_ids,
          rootAccess: row.root_access,
          ...(row.approval_policy ? { approvalPolicy: row.approval_policy } : {}),
          allowedTools: row.allowed_tools,
          ...(row.revoked_at ? { revokedAt: iso(row.revoked_at) } : {}),
          ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}),
          revision: row.revision,
          createdAt: iso(row.created_at)
        }
      : undefined;
  }

  async listGrants(accountId: string): Promise<AgentGrantRecord[]> {
    const result = await this.pool.query<{ grant_id: string }>(
      "SELECT grant_id FROM adc_agent_grants WHERE account_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [accountId]
    );
    const grants: AgentGrantRecord[] = [];
    for (const row of result.rows) {
      const grant = await this.getGrant(row.grant_id);
      if (grant) grants.push(grant);
    }
    return grants;
  }

  async revokeGrant(accountId: string, grantId: string, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE adc_agent_grants SET revoked_at = COALESCE(revoked_at, $3), revision = revision + 1
       WHERE account_id = $1 AND grant_id = $2 AND deleted_at IS NULL`,
      [accountId, grantId, now.toISOString()]
    );
    return !!result.rowCount;
  }

  async updateGrant(
    grant: AgentGrantRecord,
    revision: number,
    audit: AuditEvent
  ): Promise<AgentGrantRecord> {
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE adc_agent_grants SET name = $3, project_id = $4, profile = $5,
          node_ids = $6, root_ids = $7, root_access = $8, approval_policy = $9,
          allowed_tools = $10, revision = revision + 1
         WHERE account_id = $1 AND grant_id = $2 AND revision = $11
           AND revoked_at IS NULL AND deleted_at IS NULL`,
        [
          grant.accountId,
          grant.grantId,
          grant.name ?? "Agent",
          grant.projectId ?? null,
          grant.profile,
          JSON.stringify(grant.nodeIds),
          JSON.stringify(grant.rootIds),
          grant.rootAccess ?? "selected",
          grant.approvalPolicy ?? null,
          JSON.stringify(grant.allowedTools),
          revision
        ]
      );
      if (!result.rowCount)
        throw new ProtocolError("conflict", "Authorization changed. Refresh and try again.", false);
      await insertAudit(client, audit);
    });
    return { ...grant, revision: revision + 1 };
  }

  async deleteGrant(
    accountId: string,
    grantId: string,
    revision: number,
    audit: AuditEvent
  ): Promise<void> {
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE adc_agent_grants SET revoked_at = COALESCE(revoked_at, $4), deleted_at = $4, revision = revision + 1
         WHERE account_id = $1 AND grant_id = $2 AND revision = $3 AND deleted_at IS NULL`,
        [accountId, grantId, revision, audit.createdAt]
      );
      if (!result.rowCount)
        throw new ProtocolError("conflict", "Authorization changed. Refresh and try again.", false);
      await cancelResourceWork(client, accountId, "grant", grantId, audit.createdAt);
      await insertAudit(client, audit);
    });
  }

  async putApproval(approval: ApprovalRecord): Promise<ApprovalRecord> {
    const result = await this.pool.query(
      `INSERT INTO adc_approvals
       (approval_id, invocation_id, account_id, node_id, placement_reason, invocation,
        policy_decision, status, created_at, expires_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (invocation_id) DO UPDATE
       SET invocation_id = EXCLUDED.invocation_id
       RETURNING *`,
      [
        approval.approvalId,
        approval.invocation.invocationId,
        approval.accountId,
        approval.nodeId,
        approval.placementReason,
        approval.invocation,
        approval.policyDecision,
        approval.status,
        approval.createdAt,
        approval.expiresAt,
        approval.resolvedAt ?? null
      ]
    );
    const persisted = approvalFromRow(result.rows[0]!);
    assertSameInvocation(persisted.invocation, approval.invocation);
    return persisted;
  }

  async getApproval(approvalId: string): Promise<ApprovalRecord | undefined> {
    const result = await this.pool.query("SELECT * FROM adc_approvals WHERE approval_id = $1", [
      approvalId
    ]);
    return result.rows[0] ? approvalFromRow(result.rows[0]) : undefined;
  }

  async getApprovalByInvocation(invocationId: string): Promise<ApprovalRecord | undefined> {
    const result = await this.pool.query("SELECT * FROM adc_approvals WHERE invocation_id = $1", [
      invocationId
    ]);
    return result.rows[0] ? approvalFromRow(result.rows[0]) : undefined;
  }

  async listApprovals(accountId: string): Promise<ApprovalRecord[]> {
    const result = await this.pool.query(
      "SELECT * FROM adc_approvals WHERE account_id = $1 ORDER BY created_at DESC",
      [accountId]
    );
    return result.rows.map(approvalFromRow);
  }

  async resolveApproval(
    approvalId: string,
    resolution: "approved" | "denied",
    now: Date
  ): Promise<ApprovalRecord | undefined> {
    const result = await this.pool.query(
      `UPDATE adc_approvals
       SET status = CASE WHEN expires_at <= $3 THEN 'expired' ELSE $2 END,
           resolved_at = $3
       WHERE approval_id = $1 AND status = 'pending'
       RETURNING *`,
      [approvalId, resolution, now.toISOString()]
    );
    return result.rows[0] ? approvalFromRow(result.rows[0]) : undefined;
  }

  async enqueue(dispatch: DispatchRecord, audit: AuditEvent): Promise<DispatchRecord> {
    return transaction(this.pool, (client) => insertDispatch(client, dispatch, audit));
  }

  async approveAndEnqueue(
    approvalId: string,
    dispatch: DispatchRecord,
    audit: AuditEvent,
    now: Date
  ): Promise<DispatchRecord | undefined> {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `SELECT * FROM adc_approvals WHERE approval_id = $1 AND account_id = $2 FOR UPDATE`,
        [approvalId, dispatch.invocation.accountId]
      );
      const approval = result.rows[0];
      if (!approval || approval.status !== "pending" || new Date(approval.expires_at) <= now)
        return;
      assertSameInvocation(approval.invocation, dispatch.invocation);
      const queued = await insertDispatch(client, dispatch, audit);
      await client.query(
        `UPDATE adc_approvals SET status = 'approved', resolved_at = $2 WHERE approval_id = $1`,
        [approvalId, now.toISOString()]
      );
      await client.query(
        `INSERT INTO adc_audit_events (event_id, account_id, invocation_id, event_type, payload, created_at)
         VALUES ($1, $2, $3, 'approval.approved', $4, $5)`,
        [
          createId("dsp"),
          dispatch.invocation.accountId,
          dispatch.invocation.invocationId,
          { approvalId, dispatchId: queued.dispatchId },
          now.toISOString()
        ]
      );
      return queued;
    });
  }

  async claim(nodeId: string, now: Date, leaseMs: number): Promise<DispatchRecord | undefined> {
    const leaseToken = randomBytes(24).toString("base64url");
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT dispatch_id FROM adc_dispatches
         WHERE node_id = $1 AND (
           status = 'queued' OR
           (status IN ('leased', 'running', 'cancel_requested') AND lease_expires_at <= $2)
         )
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE adc_dispatches d
       SET status = CASE WHEN d.status = 'queued' THEN 'leased' ELSE d.status END,
           lease_token = $3, lease_expires_at = $4, updated_at = $2
       FROM candidate
       WHERE d.dispatch_id = candidate.dispatch_id
       RETURNING d.*`,
      [nodeId, now.toISOString(), leaseToken, leaseExpiresAt.toISOString()]
    );
    return result.rows[0] ? dispatchFromRow(result.rows[0]) : undefined;
  }

  async acknowledge(
    dispatchId: string,
    leaseToken: string,
    now: Date
  ): Promise<DispatchRecord | undefined> {
    const result = await this.pool.query(
      `UPDATE adc_dispatches
       SET status = CASE WHEN status = 'cancel_requested' THEN status ELSE 'running' END,
           updated_at = $3
       WHERE dispatch_id = $1 AND status IN ('leased', 'running', 'cancel_requested') AND lease_token = $2
         AND lease_expires_at > $3
       RETURNING *`,
      [dispatchId, leaseToken, now.toISOString()]
    );
    return result.rows[0] ? dispatchFromRow(result.rows[0]) : undefined;
  }

  async renewLease(
    dispatchId: string,
    leaseToken: string,
    now: Date,
    leaseMs: number
  ): Promise<DispatchRecord | undefined> {
    const result = await this.pool.query(
      `UPDATE adc_dispatches
       SET lease_expires_at = $4, updated_at = $3
       WHERE dispatch_id = $1 AND status IN ('running', 'cancel_requested') AND lease_token = $2
         AND lease_expires_at > $3
       RETURNING *`,
      [dispatchId, leaseToken, now.toISOString(), new Date(now.getTime() + leaseMs).toISOString()]
    );
    return result.rows[0] ? dispatchFromRow(result.rows[0]) : undefined;
  }

  async complete(
    dispatchId: string,
    leaseToken: string,
    result: InvocationResult,
    receipt: Receipt | undefined,
    now: Date
  ): Promise<DispatchRecord | undefined> {
    return transaction(this.pool, async (client) => {
      const current = await client.query(
        "SELECT * FROM adc_dispatches WHERE dispatch_id = $1 FOR UPDATE",
        [dispatchId]
      );
      const row = current.rows[0];
      if (!row) {
        return undefined;
      }
      if (["succeeded", "failed", "denied", "cancelled", "unknown_outcome"].includes(row.status)) {
        return dispatchFromRow(row);
      }
      if (row.lease_token !== leaseToken) {
        return undefined;
      }
      if (isSideEffectTool(row.invocation.tool) && !receipt) {
        throw new ProtocolError(
          ErrorCodes.INVALID_REQUEST,
          "side-effecting completion requires a receipt",
          false
        );
      }
      const status =
        result.status === "succeeded"
          ? "succeeded"
          : result.status === "cancelled"
            ? "cancelled"
            : result.status === "unknown_outcome"
              ? "unknown_outcome"
              : result.status === "denied"
                ? "denied"
                : "failed";
      const updated = await client.query(
        `UPDATE adc_dispatches
         SET status = $3, result = $4, receipt = $5, updated_at = $6
         WHERE dispatch_id = $1 AND lease_token = $2
         RETURNING *`,
        [dispatchId, leaseToken, status, result, receipt ?? null, now.toISOString()]
      );
      await client.query(
        `INSERT INTO adc_audit_events
         (event_id, account_id, invocation_id, event_type, payload, created_at)
         VALUES ($1, $2, $3, 'dispatch.completed', $4, $5)`,
        [
          createId("dsp"),
          row.account_id,
          row.invocation_id,
          { dispatchId, nodeId: row.node_id, status, receiptId: receipt?.receiptId },
          now.toISOString()
        ]
      );
      return dispatchFromRow(updated.rows[0]!);
    });
  }

  async requestCancel(dispatchId: string, now: Date): Promise<DispatchRecord | undefined> {
    const result = await this.pool.query(
      `UPDATE adc_dispatches
       SET status = CASE
             WHEN status IN ('queued', 'leased') THEN 'cancelled'
             ELSE 'cancel_requested'
           END,
           updated_at = $2
       WHERE dispatch_id = $1
         AND status NOT IN ('succeeded', 'failed', 'denied', 'cancelled', 'unknown_outcome')
       RETURNING *`,
      [dispatchId, now.toISOString()]
    );
    if (result.rows[0]) {
      return dispatchFromRow(result.rows[0]);
    }
    return this.getDispatchById(dispatchId);
  }

  async getDispatchById(dispatchId: string): Promise<DispatchRecord | undefined> {
    const result = await this.pool.query("SELECT * FROM adc_dispatches WHERE dispatch_id = $1", [
      dispatchId
    ]);
    return result.rows[0] ? dispatchFromRow(result.rows[0]) : undefined;
  }

  async getDispatchByInvocation(invocationId: string): Promise<DispatchRecord | undefined> {
    const result = await this.pool.query("SELECT * FROM adc_dispatches WHERE invocation_id = $1", [
      invocationId
    ]);
    return result.rows[0] ? dispatchFromRow(result.rows[0]) : undefined;
  }

  async listAudit(accountId: string, invocationId?: string): Promise<AuditEvent[]> {
    const result = invocationId
      ? await this.pool.query(
          `SELECT * FROM adc_audit_events
           WHERE account_id = $1 AND invocation_id = $2 ORDER BY created_at`,
          [accountId, invocationId]
        )
      : await this.pool.query(
          "SELECT * FROM adc_audit_events WHERE account_id = $1 ORDER BY created_at",
          [accountId]
        );
    return result.rows.map(auditFromRow);
  }

  async putAudit(event: AuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO adc_audit_events
       (event_id, account_id, invocation_id, event_type, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.eventId,
        event.accountId,
        event.invocationId ?? null,
        event.type,
        event.payload,
        event.createdAt
      ]
    );
  }

  async putArtifact(artifact: ArtifactRecord): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO adc_artifacts
       (artifact_id, account_id, invocation_id, node_id, content_type, content_sha256,
        byte_size, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (artifact_id) DO NOTHING`,
      [
        artifact.artifactId,
        artifact.accountId,
        artifact.invocationId,
        artifact.nodeId,
        artifact.contentType,
        artifact.sha256,
        artifact.data.byteLength,
        artifact.data,
        artifact.createdAt
      ]
    );
    if (!result.rowCount) {
      const existing = await this.getArtifact(artifact.artifactId);
      if (
        !existing ||
        existing.sha256 !== artifact.sha256 ||
        existing.accountId !== artifact.accountId ||
        existing.invocationId !== artifact.invocationId
      ) {
        throw new ProtocolError(
          ErrorCodes.CONFLICT,
          "artifact id was already used with different content",
          false
        );
      }
    }
  }

  async getArtifact(artifactId: string): Promise<ArtifactRecord | undefined> {
    const result = await this.pool.query("SELECT * FROM adc_artifacts WHERE artifact_id = $1", [
      artifactId
    ]);
    const row = result.rows[0];
    return row
      ? {
          artifactId: row.artifact_id,
          accountId: row.account_id,
          invocationId: row.invocation_id,
          nodeId: row.node_id,
          contentType: row.content_type,
          sha256: row.content_sha256,
          data: Buffer.from(row.data),
          createdAt: iso(row.created_at)
        }
      : undefined;
  }

  async consumeNodeNonce(nodeId: string, nonce: string, expiresAt: Date): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      await client.query("DELETE FROM adc_node_nonces WHERE expires_at <= NOW()");
      const result = await client.query(
        `INSERT INTO adc_node_nonces (node_id, nonce, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [nodeId, nonce, expiresAt.toISOString()]
      );
      return (result.rowCount ?? 0) > 0;
    });
  }
}

async function insertAudit(client: PoolClient, event: AuditEvent) {
  await client.query(
    `INSERT INTO adc_audit_events (event_id, account_id, invocation_id, event_type, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      event.eventId,
      event.accountId,
      event.invocationId ?? null,
      event.type,
      event.payload,
      event.createdAt
    ]
  );
}

async function cancelResourceWork(
  client: PoolClient,
  accountId: string,
  kind: "node" | "grant",
  id: string,
  now: string
) {
  const predicate =
    kind === "node" ? "node_id = $2" : "invocation->'authorization'->>'grantId' = $2";
  await client.query(
    `UPDATE adc_dispatches SET status = CASE WHEN status IN ('queued', 'leased') THEN 'cancelled' ELSE 'cancel_requested' END,
     updated_at = $3 WHERE account_id = $1 AND ${predicate} AND status IN ('queued', 'leased', 'running')`,
    [accountId, id, now]
  );
  await client.query(
    `UPDATE adc_approvals SET status = 'denied', resolved_at = $3
     WHERE account_id = $1 AND ${predicate} AND status = 'pending'`,
    [accountId, id, now]
  );
}

async function insertDispatch(client: PoolClient, dispatch: DispatchRecord, audit: AuditEvent) {
  const invocation = dispatch.invocation;
  const inserted = await client.query(
    `INSERT INTO adc_dispatches
     (dispatch_id, invocation_id, account_id, actor_id, node_id, idempotency_key,
      input_hash, invocation, policy_decision, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT DO NOTHING RETURNING *`,
    [
      dispatch.dispatchId,
      invocation.invocationId,
      invocation.accountId,
      invocation.actor.id,
      dispatch.nodeId,
      invocation.idempotencyKey ?? null,
      invocationInputHash(invocation),
      invocation,
      dispatch.policyDecision,
      dispatch.status,
      dispatch.createdAt,
      dispatch.updatedAt
    ]
  );
  if (!inserted.rowCount) {
    const existing = await client.query(
      `SELECT * FROM adc_dispatches WHERE invocation_id = $1 OR
       (account_id = $2 AND actor_id = $3 AND idempotency_key = $4)`,
      [
        invocation.invocationId,
        invocation.accountId,
        invocation.actor.id,
        invocation.idempotencyKey ?? null
      ]
    );
    if (existing.rows.length !== 1)
      throw new ProtocolError("conflict", "Invocation key is unavailable.", false);
    const persisted = dispatchFromRow(existing.rows[0]!);
    assertSameInvocation(persisted.invocation, invocation);
    return persisted;
  }
  await client.query(
    `INSERT INTO adc_audit_events (event_id, account_id, invocation_id, event_type, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      audit.eventId,
      audit.accountId,
      audit.invocationId ?? null,
      audit.type,
      audit.payload,
      audit.createdAt
    ]
  );
  return dispatchFromRow(inserted.rows[0]!);
}
