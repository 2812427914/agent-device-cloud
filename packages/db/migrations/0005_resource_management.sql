ALTER TABLE adc_nodes
  ADD COLUMN access_policy jsonb,
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD COLUMN deleted_at timestamptz;

ALTER TABLE adc_agent_grants
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD COLUMN deleted_at timestamptz;

-- Removing a device frees its display name while retaining identity and receipts.
ALTER TABLE adc_nodes DROP CONSTRAINT adc_nodes_account_id_label_key;
CREATE UNIQUE INDEX adc_nodes_live_label_idx ON adc_nodes (account_id, label)
  WHERE deleted_at IS NULL;
