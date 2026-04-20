import assert from 'node:assert/strict';
import test from 'node:test';

import { claimProviderCallBudget, resetProviderCostGuardMetrics } from '../server/lib/provider-cost-guard.js';

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

test('provider-cost-guard blocks when global per-minute call budget is exceeded', async () => {
  resetProviderCostGuardMetrics();
  const cacheClient = createMemoryCounterCache();
  const env = {
    SEARCH_PROVIDER_GLOBAL_PER_MINUTE_BUDGET: '1'
  };

  const first = await claimProviderCallBudget({
    cacheClient,
    env,
    userId: 'user_1',
    route: 'MXP-JFK',
    plannedCalls: 1
  });
  const second = await claimProviderCallBudget({
    cacheClient,
    env,
    userId: 'user_1',
    route: 'MXP-LAX',
    plannedCalls: 1
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.reason, 'global_per_minute_calls_exceeded');
});

test('provider-cost-guard applies route-level budgets', async () => {
  resetProviderCostGuardMetrics();
  const cacheClient = createMemoryCounterCache();
  const env = {
    SEARCH_PROVIDER_ROUTE_DAILY_BUDGET: '1'
  };

  const first = await claimProviderCallBudget({
    cacheClient,
    env,
    userId: 'user_2',
    route: 'FCO-BCN',
    plannedCalls: 1
  });
  const second = await claimProviderCallBudget({
    cacheClient,
    env,
    userId: 'user_2',
    route: 'FCO-BCN',
    plannedCalls: 1
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.reason, 'route_daily_calls_exceeded');
});

test('provider-cost-guard fail-closed by default when backend is unavailable', async () => {
  resetProviderCostGuardMetrics();
  const env = {
    SEARCH_PROVIDER_GLOBAL_DAILY_BUDGET: '10'
  };

  const out = await claimProviderCallBudget({
    cacheClient: null,
    env,
    userId: 'user_3',
    route: 'FCO-JFK'
  });

  assert.equal(out.allowed, false);
  assert.equal(out.reason, 'backend_unavailable_fail_closed');
});

test('provider-cost-guard supports explicit fail-open mode', async () => {
  resetProviderCostGuardMetrics();
  const env = {
    SEARCH_PROVIDER_GLOBAL_DAILY_BUDGET: '10',
    SEARCH_PROVIDER_BUDGET_FAIL_OPEN: 'true'
  };

  const out = await claimProviderCallBudget({
    cacheClient: null,
    env,
    userId: 'user_4',
    route: 'FCO-JFK'
  });

  assert.equal(out.allowed, true);
  assert.equal(out.reason, 'backend_unavailable_fail_open');
});

