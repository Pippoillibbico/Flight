import { runProviderCollectionOnce } from './provider-collection-worker.js';
import {
  cleanupStaleOpportunityPipelineRuns,
  createOpportunityPipelineRun,
  enrichShortlistedOpportunities,
  finalizeOpportunityPipelineRun,
  findRecentRunningOpportunityPipelineRun,
  getOpportunityPipelineStats,
  refreshOpportunityFeed
} from '../lib/opportunity-store.js';
import { parseFlag } from '../lib/env-flags.js';
import { logger } from '../lib/logger.js';

function compactPipelineSummary(summary = {}) {
  const stats = summary?.stats && typeof summary.stats === 'object' ? summary.stats : null;
  const compactStats = stats
    ? {
        refreshedAt: stats.refreshedAt || null,
        processed: Number(stats.processed || 0),
        published: Number(stats.published || 0),
        deduped: Number(stats.deduped || 0),
        skippedWeak: Number(stats.skippedWeak || 0),
        enriched: Number(stats.enriched || 0),
        enrichFailed: Number(stats.enrichFailed || 0),
        apiFilteredOut: Number(stats.apiFilteredOut || 0),
        skippedInvalid: Number(stats.skippedInvalid || 0),
        totals: stats.totals || null,
        apiQuality: stats.apiQuality || null,
        recentRuns: Array.isArray(stats.recentRuns)
          ? stats.recentRuns.slice(0, 5).map((run) => ({
              id: run?.id || null,
              status: run?.status || null,
              started_at: run?.started_at || null,
              finished_at: run?.finished_at || null,
              processed_count: Number(run?.processed_count || 0),
              published_count: Number(run?.published_count || 0),
              deduped_count: Number(run?.deduped_count || 0),
              enriched_count: Number(run?.enriched_count || 0),
              enrich_failed_count: Number(run?.enrich_failed_count || 0)
            }))
          : []
      }
    : null;

  return {
    providerCollection: summary.providerCollection || { skipped: true },
    refresh: summary.refresh || { refreshed: false, processed: 0, published: 0, skippedWeak: 0 },
    enrichment: summary.enrichment || { candidates: 0, enriched: 0, failed: 0 },
    stats: compactStats
  };
}

export async function runOpportunityPipelineOnce() {
  const fetchProviders = parseFlag(process.env.OPPORTUNITY_PIPELINE_FETCH_PROVIDERS, false);
  const enrichmentBatch = Math.max(1, Math.min(40, Number(process.env.OPPORTUNITY_ENRICHMENT_BATCH || 10)));
  const refreshLookbackDays = Math.max(14, Math.min(180, Number(process.env.OPPORTUNITY_LOOKBACK_DAYS || 75)));
  const refreshLimit = Math.max(200, Math.min(10000, Number(process.env.OPPORTUNITY_REFRESH_LIMIT || 2000)));
  const staleRunMinutes = Math.max(10, Math.min(24 * 60, Number(process.env.OPPORTUNITY_PIPELINE_STALE_RUNNING_MINUTES || 60)));
  const overlapGuardMinutes = Math.max(1, Math.min(24 * 60, Number(process.env.OPPORTUNITY_PIPELINE_OVERLAP_GUARD_MINUTES || 30)));

  const staleRunsClosed = await cleanupStaleOpportunityPipelineRuns({ staleAfterMinutes: staleRunMinutes });
  const overlapRun = await findRecentRunningOpportunityPipelineRun({ withinMinutes: overlapGuardMinutes });
  if (overlapRun) {
    const result = {
      skipped: true,
      reason: 'overlap_running',
      overlapGuardMinutes,
      overlapRunId: String(overlapRun?.id || ''),
      overlapRunStartedAt: overlapRun?.started_at || null,
      staleRunsClosed
    };
    logger.warn(result, 'opportunity_pipeline_worker_skipped_overlap_running');
    return result;
  }

  const summary = {
    providerCollection: { skipped: true },
    refresh: { refreshed: false, processed: 0, published: 0, skippedWeak: 0 },
    enrichment: { candidates: 0, enriched: 0, failed: 0 },
    stats: null,
    staleRunsClosed
  };

  const run = await createOpportunityPipelineRun({
    providerFetchEnabled: fetchProviders,
    metadata: { refreshLookbackDays, refreshLimit, enrichmentBatch }
  });

  try {
    if (fetchProviders) {
      summary.providerCollection = await runProviderCollectionOnce();
    }

    summary.refresh = await refreshOpportunityFeed({
      lookbackDays: refreshLookbackDays,
      limit: refreshLimit
    });
    summary.enrichment = await enrichShortlistedOpportunities({
      maxItems: enrichmentBatch
    });
    summary.stats = await getOpportunityPipelineStats();
    const metadata = compactPipelineSummary(summary);

    await finalizeOpportunityPipelineRun({
      runId: run.id,
      status: 'success',
      processedCount: Number(summary.refresh.processed || 0),
      publishedCount: Number(summary.refresh.published || 0),
      dedupedCount: Number(summary.refresh.processed || 0) - Number(summary.refresh.published || 0) - Number(summary.refresh.skippedWeak || 0),
      enrichedCount: Number(summary.enrichment.enriched || 0),
      enrichFailedCount: Number(summary.enrichment.failed || 0),
      metadata
    });
    logger.info({ runId: run.id, summary: metadata }, 'opportunity_pipeline_worker_completed');
    return summary;
  } catch (error) {
    const metadata = compactPipelineSummary(summary);
    await finalizeOpportunityPipelineRun({
      runId: run.id,
      status: 'failed',
      processedCount: Number(summary.refresh.processed || 0),
      publishedCount: Number(summary.refresh.published || 0),
      dedupedCount: Number(summary.refresh.deduped || 0),
      enrichedCount: Number(summary.enrichment.enriched || 0),
      enrichFailedCount: Number(summary.enrichment.failed || 0),
      errorSummary: error?.message || String(error),
      metadata
    });
    logger.error({ runId: run.id, err: error }, 'opportunity_pipeline_worker_failed');
    throw error;
  }
}
