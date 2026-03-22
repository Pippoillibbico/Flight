import 'dotenv/config';
import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const SQLITE_DB_PATH = resolve(ROOT, 'data', 'app.db');

function parseArg(name, fallback = null) {
  const prefix = `${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return fallback;
}

function parseBool(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function normalizeMode(modeArg) {
  const raw = String(modeArg || '').trim();
  const normalized = raw
    .trim()
    .toLowerCase();
  if (normalized === 'postgres' || normalized === 'sqlite') {
    return { mode: normalized, explicit: true };
  }
  return {
    mode: String(process.env.DATABASE_URL || '').trim() ? 'postgres' : 'sqlite',
    explicit: false
  };
}

function summarizeSeverity(report) {
  const checks = report?.checks || {};
  const critical =
    checks.schemaErrors === true ||
    toNumber(checks.invalidQuotePriceCount, 0) > 0 ||
    toNumber(checks.publishedDealsMissingQuotes, 0) > 0 ||
    toNumber(checks.publishedDealsMissingRouteStats, 0) > 0 ||
    toNumber(checks.oldRunningJobs, 0) > 0;
  if (critical) return 'CRITICAL';
  if (toNumber(checks.duplicateQuoteFingerprints, 0) > 0 || toNumber(checks.duplicateDealKeys, 0) > 0) return 'WARNING';
  return 'OK';
}

function buildChecks(report) {
  return {
    schemaErrors: Array.isArray(report?.errors) && report.errors.length > 0,
    duplicateQuoteFingerprints: Array.isArray(report?.flightQuotes?.duplicateFingerprintsTop) ? report.flightQuotes.duplicateFingerprintsTop.length : 0,
    duplicateDealKeys: Array.isArray(report?.detectedDeals?.duplicateDealKeysTop) ? report.detectedDeals.duplicateDealKeysTop.length : 0,
    invalidQuotePriceCount: toNumber(report?.flightQuotes?.invalidPriceCount, 0),
    publishedDealsMissingQuotes: toNumber(report?.detectedDeals?.publishedMissingQuotes, 0),
    publishedDealsMissingRouteStats: toNumber(report?.detectedDeals?.publishedMissingRouteStats, 0),
    oldRunningJobs: toNumber(report?.ingestionJobs?.oldRunningCount, 0)
  };
}

async function collectSqlite({ dbPath, oldRunningMinutes }) {
  const sqlite = await import('node:sqlite');
  const db = new sqlite.DatabaseSync(dbPath);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'sqlite',
    dbPath,
    oldRunningMinutes,
    errors: [],
    tables: {},
    flightQuotes: {},
    detectedDeals: {},
    ingestionJobs: {}
  };

  const hasTable = (table) =>
    Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(String(table || '').trim())?.name);
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);

  try {
    report.tables.flight_quotes = hasTable('flight_quotes');
    report.tables.detected_deals = hasTable('detected_deals');
    report.tables.route_price_stats = hasTable('route_price_stats');
    report.tables.ingestion_jobs = hasTable('ingestion_jobs');

    if (report.tables.flight_quotes) {
      report.flightQuotes = {
        total: toNumber(one('SELECT COUNT(*) AS c FROM flight_quotes').c, 0),
        invalidPriceCount: toNumber(one('SELECT COUNT(*) AS c FROM flight_quotes WHERE total_price IS NULL OR total_price <= 0').c, 0),
        unbookableCount: toNumber(one('SELECT COUNT(*) AS c FROM flight_quotes WHERE is_bookable = 0').c, 0),
        duplicateFingerprintsTop: all(
          `SELECT fingerprint AS key, COUNT(*) AS c
           FROM flight_quotes
           GROUP BY fingerprint
           HAVING COUNT(*) > 1
           ORDER BY c DESC
           LIMIT 10`
        )
      };
    }

    if (report.tables.detected_deals) {
      const base = {
        total: toNumber(one('SELECT COUNT(*) AS c FROM detected_deals').c, 0),
        published: toNumber(one("SELECT COUNT(*) AS c FROM detected_deals WHERE status = 'published'").c, 0),
        expiredPublished: toNumber(
          one("SELECT COUNT(*) AS c FROM detected_deals WHERE status = 'published' AND expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')").c,
          0
        ),
        duplicateDealKeysTop: all(
          `SELECT deal_key AS key, COUNT(*) AS c
           FROM detected_deals
           GROUP BY deal_key
           HAVING COUNT(*) > 1
           ORDER BY c DESC
           LIMIT 10`
        ),
        publishedMissingQuotes: 0,
        publishedMissingRouteStats: 0,
        publishedUnbookableQuotes: 0
      };

      if (report.tables.flight_quotes) {
        base.publishedMissingQuotes = toNumber(
          one(
            `SELECT COUNT(*) AS c
             FROM detected_deals d
             LEFT JOIN flight_quotes q ON q.id = d.flight_quote_id
             WHERE d.status = 'published'
               AND q.id IS NULL`
          ).c,
          0
        );

        base.publishedUnbookableQuotes = toNumber(
          one(
            `SELECT COUNT(*) AS c
             FROM detected_deals d
             JOIN flight_quotes q ON q.id = d.flight_quote_id
             WHERE d.status = 'published'
               AND q.is_bookable = 0`
          ).c,
          0
        );

        if (report.tables.route_price_stats) {
          base.publishedMissingRouteStats = toNumber(
            one(
              `SELECT COUNT(*) AS c
               FROM detected_deals d
               JOIN flight_quotes q ON q.id = d.flight_quote_id
               LEFT JOIN route_price_stats s
                 ON s.route_id = q.route_id
                AND s.departure_month = substr(q.departure_date, 1, 7) || '-01'
                AND s.trip_type = q.trip_type
                AND s.cabin_class = q.cabin_class
                AND s.currency = q.currency
               WHERE d.status = 'published'
                 AND s.id IS NULL`
            ).c,
            0
          );
        }
      }

      report.detectedDeals = base;
    }

    if (report.tables.ingestion_jobs) {
      report.ingestionJobs = {
        total: toNumber(one('SELECT COUNT(*) AS c FROM ingestion_jobs').c, 0),
        running: toNumber(one("SELECT COUNT(*) AS c FROM ingestion_jobs WHERE status = 'running'").c, 0),
        pending: toNumber(one("SELECT COUNT(*) AS c FROM ingestion_jobs WHERE status = 'pending'").c, 0),
        oldRunningCount: toNumber(
          one(
            `SELECT COUNT(*) AS c
             FROM ingestion_jobs
             WHERE status = 'running'
               AND (
                 (julianday('now') - julianday(COALESCE(updated_at, started_at, created_at))) * 24 * 60
               ) > ?`,
            oldRunningMinutes
          ).c,
          0
        ),
        bySourceTop: all(
          `SELECT source, COUNT(*) AS c
           FROM ingestion_jobs
           GROUP BY source
           ORDER BY c DESC
           LIMIT 10`
        )
      };
    }
  } catch (error) {
    report.errors.push(error?.message || String(error));
  } finally {
    db.close?.();
  }

  report.checks = buildChecks(report);
  report.severity = summarizeSeverity(report);
  report.ok = report.severity !== 'CRITICAL';
  return report;
}

async function hasPgTable(pool, table) {
  const result = await pool.query(`SELECT to_regclass($1) AS ref`, [`public.${table}`]);
  return Boolean(result.rows[0]?.ref);
}

async function collectPostgres({ oldRunningMinutes }) {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for postgres mode');
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'postgres',
    oldRunningMinutes,
    errors: [],
    tables: {},
    flightQuotes: {},
    detectedDeals: {},
    ingestionJobs: {}
  };

  try {
    report.tables.flight_quotes = await hasPgTable(pool, 'flight_quotes');
    report.tables.detected_deals = await hasPgTable(pool, 'detected_deals');
    report.tables.route_price_stats = await hasPgTable(pool, 'route_price_stats');
    report.tables.ingestion_jobs = await hasPgTable(pool, 'ingestion_jobs');

    if (report.tables.flight_quotes) {
      report.flightQuotes = {
        total: toNumber((await pool.query('SELECT COUNT(*)::int AS c FROM flight_quotes')).rows[0]?.c, 0),
        invalidPriceCount: toNumber((await pool.query('SELECT COUNT(*)::int AS c FROM flight_quotes WHERE total_price IS NULL OR total_price <= 0')).rows[0]?.c, 0),
        unbookableCount: toNumber((await pool.query('SELECT COUNT(*)::int AS c FROM flight_quotes WHERE is_bookable = false')).rows[0]?.c, 0),
        duplicateFingerprintsTop: (
          await pool.query(
            `SELECT fingerprint AS key, COUNT(*)::int AS c
             FROM flight_quotes
             GROUP BY fingerprint
             HAVING COUNT(*) > 1
             ORDER BY c DESC
             LIMIT 10`
          )
        ).rows
      };
    }

    if (report.tables.detected_deals) {
      const base = {
        total: toNumber((await pool.query('SELECT COUNT(*)::int AS c FROM detected_deals')).rows[0]?.c, 0),
        published: toNumber((await pool.query("SELECT COUNT(*)::int AS c FROM detected_deals WHERE status='published'")).rows[0]?.c, 0),
        expiredPublished: toNumber(
          (await pool.query("SELECT COUNT(*)::int AS c FROM detected_deals WHERE status='published' AND expires_at IS NOT NULL AND expires_at < NOW()")).rows[0]?.c,
          0
        ),
        duplicateDealKeysTop: (
          await pool.query(
            `SELECT deal_key AS key, COUNT(*)::int AS c
             FROM detected_deals
             GROUP BY deal_key
             HAVING COUNT(*) > 1
             ORDER BY c DESC
             LIMIT 10`
          )
        ).rows,
        publishedMissingQuotes: 0,
        publishedMissingRouteStats: 0,
        publishedUnbookableQuotes: 0
      };

      if (report.tables.flight_quotes) {
        base.publishedMissingQuotes = toNumber(
          (
            await pool.query(
              `SELECT COUNT(*)::int AS c
               FROM detected_deals d
               LEFT JOIN flight_quotes q ON q.id = d.flight_quote_id
               WHERE d.status='published'
                 AND q.id IS NULL`
            )
          ).rows[0]?.c,
          0
        );

        base.publishedUnbookableQuotes = toNumber(
          (
            await pool.query(
              `SELECT COUNT(*)::int AS c
               FROM detected_deals d
               JOIN flight_quotes q ON q.id = d.flight_quote_id
               WHERE d.status='published'
                 AND q.is_bookable = false`
            )
          ).rows[0]?.c,
          0
        );

        if (report.tables.route_price_stats) {
          base.publishedMissingRouteStats = toNumber(
            (
              await pool.query(
                `SELECT COUNT(*)::int AS c
                 FROM detected_deals d
                 JOIN flight_quotes q ON q.id = d.flight_quote_id
                 LEFT JOIN route_price_stats s
                   ON s.route_id = q.route_id
                  AND s.departure_month = date_trunc('month', q.departure_date)::date
                  AND s.trip_type = q.trip_type
                  AND s.cabin_class = q.cabin_class
                  AND s.currency = q.currency
                 WHERE d.status='published'
                   AND s.id IS NULL`
              )
            ).rows[0]?.c,
            0
          );
        }
      }

      report.detectedDeals = base;
    }

    if (report.tables.ingestion_jobs) {
      report.ingestionJobs = {
        total: toNumber((await pool.query('SELECT COUNT(*)::int AS c FROM ingestion_jobs')).rows[0]?.c, 0),
        running: toNumber((await pool.query("SELECT COUNT(*)::int AS c FROM ingestion_jobs WHERE status='running'")).rows[0]?.c, 0),
        pending: toNumber((await pool.query("SELECT COUNT(*)::int AS c FROM ingestion_jobs WHERE status='pending'")).rows[0]?.c, 0),
        oldRunningCount: toNumber(
          (
            await pool.query(
              `SELECT COUNT(*)::int AS c
               FROM ingestion_jobs
               WHERE status='running'
                 AND NOW() - COALESCE(updated_at, started_at, created_at) > ($1 * INTERVAL '1 minute')`,
              [oldRunningMinutes]
            )
          ).rows[0]?.c,
          0
        ),
        bySourceTop: (
          await pool.query(
            `SELECT source, COUNT(*)::int AS c
             FROM ingestion_jobs
             GROUP BY source
             ORDER BY c DESC
             LIMIT 10`
          )
        ).rows
      };
    }
  } catch (error) {
    report.errors.push(error?.message || String(error));
  } finally {
    await pool.end();
  }

  report.checks = buildChecks(report);
  report.severity = summarizeSeverity(report);
  report.ok = report.severity !== 'CRITICAL';
  return report;
}

async function main() {
  const modeConfig = normalizeMode(parseArg('--mode', null));
  const mode = modeConfig.mode;
  const oldRunningMinutes = Math.max(1, Math.min(24 * 60, toNumber(parseArg('--old-running-minutes', '360'), 360)));
  const outArg = String(parseArg('--out', '') || '').trim();
  const outPath = outArg ? resolve(ROOT, outArg) : null;
  const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const requirePrimary = parseBool(
    parseArg('--require-primary', process.env.SYSTEM_STATE_REPORT_REQUIRE_PRIMARY),
    isProduction
  );

  const sqliteDbPath = String(parseArg('--db', SQLITE_DB_PATH) || SQLITE_DB_PATH);
  let report;
  if (mode === 'postgres') {
    const pgReport = await collectPostgres({ oldRunningMinutes });
    const shouldFallbackToSqlite =
      !modeConfig.explicit &&
      Array.isArray(pgReport?.errors) &&
      pgReport.errors.length > 0 &&
      (!pgReport.tables || Object.keys(pgReport.tables).length === 0);

    if (shouldFallbackToSqlite) {
      report = await collectSqlite({ dbPath: sqliteDbPath, oldRunningMinutes });
      report.fallback = {
        fromMode: 'postgres',
        reason: pgReport.errors[0]
      };
      if (requirePrimary) {
        report.errors = Array.isArray(report.errors) ? report.errors : [];
        report.errors.push('primary_db_unreachable_fallback_not_allowed');
        report.severity = 'CRITICAL';
        report.ok = false;
      }
    } else {
      report = pgReport;
    }
  } else {
    report = await collectSqlite({ dbPath: sqliteDbPath, oldRunningMinutes });
  }

  if (outPath) {
    await mkdir(resolve(outPath, '..'), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify(report, null, 2));
  if (requirePrimary && report?.fallback?.fromMode === 'postgres') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('system-state-report failed:', error?.message || error);
  process.exit(1);
});
