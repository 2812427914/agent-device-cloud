-- Historical accounts are retained but have no public owner until explicitly claimed locally.
ALTER TABLE adc_accounts ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE adc_accounts ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Personal account';
ALTER TABLE adc_accounts ALTER COLUMN owner_token_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS adc_accounts_user_idx ON adc_accounts(user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS adc_credentials (
  credential_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES adc_accounts(account_id) ON DELETE CASCADE,
  grant_id text NOT NULL REFERENCES adc_agent_grants(grant_id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS adc_credentials_account_idx ON adc_credentials(account_id);

CREATE TABLE IF NOT EXISTS adc_oauth_bindings (
  client_id text NOT NULL,
  user_id text NOT NULL,
  account_id text NOT NULL REFERENCES adc_accounts(account_id) ON DELETE CASCADE,
  grant_id text NOT NULL REFERENCES adc_agent_grants(grant_id),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (client_id, user_id)
);

CREATE TABLE IF NOT EXISTS adc_rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);

ALTER TABLE adc_agent_grants ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Agent';
ALTER TABLE adc_agent_grants ADD COLUMN IF NOT EXISTS project_id text REFERENCES adc_projects(project_id);
