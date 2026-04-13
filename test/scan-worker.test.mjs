import assert from 'node:assert/strict';
import test from 'node:test';
import { runScanWorkerOnce } from '../server/lib/scan/scan-worker.js';

test('scan worker retries failed task and stores quotes on next attempt', async () => {
  const tasks = [
    {
      id: 't1',
      originIata: 'MXP',
      destinationIata: 'JFK',
      departureDate: '2026-08-10',
      returnDate: '2026-08-20',
      adults: 1,
      cabinClass: 'economy',
      attempt: 0,
      maxAttempts: 2,
      notBeforeTs: 0,
      metadata: {}
    }
  ];

  const queue = {
    async dequeue() {
      return tasks.shift() || null;
    },
    async requeue(task) {
      tasks.push({ ...task, notBeforeTs: 0 });
      return { requeued: true };
    }
  };

  let adapterCalls = 0;
  const providerAdapter = {
    async fetchOffers() {
      adapterCalls += 1;
      if (adapterCalls === 1) throw new Error('temporary_provider_failure');
      return {
        fromCache: false,
        offers: [
          {
            originIata: 'MXP',
            destinationIata: 'JFK',
            departureDate: '2026-08-10',
            returnDate: '2026-08-20',
            tripType: 'round_trip',
            cabinClass: 'economy',
            totalPrice: 399,
            currency: 'EUR',
            provider: 'mock',
            source: 'partner_feed',
            metadata: { totalStops: 1 }
          }
        ]
      };
    }
  };

  let inserted = 0;
  const quoteStorage = {
    async saveQuotes(quotes) {
      inserted += quotes.length;
      return {
        processedCount: quotes.length,
        insertedCount: quotes.length,
        dedupedCount: 0,
        failedCount: 0,
        mode: 'mock'
      };
    }
  };

  const updates = [];
  const result = await runScanWorkerOnce({
    enabled: true,
    maxJobs: 5,
    retryBaseSec: 0,
    queue,
    providerAdapter,
    quoteStorage,
    createIngestionJob: async () => ({ id: 'job_1' }),
    updateIngestionJob: async (payload) => {
      updates.push(payload);
    }
  });

  assert.equal(result.processedTasks, 2);
  assert.equal(result.retriedTasks, 1);
  assert.equal(result.insertedQuotes, 1);
  assert.equal(result.deadLetteredTasks, 0);
  assert.equal(inserted, 1);
  assert.equal(updates.length >= 2, true);
});

test('scan worker dead-letters task after max attempts', async () => {
  const tasks = [
    {
      id: 't_dead',
      originIata: 'FCO',
      destinationIata: 'JFK',
      departureDate: '2026-10-03',
      returnDate: '2026-10-14',
      adults: 1,
      cabinClass: 'economy',
      attempt: 0,
      maxAttempts: 0,
      notBeforeTs: 0,
      metadata: {}
    }
  ];

  let deadLetterCount = 0;
  const queue = {
    async dequeue() {
      return tasks.shift() || null;
    },
    async requeue() {
      return { requeued: true };
    },
    async deadLetter() {
      deadLetterCount += 1;
      return { deadLettered: true };
    }
  };

  const providerAdapter = {
    async fetchOffers() {
      throw new Error('provider_hard_failure');
    }
  };

  const quoteStorage = {
    async saveQuotes() {
      return { insertedCount: 0, dedupedCount: 0, failedCount: 0 };
    }
  };

  const result = await runScanWorkerOnce({
    enabled: true,
    maxJobs: 3,
    queue,
    providerAdapter,
    quoteStorage,
    createIngestionJob: async () => ({ id: 'job_dead' }),
    updateIngestionJob: async () => {}
  });

  assert.equal(result.processedTasks, 1);
  assert.equal(result.failedTasks, 1);
  assert.equal(result.retriedTasks, 0);
  assert.equal(result.deadLetteredTasks, 1);
  assert.equal(deadLetterCount, 1);
});

test('scan worker requeues rate-limited task without incrementing attempt', async () => {
  const tasks = [
    {
      id: 't_rate',
      originIata: 'LIN',
      destinationIata: 'MAD',
      departureDate: '2026-11-03',
      returnDate: '2026-11-10',
      adults: 1,
      cabinClass: 'economy',
      attempt: 0,
      maxAttempts: 3,
      notBeforeTs: 0,
      metadata: { priority: 'low' }
    }
  ];

  let requeuedTask = null;
  let requeueDelay = 0;
  const queue = {
    async dequeue() {
      return tasks.shift() || null;
    },
    async requeue(task, { delaySec } = {}) {
      requeuedTask = task;
      requeueDelay = Number(delaySec || 0);
      return { requeued: true };
    },
    async deadLetter() {
      return { deadLettered: true };
    }
  };

  const providerAdapter = {
    async fetchOffers() {
      const error = new Error('provider_rate_limit_priority_exceeded');
      error.code = 'provider_rate_limit_priority_exceeded';
      throw error;
    }
  };

  const quoteStorage = {
    async saveQuotes() {
      return { insertedCount: 0, dedupedCount: 0, failedCount: 0 };
    }
  };

  const result = await runScanWorkerOnce({
    enabled: true,
    maxJobs: 2,
    rateLimitDelayLowSec: 777,
    queue,
    providerAdapter,
    quoteStorage,
    createIngestionJob: async () => ({ id: 'job_rate' }),
    updateIngestionJob: async () => {}
  });

  assert.equal(result.processedTasks, 1);
  assert.equal(result.failedTasks, 0);
  assert.equal(result.retriedTasks, 1);
  assert.equal(result.deadLetteredTasks, 0);
  assert.equal(requeueDelay, 777);
  assert.equal(Number(requeuedTask?.attempt || 0), 0);
  assert.equal(Number(requeuedTask?.metadata?.rateLimitRequeues || 0), 1);
});

