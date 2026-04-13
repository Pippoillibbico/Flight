import { createIngestionJob, updateIngestionJob } from '../deal-engine-store.js';
import { parseFlag } from '../env-flags.js';
import { getCacheClient } from '../free-cache.js';
import { logger } from '../logger.js';
import { createScanQueue } from './scan-queue.js';
import { createScanProviderAdapter } from './provider-adapter.js';
import { normalizeProviderQuotes } from './quote-normalizer.js';
import { createQuoteStorage } from './quote-storage.js';

function safeInt(value, fallback, min, max) {
  const out = Number(value);
  if (!Number.isFinite(out)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(out)));
}

function retryDelaySec(attempt, baseSec) {
  return Math.max(1, Math.floor(Number(baseSec || 2) * 2 ** Math.max(0, attempt - 1)));
}

function normalizePriority(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'high' || text === 'medium' || text === 'low') return text;
  return 'medium';
}

function buildProviderRequestKey(task) {
  const originIata = String(task?.originIata || '').trim().toUpperCase();
  const destinationIata = String(task?.destinationIata || '').trim().toUpperCase();
  const departureDate = String(task?.departureDate || '').trim().slice(0, 10);
  const returnDate = task?.returnDate ? String(task.returnDate).trim().slice(0, 10) : 'oneway';
  const adults = Math.max(1, Math.min(9, Number(task?.adults || 1) || 1));
  const cabinClass = String(task?.cabinClass || 'economy').trim().toLowerCase();
  return `${originIata}-${destinationIata}:${departureDate}:${returnDate}:${adults}:${cabinClass}`;
}

