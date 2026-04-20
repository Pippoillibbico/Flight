import assert from 'node:assert/strict';
import test from 'node:test';

import { claimAiBudget, resetAiCostGuardMetrics } from '../server/lib/ai-cost-guard.js';

function createMemoryCounterCache() {
  const store = new Map();
  return {
    async incr(key) {
      const next = Number(store.get(key) || 0) + 1;
      store.set(key, next);
      return next;
    },
    async incrby(key, amount) {
      const delta = Math.max(0, Math.trunc(Number(amount) || 0));
      const next = Number(store.get(key) || 0) + delta;
      store.set(key, next);
      return next;
    },
    async expire() {
      return 1;
    }
  };
}

test('ai-cost-guard blocks when global per-minute budget is exceeded', async () => {
  resetAiCostGuardMetrics();
  const cacheClient = createMemoryCounterCache();
  const env = {
    AI_BUDGET_GLOBAL_PER_MINUTE_CALLS: '1'
  };

  const first = await claimAiBudget({
    cacheClient,
    env,
    userId: 'u_1',
    route: 'decision.intake',
    estimatedTokens: 220
  });
  const second = await claimAiBudget({
    cacheClient,
    env,
    userId: 'u_1',
    route: 'decision.intake',
    estimatedTokens: 220
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.reason, 'global_per_minute_calls_exceeded');
});

test('ai-cost-guard blocks on estimated token budget limits', async () => {
  resetAiCostGuardMetrics();
  const cacheClient = createMemoryCounterCache();
  const env = {
    AI_BUDGET_GLOBAL_DAILY_EST_TOKENS: '500'
  };

  const ok = await claimAiBudget({
    cacheClient,
    env,
    userId: 'u_2',
    route: 'decision.just_go',
    estimatedTokens: 300
  });
  const blocked = await claimAiBudget({
    cacheClient,
    env,
    userId: 'u_2',
    route: 'decision.just_go',
    estimatedTokens: 260
  });

  assert.equal(ok.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'global_daily_est_tokens_exceeded');
});

test('ai-cost-guard fails closed by default when cache backend is unavailable', async () => {
  resetAiCostGuardMetrics();
  const env = {
    AI_BUDGET_GLOBAL_DAILY_CALLS: '1'
  };

  const out = await claimAiBudget({
    cacheClient: null,
    env,
    userId: 'u_3',
    route: 'decision.intake'
  });

  assert.equal(out.allowed, false);
  assert.equal(out.reason, 'backend_unavailable_fail_closed');
});

test('ai-cost-guard supports explicit fail-open when configured', async () => {
  resetAiCostGuardMetrics();
  const env = {
    AI_BUDGET_GLOBAL_DAILY_CALLS: '1',
    AI_BUDGET_FAIL_OPEN: 'true'
  };

  const out = await claimAiBudget({
    cacheClient: null,
    env,
    userId: 'u_4',
    route: 'decision.intake'
  });

  assert.equal(out.allowed, true);
  assert.equal(out.reason, 'backend_unavailable_fail_open');
});
