import assert from 'node:assert/strict';
import test from 'node:test';
import { createIngestionJob, listIngestionJobs, runIngestionJobsMaintenance, updateIngestionJob } from '../server/lib/deal-engine-store.js';

test('createIngestionJob closes stale running jobs of same type before inserting a new run', async () => {
  const jobType = `ingestion_maintenance_${Date.now()}`;
  const staleJob = await createIngestionJob({
    jobType,
    source: 'internal',
    status: 'running',
    metadata: { test: true }
  });

  const staleStartedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  await updateIngestionJob({
    jobId: staleJob.id,
    status: 'running',
    startedAt: staleStartedAt
  });

  const freshJob = await createIngestionJob({
    jobType,
    source: 'internal',
    status: 'running',
    metadata: { test: true, second: true }
  });

  const rows = await listIngestionJobs({ jobTypes: [jobType], limit: 10 });
  const byId = new Map(rows.map((row) => [String(row.id || ''), row]));

  assert.equal(Boolean(byId.get(staleJob.id)), true);
  assert.equal(Boolean(byId.get(freshJob.id)), true);
  assert.equal(String(byId.get(staleJob.id)?.status || ''), 'failed');
  assert.equal(String(byId.get(staleJob.id)?.error_summary || ''), 'stale_job_same_type_auto_closed');
  assert.equal(String(byId.get(freshJob.id)?.status || ''), 'running');

  await updateIngestionJob({
    jobId: freshJob.id,
    status: 'success',
    finishedAt: new Date().toISOString(),
    processedCount: 0,
    insertedCount: 0,
    dedupedCount: 0,
    failedCount: 0
  });
});

test('runIngestionJobsMaintenance force-closes stale running jobs', async () => {
  const jobType = `ingestion_maintenance_force_${Date.now()}`;
  const staleJob = await createIngestionJob({
    jobType,
    source: 'internal',
    status: 'running',
    metadata: { test: 'force_cleanup' }
  });

  const staleStartedAt = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  await updateIngestionJob({
    jobId: staleJob.id,
    status: 'running',
    startedAt: staleStartedAt
  });

  const maintenance = await runIngestionJobsMaintenance({ force: true });
  assert.equal(Number(maintenance.running) >= 0, true);

  const rows = await listIngestionJobs({ jobTypes: [jobType], limit: 5 });
  const row = rows.find((item) => String(item.id || '') === staleJob.id);
  assert.equal(Boolean(row), true);
  assert.equal(String(row?.status || ''), 'failed');
  assert.equal(String(row?.error_summary || ''), 'stale_job_auto_closed');
});
