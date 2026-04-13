import assert from 'node:assert/strict';
import test from 'node:test';
import { createScanQueue } from '../server/lib/scan/scan-queue.js';

function createMemoryCache() {
  const kv = new Map();
  const list = new Map();
  return {
    async setnx(key, value, _ttlSec) {
      if (kv.has(key)) return 0;
      kv.set(key, String(value));
      return 1;
    },
    async lpush(key, value) {
      const arr = list.get(key) || [];
      arr.unshift(String(value));
      list.set(key, arr);
      return arr.length;
    },
    async rpop(key) {
      const arr = list.get(key) || [];
      const out = arr.pop() ?? null;
      list.set(key, arr);
      return out;
    },
    async llen(key) {
      const arr = list.get(key) || [];
      return arr.length;
    },
    async lrange(key, start, stop) {
      const arr = list.get(key) || [];
      const safeStart = Math.max(0, Number(start) || 0);
      const safeStop = Math.max(safeStart, Number(stop) || 0);
      return arr.slice(safeStart, safeStop + 1);
    },
    async ltrim(key, start, stop) {
      const arr = list.get(key) || [];
      const safeStart = Math.max(0, Number(start) || 0);
      const safeStop = Math.max(safeStart, Number(stop) || 0);
      list.set(key, arr.slice(safeStart, safeStop + 1));
      return 'OK';
    },
    async del(key) {
      const had = kv.delete(key);
      return had ? 1 : 0;
    }
  };
}

test('scan queue dedupes repeated route/date tasks', async () => {
  const queue = createScanQueue({
    cache: createMemoryCache(),
    logger: { info: () => {}, warn: () => {} },
    queueKey: 'test:scan:queue'
  });

  const first = await queue.enqueue({
    originIata: 'MXP',
    destinationIata: 'JFK',
    departureDate: '2026-08-10',
    returnDate: '2026-08-20',
    adults: 1,
    cabinClass: 'economy'
  });
  const second = await queue.enqueue({
    originIata: 'MXP',
    destinationIata: 'JFK',
    departureDate: '2026-08-10',
    returnDate: '2026-08-20',
    adults: 1,
    cabinClass: 'economy'
  });

  assert.equal(first.enqueued, true);
  assert.equal(second.enqueued, false);
  assert.equal(second.reason, 'duplicate');

  const task = await queue.dequeue();
  assert.equal(task.originIata, 'MXP');
  assert.equal(task.destinationIata, 'JFK');
  assert.equal(task.departureDate, '2026-08-10');
});

test('scan queue requeues task with delay', async () => {
  const queue = createScanQueue({
    cache: createMemoryCache(),
    logger: { info: () => {}, warn: () => {} },
    queueKey: 'test:scan:queue:delay'
  });

  await queue.requeue(
    {
      id: 'task_1',
      originIata: 'FCO',
      destinationIata: 'LHR',
      departureDate: '2026-09-01',
      returnDate: '2026-09-07',
      adults: 1,
      cabinClass: 'economy',
      attempt: 1,
      maxAttempts: 3
    },
    { delaySec: 2 }
  );

  const task = await queue.dequeue();
  assert.equal(task.id, 'task_1');
  assert.equal(task.attempt, 1);
  assert.equal(task.notBeforeTs > Date.now(), true);
});

test('scan queue stores dead-letter payload and exposes stats', async () => {
  const queue = createScanQueue({
    cache: createMemoryCache(),
    logger: { info: () => {}, warn: () => {} },
    queueKey: 'test:scan:queue:dead',
    deadLetterKey: 'test:scan:queue:dead:dlq',
    deadLetterMax: 10
  });

  await queue.enqueue({
    originIata: 'FCO',
    destinationIata: 'MAD',
    departureDate: '2026-11-03',
    returnDate: '2026-11-09',
    adults: 1,
    cabinClass: 'economy'
  });
  await queue.deadLetter(
    {
      id: 'task_dead_1',
      originIata: 'FCO',
      destinationIata: 'MAD',
      departureDate: '2026-11-03',
      returnDate: '2026-11-09',
      adults: 1,
      cabinClass: 'economy',
      attempt: 3,
      maxAttempts: 3
    },
    { reason: 'max_attempts_exceeded', error: 'provider_timeout', scanRunId: 'run_1' }
  );

  const stats = await queue.getStats();
  assert.equal(stats.pending, 1);
  assert.equal(stats.deadLettered, 1);

  const deadLetters = await queue.peekDeadLetters({ limit: 5 });
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].reason, 'max_attempts_exceeded');
  assert.equal(deadLetters[0].scanRunId, 'run_1');
});

