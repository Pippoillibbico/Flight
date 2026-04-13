import { listIngestionJobs } from '../deal-engine-store.js';
import { logger as rootLogger } from '../logger.js';
import { createScanQueue } from './scan-queue.js';

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function normalizeJobRow(row) {
  return {
    id: String(row?.id || ''),
    jobType: String(row?.job_type || row?.jobType || ''),
    status: String(row?.status || 'unknown'),
    source: String(row?.source || ''),
    startedAt: row?.started_at || row?.startedAt || null,
    finishedAt: row?.finished_at || row?.finishedAt || null,
    processedCount: toNumber(row?.processed_count ?? row?.processedCount, 0),
    insertedCount: toNumber(row?.inserted_count ?? row?.insertedCount, 0),
    dedupedCount: toNumber(row?.deduped_count ?? row?.dedupedCount, 0),
    failedCount: toNumber(row?.failed_count ?? row?.failedCount, 0),
    errorSummary: row?.error_summary || row?.errorSummary || null,
    metadata: row?.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row?.created_at || row?.createdAt || null,
    updatedAt: row?.updated_at || row?.updatedAt || null
  };
}

export function createScanStatusService({
  queue = createScanQueue(),
  listIngestionJobsFn = listIngestionJobs,
  providerRegistry = null,
  logger = rootLogger
} = {}) {
  async function getStatus({ recentRunsLimit = 20 } = {}) {
    const safeRecentRunsLimit = Math.max(1, Math.min(100, Number(recentRunsLimit) || 20));
    try {
      const [queueStats, deadLetters, rawRuns] = await Promise.all([
        typeof queue.getStats === 'function' ? queue.getStats() : Promise.resolve({ pending: 0, deadLettered: 0 }),
        typeof queue.peekDeadLetters === 'function' ? queue.peekDeadLetters({ limit: 10 }) : Promise.resolve([]),
        listIngestionJobsFn({
          jobTypes: ['flight_scan_scheduler', 'flight_scan_worker'],
          limit: safeRecentRunsLimit
        })
      ]);

      const recentRuns = Array.isArray(rawRuns) ? rawRuns.map(normalizeJobRow) : [];
      const schedulerRuns = recentRuns.filter((row) => row.jobType === 'flight_scan_scheduler');
      const workerRuns = recentRuns.filter((row) => row.jobType === 'flight_scan_worker');
      const providerRuntime = providerRegistry?.runtimeStats?.() || providerRegistry?.listProviders?.() || [];
      const distributedQueue = Boolean(String(process.env.REDIS_URL || '').trim());
      const queueOut = {
        ...(queueStats && typeof queueStats === 'object' ? queueStats : {}),
        distributed: distributedQueue,
        backend: distributedQueue ? 'redis' : 'in_memory'
      };

      return {
        ok: true,
        now: new Date().toISOString(),
        queue: queueOut,
        deadLetters: Array.isArray(deadLetters) ? deadLetters : [],
        recentRuns,
        scheduler: {
          lastRun: schedulerRuns[0] || null,
          recentCount: schedulerRuns.length
        },
        worker: {
          lastRun: workerRuns[0] || null,
          recentCount: workerRuns.length
        },
        providers: providerRuntime
      };
    } catch (error) {
      logger.error({ err: error }, 'flight_scan_status_failed');
      return {
        ok: false,
        now: new Date().toISOString(),
        error: error?.message || String(error)
      };
    }
  }

  return {
    getStatus
  };
}
