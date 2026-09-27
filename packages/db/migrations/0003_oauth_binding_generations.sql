-- Every reconnection has a distinct consent reference. Tokens and authorization
-- codes retain the reference they were issued for, including through refresh.
ALTER TABLE adc_oauth_bindings ADD COLUMN generation text NOT NULL
  DEFAULT ('binding_' || md5(random()::text || clock_timestamp()::text));
