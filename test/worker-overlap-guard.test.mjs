import assert from 'node:assert/strict';
import test from 'node:test';
import { runDetectedDealsWorkerOnce } from '../server/jobs/detected-deals-worker.js';
import { runPriceAlertsWorkerOnce } from '../server/jobs/price-alerts-worker.js';
import { runRoutePriceStatsWorkerOnce } from '../server/jobs/route-price-stats-worker.js';
import { createIngestionJob, updateIngestionJob } from '../server/lib/deal-engine-store.js';

const OVERLAP_GUARD_ENV = 'INGESTION_JOB_OVERLAP_GUARD_MINUTES';

async function createFreshRunningJob(jobType) {
  const job = await createIngestionJob({
    jobType,
    source: 'internal',
    status: 'running',
    metadata: {
      test: 'worker_overlap_guard'
    }
  });
  await updateIngestionJob({
    jobId: job.id,
    status: 'running',
    startedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
  });
  return job;
}

async function completeJob(jobId) {
  await updateIngestionJob({
    jobId,
    status: 'success',
    finishedAt: new Date().toISOString(),
    processedCount: 0,
    insertedCount: 0,
    dedupedCount: 0,
    failedCount: 0
  });
}

function withOverlapGuardMinutes(value) {
  const previous = process.env[OVERLAP_GUARD_ENV];
  process.env[OVERLAP_GUARD_ENV] = String(value);
  return () => {
    if (previous == null) delete process.env[OVERLAP_GUARD_ENV];
    else process.env[OVERLAP_GUARD_ENV] = previous;
  };
}

test('route price stats worker skips when a recent running job already exists', async () => {
  const restoreEnv = withOverlapGuardMinutes(45);
  const overlapJob = await createFreshRunningJob('route_price_stats_refresh');
  try {
    const result = await runRoutePriceStatsWorkerOnce();
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'overlap_running');
    assert.equal(typeof result.overlapJobId, 'string');
    assert.equal(result.overlapJobId.length > 0, true);
    assert.equal(result.overlapJobType, 'route_price_stats_refresh');
  } finally {
    await completeJob(overlapJob.id);
    restoreEnv();
  }
});

test('detected deals worker skips when a recent running job already exists', async () => {
  const restoreEnv = withOverlapGuardMinutes(45);
  const overlapJob = await createFreshRunningJob('detected_deals_refresh');
  try {
    const result = await runDetectedDealsWorkerOnce();
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'overlap_running');
    assert.equal(typeof result.overlapJobId, 'string');
    assert.equal(result.overlapJobId.length > 0, true);
    assert.equal(result.overlapJobType, 'detected_deals_refresh');
  } finally {
    await completeJob(overlapJob.id);
    restoreEnv();
  }
});

test('price alerts worker skips when a recent running job already exists', async () => {
  const restoreEnv = withOverlapGuardMinutes(45);
  const overlapJob = await createFreshRunningJob('price_alerts_scan');
  try {
    const result = await runPriceAlertsWorkerOnce();
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'overlap_running');
    assert.equal(typeof result.overlapJobId, 'string');
    assert.equal(result.overlapJobId.length > 0, true);
    assert.equal(result.overlapJobType, 'price_alerts_scan');
    assert.equal(result.limit, null);
  } finally {
    await completeJob(overlapJob.id);
    restoreEnv();
  }
});
