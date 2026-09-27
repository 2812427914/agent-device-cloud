DROP INDEX IF EXISTS adc_nodes_live_label_idx;
CREATE UNIQUE INDEX adc_nodes_active_label_idx ON adc_nodes (account_id, label)
  WHERE deleted_at IS NULL AND status = 'active';
