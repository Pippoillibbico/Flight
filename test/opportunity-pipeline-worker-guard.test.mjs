import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cleanupStaleOpportunityPipelineRuns,
  createOpportunityPipelineRun,
  finalizeOpportunityPipelineRun,
  findRecentRunningOpportunityPipelineRun,
  listRecentOpportunityPipelineRuns
} from '../server/lib/opportunity-store.js';
import { runOpportunityPipelineOnce } from '../server/jobs/opportunity-pipeline-worker.js';

const OPPORTUNITY_OVERLAP_ENV = 'OPPORTUNITY_PIPELINE_OVERLAP_GUARD_MINUTES';
const OPPORTUNITY_STALE_ENV = 'OPPORTUNITY_PIPELINE_STALE_RUNNING_MINUTES';

function withEnv(name, value) {
  const previous = process.env[name];
  process.env[name] = String(value);
  return () => {
    if (previous == null) delete process.env[name];
    else process.env[name] = previous;
  };
}

async function withOpportunitySqliteDb(fn) {
  const sqlite = await import('node:sqlite');
  const dbPath = fileURLToPath(new URL('../data/app.db', import.meta.url));
  const db = new sqlite.DatabaseSync(dbPath);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

test('opportunity pipeline worker skips when a recent running run already exists', async () => {
  const restoreOverlap = withEnv(OPPORTUNITY_OVERLAP_ENV, 45);
  const run = await createOpportunityPipelineRun({
    providerFetchEnabled: false,
    metadata: { test: 'overlap_guard' }
  });

  try {
    const overlap = await findRecentRunningOpportunityPipelineRun({ withinMinutes: 45 });
    assert.equal(String(overlap?.id || ''), run.id);

    const result = await runOpportunityPipelineOnce();
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'overlap_running');
    assert.equal(String(result.overlapRunId || ''), run.id);
  } finally {
    await finalizeOpportunityPipelineRun({
      runId: run.id,
      status: 'success',
      processedCount: 0,
      publishedCount: 0,
      dedupedCount: 0,
      enrichedCount: 0,
      enrichFailedCount: 0
    });
    restoreOverlap();
  }
});

test('stale running opportunity pipeline runs are auto-closed', async () => {
  const restoreStale = withEnv(OPPORTUNITY_STALE_ENV, 30);
  const run = await createOpportunityPipelineRun({
    providerFetchEnabled: false,
    metadata: { test: 'stale_cleanup' }
  });

  try {
    await withOpportunitySqliteDb(async (db) => {
      db.prepare(
        `UPDATE opportunity_pipeline_runs
         SET started_at = datetime('now', '-3 hour')
         WHERE id = ?`
      ).run(run.id);
    });

    const closedCount = await cleanupStaleOpportunityPipelineRuns({ staleAfterMinutes: 30 });
    assert.equal(closedCount >= 1, true);

    const recent = await listRecentOpportunityPipelineRuns(200);
    let row = recent.find((item) => String(item?.id || '') === run.id);
    if (!row) {
      row = await withOpportunitySqliteDb(async (db) =>
        db.prepare('SELECT id, status, error_summary FROM opportunity_pipeline_runs WHERE id = ?').get(run.id)
      );
    }
    assert.equal(Boolean(row), true);
    assert.equal(String(row?.status || ''), 'failed');
    assert.equal(String(row?.error_summary || ''), 'stale_pipeline_run_auto_closed');
  } finally {
    restoreStale();
  }
});
