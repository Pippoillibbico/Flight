import { runProviderCollectionOnce } from './provider-collection-worker.js';
import {
  createOpportunityPipelineRun,
  enrichShortlistedOpportunities,
  finalizeOpportunityPipelineRun,
  getOpportunityPipelineStats,
  refreshOpportunityFeed
} from '../lib/opportunity-store.js';
import { logger } from '../lib/logger.js';

function parseFlag(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

export async function runOpportunityPipelineOnce() {
  const fetchProviders = parseFlag(process.env.OPPORTUNITY_PIPELINE_FETCH_PROVIDERS, false);
  const enrichmentBatch = Math.max(1, Math.min(40, Number(process.env.OPPORTUNITY_ENRICHMENT_BATCH || 10)));
  const refreshLookbackDays = Math.max(14, Math.min(180, Number(process.env.OPPORTUNITY_LOOKBACK_DAYS || 75)));
  const refreshLimit = Math.max(200, Math.min(10000, Number(process.env.OPPORTUNITY_REFRESH_LIMIT || 2000)));

  const summary = {
    providerCollection: { skipped: true },
    refresh: { refreshed: false, processed: 0, published: 0, skippedWeak: 0 },
    enrichment: { candidates: 0, enriched: 0, failed: 0 },
    stats: null
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

    await finalizeOpportunityPipelineRun({
      runId: run.id,
      status: 'success',
      processedCount: Number(summary.refresh.processed || 0),
      publishedCount: Number(summary.refresh.published || 0),
      dedupedCount: Number(summary.refresh.processed || 0) - Number(summary.refresh.published || 0) - Number(summary.refresh.skippedWeak || 0),
      enrichedCount: Number(summary.enrichment.enriched || 0),
      enrichFailedCount: Number(summary.enrichment.failed || 0),
      metadata: summary
    });
    logger.info({ runId: run.id, summary }, 'opportunity_pipeline_worker_completed');
    return summary;
  } catch (error) {
    await finalizeOpportunityPipelineRun({
      runId: run.id,
      status: 'failed',
      processedCount: Number(summary.refresh.processed || 0),
      publishedCount: Number(summary.refresh.published || 0),
      dedupedCount: Number(summary.refresh.deduped || 0),
      enrichedCount: Number(summary.enrichment.enriched || 0),
      enrichFailedCount: Number(summary.enrichment.failed || 0),
      errorSummary: error?.message || String(error),
      metadata: summary
    });
    logger.error({ runId: run.id, err: error }, 'opportunity_pipeline_worker_failed');
    throw error;
  }
}
