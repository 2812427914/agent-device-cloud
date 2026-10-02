ALTER TABLE adc_nodes DROP CONSTRAINT IF EXISTS adc_nodes_platform_check;
ALTER TABLE adc_nodes
  ADD CONSTRAINT adc_nodes_platform_check
  CHECK (platform IN ('darwin', 'linux', 'win32', 'android'));
