import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger as rootLogger } from './logger.js';

const SQLITE_DB_PATH = fileURLToPath(new URL('../../data/app.db', import.meta.url));

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function confidenceForCount(count) {
  const n = Math.max(0, Number(count) || 0);
  if (n >= 80) return 'high';
  if (n >= 40) return 'medium';
  if (n >= 25) return 'low';
  return 'very_low';
}

function normalizeRouteId(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function createRoutePriceStatsService(options = {}) {
  const forcedMode = String(options.mode || '').trim().toLowerCase();
  let mode = forcedMode === 'postgres' || forcedMode === 'sqlite' ? forcedMode : process.env.DATABASE_URL ? 'postgres' : 'sqlite';
  const logger = options.logger || rootLogger;

  let pgPool = options.pgPool || null;
  let sqliteDb = options.sqliteDb || null;
  let initialized = false;

  async function ensurePostgresSchema() {
    if (!pgPool) {
      pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    }

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS route_price_stats (
        id BIGSERIAL PRIMARY KEY,
        route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        departure_month DATE NOT NULL,
        trip_type TEXT NOT NULL DEFAULT 'round_trip',
        cabin_class TEXT NOT NULL DEFAULT 'economy',
        currency CHAR(3) NOT NULL DEFAULT 'EUR',
        quotes_count INTEGER NOT NULL DEFAULT 0,
        min_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        max_price NUMERIC(10,2) NULL,
        avg_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        avg_price_7d NUMERIC(10,2) NULL,
        avg_price_30d NUMERIC(10,2) NULL,
        median_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        p10_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        p25_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        p75_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        p90_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        stddev_price NUMERIC(12,4) NULL,
        confidence_level TEXT NOT NULL DEFAULT 'low',
        last_quote_at TIMESTAMPTZ NULL,
        computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_route_price_stats_dim UNIQUE (route_id, departure_month, trip_type, cabin_class, currency)
      )
    `);

    await pgPool.query(`
      ALTER TABLE route_price_stats ADD COLUMN IF NOT EXISTS max_price NUMERIC(10,2) NULL;
      ALTER TABLE route_price_stats ADD COLUMN IF NOT EXISTS avg_price_7d NUMERIC(10,2) NULL;
      ALTER TABLE route_price_stats ADD COLUMN IF NOT EXISTS avg_price_30d NUMERIC(10,2) NULL;
    `);

    await pgPool.query(`
      CREATE INDEX IF NOT EXISTS idx_route_price_stats_route_month
        ON route_price_stats(route_id, departure_month DESC);
      CREATE INDEX IF NOT EXISTS idx_route_price_stats_month_confidence
        ON route_price_stats(departure_month, confidence_level);
      CREATE INDEX IF NOT EXISTS idx_route_price_stats_route_computed
        ON route_price_stats(route_id, computed_at DESC);
    `);
  }

  async function ensureSqliteSchema() {
    if (!sqliteDb) {
      await mkdir(dirname(SQLITE_DB_PATH), { recursive: true });
      const sqlite = await import('node:sqlite');
      sqliteDb = new sqlite.DatabaseSync(SQLITE_DB_PATH);
    }

    sqliteDb.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS route_price_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id INTEGER NOT NULL,
        departure_month TEXT NOT NULL,
        trip_type TEXT NOT NULL DEFAULT 'round_trip',
        cabin_class TEXT NOT NULL DEFAULT 'economy',
        currency TEXT NOT NULL DEFAULT 'EUR',
        quotes_count INTEGER NOT NULL DEFAULT 0,
        min_price REAL NOT NULL DEFAULT 0,
        max_price REAL NULL,
        avg_price REAL NOT NULL DEFAULT 0,
        avg_price_7d REAL NULL,
        avg_price_30d REAL NULL,
        median_price REAL NOT NULL DEFAULT 0,
        p10_price REAL NOT NULL DEFAULT 0,
        p25_price REAL NOT NULL DEFAULT 0,
        p75_price REAL NOT NULL DEFAULT 0,
        p90_price REAL NOT NULL DEFAULT 0,
        stddev_price REAL NULL,
        confidence_level TEXT NOT NULL DEFAULT 'low',
        last_quote_at TEXT NULL,
        computed_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (route_id, departure_month, trip_type, cabin_class, currency)
      );
      CREATE INDEX IF NOT EXISTS idx_route_price_stats_route_month
        ON route_price_stats(route_id, departure_month DESC);
      CREATE INDEX IF NOT EXISTS idx_route_price_stats_month_confidence
        ON route_price_stats(departure_month, confidence_level);
      CREATE INDEX IF NOT EXISTS idx_route_price_stats_route_computed
        ON route_price_stats(route_id, computed_at DESC);
    `);

    try { sqliteDb.exec('ALTER TABLE route_price_stats ADD COLUMN max_price REAL NULL'); } catch {}
    try { sqliteDb.exec('ALTER TABLE route_price_stats ADD COLUMN avg_price_7d REAL NULL'); } catch {}
    try { sqliteDb.exec('ALTER TABLE route_price_stats ADD COLUMN avg_price_30d REAL NULL'); } catch {}
  }

  async function ensureInitialized() {
    if (initialized) return;
    mode = forcedMode === 'postgres' || forcedMode === 'sqlite' ? forcedMode : process.env.DATABASE_URL ? 'postgres' : 'sqlite';
    if (mode === 'postgres') await ensurePostgresSchema();
    else await ensureSqliteSchema();
    initialized = true;
  }

  async function refreshPostgres({ routeId = null } = {}) {
    const normalizedRouteId = normalizeRouteId(routeId);
    const tableRes = await pgPool.query("SELECT to_regclass('public.flight_quotes') AS ref");
    if (!tableRes.rows[0]?.ref) {
      return { skipped: true, reason: 'flight_quotes_missing', updatedRows: 0, groupedRows: 0, quoteCount: 0, mode };
    }

    const params = [];
    const routeWhere = normalizedRouteId != null ? 'WHERE fq.route_id = $1' : '';
    if (normalizedRouteId != null) params.push(normalizedRouteId);

    const sql = `
      WITH grouped AS (
        SELECT
          fq.route_id,
          date_trunc('month', fq.departure_date)::date AS departure_month,
          fq.trip_type,
          fq.cabin_class,
          fq.currency,
          COUNT(*)::int AS quotes_count,
          MIN(fq.total_price)::numeric(10,2) AS min_price,
          MAX(fq.total_price)::numeric(10,2) AS max_price,
          AVG(fq.total_price)::numeric(10,2) AS avg_price,
          COALESCE(AVG(fq.total_price) FILTER (WHERE fq.observed_at >= NOW() - INTERVAL '7 days'), AVG(fq.total_price))::numeric(10,2) AS avg_price_7d,
          COALESCE(AVG(fq.total_price) FILTER (WHERE fq.observed_at >= NOW() - INTERVAL '30 days'), AVG(fq.total_price))::numeric(10,2) AS avg_price_30d,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY fq.total_price)::numeric(10,2) AS median_price,
          percentile_cont(0.10) WITHIN GROUP (ORDER BY fq.total_price)::numeric(10,2) AS p10_price,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY fq.total_price)::numeric(10,2) AS p25_price,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY fq.total_price)::numeric(10,2) AS p75_price,
          percentile_cont(0.90) WITHIN GROUP (ORDER BY fq.total_price)::numeric(10,2) AS p90_price,
          stddev_pop(fq.total_price)::numeric(12,4) AS stddev_price,
          MAX(fq.observed_at) AS last_quote_at,
          CASE
            WHEN COUNT(*) >= 80 THEN 'high'
            WHEN COUNT(*) >= 40 THEN 'medium'
            WHEN COUNT(*) >= 25 THEN 'low'
            ELSE 'very_low'
          END AS confidence_level
        FROM flight_quotes fq
        ${routeWhere}
        GROUP BY fq.route_id, date_trunc('month', fq.departure_date)::date, fq.trip_type, fq.cabin_class, fq.currency
      ), upserted AS (
        INSERT INTO route_price_stats (
          route_id, departure_month, trip_type, cabin_class, currency,
          quotes_count, min_price, max_price, avg_price, avg_price_7d, avg_price_30d,
          median_price, p10_price, p25_price, p75_price, p90_price,
          stddev_price, confidence_level, last_quote_at, computed_at
        )
        SELECT
          route_id, departure_month, trip_type, cabin_class, currency,
          quotes_count, min_price, max_price, avg_price, avg_price_7d, avg_price_30d,
          median_price, p10_price, p25_price, p75_price, p90_price,
          stddev_price, confidence_level, last_quote_at, NOW()
        FROM grouped
        ON CONFLICT (route_id, departure_month, trip_type, cabin_class, currency)
        DO UPDATE SET
          quotes_count = EXCLUDED.quotes_count,
          min_price = EXCLUDED.min_price,
          max_price = EXCLUDED.max_price,
          avg_price = EXCLUDED.avg_price,
          avg_price_7d = EXCLUDED.avg_price_7d,
          avg_price_30d = EXCLUDED.avg_price_30d,
          median_price = EXCLUDED.median_price,
          p10_price = EXCLUDED.p10_price,
          p25_price = EXCLUDED.p25_price,
          p75_price = EXCLUDED.p75_price,
          p90_price = EXCLUDED.p90_price,
          stddev_price = EXCLUDED.stddev_price,
          confidence_level = EXCLUDED.confidence_level,
          last_quote_at = EXCLUDED.last_quote_at,
          computed_at = NOW()
        RETURNING 1
      )
      SELECT
        (SELECT COUNT(*)::int FROM grouped) AS grouped_rows,
        (SELECT COUNT(*)::int FROM upserted) AS updated_rows,
        (SELECT COUNT(*)::int FROM flight_quotes fq ${routeWhere}) AS quote_count
    `;

    const result = await pgPool.query(sql, params);
    const row = result.rows[0] || {};
    return {
      skipped: false,
      reason: null,
      updatedRows: Number(row.updated_rows || 0),
      groupedRows: Number(row.grouped_rows || 0),
      quoteCount: Number(row.quote_count || 0),
      mode
    };
  }

  async function refreshSqlite({ routeId = null } = {}) {
    const normalizedRouteId = normalizeRouteId(routeId);
    const table = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='flight_quotes'`).get();
    if (!table?.name) {
      return { skipped: true, reason: 'flight_quotes_missing', updatedRows: 0, groupedRows: 0, quoteCount: 0, mode };
    }

    const where = normalizedRouteId != null ? 'WHERE fq.route_id = ?' : '';
    const params = normalizedRouteId != null ? [normalizedRouteId] : [];

    const grouped = sqliteDb
      .prepare(
        `SELECT
           fq.route_id AS route_id,
           substr(fq.departure_date, 1, 7) || '-01' AS departure_month,
           fq.trip_type AS trip_type,
           fq.cabin_class AS cabin_class,
           fq.currency AS currency,
           COUNT(*) AS quotes_count,
           MIN(fq.total_price) AS min_price,
           MAX(fq.total_price) AS max_price,
           AVG(fq.total_price) AS avg_price,
           AVG(CASE WHEN datetime(fq.observed_at) >= datetime('now', '-7 day') THEN fq.total_price END) AS avg_price_7d,
           AVG(CASE WHEN datetime(fq.observed_at) >= datetime('now', '-30 day') THEN fq.total_price END) AS avg_price_30d,
           MAX(fq.observed_at) AS last_quote_at
         FROM flight_quotes fq
         ${where}
         GROUP BY fq.route_id, substr(fq.departure_date, 1, 7), fq.trip_type, fq.cabin_class, fq.currency`
      )
      .all(...params);

    const upsert = sqliteDb.prepare(
      `INSERT INTO route_price_stats (
         route_id, departure_month, trip_type, cabin_class, currency,
         quotes_count, min_price, max_price, avg_price, avg_price_7d, avg_price_30d,
         median_price, p10_price, p25_price, p75_price, p90_price,
         stddev_price, confidence_level, last_quote_at, computed_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(route_id, departure_month, trip_type, cabin_class, currency)
       DO UPDATE SET
         quotes_count=excluded.quotes_count,
         min_price=excluded.min_price,
         max_price=excluded.max_price,
         avg_price=excluded.avg_price,
         avg_price_7d=excluded.avg_price_7d,
         avg_price_30d=excluded.avg_price_30d,
         median_price=excluded.median_price,
         p10_price=excluded.p10_price,
         p25_price=excluded.p25_price,
         p75_price=excluded.p75_price,
         p90_price=excluded.p90_price,
         stddev_price=excluded.stddev_price,
         confidence_level=excluded.confidence_level,
         last_quote_at=excluded.last_quote_at,
         computed_at=datetime('now')`
    );

    let updatedRows = 0;
    for (const row of grouped) {
      const quotesCount = Number(row.quotes_count || 0);
      const minPrice = round2(row.min_price);
      const maxPrice = round2(row.max_price);
      const avgPrice = round2(row.avg_price);
      const avg7 = row.avg_price_7d == null ? avgPrice : round2(row.avg_price_7d);
      const avg30 = row.avg_price_30d == null ? avgPrice : round2(row.avg_price_30d);

      upsert.run(
        Number(row.route_id),
        String(row.departure_month),
        String(row.trip_type || 'round_trip'),
        String(row.cabin_class || 'economy'),
        String(row.currency || 'EUR'),
        quotesCount,
        minPrice,
        maxPrice,
        avgPrice,
        avg7,
        avg30,
        avgPrice,
        minPrice,
        minPrice,
        maxPrice,
        maxPrice,
        null,
        confidenceForCount(quotesCount),
        row.last_quote_at || null
      );
      updatedRows += 1;
    }

    const quoteCountRow = sqliteDb
      .prepare(`SELECT COUNT(*) AS c FROM flight_quotes fq ${where}`)
      .get(...params);

    return {
      skipped: false,
      reason: null,
      updatedRows,
      groupedRows: grouped.length,
      quoteCount: Number(quoteCountRow?.c || 0),
      mode
    };
  }

  async function refreshRoutePriceStats({ routeId = null } = {}) {
    await ensureInitialized();
    const startedAt = Date.now();
    const normalizedRouteId = normalizeRouteId(routeId);
    const result = mode === 'postgres' ? await refreshPostgres({ routeId: normalizedRouteId }) : await refreshSqlite({ routeId: normalizedRouteId });
    logger.info(
      {
        routeId: normalizedRouteId,
        durationMs: Date.now() - startedAt,
        ...result
      },
      'route_price_stats_refresh_completed'
    );
    return result;
  }

  return {
    refreshRoutePriceStats,
    getMode: () => mode
  };
}

let singleton = null;

export function getRoutePriceStatsService() {
  if (!singleton) singleton = createRoutePriceStatsService();
  return singleton;
}

export async function refreshRoutePriceStats(options = {}) {
  return getRoutePriceStatsService().refreshRoutePriceStats(options);
}
