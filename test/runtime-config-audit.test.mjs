import test from 'node:test';
import assert from 'node:assert/strict';
import { getRuntimeConfigAudit } from '../server/lib/runtime-config.js';

test('runtime config audit flags blocking keys when missing', () => {
  const audit = getRuntimeConfigAudit({
    JWT_SECRET: 'a'.repeat(32)
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('DATABASE_URL'));
  assert.ok(audit.blockingFailedKeys.includes('REDIS_URL'));
});

test('runtime config audit passes when blocking keys are present', () => {
  const audit = getRuntimeConfigAudit({
    JWT_SECRET: 'a'.repeat(48),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379'
  });

  assert.equal(audit.ok, true);
  assert.equal(audit.summary.blockingFailed, 0);
});

test('runtime config audit blocks production when outbound click secret is weak or reused', () => {
  const jwtSecret = 'x'.repeat(48);
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'stripe',
    JWT_SECRET: jwtSecret,
    OUTBOUND_CLICK_SECRET: jwtSecret,
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('OUTBOUND_CLICK_SECRET'));
});

test('runtime config audit rejects unsupported billing provider values', () => {
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'braintree',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('BILLING_PROVIDER'));
});

test('runtime config audit blocks production when mock billing upgrades are enabled', () => {
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'stripe',
    ALLOW_MOCK_BILLING_UPGRADES: 'true',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('ALLOW_MOCK_BILLING_UPGRADES'));
});

test('runtime config audit blocks production when Stripe publishable key and prices are missing', () => {
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_live_example_key_1234567890',
    STRIPE_WEBHOOK_SECRET: 'whsec_live_example_1234567890',
    ALLOW_MOCK_BILLING_UPGRADES: 'false',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('STRIPE_PUBLISHABLE_KEY'));
  assert.ok(audit.blockingFailedKeys.includes('STRIPE_PRICE_PRO'));
  assert.ok(audit.blockingFailedKeys.includes('STRIPE_PRICE_CREATOR'));
});

test('runtime config audit blocks production when STRIPE_SECRET_KEY is missing with billing provider stripe', () => {
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: '',
    ALLOW_MOCK_BILLING_UPGRADES: 'false',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('STRIPE_SECRET_KEY'));
});

test('runtime config audit blocks production when AI free-user bypass is enabled', () => {
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_live_example_key_1234567890',
    STRIPE_WEBHOOK_SECRET: 'whsec_live_example_1234567890',
    STRIPE_PUBLISHABLE_KEY: 'pk_live_example_key_1234567890',
    STRIPE_PRICE_PRO: 'price_live_pro_12345',
    STRIPE_PRICE_CREATOR: 'price_live_creator_12345',
    AI_ALLOW_FREE_USERS: 'true',
    ALLOW_MOCK_BILLING_UPGRADES: 'false',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('AI_ALLOW_FREE_USERS'));
});

test('runtime config audit blocks production when AI_ALLOWED_PLAN_TYPES includes free', () => {
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_live_example_key_1234567890',
    STRIPE_WEBHOOK_SECRET: 'whsec_live_example_1234567890',
    STRIPE_PUBLISHABLE_KEY: 'pk_live_example_key_1234567890',
    STRIPE_PRICE_PRO: 'price_live_pro_12345',
    STRIPE_PRICE_CREATOR: 'price_live_creator_12345',
    AI_ALLOW_FREE_USERS: 'false',
    AI_ALLOWED_PLAN_TYPES: 'free,elite,creator',
    ALLOW_MOCK_BILLING_UPGRADES: 'false',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('AI_ALLOWED_PLAN_TYPES'));
});

test('runtime config audit blocks production when Stripe inline price-data fallback is enabled', () => {
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_live_example_key_1234567890',
    STRIPE_WEBHOOK_SECRET: 'whsec_live_example_1234567890',
    STRIPE_PUBLISHABLE_KEY: 'pk_live_example_key_1234567890',
    STRIPE_PRICE_PRO: 'price_live_pro_12345',
    STRIPE_PRICE_CREATOR: 'price_live_creator_12345',
    STRIPE_ALLOW_INLINE_PRICE_DATA: 'true',
    ALLOW_MOCK_BILLING_UPGRADES: 'false',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('STRIPE_ALLOW_INLINE_PRICE_DATA'));
});

test('runtime config audit fails when Duffel is enabled without API key', () => {
  const audit = getRuntimeConfigAudit({
    JWT_SECRET: 'a'.repeat(48),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379',
    ENABLE_PROVIDER_DUFFEL: 'true',
    DUFFEL_API_KEY: ''
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('DUFFEL_PROVIDER_CREDENTIALS'));
});

test('runtime config audit fails when scanner is enabled and no provider is configured', () => {
  const audit = getRuntimeConfigAudit({
    JWT_SECRET: 'a'.repeat(48),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379',
    FLIGHT_SCAN_ENABLED: 'true',
    ENABLE_PROVIDER_DUFFEL: 'false'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('AT_LEAST_ONE_PROVIDER_CONFIGURED'));
});

test('runtime config audit passes scanner provider consistency when one provider is configured', () => {
  const audit = getRuntimeConfigAudit({
    JWT_SECRET: 'a'.repeat(48),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379',
    FLIGHT_SCAN_ENABLED: 'true',
    ENABLE_PROVIDER_DUFFEL: 'true',
    DUFFEL_API_KEY: 'duffel_live_key_123456'
  });

  assert.equal(audit.ok, true);
  assert.ok(!audit.blockingFailedKeys.includes('AT_LEAST_ONE_PROVIDER_CONFIGURED'));
  assert.ok(!audit.blockingFailedKeys.includes('DUFFEL_PROVIDER_CREDENTIALS'));
});

test('runtime config audit fails in production when deals content has no delivery channel', () => {
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'stripe',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379',
    DEALS_CONTENT_ENABLED: 'true',
    DEALS_CONTENT_INAPP_ENABLED: 'false',
    PUSH_WEBHOOK_URL: '',
    DEALS_CONTENT_SOCIAL_WEBHOOK_URL: '',
    DEALS_CONTENT_NEWSLETTER_RECIPIENTS: ''
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('DEALS_CONTENT_DELIVERY_CHANNELS'));
});

test('runtime config audit passes deals content channel check with in-app delivery enabled', () => {
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_live_prod_key_1234567890abcdef',
    STRIPE_WEBHOOK_SECRET: 'whsec_live_prod_1234567890',
    STRIPE_PUBLISHABLE_KEY: 'pk_live_prod_key_1234567890abcdef',
    STRIPE_PRICE_PRO: 'price_live_pro_12345',
    STRIPE_PRICE_CREATOR: 'price_live_creator_12345',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379',
    ENABLE_PROVIDER_DUFFEL: 'true',
    ENABLE_PROVIDER_KIWI: 'false',
    ENABLE_PROVIDER_SKYSCANNER: 'false',
    DUFFEL_API_KEY: 'duffel_live_key_123456',
    ENABLE_TRAVELPAYOUTS_AFFILIATE: 'true',
    AFFILIATE_TRAVELPAYOUTS_MARKER: 'tp_marker_prod_123',
    DEALS_CONTENT_ENABLED: 'true',
    DEALS_CONTENT_INAPP_ENABLED: 'true'
  });

  assert.equal(audit.ok, true);
  assert.ok(!audit.blockingFailedKeys.includes('DEALS_CONTENT_DELIVERY_CHANNELS'));
});
