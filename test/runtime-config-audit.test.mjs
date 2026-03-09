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