test('scan worker requeues inflight contention without consuming rate-limit retries', async () => {
  const tasks = [
    {
      id: 't_inflight',
      originIata: 'MXP',
      destinationIata: 'LIS',
      departureDate: '2026-11-03',
      returnDate: '2026-11-10',
      adults: 1,
      cabinClass: 'economy',
      attempt: 0,
      maxAttempts: 3,
      notBeforeTs: 0,
      metadata: { priority: 'high', rateLimitRequeues: 4 }
    }
  ];

  let requeuedTask = null;
  let requeueDelay = 0;
  const queue = {
    async dequeue() {
      return tasks.shift() || null;
    },
    async requeue(task, { delaySec } = {}) {
      requeuedTask = task;
      requeueDelay = Number(delaySec || 0);
      return { requeued: true };
    },
    async deadLetter() {
      return { deadLettered: true };
    }
  };

  const providerAdapter = {
    async fetchOffers() {
      const error = new Error('provider_request_inflight');
      error.code = 'provider_request_inflight';
      throw error;
    }
  };

  const quoteStorage = {
    async saveQuotes() {
      return { insertedCount: 0, dedupedCount: 0, failedCount: 0 };
    }
  };

  const result = await runScanWorkerOnce({
    enabled: true,
    maxJobs: 2,
    inFlightDelaySec: 9,
    queue,
    providerAdapter,
    quoteStorage,
    createIngestionJob: async () => ({ id: 'job_inflight' }),
    updateIngestionJob: async () => {}
  });

  assert.equal(result.processedTasks, 1);
  assert.equal(result.failedTasks, 0);
  assert.equal(result.retriedTasks, 1);
  assert.equal(result.deadLetteredTasks, 0);
  assert.equal(requeueDelay, 9);
  assert.equal(Number(requeuedTask?.attempt || 0), 0);
  assert.equal(Number(requeuedTask?.metadata?.rateLimitRequeues || 0), 4);
  assert.equal(Number(requeuedTask?.metadata?.inFlightRequeues || 0), 1);
});

test('scan worker reuses provider response for duplicate request within same run', async () => {
  const tasks = [
    {
      id: 'dup_1',
      originIata: 'FCO',
      destinationIata: 'JFK',
      departureDate: '2026-12-01',
      returnDate: '2026-12-08',
      adults: 1,
      cabinClass: 'economy',
      attempt: 0,
      maxAttempts: 2,
      notBeforeTs: 0,
      metadata: { priority: 'medium' }
    },
    {
      id: 'dup_2',
      originIata: 'FCO',
      destinationIata: 'JFK',
      departureDate: '2026-12-01',
      returnDate: '2026-12-08',
      adults: 1,
      cabinClass: 'economy',
      attempt: 0,
      maxAttempts: 2,
      notBeforeTs: 0,
      metadata: { priority: 'low' }
    }
  ];

  const queue = {
    async dequeue() {
      return tasks.shift() || null;
    },
    async requeue() {
      return { requeued: true };
    }
  };

  let providerCalls = 0;
  const providerAdapter = {
    async fetchOffers() {
      providerCalls += 1;
      return {
        fromCache: false,
        offers: [
          {
            originIata: 'FCO',
            destinationIata: 'JFK',
            departureDate: '2026-12-01',
            returnDate: '2026-12-08',
            tripType: 'round_trip',
            cabinClass: 'economy',
            totalPrice: 470,
            currency: 'EUR',
            provider: 'mock',
            source: 'partner_feed',
            metadata: { totalStops: 1 }
          }
        ]
      };
    }
  };

  let saveCalls = 0;
  const quoteStorage = {
    async saveQuotes(quotes) {
      saveCalls += 1;
      return {
        processedCount: quotes.length,
        insertedCount: quotes.length,
        dedupedCount: 0,
        failedCount: 0,
        mode: 'mock'
      };
    }
  };

  const result = await runScanWorkerOnce({
    enabled: true,
    maxJobs: 5,
    queue,
    providerAdapter,
    quoteStorage,
    createIngestionJob: async () => ({ id: 'job_reuse' }),
    updateIngestionJob: async () => {}
  });

  assert.equal(result.processedTasks, 2);
  assert.equal(result.reusedProviderResponses, 1);
  assert.equal(providerCalls, 1);
  assert.equal(saveCalls, 2);
});

