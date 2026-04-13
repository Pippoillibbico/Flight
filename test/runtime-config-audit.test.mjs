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
    BILLING_PROVIDER: 'braintree',
    JWT_SECRET: jwtSecret,
    OUTBOUND_CLICK_SECRET: jwtSecret,
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379',
    BT_MERCHANT_ID: 'merchant_123456',
    BT_PUBLIC_KEY: 'public_123456',
    BT_PRIVATE_KEY: 'private_1234567890',
    BT_ENVIRONMENT: 'sandbox'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('OUTBOUND_CLICK_SECRET'));
});

test('runtime config audit enforces braintree billing lock in production', () => {
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'stripe',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('BILLING_PROVIDER_PRODUCTION_LOCK'));
});

test('runtime config audit blocks production when mock billing upgrades are enabled', () => {
  const audit = getRuntimeConfigAudit({
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'braintree',
    ALLOW_MOCK_BILLING_UPGRADES: 'true',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379',
    BT_MERCHANT_ID: 'merchant_123456',
    BT_PUBLIC_KEY: 'public_123456',
    BT_PRIVATE_KEY: 'private_1234567890',
    BT_ENVIRONMENT: 'sandbox'
  });

  assert.equal(audit.ok, false);
  assert.ok(audit.blockingFailedKeys.includes('ALLOW_MOCK_BILLING_UPGRADES'));
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
    ENABLE_PROVIDER_DUFFEL: 'false',
    ENABLE_PROVIDER_AMADEUS: 'false'
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
    BILLING_PROVIDER: 'braintree',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379',
    BT_MERCHANT_ID: 'merchant_123456',
    BT_PUBLIC_KEY: 'public_123456',
    BT_PRIVATE_KEY: 'private_1234567890',
    BT_ENVIRONMENT: 'sandbox',
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
    BILLING_PROVIDER: 'braintree',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379',
    BT_MERCHANT_ID: 'merchant_123456',
    BT_PUBLIC_KEY: 'public_123456',
    BT_PRIVATE_KEY: 'private_1234567890',
    BT_ENVIRONMENT: 'sandbox',
    BT_PLAN_PRO_ID: 'plan_pro_test',
    BT_PLAN_CREATOR_ID: 'plan_elite_test',
    DEALS_CONTENT_ENABLED: 'true',
    DEALS_CONTENT_INAPP_ENABLED: 'true'
  });

  assert.equal(audit.ok, true);
  assert.ok(!audit.blockingFailedKeys.includes('DEALS_CONTENT_DELIVERY_CHANNELS'));
});
