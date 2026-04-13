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
    BILLING_PROVIDER: 'braintree',
    BT_MERCHANT_ID: 'merchant_test',
    BT_PUBLIC_KEY: 'public_test',
    BT_PRIVATE_KEY: 'private_key_test_12345',
    BT_ENVIRONMENT: 'sandbox',
    BT_PLAN_PRO_ID: 'plan_pro_test',
    BT_PLAN_CREATOR_ID: 'plan_elite_test'
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
