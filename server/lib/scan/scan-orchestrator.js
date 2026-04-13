import { parseFlag } from '../env-flags.js';
import { logger } from '../logger.js';
import { runRouteSchedulerOnce } from './route-scheduler.js';
import { createScanQueue } from './scan-queue.js';
import { runScanWorkerOnce } from './scan-worker.js';

function safeInt(value, fallback, min, max) {
  const out = Number(value);
  if (!Number.isFinite(out)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(out)));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toNumber(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function addWorkerTotals(target, workerSummary) {
  target.processedTasks += toNumber(workerSummary?.processedTasks);
  target.delayedTasks += toNumber(workerSummary?.delayedTasks);
  target.insertedQuotes += toNumber(workerSummary?.insertedQuotes);
  target.dedupedQuotes += toNumber(workerSummary?.dedupedQuotes);
  target.rejectedQuotes += toNumber(workerSummary?.rejectedQuotes);
  target.failedTasks += toNumber(workerSummary?.failedTasks);
  target.retriedTasks += toNumber(workerSummary?.retriedTasks);
  target.deadLetteredTasks += toNumber(workerSummary?.deadLetteredTasks);
}

export async function runFlightScanCycleOnce(options = {}) {
  const enabled = parseFlag(options.enabled ?? process.env.FLIGHT_SCAN_ENABLED, false);
  if (!enabled) {
    return {
      skipped: true,
      reason: 'disabled',
      runScheduler: false,
      workerPassesExecuted: 0,
      maxWorkerPasses: 0,
      queueDepthBefore: 0,
      queueDepthAfter: 0,
      stoppedReason: 'disabled',
      schedulerSummary: { skipped: true, reason: 'disabled' },
      workerRuns: [],
      totals: {
        processedTasks: 0,
        delayedTasks: 0,
        insertedQuotes: 0,
        dedupedQuotes: 0,
        rejectedQuotes: 0,
        failedTasks: 0,
        retriedTasks: 0,
        deadLetteredTasks: 0
      },
      downstream: { skipped: true, reason: 'disabled' }
    };
  }

  const runScheduler = parseFlag(options.runScheduler ?? process.env.FLIGHT_SCAN_CYCLE_RUN_SCHEDULER, true);
  const stopWhenQueueEmpty = parseFlag(options.stopWhenQueueEmpty ?? process.env.FLIGHT_SCAN_CYCLE_STOP_WHEN_QUEUE_EMPTY, true);
  const maxWorkerPasses = safeInt(options.maxWorkerPasses ?? process.env.FLIGHT_SCAN_CYCLE_MAX_WORKER_PASSES, 6, 1, 300);
  const runDownstream = parseFlag(options.runDownstream ?? process.env.FLIGHT_SCAN_RUN_DOWNSTREAM, false);

  const queue = options.queue || createScanQueue(options.queueOptions || {});
  const schedulerFn = options.runRouteSchedulerOnceFn || runRouteSchedulerOnce;
  const workerFn = options.runScanWorkerOnceFn || runScanWorkerOnce;

  const schedulerOptions = asObject(options.schedulerOptions);
  const workerOptions = asObject(options.workerOptions);
  const output = {
    skipped: false,
    reason: null,
    runScheduler,
    workerPassesExecuted: 0,
    maxWorkerPasses,
    queueDepthBefore: 0,
    queueDepthAfter: 0,
    stoppedReason: null,
    schedulerSummary: { skipped: true, reason: 'scheduler_disabled' },
    workerRuns: [],
    totals: {
      processedTasks: 0,
      delayedTasks: 0,
      insertedQuotes: 0,
      dedupedQuotes: 0,
      rejectedQuotes: 0,
      failedTasks: 0,
      retriedTasks: 0,
      deadLetteredTasks: 0
    },
    downstream: { skipped: true, reason: 'downstream_disabled' }
  };

  if (typeof queue.getQueueDepth === 'function') {
    output.queueDepthBefore = toNumber(await queue.getQueueDepth());
  }

  if (runScheduler) {
    output.schedulerSummary = await schedulerFn({
      ...schedulerOptions,
      enabled: true,
      queue
    });
  }

  let stoppedReason = 'max_worker_passes_reached';

  for (let pass = 1; pass <= maxWorkerPasses; pass += 1) {
    const queueDepthBeforePass = typeof queue.getQueueDepth === 'function' ? toNumber(await queue.getQueueDepth()) : null;

    if (stopWhenQueueEmpty && queueDepthBeforePass === 0) {
      stoppedReason = pass === 1 ? 'queue_empty_before_first_pass' : 'queue_empty';
      break;
    }

    const workerSummary = await workerFn({
      ...workerOptions,
      enabled: true,
      queue
    });
    const queueDepthAfterPass = typeof queue.getQueueDepth === 'function' ? toNumber(await queue.getQueueDepth()) : null;

    output.workerRuns.push({
      pass,
      queueDepthBefore: queueDepthBeforePass,
      queueDepthAfter: queueDepthAfterPass,
      ...workerSummary
    });
    addWorkerTotals(output.totals, workerSummary);

    if (stopWhenQueueEmpty && queueDepthAfterPass === 0) {
      stoppedReason = 'queue_empty';
      break;
    }

    const processedTasks = toNumber(workerSummary?.processedTasks);
    const delayedTasks = toNumber(workerSummary?.delayedTasks);
    if (processedTasks === 0 && delayedTasks === 0) {
      stoppedReason = 'worker_no_progress';
      break;
    }
    if (processedTasks === 0 && delayedTasks > 0) {
      stoppedReason = 'worker_delayed_tasks';
      break;
    }
  }

  output.workerPassesExecuted = output.workerRuns.length;
  output.stoppedReason = stoppedReason;
  if (typeof queue.getQueueDepth === 'function') {
    output.queueDepthAfter = toNumber(await queue.getQueueDepth());
  }

  if (runDownstream) {
    if (typeof options.runDownstreamPipeline === 'function') {
      output.downstream = await options.runDownstreamPipeline();
    } else {
      output.downstream = { skipped: true, reason: 'downstream_runner_not_configured' };
    }
  }

  logger.info(
    {
      runScheduler: output.runScheduler,
      maxWorkerPasses: output.maxWorkerPasses,
      workerPassesExecuted: output.workerPassesExecuted,
      queueDepthBefore: output.queueDepthBefore,
      queueDepthAfter: output.queueDepthAfter,
      stoppedReason: output.stoppedReason,
      totals: output.totals,
      downstream: output.downstream
    },
    'flight_scan_cycle_completed'
  );
  return output;
}
