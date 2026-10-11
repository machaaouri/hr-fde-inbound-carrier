-- Twin carrier_contacts for voice E2E (OTP inbox).
-- MC list and expected FMCSA outcomes: qa/test-carriers.md

INSERT INTO carrier_contacts (mc_number, legal_name, email, source)
VALUES
  ('136818', 'Swift Transportation Co. of Arizona', 'odocto1@gmail.com', 'seed'),
  ('133655', 'Schneider National Carriers', 'odocto1@gmail.com', 'seed'),
  ('114457', 'Dart Transit Company', 'odocto1@gmail.com', 'seed'),
  ('150300', 'Miller Transports', 'odocto1@gmail.com', 'seed')
ON CONFLICT (mc_number) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  email = EXCLUDED.email,
  source = EXCLUDED.source,
  updated_at = NOW();
