import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import express from 'express';

import { buildSystemRouter } from '../server/routes/system.js';
import { evaluateCachePolicy, getRuntimeProfileSummary, resolveRuntimeProfile } from '../server/lib/runtime-profile.js';
import { getRuntimeConfigAudit } from '../server/lib/runtime-config.js';
import { PLAN_LIMITS, isFreeAiFeatureFlagEnabled } from '../server/lib/plan-access.js';

function softZeroCostEnv(extra = {}) {
  return {
    NODE_ENV: 'production',
    RUNTIME_PROFILE: 'soft-zero-cost',
    LAUNCH_MODE: 'soft',
    RUNTIME_MODE: 'api',
    RUNTIME_INSTANCE_COUNT: '1',
    CACHE_BACKEND: 'memory',
    REDIS_REQUIRED_MODE: 'soft_optional',
    ALLOW_IN_MEMORY_CACHE_IN_SOFT_LAUNCH: 'true',
    AI_ALLOW_FREE_USERS: 'false',
    FREE_AI_ENABLED: 'false',
    AI_BUDGET_FAIL_OPEN: 'false',
    SEARCH_PROVIDER_BUDGET_FAIL_OPEN: 'false',
    ENABLE_PROVIDER_DUFFEL: 'false',
    ENABLE_PROVIDER_KIWI: 'false',
    ENABLE_PROVIDER_SKYSCANNER: 'false',
    FLIGHT_SCAN_ENABLED: 'false',
    PROVIDER_COLLECTION_ENABLED: 'false',
    ...extra
  };
}

function productionFullEnv(extra = {}) {
  return {
    ...softZeroCostEnv({
      RUNTIME_PROFILE: 'production-full',
      LAUNCH_MODE: 'public',
      CACHE_BACKEND: 'redis',
      REDIS_REQUIRED_MODE: 'production_full',
      REDIS_URL: 'redis://cache.internal:6379',
      DATABASE_URL: 'postgresql://user:pass@db.internal:5432/flight',
      ENABLE_PROVIDER_DUFFEL: 'true',
      DUFFEL_API_KEY: 'duffel_live_key_123456',
      FLIGHT_SCAN_ENABLED: 'true',
      ALLOW_IN_MEMORY_CACHE_IN_SOFT_LAUNCH: 'false'
    }),
    ...extra
  };
}

