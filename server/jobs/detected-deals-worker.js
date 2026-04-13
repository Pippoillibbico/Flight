import { createIngestionJob, findRecentRunningIngestionJob, updateIngestionJob } from '../lib/deal-engine-store.js';
import { detectAndStoreDeals } from '../lib/detected-deals-engine.js';
import { parseFlag } from '../lib/env-flags.js';
import { logger } from '../lib/logger.js';
import { bootstrapFlightQuotesFromPublishedOpportunities } from '../lib/quote-bootstrap.js';
import { refreshRoutePriceStats } from '../lib/route-price-stats-service.js';

function normalizeRouteId(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function shouldBootstrap({ result, routeId, enabled }) {
  if (!enabled) return false;
  if (routeId != null) return false;
  const processedQuotes = Number(result?.processedQuotes || 0);
  const insertedDeals = Number(result?.insertedDeals || 0);
  const updatedDeals = Number(result?.updatedDeals || 0);
  const skippedReason = String(result?.reason || '');
  if (result?.skipped && (skippedReason === 'flight_quotes_missing' || skippedReason === 'route_price_stats_missing')) return true;
  if (processedQuotes === 0 && insertedDeals === 0 && updatedDeals === 0) return true;
  return false;
}

export async function runDetectedDealsWorkerOnce({ routeId = null } = {}) {
  const normalizedRouteId = normalizeRouteId(routeId);
  const overlapGuardMinutes = Math.max(1, Math.min(24 * 60, Number(process.env.INGESTION_JOB_OVERLAP_GUARD_MINUTES || 30)));
  if (normalizedRouteId == null) {
    const overlapJob = await findRecentRunningIngestionJob({
      jobTypes: ['detected_deals_refresh'],
      withinMinutes: overlapGuardMinutes
    });
    if (overlapJob) {
      const result = {
        skipped: true,
        reason: 'overlap_running',
        overlapGuardMinutes,
        overlapJobId: String(overlapJob?.id || ''),
        overlapJobType: String(overlapJob?.job_type || overlapJob?.jobType || 'detected_deals_refresh'),
        routeId: null
      };
      logger.warn(result, 'detected_deals_worker_skipped_overlap_running');
      return result;
    }
  }
  const bootstrapEnabled = parseFlag(process.env.CORE_QUOTES_BOOTSTRAP_ENABLED, true);
  const bootstrapLimit = Math.max(50, Math.min(5000, Number(process.env.CORE_QUOTES_BOOTSTRAP_LIMIT || 500)));
  const bootstrapDealsLookbackHours = Math.max(72, Math.min(24 * 365, Number(process.env.CORE_QUOTES_BOOTSTRAP_DEALS_LOOKBACK_HOURS || 24 * 30)));
  const job = await createIngestionJob({
    jobType: 'detected_deals_refresh',
    source: 'internal',
    status: 'running',
    metadata: {
      routeId: normalizedRouteId
    }
  });

  await updateIngestionJob({
    jobId: job.id,
    startedAt: new Date().toISOString(),
    status: 'running'
  });

  try {
    let result = await detectAndStoreDeals({ routeId: normalizedRouteId });
    let bootstrap = {
      attempted: false,
      skipped: true,
      reason: 'not_needed'
    };
    let statsRefresh = null;

    if (shouldBootstrap({ result, routeId: normalizedRouteId, enabled: bootstrapEnabled })) {
      try {
        bootstrap = await bootstrapFlightQuotesFromPublishedOpportunities({
          limit: bootstrapLimit,
          logger
        });
        if (Number(bootstrap.processedCount || 0) > 0) {
          statsRefresh = await refreshRoutePriceStats({ routeId: normalizedRouteId });
          result = await detectAndStoreDeals({
            routeId: normalizedRouteId,
            lookbackHours: bootstrapDealsLookbackHours
          });
        }
      } catch (bootstrapError) {
        bootstrap = {
          attempted: true,
          skipped: false,
          reason: 'bootstrap_failed',
          error: bootstrapError?.message || String(bootstrapError)
        };
        logger.warn({ err: bootstrapError, routeId: normalizedRouteId }, 'detected_deals_worker_bootstrap_failed');
      }
    }

    result = {
      ...result,
      bootstrap,
      bootstrapRoutePriceStats: statsRefresh
    };

    await updateIngestionJob({
      jobId: job.id,
      status: 'success',
      finishedAt: new Date().toISOString(),
      processedCount: Number(result.processedQuotes || 0),
      insertedCount: Number(result.insertedDeals || 0),
      dedupedCount: Number(result.updatedDeals || 0),
      failedCount: 0,
      metadata: result
    });
    logger.info({ ...result, routeId: normalizedRouteId }, 'detected_deals_worker_completed');
    return result;
  } catch (error) {
    await updateIngestionJob({
      jobId: job.id,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      failedCount: 1,
      errorSummary: error?.message || String(error)
    });
    logger.error({ err: error, routeId: normalizedRouteId }, 'detected_deals_worker_failed');
    throw error;
  }
}
