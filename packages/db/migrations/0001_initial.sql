CREATE TABLE IF NOT EXISTS adc_accounts (
  account_id text PRIMARY KEY,
  owner_token_hash text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS adc_pairing_codes (
  code_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES adc_accounts(account_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS adc_nodes (
  node_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES adc_accounts(account_id) ON DELETE CASCADE,
  label text NOT NULL,
  public_key text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('darwin', 'linux')),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  capability jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, label)
);

CREATE TABLE IF NOT EXISTS adc_projects (
  project_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES adc_accounts(account_id) ON DELETE CASCADE,
  label text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, label)
);

CREATE TABLE IF NOT EXISTS adc_roots (
  root_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES adc_projects(project_id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES adc_nodes(node_id) ON DELETE CASCADE,
  label text NOT NULL,
  writable boolean NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, node_id, label)
);

CREATE TABLE IF NOT EXISTS adc_agent_grants (
  grant_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES adc_accounts(account_id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  profile text NOT NULL,
  node_ids jsonb NOT NULL,
  root_ids jsonb NOT NULL,
  allowed_tools jsonb NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS adc_approvals (
  approval_id text PRIMARY KEY,
  invocation_id text NOT NULL UNIQUE,
  account_id text NOT NULL REFERENCES adc_accounts(account_id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES adc_nodes(node_id),
  placement_reason text NOT NULL,
  invocation jsonb NOT NULL,
  policy_decision jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS adc_approval_queue_idx
  ON adc_approvals (account_id, status, created_at);

CREATE TABLE IF NOT EXISTS adc_dispatches (
  dispatch_id text PRIMARY KEY,
  invocation_id text NOT NULL UNIQUE,
  account_id text NOT NULL REFERENCES adc_accounts(account_id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  node_id text NOT NULL REFERENCES adc_nodes(node_id),
  idempotency_key text,
  input_hash text NOT NULL,
  invocation jsonb NOT NULL,
  policy_decision jsonb NOT NULL,
  status text NOT NULL,
  lease_token text,
  lease_expires_at timestamptz,
  result jsonb,
  receipt jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS adc_dispatch_idempotency_idx
  ON adc_dispatches (account_id, actor_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS adc_dispatch_claim_idx
  ON adc_dispatches (node_id, status, created_at);

CREATE TABLE IF NOT EXISTS adc_artifacts (
  artifact_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES adc_accounts(account_id) ON DELETE CASCADE,
  invocation_id text NOT NULL,
  node_id text NOT NULL REFERENCES adc_nodes(node_id),
  content_type text NOT NULL,
  content_sha256 text NOT NULL,
  byte_size bigint NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS adc_artifact_invocation_idx
  ON adc_artifacts (account_id, invocation_id);

CREATE TABLE IF NOT EXISTS adc_audit_events (
  event_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES adc_accounts(account_id) ON DELETE CASCADE,
  invocation_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS adc_audit_lookup_idx
  ON adc_audit_events (account_id, invocation_id, created_at);

CREATE TABLE IF NOT EXISTS adc_node_nonces (
  node_id text NOT NULL REFERENCES adc_nodes(node_id) ON DELETE CASCADE,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (node_id, nonce)
);