export async function runScanWorkerOnce(options = {}) {
  const enabled = parseFlag(options.enabled ?? process.env.FLIGHT_SCAN_ENABLED, false);
  if (!enabled) {
    return {
      skipped: true,
      reason: 'disabled',
      processedTasks: 0,
      insertedQuotes: 0,
      dedupedQuotes: 0,
      failedTasks: 0,
      retriedTasks: 0,
      deadLetteredTasks: 0,
      reusedProviderResponses: 0
    };
  }

  const maxJobs = safeInt(options.maxJobs ?? process.env.FLIGHT_SCAN_WORKER_MAX_JOBS, 80, 1, 2000);
  const retryBaseSec = safeInt(options.retryBaseSec ?? process.env.FLIGHT_SCAN_RETRY_BASE_SEC, 2, 1, 60);
  const rateLimitDelayHighSec = safeInt(options.rateLimitDelayHighSec ?? process.env.FLIGHT_SCAN_RATE_LIMIT_DELAY_HIGH_SEC, 60, 5, 3600);
  const rateLimitDelayMediumSec = safeInt(options.rateLimitDelayMediumSec ?? process.env.FLIGHT_SCAN_RATE_LIMIT_DELAY_MEDIUM_SEC, 180, 10, 7200);
  const rateLimitDelayLowSec = safeInt(options.rateLimitDelayLowSec ?? process.env.FLIGHT_SCAN_RATE_LIMIT_DELAY_LOW_SEC, 600, 30, 14400);
  const maxRateLimitRequeues = safeInt(
    options.maxRateLimitRequeues ?? process.env.FLIGHT_SCAN_RATE_LIMIT_MAX_REQUEUES,
    12,
    1,
    500
  );
  const inFlightDelaySec = safeInt(
    options.inFlightDelaySec ?? process.env.FLIGHT_SCAN_INFLIGHT_REQUEUE_DELAY_SEC,
    3,
    1,
    300
  );
  const maxInFlightRequeues = safeInt(
    options.maxInFlightRequeues ?? process.env.FLIGHT_SCAN_INFLIGHT_MAX_REQUEUES,
    30,
    1,
    500
  );
  const defaultFreshnessTtlSec = safeInt(options.defaultFreshnessTtlSec ?? process.env.FLIGHT_SCAN_WINDOW_FRESHNESS_TTL_SEC, 86400, 300, 1209600);

  const queue = options.queue || createScanQueue(options.queueOptions || {});
  const providerAdapter = options.providerAdapter || createScanProviderAdapter(options.providerAdapterOptions || {});
  const quoteStorage = options.quoteStorage || createQuoteStorage();
  const cache = options.cache || getCacheClient();
  const createJob = options.createIngestionJob || createIngestionJob;
  const updateJob = options.updateIngestionJob || updateIngestionJob;

  const job = await createJob({
    jobType: 'flight_scan_worker',
    source: 'scan_worker',
    status: 'running',
    metadata: { maxJobs }
  });

  await updateJob({
    jobId: job.id,
    status: 'running',
    startedAt: new Date().toISOString()
  });

  let processedTasks = 0;
  let delayedTasks = 0;
  let insertedQuotes = 0;
  let dedupedQuotes = 0;
  let rejectedQuotes = 0;
  let failedTasks = 0;
  let retriedTasks = 0;
  let deadLetteredTasks = 0;
  let reusedProviderResponses = 0;
  const providerResponseByRequest = new Map();
  const seenDelayedTaskIds = new Set();

  try {
    for (let i = 0; i < maxJobs; i += 1) {
      const task = await queue.dequeue();
      if (!task) break;

      if (Number(task.notBeforeTs || 0) > Date.now()) {
        delayedTasks += 1;
        const remainingSec = Math.max(1, Math.ceil((Number(task.notBeforeTs || 0) - Date.now()) / 1000));
        const delayedTaskId = String(task?.id || '').trim();
        const repeatedDelayedTask = Boolean(delayedTaskId && seenDelayedTaskIds.has(delayedTaskId));
        await queue.requeue(task, { delaySec: remainingSec });
        if (delayedTaskId) seenDelayedTaskIds.add(delayedTaskId);
        if (repeatedDelayedTask) {
          logger.info(
            {
              scanRunId: job.id,
              taskId: delayedTaskId || null,
              originIata: task.originIata,
              destinationIata: task.destinationIata,
              departureDate: task.departureDate,
              remainingSec
            },
            'flight_scan_worker_stopped_repeating_delayed_task'
          );
          break;
        }
        continue;
      }

      processedTasks += 1;
      try {
        const providerRequestKey = buildProviderRequestKey(task);
        let providerOut = providerResponseByRequest.get(providerRequestKey) || null;
        if (!providerOut) {
          providerOut = await providerAdapter.fetchOffers(task);
          providerResponseByRequest.set(providerRequestKey, providerOut);
        } else {
          reusedProviderResponses += 1;
        }
        const normalized = normalizeProviderQuotes({
          offers: providerOut.offers,
          task,
          scanRunId: job.id
        });
        rejectedQuotes += Number(normalized.rejectedCount || 0);

        const stored = await quoteStorage.saveQuotes(normalized.quotes, { scanRunId: job.id });
        insertedQuotes += Number(stored.insertedCount || 0);
        dedupedQuotes += Number(stored.dedupedCount || 0);

        const freshnessKey = String(task?.metadata?.freshnessKey || '').trim();
        if (freshnessKey && typeof cache?.setex === 'function') {
          const freshnessTtlSec = safeInt(task?.metadata?.freshnessTtlSec ?? defaultFreshnessTtlSec, defaultFreshnessTtlSec, 300, 1209600);
          try {
            await cache.setex(freshnessKey, freshnessTtlSec, String(Date.now()));
          } catch (freshnessError) {
            logger.warn({ err: freshnessError, freshnessKey }, 'flight_scan_task_freshness_update_failed');
          }
        }

        logger.info(
          {
            scanRunId: job.id,
            taskId: task.id,
            originIata: task.originIata,
            destinationIata: task.destinationIata,
            departureDate: task.departureDate,
            offerCount: Array.isArray(providerOut.offers) ? providerOut.offers.length : 0,
            inserted: Number(stored.insertedCount || 0),
            deduped: Number(stored.dedupedCount || 0),
            rejected: Number(normalized.rejectedCount || 0),
            fromCache: Boolean(providerOut.fromCache)
          },
          'flight_scan_task_completed'
        );
      } catch (error) {
        const errorCode = String(error?.code || error?.message || '').trim().toLowerCase();
        const inFlightContention = errorCode === 'provider_request_inflight';
        const rateLimited =
          errorCode === 'provider_rate_limit_exceeded' ||
          errorCode === 'provider_rate_limit_priority_exceeded';
        if (inFlightContention) {
          const inFlightRequeues = Math.max(0, Number(task?.metadata?.inFlightRequeues || 0));
          if (inFlightRequeues >= maxInFlightRequeues) {
            failedTasks += 1;
            if (typeof queue.deadLetter === 'function') {
              try {
                await queue.deadLetter(task, {
                  reason: 'inflight_requeue_limit_exceeded',
                  error,
                  scanRunId: job.id
                });
                deadLetteredTasks += 1;
              } catch (deadLetterError) {
                logger.warn(
                  {
                    scanRunId: job.id,
                    taskId: task.id,
                    err: deadLetterError?.message || String(deadLetterError)
                  },
                  'flight_scan_task_dead_letter_failed'
                );
              }
            }
            logger.error(
              {
                scanRunId: job.id,
                taskId: task.id,
                originIata: task.originIata,
                destinationIata: task.destinationIata,
                departureDate: task.departureDate,
                inFlightRequeues,
                maxInFlightRequeues,
                err: error?.message || String(error)
              },
              'flight_scan_task_failed_inflight_final'
            );
            continue;
          }

          retriedTasks += 1;
          await queue.requeue(
            {
              ...task,
              metadata: {
                ...(task?.metadata && typeof task.metadata === 'object' ? task.metadata : {}),
                inFlightRequeues: inFlightRequeues + 1
              }
            },
            { delaySec: inFlightDelaySec }
          );
          logger.info(
            {
              scanRunId: job.id,
              taskId: task.id,
              originIata: task.originIata,
              destinationIata: task.destinationIata,
              departureDate: task.departureDate,
              delaySec: inFlightDelaySec,
              inFlightRequeues: inFlightRequeues + 1,
              err: error?.message || String(error)
            },
            'flight_scan_task_requeued_inflight_contention'
          );
          continue;
        }

        if (rateLimited) {
          const rateLimitRequeues = Math.max(0, Number(task?.metadata?.rateLimitRequeues || 0));
          if (rateLimitRequeues >= maxRateLimitRequeues) {
            failedTasks += 1;
            if (typeof queue.deadLetter === 'function') {
              try {
                await queue.deadLetter(task, {
                  reason: 'rate_limit_requeue_limit_exceeded',
                  error,
                  scanRunId: job.id
                });
                deadLetteredTasks += 1;
              } catch (deadLetterError) {
                logger.warn(
                  {
                    scanRunId: job.id,
                    taskId: task.id,
                    err: deadLetterError?.message || String(deadLetterError)
                  },
                  'flight_scan_task_dead_letter_failed'
                );
              }
            }
            logger.error(
              {
                scanRunId: job.id,
                taskId: task.id,
                originIata: task.originIata,
                destinationIata: task.destinationIata,
                departureDate: task.departureDate,
                rateLimitRequeues,
                maxRateLimitRequeues,
                err: error?.message || String(error)
              },
              'flight_scan_task_failed_rate_limited_final'
            );
            continue;
          }

          retriedTasks += 1;
          const priority = normalizePriority(task?.metadata?.priority);
          const priorityDelays = {
            high: rateLimitDelayHighSec,
            medium: rateLimitDelayMediumSec,
            low: rateLimitDelayLowSec
          };
          const delaySec = Number(priorityDelays[priority] || rateLimitDelayMediumSec);
          await queue.requeue(
            {
              ...task,
              metadata: {
                ...(task?.metadata && typeof task.metadata === 'object' ? task.metadata : {}),
                rateLimitRequeues: rateLimitRequeues + 1
              }
            },
            { delaySec }
          );
          logger.info(
            {
              scanRunId: job.id,
              taskId: task.id,
              originIata: task.originIata,
              destinationIata: task.destinationIata,
              departureDate: task.departureDate,
              priority,
              delaySec,
              err: error?.message || String(error)
            },
            'flight_scan_task_requeued_rate_limited'
          );
          continue;
        }

        failedTasks += 1;
        const nextAttempt = Math.max(0, Number(task.attempt || 0)) + 1;
        const maxAttempts = Math.max(0, Number(task.maxAttempts || 0));
        const canRetry = nextAttempt <= maxAttempts;

        if (canRetry) {
          retriedTasks += 1;
          const delaySec = retryDelaySec(nextAttempt, retryBaseSec);
          await queue.requeue(
            {
              ...task,
              attempt: nextAttempt
            },
            { delaySec }
          );
          logger.info(
            {
              scanRunId: job.id,
              taskId: task.id,
              originIata: task.originIata,
              destinationIata: task.destinationIata,
              departureDate: task.departureDate,
              attempt: nextAttempt,
              maxAttempts,
              delaySec,
              err: error?.message || String(error)
            },
            'flight_scan_task_retried'
          );
        } else {
          if (typeof queue.deadLetter === 'function') {
            try {
              await queue.deadLetter(task, {
                reason: 'max_attempts_exceeded',
                error,
                scanRunId: job.id
              });
              deadLetteredTasks += 1;
            } catch (deadLetterError) {
              logger.warn(
                {
                  scanRunId: job.id,
                  taskId: task.id,
                  err: deadLetterError?.message || String(deadLetterError)
                },
                'flight_scan_task_dead_letter_failed'
              );
            }
          }
          logger.error(
            {
              scanRunId: job.id,
              taskId: task.id,
              originIata: task.originIata,
              destinationIata: task.destinationIata,
              departureDate: task.departureDate,
              attempt: nextAttempt,
              maxAttempts,
              err: error?.message || String(error)
            },
            'flight_scan_task_failed_final'
          );
        }
      }
    }

    const status = failedTasks > 0 ? (insertedQuotes > 0 ? 'partial' : 'failed') : 'success';
    const summary = {
      skipped: false,
      reason: null,
      processedTasks,
      delayedTasks,
      insertedQuotes,
      dedupedQuotes,
      rejectedQuotes,
      failedTasks,
      retriedTasks,
      deadLetteredTasks,
      reusedProviderResponses
    };

    await updateJob({
      jobId: job.id,
      status,
      finishedAt: new Date().toISOString(),
      processedCount: processedTasks,
      insertedCount: insertedQuotes,
      dedupedCount: dedupedQuotes,
      failedCount: failedTasks,
      metadata: summary
    });

    logger.info({ scanRunId: job.id, ...summary, status }, 'flight_scan_worker_completed');
    return summary;
  } catch (error) {
    await updateJob({
      jobId: job.id,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      processedCount: processedTasks,
      insertedCount: insertedQuotes,
      dedupedCount: dedupedQuotes,
      failedCount: failedTasks + 1,
      errorSummary: error?.message || String(error),
      metadata: {
        delayedTasks,
        rejectedQuotes,
        retriedTasks,
        deadLetteredTasks,
        reusedProviderResponses
      }
    });
    logger.error({ err: error, scanRunId: job.id }, 'flight_scan_worker_failed');
    throw error;
  }
}
