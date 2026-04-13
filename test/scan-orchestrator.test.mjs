import assert from 'node:assert/strict';
import test from 'node:test';
import { runFlightScanCycleOnce } from '../server/lib/scan/scan-orchestrator.js';

test('scan orchestrator runs scheduler and multiple worker passes until queue is empty', async () => {
  let depth = 4;
  let schedulerCalls = 0;
  let workerCalls = 0;

  const queue = {
    async getQueueDepth() {
      return depth;
    }
  };

  const summary = await runFlightScanCycleOnce({
    enabled: true,
    queue,
    runScheduler: true,
    maxWorkerPasses: 6,
    runRouteSchedulerOnceFn: async () => {
      schedulerCalls += 1;
      depth += 2;
      return { skipped: false, enqueued: 2, duplicates: 0, rejected: 0 };
    },
    runScanWorkerOnceFn: async () => {
      workerCalls += 1;
      const processed = Math.min(3, depth);
      depth -= processed;
      return {
        skipped: false,
        processedTasks: processed,
        delayedTasks: 0,
        insertedQuotes: processed,
        dedupedQuotes: 0,
        rejectedQuotes: 0,
        failedTasks: 0,
        retriedTasks: 0,
        deadLetteredTasks: 0
      };
    }
  });

  assert.equal(schedulerCalls, 1);
  assert.equal(workerCalls, 2);
  assert.equal(summary.workerPassesExecuted, 2);
  assert.equal(summary.totals.processedTasks, 6);
  assert.equal(summary.stoppedReason, 'queue_empty');
  assert.equal(summary.queueDepthAfter, 0);
});

test('scan orchestrator stops when worker reports delayed-only tasks', async () => {
  let depth = 2;
  let workerCalls = 0;

  const queue = {
    async getQueueDepth() {
      return depth;
    }
  };

  const summary = await runFlightScanCycleOnce({
    enabled: true,
    queue,
    runScheduler: false,
    maxWorkerPasses: 5,
    runScanWorkerOnceFn: async () => {
      workerCalls += 1;
      return {
        skipped: false,
        processedTasks: 0,
        delayedTasks: 2,
        insertedQuotes: 0,
        dedupedQuotes: 0,
        rejectedQuotes: 0,
        failedTasks: 0,
        retriedTasks: 0,
        deadLetteredTasks: 0
      };
    }
  });

  assert.equal(workerCalls, 1);
  assert.equal(summary.workerPassesExecuted, 1);
  assert.equal(summary.stoppedReason, 'worker_delayed_tasks');
  assert.equal(summary.queueDepthAfter, 2);
});

test('scan orchestrator invokes downstream pipeline only when enabled', async () => {
  let downstreamCalls = 0;
  const queue = {
    async getQueueDepth() {
      return 0;
    }
  };

  const summary = await runFlightScanCycleOnce({
    enabled: true,
    queue,
    runScheduler: false,
    runDownstream: true,
    runScanWorkerOnceFn: async () => ({
      skipped: false,
      processedTasks: 0,
      delayedTasks: 0,
      insertedQuotes: 0,
      dedupedQuotes: 0,
      rejectedQuotes: 0,
      failedTasks: 0,
      retriedTasks: 0,
      deadLetteredTasks: 0
    }),
    runDownstreamPipeline: async () => {
      downstreamCalls += 1;
      return { routePriceStats: { updatedRows: 10 } };
    }
  });

  assert.equal(downstreamCalls, 1);
  assert.deepEqual(summary.downstream, { routePriceStats: { updatedRows: 10 } });
});