function paidLiveEnv(extra = {}) {
  return {
    ...productionFullEnv({
      RUNTIME_PROFILE: 'paid-live',
      LAUNCH_MODE: 'soft',
      ENABLE_PROVIDER_DUFFEL: 'true',
      DUFFEL_API_KEY: 'duffel_live_key_123456',
      FLIGHT_SCAN_ENABLED: 'true'
    }),
    ...extra
  };
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function buildTestSystemApp(env) {
  const previous = process.env;
  process.env = { ...previous, ...env };
  const app = express();
  app.use(
    buildSystemRouter({
      BUILD_VERSION: 'test',
      pgPool: null,
      getPriceDatasetStatus: async () => ({ ok: true }),
      logger: { error() {}, warn() {}, info() {} },
      getCacheClient: () => ({ ping: async () => 'PONG' }),
      readDb: async () => ({}),
      verifyImmutableAudit: async () => ({ ok: true, count: 0 }),
      createAuditCheck: (id, label, ok, detail) => ({ id, label, ok: Boolean(ok), detail }),
      CORS_ALLOWLIST: new Set(['https://app.flightsuite.test']),
      LOGIN_MAX_FAILURES: 5,
      LOGIN_LOCK_MINUTES: 15,
      RL_AUTH_PER_MINUTE: 6,
      runFeatureAudit: () => ({ ok: true }),
      getDataFoundationStatus: async () => ({ ok: true }),
      getOpportunityPipelineStats: async () => ({}),
      getOpportunityIntelligenceDebugStats: async () => ({}),
      providerRegistry: { listProviders: () => [], runtimeStats: () => [] },
      getRuntimeConfigAudit,
      evaluateStartupReadiness: () => ({ ok: true, summary: { policy: { blockingFailed: 0 } }, blockingFailed: { policy: [] } })
    })
  );
  return {
    app,
    restore() {
      process.env = previous;
    }
  };
}

test('RUNTIME_PROFILE falls back from LAUNCH_MODE=soft to soft-zero-cost', () => {
  assert.equal(resolveRuntimeProfile({ NODE_ENV: 'production', LAUNCH_MODE: 'soft' }), 'soft-zero-cost');
});

test('soft-zero-cost without Redis passes cache policy when single-instance and Free zero-cost', () => {
  const policy = evaluateCachePolicy(softZeroCostEnv({ REDIS_URL: '' }));
  assert.equal(policy.ok, true);
  assert.equal(policy.memoryAllowed, true);
  assert.equal(policy.redisStatus, 'optional_missing_safe');
});

test('production-full without Redis fails readiness policy', () => {
  const policy = evaluateCachePolicy(productionFullEnv({ REDIS_URL: '', CACHE_BACKEND: 'memory' }));
  assert.equal(policy.ok, false);
  assert.equal(policy.redisRequired, true);
  assert.ok(policy.reasons.includes('redis_required_missing') || policy.reasons.includes('memory_cache_profile_not_allowed'));
});

test('paid-live with live provider jobs but without Redis fails cache policy', () => {
  const policy = evaluateCachePolicy(paidLiveEnv({ REDIS_URL: '', CACHE_BACKEND: 'memory' }));
  assert.equal(policy.ok, false);
  assert.equal(policy.redisRequired, true);
  assert.ok(policy.reasons.includes('live_provider_or_jobs_require_redis') || policy.reasons.includes('redis_required_missing'));
});

test('Free cannot use AI or live providers in any runtime profile', () => {
  for (const runtimeProfile of ['soft-zero-cost', 'paid-live', 'production-full']) {
    assert.equal(PLAN_LIMITS.free.aiEnabled, false, runtimeProfile);
    assert.equal(PLAN_LIMITS.free.liveProviderSearchEnabled, false, runtimeProfile);
    assert.equal(PLAN_LIMITS.free.deepScan, false, runtimeProfile);
    assert.equal(PLAN_LIMITS.free.multiCityLive, false, runtimeProfile);
    assert.equal(PLAN_LIMITS.free.instantAlerts, false, runtimeProfile);
    assert.equal(isFreeAiFeatureFlagEnabled({ NODE_ENV: 'production', RUNTIME_PROFILE: runtimeProfile, FREE_AI_ENABLED: 'true' }), false);
  }
});

test('memory cache is forbidden in production-full', () => {
  const policy = evaluateCachePolicy(productionFullEnv({ CACHE_BACKEND: 'memory', REDIS_URL: '' }));
  assert.equal(policy.memoryAllowed, false);
  assert.equal(policy.ok, false);
});

test('Docker Desktop is not required when INFRA_MODE is wsl-docker or external', () => {
  const script = readFileSync('scripts/release-prod-gate.mjs', 'utf8');
  const docs = readFileSync('docs/ops/windows-infra-gate.md', 'utf8');
  assert.match(script, /INFRA_MODE === 'external'/);
  assert.match(script, /INFRA_MODE === 'wsl-docker'/);
  assert.match(script, /ALLOW_DOCKER_DESKTOP_FALLBACK/);
  assert.match(docs, /Docker Desktop is not required/);
  assert.match(docs, /INFRA_MODE=external/);
  assert.match(docs, /INFRA_MODE=wsl-docker/);
});

test('public capabilities expose safe UI gates only', async () => {
  const harness = buildTestSystemApp(softZeroCostEnv({ REDIS_URL: '', EMAIL_DRY_RUN: 'true' }));
  try {
    await withServer(harness.app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/system/capabilities`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.runtimeProfile, undefined);
      assert.equal(body.cacheBackend, undefined);
      assert.equal(body.redisStatus, undefined);
      assert.equal(body.capabilities.data_source, 'internal');
      assert.equal(body.capabilities.ai_features.active, false);
      assert.equal(body.capabilities.live_flight_providers.active, false);
    });
  } finally {
    harness.restore();
  }
});

test('readyz reports readiness without exposing infrastructure details', async () => {
  const harness = buildTestSystemApp(productionFullEnv({ REDIS_URL: '', CACHE_BACKEND: 'memory' }));
  try {
    await withServer(harness.app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/readyz`);
      const body = await res.json();
      assert.equal(res.status, 503);
      assert.equal(body.ok, false);
      assert.equal(body.runtimeProfile, undefined);
      assert.equal(body.redisStatus, undefined);
      assert.equal(body.checks, undefined);
    });
  } finally {
    harness.restore();
  }
});

test('runtime summary marks Free zero-cost risk when AI Free is enabled by env', () => {
  const summary = getRuntimeProfileSummary(softZeroCostEnv({ FREE_AI_ENABLED: 'true' }));
  assert.equal(summary.freeCostStatus, 'zero_cost_at_risk');
  assert.equal(summary.ai, 'free_risk');
});
