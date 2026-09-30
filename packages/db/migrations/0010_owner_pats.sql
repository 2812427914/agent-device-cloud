CREATE TABLE IF NOT EXISTS adc_owner_pats (
  pat_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES adc_accounts(account_id) ON DELETE CASCADE,
  label text NOT NULL,
  read_only boolean NOT NULL DEFAULT false,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS adc_owner_pats_account_idx ON adc_owner_pats(account_id);
