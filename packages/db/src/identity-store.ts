import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { createId, ProtocolError } from "@adc/protocol";

export interface PersonalAccount {
  accountId: string;
  userId: string;
  name: string;
}

export interface Credential {
  credentialId: string;
  accountId: string;
  grantId: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

function credential(row: Record<string, any>): Credential {
  return {
    credentialId: row.credential_id,
    accountId: row.account_id,
    grantId: row.grant_id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null
  };
}

/** PostgreSQL identity state shared by all application workers. */
export class IdentityStore {
  constructor(readonly pool: Pool) {}

  async accountForUser(userId: string, name: string): Promise<PersonalAccount> {
    const result = await this.pool.query(
      `INSERT INTO adc_accounts (account_id, user_id, name, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) WHERE user_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name
       RETURNING account_id, user_id, name`,
      [createId("acct"), userId, name]
    );
    const row = result.rows[0]!;
    return { accountId: row.account_id, userId: row.user_id, name: row.name };
  }

  async createCredential(
    accountId: string,
    grantId: string,
    name: string,
    expiresAt: Date
  ): Promise<{ credential: Credential; token: string }> {
    const token = `adc_${randomBytes(32).toString("base64url")}`;
    const result = await this.pool.query(
      `INSERT INTO adc_credentials
       (credential_id, account_id, grant_id, name, token_hash, created_at, expires_at)
       SELECT $1, $2, grant_id, $4, $5, NOW(), $6
       FROM adc_agent_grants WHERE grant_id = $3 AND account_id = $2 AND revoked_at IS NULL
       RETURNING *`,
      [
        `cred_${randomBytes(16).toString("hex")}`,
        accountId,
        grantId,
        name,
        hashToken(token),
        expiresAt
      ]
    );
    if (!result.rows[0]) throw new ProtocolError("not_found", "Grant not found.", false);
    return { credential: credential(result.rows[0]), token };
  }

  async authenticateCredential(token: string): Promise<Credential | undefined> {
    if (!/^adc_[A-Za-z0-9_-]{43}$/.test(token)) return;
    const result = await this.pool.query(
      `UPDATE adc_credentials c SET last_used_at = NOW()
       FROM adc_agent_grants g
       WHERE c.token_hash = $1 AND c.revoked_at IS NULL AND c.expires_at > NOW()
         AND g.grant_id = c.grant_id AND g.account_id = c.account_id AND g.revoked_at IS NULL
       RETURNING c.*`,
      [hashToken(token)]
    );
    return result.rows[0] ? credential(result.rows[0]) : undefined;
  }

  async listCredentials(accountId: string): Promise<Credential[]> {
    const result = await this.pool.query(
      `SELECT c.*, COALESCE(c.revoked_at, g.revoked_at) AS revoked_at
       FROM adc_credentials c JOIN adc_agent_grants g ON g.grant_id = c.grant_id
       WHERE c.account_id = $1 AND g.deleted_at IS NULL ORDER BY c.created_at DESC`,
      [accountId]
    );
    return result.rows.map(credential);
  }

  async revokeCredential(accountId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE adc_credentials SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE account_id = $1 AND credential_id = $2`,
      [accountId, id]
    );
    return !!result.rowCount;
  }

  async bindOAuthClient(userId: string, accountId: string, clientId: string, grantId: string) {
    const result = await this.pool.query(
      `INSERT INTO adc_oauth_bindings (client_id, user_id, account_id, grant_id, created_at, generation)
       SELECT $3, $1, $2, grant_id, NOW(), $5
       FROM adc_agent_grants WHERE grant_id = $4 AND account_id = $2 AND revoked_at IS NULL
       ON CONFLICT (client_id, user_id) DO UPDATE SET
         grant_id = EXCLUDED.grant_id,
         generation = CASE WHEN adc_oauth_bindings.revoked_at IS NULL
           THEN adc_oauth_bindings.generation ELSE EXCLUDED.generation END,
         created_at = CASE WHEN adc_oauth_bindings.revoked_at IS NULL
           THEN adc_oauth_bindings.created_at ELSE NOW() END,
         revoked_at = NULL
         WHERE adc_oauth_bindings.grant_id = EXCLUDED.grant_id OR adc_oauth_bindings.revoked_at IS NOT NULL
       RETURNING grant_id`,
      [userId, accountId, clientId, grantId, `binding_${randomBytes(24).toString("hex")}`]
    );
    if (!result.rowCount) {
      throw new ProtocolError(
        "conflict",
        "Disconnect this client before changing its authorization, and choose an active grant.",
        false
      );
    }
  }

  async oauthBinding(userId: string, clientId: string, generation: string) {
    const result = await this.pool.query<{ account_id: string; grant_id: string }>(
      `SELECT b.account_id, b.grant_id FROM adc_oauth_bindings b
       JOIN adc_agent_grants g ON g.grant_id = b.grant_id AND g.account_id = b.account_id
       WHERE b.user_id = $1 AND b.client_id = $2
         AND b.generation = $3
         AND b.revoked_at IS NULL AND g.revoked_at IS NULL`,
      [userId, clientId, generation]
    );
    const row = result.rows[0];
    return row ? { accountId: row.account_id, grantId: row.grant_id } : undefined;
  }

  async revokeOAuthBinding(accountId: string, clientId: string): Promise<void> {
    await this.pool.query(
      `UPDATE adc_oauth_bindings SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE account_id = $1 AND client_id = $2`,
      [accountId, clientId]
    );
  }

  async listOAuthBindings(accountId: string) {
    const result = await this.pool.query(
      `SELECT b.client_id, b.grant_id, b.created_at, COALESCE(b.revoked_at, g.revoked_at) AS revoked_at
       FROM adc_oauth_bindings b JOIN adc_agent_grants g ON g.grant_id = b.grant_id
       WHERE b.account_id = $1 AND g.deleted_at IS NULL ORDER BY b.created_at DESC`,
      [accountId]
    );
    return result.rows.map((row) => ({
      clientId: row.client_id,
      grantId: row.grant_id,
      createdAt: new Date(row.created_at).toISOString(),
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null
    }));
  }

  async countActiveConnections(accountId: string, now: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM adc_credentials c
          JOIN adc_agent_grants g
            ON g.grant_id = c.grant_id AND g.account_id = c.account_id
          WHERE c.account_id = $1
            AND c.revoked_at IS NULL AND c.expires_at > $2::timestamptz
            AND g.revoked_at IS NULL AND g.deleted_at IS NULL)
         +
         (SELECT COUNT(*) FROM adc_oauth_bindings b
          JOIN adc_agent_grants g
            ON g.grant_id = b.grant_id AND g.account_id = b.account_id
          WHERE b.account_id = $1 AND b.revoked_at IS NULL
            AND g.revoked_at IS NULL AND g.deleted_at IS NULL)
       )::text AS count`,
      [accountId, now]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async takeRateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
    const result = await this.pool.query<{ count: number }>(
      `INSERT INTO adc_rate_limits (key, count, expires_at)
       VALUES ($1, 1, NOW() + $2 * INTERVAL '1 second')
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN adc_rate_limits.expires_at <= NOW() THEN 1 ELSE adc_rate_limits.count + 1 END,
         expires_at = CASE WHEN adc_rate_limits.expires_at <= NOW()
           THEN NOW() + $2 * INTERVAL '1 second' ELSE adc_rate_limits.expires_at END
       RETURNING count`,
      [key, windowSeconds]
    );
    return result.rows[0]!.count <= max;
  }
}
