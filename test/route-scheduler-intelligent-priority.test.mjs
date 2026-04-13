import assert from 'node:assert/strict';
import test from 'node:test';
import { runRouteSchedulerOnce } from '../server/lib/scan/route-scheduler.js';

function createMemoryCache() {
  const kv = new Map();
  return {
    async get(key) {
      return kv.has(key) ? kv.get(key) : null;
    },
    async setex(key, _ttlSec, value) {
      kv.set(key, String(value));
      return 'OK';
    },
    async setnx(key, value) {
      if (kv.has(key)) return 0;
      kv.set(key, String(value));
      return 1;
    },
    async del(key) {
      kv.delete(key);
      return 1;
    }
  };
}

test('intelligent scheduler skips route when priority cooldown is still active', async () => {
  const cache = createMemoryCache();
  const queue = {
    async enqueueMany(tasks) {
      return { enqueued: tasks.length, duplicates: 0, rejected: 0, total: tasks.length };
    }
  };

  const baseOptions = {
    enabled: true,
    intelligentPriorityEnabled: true,
    lockEnabled: true,
    lockCache: cache,
    routeLimit: 5,
    perOriginCap: 5,
    windows: 1,
    priorityHighCooldownSec: 3600,
    priorityMediumCooldownSec: 3600,
    priorityLowCooldownSec: 3600,
    queue,
    loadSeedRoutes: async () => ({ origins: { FCO: ['JFK'] } }),
    listPopularRoutePairs: async () => [{ originIata: 'FCO', destinationIata: 'JFK', observations: 180 }],
    listActiveDiscoverySubscriptions: async () => [],
    listRouteIntelligenceSignals: async () => [
      {
        originIata: 'FCO',
        destinationIata: 'JFK',
        observations: 220,
        volatilityPct: 22,
        recentDropPct: 15,
        seasonalityFactor: 1.1,
        userSignalScore: 45
      }
    ],
    listStrongDetectedDealRoutes: async () => [],
    createIngestionJob: async () => ({ id: 'job_1' }),
    updateIngestionJob: async () => {}
  };

  const first = await runRouteSchedulerOnce(baseOptions);
  assert.equal(first.scheduledRouteCount, 1);
  assert.equal(first.taskCount > 0, true);

  const second = await runRouteSchedulerOnce({
    ...baseOptions,
    createIngestionJob: async () => ({ id: 'job_2' })
  });
  assert.equal(second.scheduledRouteCount, 0);
  assert.equal(second.taskCount, 0);
  assert.equal(second.skippedByPriorityCooldown, 1);
});

test('intelligent scheduler expands similar routes when a strong deal is detected', async () => {
  const cache = createMemoryCache();
  const capturedTasks = [];
  const queue = {
    async enqueueMany(tasks) {
      capturedTasks.push(...tasks);
      return { enqueued: tasks.length, duplicates: 0, rejected: 0, total: tasks.length };
    }
  };

  await runRouteSchedulerOnce({
    enabled: true,
    intelligentPriorityEnabled: true,
    lockEnabled: true,
    lockCache: cache,
    routeLimit: 10,
    perOriginCap: 10,
    windows: 1,
    dealExpansionEnabled: true,
    dealExpansionLimit: 2,
    queue,
    loadSeedRoutes: async () => ({ origins: { FCO: ['JFK', 'BOS', 'EWR'] } }),
    listPopularRoutePairs: async () => [{ originIata: 'FCO', destinationIata: 'JFK', observations: 160 }],
    listActiveDiscoverySubscriptions: async () => [],
    listRouteIntelligenceSignals: async () => [],
    listStrongDetectedDealRoutes: async () => [{ originIata: 'FCO', destinationIata: 'JFK', topScore: 92, hits: 3 }],
    createIngestionJob: async () => ({ id: 'job_expansion' }),
    updateIngestionJob: async () => {}
  });

  const expansionTasks = capturedTasks.filter((task) => Number(task?.metadata?.expansionBoost || 0) > 0);
  assert.equal(expansionTasks.length > 0, true);
  assert.equal(expansionTasks.some((task) => ['BOS', 'EWR'].includes(task.destinationIata)), true);
});

test('scheduler skips route windows when freshness cooldown is active', async () => {
  const cache = createMemoryCache();
  const capturedRuns = [];
  const queue = {
    async enqueueMany(tasks) {
      capturedRuns.push(tasks);
      return { enqueued: tasks.length, duplicates: 0, rejected: 0, total: tasks.length };
    }
  };

  const schedulerOptions = {
    enabled: true,
    intelligentPriorityEnabled: false,
    lockEnabled: true,
    lockCache: cache,
    routeLimit: 5,
    perOriginCap: 5,
    windows: 2,
    windowCooldownHighSec: 7200,
    windowCooldownMediumSec: 7200,
    windowCooldownLowSec: 7200,
    queue,
    loadSeedRoutes: async () => ({ origins: { FCO: ['JFK'] } }),
    listPopularRoutePairs: async () => [{ originIata: 'FCO', destinationIata: 'JFK', observations: 250 }],
    listActiveDiscoverySubscriptions: async () => [],
    createIngestionJob: async () => ({ id: 'job_first' }),
    updateIngestionJob: async () => {}
  };

  const first = await runRouteSchedulerOnce(schedulerOptions);
  assert.equal(first.taskCount > 0, true);

  const firstRunTasks = capturedRuns[0] || [];
  for (const task of firstRunTasks) {
    const freshnessKey = String(task?.metadata?.freshnessKey || '');
    if (!freshnessKey) continue;
    await cache.setex(freshnessKey, 7200, String(Date.now()));
  }

  const second = await runRouteSchedulerOnce({
    ...schedulerOptions,
    createIngestionJob: async () => ({ id: 'job_second' })
  });

  assert.equal(second.taskCount, 0);
  assert.equal(second.skippedByWindowCooldown >= first.taskCount, true);
});
