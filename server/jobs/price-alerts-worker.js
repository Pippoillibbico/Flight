import { createIngestionJob, findRecentRunningIngestionJob, updateIngestionJob } from '../lib/deal-engine-store.js';
import { logger } from '../lib/logger.js';
import { runPriceAlertsScanOnce } from '../lib/price-alerts-notifier.js';

function normalizeLimit(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.min(5000, Math.trunc(parsed)));
}

export async function runPriceAlertsWorkerOnce({ limit = null } = {}) {
  const safeLimit = normalizeLimit(limit);
  const overlapGuardMinutes = Math.max(1, Math.min(24 * 60, Number(process.env.INGESTION_JOB_OVERLAP_GUARD_MINUTES || 30)));
  const overlapJob = await findRecentRunningIngestionJob({
    jobTypes: ['price_alerts_scan'],
    withinMinutes: overlapGuardMinutes
  });
  if (overlapJob) {
    const result = {
      skipped: true,
      reason: 'overlap_running',
      overlapGuardMinutes,
      overlapJobId: String(overlapJob?.id || ''),
      overlapJobType: String(overlapJob?.job_type || overlapJob?.jobType || 'price_alerts_scan'),
      limit: safeLimit
    };
    logger.warn(result, 'price_alerts_worker_skipped_overlap_running');
    return result;
  }
  const job = await createIngestionJob({
    jobType: 'price_alerts_scan',
    source: 'internal',
    status: 'running',
    metadata: {
      limit: safeLimit
    }
  });

  await updateIngestionJob({
    jobId: job.id,
    startedAt: new Date().toISOString(),
    status: 'running'
  });

  try {
    const result = await runPriceAlertsScanOnce({ limit: safeLimit || undefined });
    await updateIngestionJob({
      jobId: job.id,
      status: 'success',
      finishedAt: new Date().toISOString(),
      processedCount: Number(result.processed || 0),
      insertedCount: Number(result.sentInApp || 0) + Number(result.sentEmail || 0) + Number(result.sentPush || 0),
      dedupedCount: Number(result.deduped || 0),
      failedCount: Number(result.failed || 0),
      metadata: result
    });
    logger.info(result, 'price_alerts_worker_completed');
    return result;
  } catch (error) {
    await updateIngestionJob({
      jobId: job.id,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      failedCount: 1,
      errorSummary: error?.message || String(error)
    });
    logger.error({ err: error }, 'price_alerts_worker_failed');
    throw error;
  }
}