test('scan worker preserves long notBefore delay instead of shrinking it', async () => {
  const delayedTask = {
    id: 't_delay',
    originIata: 'FCO',
    destinationIata: 'JFK',
    departureDate: '2026-11-21',
    returnDate: '2026-11-28',
    adults: 1,
    cabinClass: 'economy',
    attempt: 0,
    maxAttempts: 3,
    notBeforeTs: Date.now() + 130_000,
    metadata: { priority: 'low' }
  };

  let dequeueCalls = 0;
  let capturedDelaySec = 0;
  const queue = {
    async dequeue() {
      dequeueCalls += 1;
      return dequeueCalls === 1 ? delayedTask : null;
    },
    async requeue(_task, { delaySec } = {}) {
      capturedDelaySec = Number(delaySec || 0);
      return { requeued: true };
    }
  };

  const providerAdapter = {
    async fetchOffers() {
      throw new Error('provider_should_not_be_called_for_delayed_task');
    }
  };

  const quoteStorage = {
    async saveQuotes() {
      return { insertedCount: 0, dedupedCount: 0, failedCount: 0 };
    }
  };

  const result = await runScanWorkerOnce({
    enabled: true,
    maxJobs: 2,
    queue,
    providerAdapter,
    quoteStorage,
    createIngestionJob: async () => ({ id: 'job_delay' }),
    updateIngestionJob: async () => {}
  });

  assert.equal(result.processedTasks, 0);
  assert.equal(result.delayedTasks, 1);
  assert.equal(capturedDelaySec >= 100, true);
});

test('scan worker dead-letters task when rate-limit requeue cap is exceeded', async () => {
  const tasks = [
    {
      id: 't_rate_limit_cap',
      originIata: 'MXP',
      destinationIata: 'BCN',
      departureDate: '2026-10-20',
      returnDate: '2026-10-27',
      adults: 1,
      cabinClass: 'economy',
      attempt: 0,
      maxAttempts: 3,
      notBeforeTs: 0,
      metadata: { priority: 'low', rateLimitRequeues: 2 }
    }
  ];

  let requeueCalled = 0;
  let deadLetterCalled = 0;
  let deadLetterReason = null;
  const queue = {
    async dequeue() {
      return tasks.shift() || null;
    },
    async requeue() {
      requeueCalled += 1;
      return { requeued: true };
    },
    async deadLetter(_task, { reason } = {}) {
      deadLetterCalled += 1;
      deadLetterReason = reason || null;
      return { deadLettered: true };
    }
  };

  const providerAdapter = {
    async fetchOffers() {
      const error = new Error('provider_rate_limit_priority_exceeded');
      error.code = 'provider_rate_limit_priority_exceeded';
      throw error;
    }
  };

  const quoteStorage = {
    async saveQuotes() {
      return { insertedCount: 0, dedupedCount: 0, failedCount: 0 };
    }
  };

  const result = await runScanWorkerOnce({
    enabled: true,
    maxJobs: 2,
    maxRateLimitRequeues: 2,
    queue,
    providerAdapter,
    quoteStorage,
    createIngestionJob: async () => ({ id: 'job_rate_limit_cap' }),
    updateIngestionJob: async () => {}
  });

  assert.equal(result.processedTasks, 1);
  assert.equal(result.retriedTasks, 0);
  assert.equal(result.failedTasks, 1);
  assert.equal(result.deadLetteredTasks, 1);
  assert.equal(requeueCalled, 0);
  assert.equal(deadLetterCalled, 1);
  assert.equal(deadLetterReason, 'rate_limit_requeue_limit_exceeded');
});

test('scan worker stops when the same delayed task repeats in the same run', async () => {
  const delayedTask = {
    id: 't_loop_delay',
    originIata: 'VCE',
    destinationIata: 'LIS',
    departureDate: '2026-12-15',
    returnDate: '2026-12-22',
    adults: 1,
    cabinClass: 'economy',
    attempt: 0,
    maxAttempts: 3,
    notBeforeTs: Date.now() + 90_000,
    metadata: { priority: 'medium' }
  };

  let dequeueCalls = 0;
  let requeueCalls = 0;
  const queue = {
    async dequeue() {
      dequeueCalls += 1;
      return delayedTask;
    },
    async requeue() {
      requeueCalls += 1;
      return { requeued: true };
    }
  };

  const providerAdapter = {
    async fetchOffers() {
      throw new Error('provider_should_not_be_called_for_repeating_delayed_task');
    }
  };

  const quoteStorage = {
    async saveQuotes() {
      return { insertedCount: 0, dedupedCount: 0, failedCount: 0 };
    }
  };

  const result = await runScanWorkerOnce({
    enabled: true,
    maxJobs: 50,
    queue,
    providerAdapter,
    quoteStorage,
    createIngestionJob: async () => ({ id: 'job_loop_delay' }),
    updateIngestionJob: async () => {}
  });

  assert.equal(result.processedTasks, 0);
  assert.equal(result.delayedTasks, 2);
  assert.equal(requeueCalls, 2);
  assert.equal(dequeueCalls, 2);
});
