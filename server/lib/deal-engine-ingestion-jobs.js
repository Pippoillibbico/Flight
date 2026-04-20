import { nanoid } from 'nanoid';

export function createIngestionJobsService({
  ensureInitialized,
  getMode,
  getPgPool,
  getSqliteDb
}) {
  let ingestionCleanupLastRunAt = 0;

  const INGESTION_JOBS_RETENTION_DAYS = Math.max(1, Number(process.env.INGESTION_JOBS_RETENTION_DAYS || 30));
  const INGESTION_JOBS_RETENTION_MAX_ROWS = Math.max(200, Number(process.env.INGESTION_JOBS_RETENTION_MAX_ROWS || 5000));
  const INGESTION_JOBS_CLEANUP_MIN_INTERVAL_MS = Math.max(60_000, Number(process.env.INGESTION_JOBS_CLEANUP_MIN_INTERVAL_MS || 15 * 60 * 1000));
  const INGESTION_JOBS_STALE_RUNNING_HOURS = Math.max(1, Number(process.env.INGESTION_JOBS_STALE_RUNNING_HOURS || 6));
  const INGESTION_JOBS_SAME_TYPE_STALE_MINUTES = Math.max(10, Number(process.env.INGESTION_JOBS_SAME_TYPE_STALE_MINUTES || 60));

  async function cleanupIngestionJobsIfNeeded({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - ingestionCleanupLastRunAt < INGESTION_JOBS_CLEANUP_MIN_INTERVAL_MS) {
      return { skipped: true, reason: 'min_interval' };
    }
    ingestionCleanupLastRunAt = now;
    await ensureInitialized();

    if (getMode() === 'postgres') {
      const pgPool = getPgPool();
      const staleClosed = await pgPool.query(
        `UPDATE ingestion_jobs
         SET status = 'failed',
             finished_at = COALESCE(finished_at, NOW()),
             error_summary = COALESCE(error_summary, 'stale_job_auto_closed'),
             updated_at = NOW()
         WHERE status = 'running'
           AND COALESCE(started_at, created_at) < NOW() - ($1::int * INTERVAL '1 hour')`,
        [INGESTION_JOBS_STALE_RUNNING_HOURS]
      );
      const retainedDeleted = await pgPool.query(
        `DELETE FROM ingestion_jobs
         WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
        [INGESTION_JOBS_RETENTION_DAYS]
      );
      const overflowDeleted = await pgPool.query(
        `DELETE FROM ingestion_jobs
         WHERE id IN (
           SELECT id
           FROM ingestion_jobs
           ORDER BY created_at DESC
           OFFSET $1
         )`,
        [INGESTION_JOBS_RETENTION_MAX_ROWS]
      );
      return {
        skipped: false,
        staleClosed: Number(staleClosed?.rowCount || 0),
        retainedDeleted: Number(retainedDeleted?.rowCount || 0),
        overflowDeleted: Number(overflowDeleted?.rowCount || 0)
      };
    }

    const sqliteDb = getSqliteDb();
    const staleClosed = sqliteDb
      .prepare(
        `UPDATE ingestion_jobs
         SET status = 'failed',
             finished_at = COALESCE(finished_at, datetime('now')),
             error_summary = COALESCE(error_summary, 'stale_job_auto_closed'),
             updated_at = datetime('now')
         WHERE status = 'running'
           AND datetime(COALESCE(started_at, created_at)) < datetime('now', '-' || ? || ' hour')`
      )
      .run(INGESTION_JOBS_STALE_RUNNING_HOURS);
    const retainedDeleted = sqliteDb
      .prepare(
        `DELETE FROM ingestion_jobs
         WHERE datetime(created_at) < datetime('now', '-' || ? || ' day')`
      )
      .run(INGESTION_JOBS_RETENTION_DAYS);
    const overflowDeleted = sqliteDb
      .prepare(
        `DELETE FROM ingestion_jobs
         WHERE id IN (
           SELECT id
           FROM ingestion_jobs
           ORDER BY datetime(created_at) DESC
           LIMIT -1 OFFSET ?
         )`
      )
      .run(INGESTION_JOBS_RETENTION_MAX_ROWS);
    return {
      skipped: false,
      staleClosed: Number(staleClosed?.changes || 0),
      retainedDeleted: Number(retainedDeleted?.changes || 0),
      overflowDeleted: Number(overflowDeleted?.changes || 0)
    };
  }

  async function cleanupStaleRunningJobsForTypeIfNeeded(jobType) {
    const normalizedJobType = String(jobType || '').trim();
    if (!normalizedJobType) return 0;

    if (getMode() === 'postgres') {
      const pgPool = getPgPool();
      const result = await pgPool.query(
        `UPDATE ingestion_jobs
         SET status = 'failed',
             finished_at = COALESCE(finished_at, NOW()),
             error_summary = COALESCE(error_summary, 'stale_job_same_type_auto_closed'),
             updated_at = NOW()
         WHERE status = 'running'
           AND job_type = $1
           AND COALESCE(started_at, created_at) < NOW() - ($2::int * INTERVAL '1 minute')`,
        [normalizedJobType, INGESTION_JOBS_SAME_TYPE_STALE_MINUTES]
      );
      return Number(result?.rowCount || 0);
    }

    const sqliteDb = getSqliteDb();
    const result = sqliteDb
      .prepare(
        `UPDATE ingestion_jobs
         SET status = 'failed',
             finished_at = COALESCE(finished_at, datetime('now')),
             error_summary = COALESCE(error_summary, 'stale_job_same_type_auto_closed'),
             updated_at = datetime('now')
         WHERE status = 'running'
           AND job_type = ?
           AND datetime(COALESCE(started_at, created_at)) < datetime('now', '-' || ? || ' minute')`
      )
      .run(normalizedJobType, INGESTION_JOBS_SAME_TYPE_STALE_MINUTES);
    return Number(result?.changes || 0);
  }

  async function createIngestionJob({ jobType, source, status = 'queued', metadata = null }) {
    await ensureInitialized();
    const id = nanoid(16);
    const payload = {
      id,
      jobType: String(jobType || '').trim() || 'unknown',
      source: String(source || '').trim() || 'manual',
      status: String(status || 'queued').trim() || 'queued',
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      createdAt: new Date().toISOString()
    };
    await cleanupStaleRunningJobsForTypeIfNeeded(payload.jobType);
    if (getMode() === 'postgres') {
      const pgPool = getPgPool();
      await pgPool.query(
        `INSERT INTO ingestion_jobs
         (id, job_type, status, source, metadata, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`,
        [payload.id, payload.jobType, payload.status, payload.source, JSON.stringify(payload.metadata)]
      );
      cleanupIngestionJobsIfNeeded().catch(() => {});
      return payload;
    }

    const sqliteDb = getSqliteDb();
    sqliteDb
      .prepare(
        `INSERT INTO ingestion_jobs
         (id, job_type, status, source, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(payload.id, payload.jobType, payload.status, payload.source, JSON.stringify(payload.metadata));
    cleanupIngestionJobsIfNeeded().catch(() => {});
    return payload;
  }

  async function updateIngestionJob({
    jobId,
    status,
    startedAt = null,
    finishedAt = null,
    processedCount = null,
    insertedCount = null,
    dedupedCount = null,
    failedCount = null,
    errorSummary = null,
    metadata = null
  }) {
    await ensureInitialized();
    const id = String(jobId || '').trim();
    if (!id) return;
    if (getMode() === 'postgres') {
      const pgPool = getPgPool();
      await pgPool.query(
        `UPDATE ingestion_jobs
         SET status = COALESCE($2, status),
             started_at = COALESCE($3::timestamptz, started_at),
             finished_at = COALESCE($4::timestamptz, finished_at),
             processed_count = COALESCE($5, processed_count),
             inserted_count = COALESCE($6, inserted_count),
             deduped_count = COALESCE($7, deduped_count),
             failed_count = COALESCE($8, failed_count),
             error_summary = COALESCE($9, error_summary),
             metadata = COALESCE($10::jsonb, metadata),
             updated_at = NOW()
         WHERE id = $1`,
        [
          id,
          status || null,
          startedAt || null,
          finishedAt || null,
          Number.isFinite(Number(processedCount)) ? Number(processedCount) : null,
          Number.isFinite(Number(insertedCount)) ? Number(insertedCount) : null,
          Number.isFinite(Number(dedupedCount)) ? Number(dedupedCount) : null,
          Number.isFinite(Number(failedCount)) ? Number(failedCount) : null,
          errorSummary || null,
          metadata && typeof metadata === 'object' ? JSON.stringify(metadata) : null
        ]
      );
      cleanupIngestionJobsIfNeeded().catch(() => {});
      return;
    }

    const sqliteDb = getSqliteDb();
    sqliteDb
      .prepare(
        `UPDATE ingestion_jobs
         SET status = COALESCE(?, status),
             started_at = COALESCE(?, started_at),
             finished_at = COALESCE(?, finished_at),
             processed_count = COALESCE(?, processed_count),
             inserted_count = COALESCE(?, inserted_count),
             deduped_count = COALESCE(?, deduped_count),
             failed_count = COALESCE(?, failed_count),
             error_summary = COALESCE(?, error_summary),
             metadata = COALESCE(?, metadata),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        status || null,
        startedAt || null,
        finishedAt || null,
        Number.isFinite(Number(processedCount)) ? Number(processedCount) : null,
        Number.isFinite(Number(insertedCount)) ? Number(insertedCount) : null,
        Number.isFinite(Number(dedupedCount)) ? Number(dedupedCount) : null,
        Number.isFinite(Number(failedCount)) ? Number(failedCount) : null,
        errorSummary || null,
        metadata && typeof metadata === 'object' ? JSON.stringify(metadata) : null,
        id
      );
    cleanupIngestionJobsIfNeeded().catch(() => {});
  }

  async function listIngestionJobs({ jobTypes = [], limit = 20 } = {}) {
    await ensureInitialized();
    await cleanupIngestionJobsIfNeeded();
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
    const normalizedJobTypes = Array.isArray(jobTypes)
      ? jobTypes.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    if (getMode() === 'postgres') {
      const pgPool = getPgPool();
      const params = [];
      let whereClause = '';
      if (normalizedJobTypes.length > 0) {
        const placeholders = normalizedJobTypes.map((_, idx) => `$${idx + 1}`);
        whereClause = `WHERE job_type IN (${placeholders.join(',')})`;
        params.push(...normalizedJobTypes);
      }
      params.push(safeLimit);

      const result = await pgPool.query(
        `SELECT
           id,
           job_type,
           status,
           source,
           started_at,
           finished_at,
           processed_count,
           inserted_count,
           deduped_count,
           failed_count,
           error_summary,
           metadata,
           created_at,
           updated_at
         FROM ingestion_jobs
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
      );
      return result.rows;
    }

    const sqliteDb = getSqliteDb();
    const whereClause = normalizedJobTypes.length > 0 ? `WHERE job_type IN (${normalizedJobTypes.map(() => '?').join(',')})` : '';
    const rows = sqliteDb
      .prepare(
        `SELECT
           id,
           job_type,
           status,
           source,
           started_at,
           finished_at,
           processed_count,
           inserted_count,
           deduped_count,
           failed_count,
           error_summary,
           metadata,
           created_at,
           updated_at
         FROM ingestion_jobs
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(...normalizedJobTypes, safeLimit);

    return rows.map((row) => {
      let metadata = {};
      try {
        metadata = row?.metadata ? JSON.parse(String(row.metadata)) : {};
      } catch {
        metadata = {};
      }
      return { ...row, metadata };
    });
  }

  async function findRecentRunningIngestionJob({ jobTypes = [], withinMinutes = 30 } = {}) {
    await ensureInitialized();
    const safeWithinMinutes = Math.max(1, Math.min(24 * 60, Number(withinMinutes) || 30));
    const normalizedJobTypes = Array.isArray(jobTypes)
      ? jobTypes.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    if (normalizedJobTypes.length === 0) return null;

    if (getMode() === 'postgres') {
      const pgPool = getPgPool();
      const placeholders = normalizedJobTypes.map((_, idx) => `$${idx + 1}`);
      const params = [...normalizedJobTypes, safeWithinMinutes];
      const result = await pgPool.query(
        `SELECT
           id,
           job_type,
           status,
           source,
           started_at,
           finished_at,
           processed_count,
           inserted_count,
           deduped_count,
           failed_count,
           error_summary,
           metadata,
           created_at,
           updated_at
         FROM ingestion_jobs
         WHERE status = 'running'
           AND job_type IN (${placeholders.join(',')})
           AND COALESCE(started_at, created_at) >= NOW() - ($${params.length}::int * INTERVAL '1 minute')
         ORDER BY COALESCE(started_at, created_at) DESC
         LIMIT 1`,
        params
      );
      return result.rows[0] || null;
    }

    const sqliteDb = getSqliteDb();
    const placeholders = normalizedJobTypes.map(() => '?').join(',');
    const row = sqliteDb
      .prepare(
        `SELECT
           id,
           job_type,
           status,
           source,
           started_at,
           finished_at,
           processed_count,
           inserted_count,
           deduped_count,
           failed_count,
           error_summary,
           metadata,
           created_at,
           updated_at
         FROM ingestion_jobs
         WHERE status = 'running'
           AND job_type IN (${placeholders})
           AND datetime(COALESCE(started_at, created_at)) >= datetime('now', '-' || ? || ' minute')
         ORDER BY datetime(COALESCE(started_at, created_at)) DESC
         LIMIT 1`
      )
      .get(...normalizedJobTypes, safeWithinMinutes);
    if (!row) return null;
    try {
      return {
        ...row,
        metadata: row?.metadata ? JSON.parse(String(row.metadata)) : {}
      };
    } catch {
      return {
        ...row,
        metadata: {}
      };
    }
  }

  async function runIngestionJobsMaintenance({ force = false } = {}) {
    await ensureInitialized();
    const cleanup = await cleanupIngestionJobsIfNeeded({ force: Boolean(force) });

    if (getMode() === 'postgres') {
      const pgPool = getPgPool();
      const result = await pgPool.query(
        `SELECT COUNT(*)::int AS c
         FROM ingestion_jobs
         WHERE status = 'running'`
      );
      return {
        ...(cleanup || {}),
        running: Number(result.rows[0]?.c || 0)
      };
    }

    const sqliteDb = getSqliteDb();
    const row = sqliteDb
      .prepare(
        `SELECT COUNT(*) AS c
         FROM ingestion_jobs
         WHERE status = 'running'`
      )
      .get();
    return {
      ...(cleanup || {}),
      running: Number(row?.c || 0)
    };
  }

  return {
    createIngestionJob,
    findRecentRunningIngestionJob,
    listIngestionJobs,
    runIngestionJobsMaintenance,
    updateIngestionJob
  };
}

