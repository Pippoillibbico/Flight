import {
  createIngestionJob,
  refreshRouteCoverageStats,
  recomputeRouteBaselines,
  updateIngestionJob
} from '../lib/deal-engine-store.js';
import { logger } from '../lib/logger.js';

export async function runBaselineRecomputeOnce() {
  const job = await createIngestionJob({
    jobType: 'baseline_recompute',
    source: 'internal',
    status: 'running',
    metadata: {}
  });
  await updateIngestionJob({ jobId: job.id, startedAt: new Date().toISOString(), status: 'running' });

  try {
    const baseline = await recomputeRouteBaselines();
    const coverage = await refreshRouteCoverageStats();
    await updateIngestionJob({
      jobId: job.id,
      status: 'success',
      finishedAt: new Date().toISOString(),
      processedCount: Number(baseline.upsertedRows || 0),
      insertedCount: Number(baseline.baselineRows || 0),
      dedupedCount: 0,
      failedCount: 0,
      metadata: { baseline, coverage }
    });
    logger.info({ ...baseline, ...coverage }, 'baseline_recompute_worker_completed');
    return { baseline, coverage };
  } catch (error) {
    await updateIngestionJob({
      jobId: job.id,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      failedCount: 1,
      errorSummary: error?.message || String(error)
    });
    logger.error({ err: error }, 'baseline_recompute_worker_failed');
    throw error;
  }
}
