ALTER TABLE adc_agent_grants
  ADD COLUMN IF NOT EXISTS root_access text NOT NULL DEFAULT 'selected'
    CHECK (root_access IN ('selected', 'all'));
ALTER TABLE adc_agent_grants
  ADD COLUMN IF NOT EXISTS approval_policy text
    CHECK (approval_policy IN ('never', 'writes', 'execute', 'always'));
