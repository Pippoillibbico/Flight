import assert from 'node:assert/strict';
import test from 'node:test';
import { runRouteSchedulerOnce } from '../server/lib/scan/route-scheduler.js';

test('route scheduler skips when lock is not acquired', async () => {
  const lockCache = {
    async setnx() {
      return 0;
    }
  };

  const result = await runRouteSchedulerOnce({
    enabled: true,
    lockEnabled: true,
    lockCache,
    createIngestionJob: async () => {
      throw new Error('createIngestionJob should not be called when lock is not acquired');
    }
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'locked');
  assert.equal(result.enqueued, 0);
});

test('route scheduler enqueues tasks and releases lock on completion', async () => {
  let released = 0;
  const lockCache = {
    async setnx() {
      return 1;
    },
    async del() {
      released += 1;
      return 1;
    }
  };

  const updates = [];
  const result = await runRouteSchedulerOnce({
    enabled: true,
    lockEnabled: true,
    lockCache,
    routeLimit: 20,
    perOriginCap: 5,
    windows: 1,
    loadSeedRoutes: async () => ({ origins: { FCO: ['JFK'] } }),
    listPopularRoutePairs: async () => [],
    listActiveDiscoverySubscriptions: async () => [],
    queue: {
      async enqueueMany(tasks) {
        return { enqueued: tasks.length, duplicates: 0, rejected: 0, total: tasks.length };
      }
    },
    createIngestionJob: async () => ({ id: 'job_1' }),
    updateIngestionJob: async (payload) => {
      updates.push(payload);
    }
  });

  assert.equal(result.skipped, false);
  assert.equal(result.routeCount, 1);
  assert.equal(result.scheduledRouteCount, 1);
  assert.equal(result.enqueued > 0, true);
  assert.equal(updates.length >= 2, true);
  assert.equal(released, 1);
});

test('route scheduler caps low-priority routes to reduce overscan', async () => {
  const capturedTasks = [];
  const result = await runRouteSchedulerOnce({
    enabled: true,
    lockEnabled: false,
    routeLimit: 10,
    perOriginCap: 10,
    windows: 1,
    lowPriorityMaxShare: 0.2,
    loadSeedRoutes: async () => ({ origins: { FCO: ['JFK', 'LAX', 'SFO', 'BOS', 'MIA', 'ORD'] } }),
    listPopularRoutePairs: async () => [],
    listActiveDiscoverySubscriptions: async () => [],
    queue: {
      async enqueueMany(tasks) {
        capturedTasks.push(...tasks);
        return { enqueued: tasks.length, duplicates: 0, rejected: 0, total: tasks.length };
      }
    },
    createIngestionJob: async () => ({ id: 'job_low_cap' }),
    updateIngestionJob: async () => {}
  });

  assert.equal(result.skipped, false);
  assert.equal(result.scheduledRouteCount <= 2, true);
  assert.equal(result.skippedByLowPriorityCap >= 4, true);
  assert.equal(capturedTasks.length > 0, true);
});

test('route scheduler skips when distributed lock backend is unavailable', async () => {
  const result = await runRouteSchedulerOnce({
    enabled: true,
    lockEnabled: true,
    distributedLockRequired: true,
    lockCache: {},
    createIngestionJob: async () => {
      throw new Error('createIngestionJob should not be called when lock backend is unavailable');
    }
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'lock_backend_unavailable');
  assert.equal(result.enqueued, 0);
});

test('route scheduler skips when distributed lock backend is degraded', async () => {
  const lockCache = {
    redisDegraded: true,
    async setnx() {
      return 1;
    }
  };

  const result = await runRouteSchedulerOnce({
    enabled: true,
    lockEnabled: true,
    distributedLockRequired: true,
    lockCache,
    createIngestionJob: async () => {
      throw new Error('createIngestionJob should not be called when lock backend is degraded');
    }
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'cache_degraded');
  assert.equal(result.enqueued, 0);
});

test('route scheduler updates priority cooldown tick only for routes accepted by queue', async () => {
  const tickKeys = [];
  const lockCache = {
    async setnx() {
      return 1;
    },
    async del() {
      return 1;
    },
    async get() {
      return null;
    },
    async setex(key) {
      tickKeys.push(String(key));
      return 'OK';
    }
  };

  const result = await runRouteSchedulerOnce({
    enabled: true,
    lockEnabled: true,
    intelligentPriorityEnabled: true,
    lockCache,
    routeLimit: 10,
    perOriginCap: 10,
    windows: 1,
    loadSeedRoutes: async () => ({ origins: { FCO: ['JFK', 'LAX'] } }),
    listPopularRoutePairs: async () => [],
    listActiveDiscoverySubscriptions: async () => [],
    listRouteIntelligenceSignals: async () => [],
    listStrongDetectedDealRoutes: async () => [],
    queue: {
      async enqueueMany(tasks) {
        const results = tasks.map((task) => {
          const routeKey = `${task.originIata}-${task.destinationIata}`;
          if (task.destinationIata === 'JFK') {
            return { status: 'enqueued', routeKey };
          }
          return { status: 'rejected', routeKey, reason: 'enqueue_failed' };
        });
        return {
          enqueued: results.filter((item) => item.status === 'enqueued').length,
          duplicates: 0,
          rejected: results.filter((item) => item.status === 'rejected').length,
          total: tasks.length,
          results
        };
      }
    },
    createIngestionJob: async () => ({ id: 'job_tick_filter' }),
    updateIngestionJob: async () => {}
  });

  assert.equal(result.skipped, false);
  assert.equal(result.rejected > 0, true);
  assert.equal(tickKeys.some((key) => key.includes('FCO-JFK')), true);
  assert.equal(tickKeys.some((key) => key.includes('FCO-LAX')), false);
});
