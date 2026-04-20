import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStartupReadiness } from '../server/lib/startup-readiness.js';

function baseProdEnv() {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'd'.repeat(48),
    ALLOW_MOCK_BILLING_UPGRADES: 'false',
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379',
    CORS_ALLOWLIST: 'https://app.flightsuite.test',
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_live_test_1234567890abcdef',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_1234567890',
    STRIPE_PUBLISHABLE_KEY: 'pk_live_test_1234567890abcdef',
    STRIPE_PRICE_PRO: 'price_live_pro_12345',
    STRIPE_PRICE_CREATOR: 'price_live_creator_12345',
    STRIPE_ALLOW_INLINE_PRICE_DATA: 'false',
    AI_ALLOW_FREE_USERS: 'false',
    ENABLE_PROVIDER_DUFFEL: 'true',
    DUFFEL_API_KEY: 'duffel_test_key_123456789',
    ENABLE_PROVIDER_KIWI: 'false',
    ENABLE_PROVIDER_SKYSCANNER: 'false',
    ENABLE_TRAVELPAYOUTS_AFFILIATE: 'true',
    AFFILIATE_TRAVELPAYOUTS_MARKER: 'tp_marker_test_123456',
    SOFT_LAUNCH_PROVIDER_PROFILE: 'true',
    SOFT_LAUNCH_AFFILIATE_PROFILE: 'true'
  };
}

test('startup readiness passes with production-safe policy', () => {
  const readiness = evaluateStartupReadiness(baseProdEnv());
  assert.equal(readiness.ok, true);
  assert.equal(readiness.summary.policy.blockingFailed, 0);
});

test('startup readiness fails when production origin is not https', () => {
  const env = baseProdEnv();
  env.FRONTEND_ORIGIN = 'http://app.flightsuite.test';
  env.CORS_ALLOWLIST = 'http://app.flightsuite.test';
  const readiness = evaluateStartupReadiness(env);
  assert.equal(readiness.ok, false);
  assert.ok(readiness.blockingFailed.policy.includes('frontend_origin_https'));
});

test('startup readiness fails when localhost is in production CORS', () => {
  const env = baseProdEnv();
  env.CORS_ALLOWLIST = 'https://app.flightsuite.test,http://localhost:5173';
  const readiness = evaluateStartupReadiness(env);
  assert.equal(readiness.ok, false);
  assert.ok(readiness.blockingFailed.policy.includes('cors_no_localhost'));
});
