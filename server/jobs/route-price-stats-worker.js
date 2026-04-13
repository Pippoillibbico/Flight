import { createIngestionJob, findRecentRunningIngestionJob, updateIngestionJob } from '../lib/deal-engine-store.js';
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

function shouldBootstrap({ refreshResult, routeId, enabled }) {
  if (!enabled) return false;
  if (routeId != null) return false;
  const quoteCount = Number(refreshResult?.quoteCount || 0);
  if (quoteCount <= 0) return true;
  if (refreshResult?.skipped && String(refreshResult?.reason || '') === 'flight_quotes_missing') return true;
  return false;
}

export async function runRoutePriceStatsWorkerOnce({ routeId = null } = {}) {
  const normalizedRouteId = normalizeRouteId(routeId);
  const overlapGuardMinutes = Math.max(1, Math.min(24 * 60, Number(process.env.INGESTION_JOB_OVERLAP_GUARD_MINUTES || 30)));
  if (normalizedRouteId == null) {
    const overlapJob = await findRecentRunningIngestionJob({
      jobTypes: ['route_price_stats_refresh'],
      withinMinutes: overlapGuardMinutes
    });
    if (overlapJob) {
      const result = {
        skipped: true,
        reason: 'overlap_running',
        overlapGuardMinutes,
        overlapJobId: String(overlapJob?.id || ''),
        overlapJobType: String(overlapJob?.job_type || overlapJob?.jobType || 'route_price_stats_refresh'),
        routeId: null
      };
      logger.warn(result, 'route_price_stats_worker_skipped_overlap_running');
      return result;
    }
  }
  const bootstrapEnabled = parseFlag(process.env.CORE_QUOTES_BOOTSTRAP_ENABLED, true);
  const bootstrapLimit = Math.max(50, Math.min(5000, Number(process.env.CORE_QUOTES_BOOTSTRAP_LIMIT || 500)));
  const job = await createIngestionJob({
    jobType: 'route_price_stats_refresh',
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
    let result = await refreshRoutePriceStats({ routeId: normalizedRouteId });
    let bootstrap = {
      attempted: false,
      skipped: true,
      reason: 'not_needed'
    };

    if (shouldBootstrap({ refreshResult: result, routeId: normalizedRouteId, enabled: bootstrapEnabled })) {
      try {
        bootstrap = await bootstrapFlightQuotesFromPublishedOpportunities({
          limit: bootstrapLimit,
          logger
        });
        if (Number(bootstrap.processedCount || 0) > 0) {
          result = await refreshRoutePriceStats({ routeId: normalizedRouteId });
        }
      } catch (bootstrapError) {
        bootstrap = {
          attempted: true,
          skipped: false,
          reason: 'bootstrap_failed',
          error: bootstrapError?.message || String(bootstrapError)
        };
        logger.warn({ err: bootstrapError, routeId: normalizedRouteId }, 'route_price_stats_worker_bootstrap_failed');
      }
    }

    result = {
      ...result,
      bootstrap
    };

    await updateIngestionJob({
      jobId: job.id,
      status: 'success',
      finishedAt: new Date().toISOString(),
      processedCount: Number(result.quoteCount || 0),
      insertedCount: Number(result.updatedRows || 0),
      dedupedCount: 0,
      failedCount: 0,
      metadata: result
    });
    logger.info({ ...result, routeId: normalizedRouteId }, 'route_price_stats_worker_completed');
    return result;
  } catch (error) {
    await updateIngestionJob({
      jobId: job.id,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      failedCount: 1,
      errorSummary: error?.message || String(error)
    });
    logger.error({ err: error, routeId: normalizedRouteId }, 'route_price_stats_worker_failed');
    throw error;
  }
}
