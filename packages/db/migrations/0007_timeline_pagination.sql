CREATE INDEX IF NOT EXISTS adc_audit_timeline_idx
  ON adc_audit_events (account_id, created_at DESC, event_id DESC);

CREATE INDEX IF NOT EXISTS adc_audit_category_timeline_idx
  ON adc_audit_events (
    account_id,
    (split_part(event_type, '.', 1)),
    created_at DESC,
    event_id DESC
  );

CREATE INDEX IF NOT EXISTS adc_approval_timeline_idx
  ON adc_approvals (account_id, created_at DESC, approval_id DESC);