test('scan queue extends dedupe ttl for low-priority windows', async () => {
  let capturedTtl = 0;
  const cache = {
    async setnx(_key, _value, ttlSec) {
      capturedTtl = Number(ttlSec || 0);
      return 1;
    },
    async lpush() {
      return 1;
    }
  };

  const queue = createScanQueue({
    cache,
    logger: { info: () => {}, warn: () => {} },
    queueKey: 'test:scan:queue:ttl',
    dedupeTtlSec: 300
  });

  await queue.enqueue({
    originIata: 'FCO',
    destinationIata: 'HND',
    departureDate: '2026-12-12',
    returnDate: '2026-12-22',
    adults: 1,
    cabinClass: 'economy',
    metadata: {
      priority: 'low',
      windowCooldownSec: 86400
    }
  });

  assert.equal(capturedTtl >= 86400, true);
});

test('scan queue rolls back dedupe claim when enqueue push fails', async () => {
  const dedupeClaims = new Set();
  let lpushCalls = 0;
  const cache = {
    async setnx(key) {
      if (dedupeClaims.has(key)) return 0;
      dedupeClaims.add(key);
      return 1;
    },
    async del(key) {
      dedupeClaims.delete(key);
      return 1;
    },
    async lpush() {
      lpushCalls += 1;
      if (lpushCalls === 1) {
        throw new Error('lpush_failed_once');
      }
      return 1;
    }
  };

  const queue = createScanQueue({
    cache,
    logger: { info: () => {}, warn: () => {} },
    queueKey: 'test:scan:queue:rollback'
  });

  await assert.rejects(
    () =>
      queue.enqueue({
        originIata: 'FCO',
        destinationIata: 'JFK',
        departureDate: '2026-07-01',
        returnDate: '2026-07-10',
        adults: 1,
        cabinClass: 'economy'
      }),
    /lpush_failed_once/
  );

  const second = await queue.enqueue({
    originIata: 'FCO',
    destinationIata: 'JFK',
    departureDate: '2026-07-01',
    returnDate: '2026-07-10',
    adults: 1,
    cabinClass: 'economy'
  });
  assert.equal(second.enqueued, true);
});

test('scan queue enqueueMany continues after single enqueue failure', async () => {
  const kv = new Set();
  const list = [];
  let lpushCalls = 0;
  const cache = {
    async setnx(key) {
      if (kv.has(key)) return 0;
      kv.add(key);
      return 1;
    },
    async del(key) {
      kv.delete(key);
      return 1;
    },
    async lpush(_key, value) {
      lpushCalls += 1;
      if (lpushCalls === 1) {
        throw new Error('first_enqueue_failed');
      }
      list.unshift(String(value));
      return list.length;
    }
  };

  const queue = createScanQueue({
    cache,
    logger: { info: () => {}, warn: () => {} },
    queueKey: 'test:scan:queue:many-fail'
  });

  const result = await queue.enqueueMany([
    {
      originIata: 'FCO',
      destinationIata: 'MAD',
      departureDate: '2026-10-01',
      returnDate: '2026-10-05',
      adults: 1,
      cabinClass: 'economy'
    },
    {
      originIata: 'MXP',
      destinationIata: 'LHR',
      departureDate: '2026-10-02',
      returnDate: '2026-10-06',
      adults: 1,
      cabinClass: 'economy'
    }
  ]);

  assert.deepEqual(result, {
    enqueued: 1,
    duplicates: 0,
    rejected: 1,
    total: 2
  });
});

test('scan queue enqueueMany can return per-item results when requested', async () => {
  const queue = createScanQueue({
    cache: createMemoryCache(),
    logger: { info: () => {}, warn: () => {} },
    queueKey: 'test:scan:queue:results'
  });

  const firstTask = {
    originIata: 'FCO',
    destinationIata: 'JFK',
    departureDate: '2026-08-01',
    returnDate: '2026-08-10',
    adults: 1,
    cabinClass: 'economy'
  };
  const duplicateTask = { ...firstTask };

  const out = await queue.enqueueMany([firstTask, duplicateTask], { includeResults: true });
  assert.equal(out.enqueued, 1);
  assert.equal(out.duplicates, 1);
  assert.equal(out.rejected, 0);
  assert.equal(Array.isArray(out.results), true);
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].status, 'enqueued');
  assert.equal(out.results[1].status, 'duplicate');
  assert.equal(out.results[0].routeKey, 'FCO-JFK');
  assert.equal(out.results[1].routeKey, 'FCO-JFK');
});
