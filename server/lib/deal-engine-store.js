import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { nanoid } from 'nanoid';

const DB_FILE_URL = new URL('../../data/app.db', import.meta.url);
const DB_FILE_PATH = fileURLToPath(DB_FILE_URL);

let initialized = false;
let sqliteDb = null;
let pgPool = null;

function getMode() {
  return process.env.DATABASE_URL ? 'postgres' : 'sqlite';
}

function toIsoTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('Invalid observed_at.');
  return date.toISOString();
}

function normalizeIata(value, label) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error(`Invalid ${label}. Expected IATA code.`);
  return normalized;
}

function normalizeDate(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Invalid ${label}. Expected YYYY-MM-DD.`);
  return text;
}

function monthFromDate(dateText) {
  return `${dateText.slice(0, 7)}-01`;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function percentileCont(sorted, p) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  const weight = pos - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function buildFingerprint(payload) {
  const parts = [
    payload.originIata,
    payload.destinationIata,
    payload.departureDate,
    payload.returnDate || '',
    payload.currency,
    round2(payload.totalPrice).toFixed(2),
    payload.provider,
    payload.cabinClass,
    payload.tripType,
    payload.observedAt,
    payload.source
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function assertLocalIngestionPolicy({ provider, source }) {
  const p = String(provider || '').toLowerCase();
  const s = String(source || '').toLowerCase();
  const banned = /(skyscanner|google[_\s-]*flights|scrap|crawler|crawl|serp)/i;
  if (banned.test(p) || banned.test(s)) {
    throw new Error('Rejected by ingestion policy: external APIs/scraping are not allowed.');
  }

  // Allow only explicit internal source families.
  const allowedSource = /^(manual|partner_feed|csv_import|csv_manual|api_ingest|seed_script|user_search)([_a-z0-9-]*)$/i;
  if (!allowedSource.test(s)) {
    throw new Error('Rejected by ingestion policy: source must be internal (manual/csv/partner feed).');
  }
}

function confidenceForCount(count) {
  if (count >= 80) return { level: 'high', score: 0.95 };
  if (count >= 40) return { level: 'medium', score: 0.8 };
  if (count >= 25) return { level: 'low', score: 0.6 };
  return { level: 'very_low', score: 0.35 };
}

async function ensurePostgres() {
  if (!pgPool) {
    pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      started_at TIMESTAMPTZ NULL,
      finished_at TIMESTAMPTZ NULL,
      processed_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      deduped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS provider_run_state (
      provider_name TEXT PRIMARY KEY,
      last_success_at TIMESTAMPTZ NULL,
      last_cursor TEXT NULL,
      last_route_batch TEXT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS route_coverage_stats (
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      travel_month DATE NOT NULL,
      observation_count INTEGER NOT NULL,
      confidence_level TEXT NOT NULL,
      last_observed_at TIMESTAMPTZ NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (origin_iata, destination_iata, travel_month)
    );
    CREATE INDEX IF NOT EXISTS idx_route_coverage_month ON route_coverage_stats(travel_month, confidence_level);
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_created_at ON ingestion_jobs(created_at DESC);
  `);
}

async function ensureSqlite() {
  if (sqliteDb) return;
  await mkdir(dirname(DB_FILE_PATH), { recursive: true });
  const sqlite = await import('node:sqlite');
  sqliteDb = new sqlite.DatabaseSync(DB_FILE_PATH);
  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (origin_iata, destination_iata)
    );
    CREATE TABLE IF NOT EXISTS price_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      travel_month TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_price REAL NOT NULL,
      provider TEXT NOT NULL,
      cabin_class TEXT NOT NULL DEFAULT 'economy',
      trip_type TEXT NOT NULL DEFAULT 'round_trip',
      observed_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      fingerprint TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS route_baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      travel_month TEXT NOT NULL,
      avg_price REAL NOT NULL,
      p10_price REAL NOT NULL,
      p25_price REAL NOT NULL,
      p50_price REAL NOT NULL,
      p75_price REAL NOT NULL,
      p90_price REAL NOT NULL,
      observation_count INTEGER NOT NULL,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (route_id, travel_month)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_price_observations_fingerprint
      ON price_observations(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_price_observations_origin_dest_departure
      ON price_observations(origin_iata, destination_iata, departure_date);
    CREATE INDEX IF NOT EXISTS idx_price_observations_route_month
      ON price_observations(route_id, travel_month);
    CREATE INDEX IF NOT EXISTS idx_route_baselines_route_month
      ON route_baselines(route_id, travel_month);
    CREATE TABLE IF NOT EXISTS discovery_alert_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      origin_iata TEXT NOT NULL,
      budget_eur REAL NOT NULL,
      mood TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT 'all',
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS discovery_notification_dedupe (
      dedupe_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      observation_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS discovery_worker_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_observed_at TEXT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_discovery_subscriptions_user
      ON discovery_alert_subscriptions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_discovery_subscriptions_match
      ON discovery_alert_subscriptions(origin_iata, region, enabled, date_from, date_to);
    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      started_at TEXT NULL,
      finished_at TEXT NULL,
      processed_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      deduped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_created_at ON ingestion_jobs(created_at DESC);
    CREATE TABLE IF NOT EXISTS provider_run_state (
      provider_name TEXT PRIMARY KEY,
      last_success_at TEXT NULL,
      last_cursor TEXT NULL,
      last_route_batch TEXT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS route_coverage_stats (
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      travel_month TEXT NOT NULL,
      observation_count INTEGER NOT NULL,
      confidence_level TEXT NOT NULL,
      last_observed_at TEXT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (origin_iata, destination_iata, travel_month)
    );
    CREATE INDEX IF NOT EXISTS idx_route_coverage_month ON route_coverage_stats(travel_month, confidence_level);
  `);
}

async function ensureInitialized() {
  if (initialized) return;
  if (getMode() === 'postgres') await ensurePostgres();
  else await ensureSqlite();
  initialized = true;
}

async function upsertRoute({ originIata, destinationIata }) {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `INSERT INTO routes (origin_iata, destination_iata, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (origin_iata, destination_iata)
       DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [originIata, destinationIata]
    );
    return Number(result.rows[0]?.id);
  }
  const row = sqliteDb
    .prepare(
      `INSERT INTO routes (origin_iata, destination_iata, created_at, updated_at)
       VALUES (?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(origin_iata, destination_iata) DO UPDATE SET updated_at=datetime('now')
       RETURNING id`
    )
    .get(originIata, destinationIata);
  return Number(row?.id);
}

function normalizeObservation(payload) {
  const originIata = normalizeIata(payload.origin_iata || payload.originIata, 'origin_iata');
  const destinationIata = normalizeIata(payload.destination_iata || payload.destinationIata, 'destination_iata');
  const departureDate = normalizeDate(payload.departure_date || payload.departureDate, 'departure_date');
  const rawReturn = payload.return_date || payload.returnDate;
  const returnDate = rawReturn ? normalizeDate(rawReturn, 'return_date') : null;
  const totalPrice = Number(payload.total_price ?? payload.totalPrice);
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) throw new Error('Invalid total_price.');
  if (totalPrice < 5 || totalPrice > 20000) throw new Error('Invalid total_price. Expected value between 5 and 20000 EUR.');

  const currency = String(payload.currency || 'EUR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency. Expected ISO code.');
  const provider = String(payload.provider || 'partner_feed').trim();
  const cabinClass = String(payload.cabin_class || payload.cabinClass || 'economy').trim().toLowerCase();
  const tripType = String(payload.trip_type || payload.tripType || (returnDate ? 'round_trip' : 'one_way')).trim().toLowerCase();
  const source = String(payload.source || 'manual').trim().toLowerCase();
  const observedAt = toIsoTimestamp(payload.observed_at || payload.observedAt);
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

  if (returnDate) {
    const from = new Date(`${departureDate}T00:00:00Z`);
    const to = new Date(`${returnDate}T00:00:00Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new Error('Invalid return_date. Expected a date later than departure_date.');
    }
  }
  if (tripType === 'one_way' && returnDate) throw new Error('Invalid trip_type. one_way cannot include return_date.');
  if (tripType === 'round_trip' && !returnDate) throw new Error('Invalid trip_type. round_trip requires return_date.');

  assertLocalIngestionPolicy({ provider, source });

  const normalized = {
    originIata,
    destinationIata,
    departureDate,
    returnDate,
    travelMonth: monthFromDate(departureDate),
    currency,
    totalPrice: round2(totalPrice),
    provider,
    cabinClass,
    tripType,
    observedAt,
    source,
    metadata
  };

  return {
    ...normalized,
    fingerprint: String(payload.fingerprint || '').trim() || buildFingerprint(normalized)
  };
}

export async function initDealEngineStore() {
  await ensureInitialized();
}

export async function ingestPriceObservation(payload) {
  const normalized = normalizeObservation(payload);
  const routeId = await upsertRoute(normalized);
  await ensureInitialized();

  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `INSERT INTO price_observations (
         route_id, origin_iata, destination_iata, departure_date, return_date, travel_month,
         currency, total_price, provider, cabin_class, trip_type, observed_at, source, fingerprint, metadata, created_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       ON CONFLICT (fingerprint) DO NOTHING
       RETURNING id`,
      [
        routeId,
        normalized.originIata,
        normalized.destinationIata,
        normalized.departureDate,
        normalized.returnDate,
        normalized.travelMonth,
        normalized.currency,
        normalized.totalPrice,
        normalized.provider,
        normalized.cabinClass,
        normalized.tripType,
        normalized.observedAt,
        normalized.source,
        normalized.fingerprint,
        JSON.stringify(normalized.metadata)
      ]
    );
    return {
      inserted: Boolean(result.rows[0]),
      id: result.rows[0]?.id || null,
      routeId,
      fingerprint: normalized.fingerprint
    };
  }

  const row = sqliteDb
    .prepare(
      `INSERT OR IGNORE INTO price_observations (
         route_id, origin_iata, destination_iata, departure_date, return_date, travel_month,
         currency, total_price, provider, cabin_class, trip_type, observed_at, source, fingerprint, metadata, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       RETURNING id`
    )
    .get(
      routeId,
      normalized.originIata,
      normalized.destinationIata,
      normalized.departureDate,
      normalized.returnDate,
      normalized.travelMonth,
      normalized.currency,
      normalized.totalPrice,
      normalized.provider,
      normalized.cabinClass,
      normalized.tripType,
      normalized.observedAt,
      normalized.source,
      normalized.fingerprint,
      JSON.stringify(normalized.metadata)
    );

  return {
    inserted: Boolean(row?.id),
    id: row?.id || null,
    routeId,
    fingerprint: normalized.fingerprint
  };
}

export async function recomputeRouteBaselines() {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `WITH agg AS (
         SELECT
           route_id,
           origin_iata,
           destination_iata,
           travel_month,
           AVG(total_price)::numeric(10,2) AS avg_price,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p10_price,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p25_price,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p50_price,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p75_price,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p90_price,
           COUNT(*)::int AS observation_count
         FROM price_observations
         GROUP BY route_id, origin_iata, destination_iata, travel_month
       )
       INSERT INTO route_baselines (
         route_id, origin_iata, destination_iata, travel_month, avg_price,
         p10_price, p25_price, p50_price, p75_price, p90_price, observation_count, computed_at
       )
       SELECT
         route_id, origin_iata, destination_iata, travel_month, avg_price,
         p10_price, p25_price, p50_price, p75_price, p90_price, observation_count, NOW()
       FROM agg
       ON CONFLICT (route_id, travel_month)
       DO UPDATE SET
         avg_price = EXCLUDED.avg_price,
         p10_price = EXCLUDED.p10_price,
         p25_price = EXCLUDED.p25_price,
         p50_price = EXCLUDED.p50_price,
         p75_price = EXCLUDED.p75_price,
         p90_price = EXCLUDED.p90_price,
         observation_count = EXCLUDED.observation_count,
         computed_at = NOW()`
    );
    const countResult = await pgPool.query('SELECT COUNT(*)::int AS value FROM route_baselines');
    return {
      recomputed: true,
      upsertedRows: Number(result.rowCount || 0),
      baselineRows: Number(countResult.rows[0]?.value || 0)
    };
  }

  const observations = sqliteDb
    .prepare(
      `SELECT route_id, origin_iata, destination_iata, travel_month, total_price
       FROM price_observations`
    )
    .all();

  const grouped = new Map();
  for (const row of observations) {
    const key = `${row.route_id}|${row.travel_month}`;
    if (!grouped.has(key)) grouped.set(key, { ...row, prices: [] });
    grouped.get(key).prices.push(Number(row.total_price));
  }

  const upsertStmt = sqliteDb.prepare(
    `INSERT INTO route_baselines (
       route_id, origin_iata, destination_iata, travel_month, avg_price,
       p10_price, p25_price, p50_price, p75_price, p90_price, observation_count, computed_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(route_id, travel_month) DO UPDATE SET
       avg_price=excluded.avg_price,
       p10_price=excluded.p10_price,
       p25_price=excluded.p25_price,
       p50_price=excluded.p50_price,
       p75_price=excluded.p75_price,
       p90_price=excluded.p90_price,
       observation_count=excluded.observation_count,
       computed_at=datetime('now')`
  );

  let upserts = 0;
  for (const group of grouped.values()) {
    const prices = group.prices.sort((a, b) => a - b);
    const avg = prices.reduce((sum, v) => sum + v, 0) / prices.length;
    upsertStmt.run(
      group.route_id,
      group.origin_iata,
      group.destination_iata,
      group.travel_month,
      round2(avg),
      round2(percentileCont(prices, 0.1)),
      round2(percentileCont(prices, 0.25)),
      round2(percentileCont(prices, 0.5)),
      round2(percentileCont(prices, 0.75)),
      round2(percentileCont(prices, 0.9)),
      prices.length
    );
    upserts += 1;
  }

  const baselineRows = sqliteDb.prepare('SELECT COUNT(*) AS value FROM route_baselines').get()?.value || 0;
  return {
    recomputed: true,
    upsertedRows: upserts,
    baselineRows: Number(baselineRows)
  };
}

async function getBaseline({ originIata, destinationIata, travelMonth }) {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `SELECT route_id, origin_iata, destination_iata, travel_month,
              avg_price, p10_price, p25_price, p50_price, p75_price, p90_price, observation_count
       FROM route_baselines
       WHERE origin_iata = $1 AND destination_iata = $2 AND travel_month = $3
       LIMIT 1`,
      [originIata, destinationIata, travelMonth]
    );
    return result.rows[0] || null;
  }
  return (
    sqliteDb
      .prepare(
        `SELECT route_id, origin_iata, destination_iata, travel_month,
                avg_price, p10_price, p25_price, p50_price, p75_price, p90_price, observation_count
         FROM route_baselines
         WHERE origin_iata = ? AND destination_iata = ? AND travel_month = ?
         LIMIT 1`
      )
      .get(originIata, destinationIata, travelMonth) || null
  );
}

export async function getRouteBaselinePercentiles({ originIata, destinationIata, travelMonth }) {
  const origin = normalizeIata(originIata, 'originIata');
  const destination = normalizeIata(destinationIata, 'destinationIata');
  const month = normalizeDate(travelMonth, 'travelMonth');
  const row = await getBaseline({ originIata: origin, destinationIata: destination, travelMonth: month });
  if (!row) return null;
  return {
    route_id: Number(row.route_id || 0),
    origin_iata: String(row.origin_iata || origin),
    destination_iata: String(row.destination_iata || destination),
    travel_month: String(row.travel_month || month),
    p10_price: Number(row.p10_price),
    p25_price: Number(row.p25_price),
    p50_price: Number(row.p50_price),
    p75_price: Number(row.p75_price),
    p90_price: Number(row.p90_price),
    observation_count: Number(row.observation_count || 0)
  };
}

export async function scoreDeal({ origin, destination, departureDate, price }) {
  const originIata = normalizeIata(origin, 'origin');
  const destinationIata = normalizeIata(destination, 'destination');
  const departure = normalizeDate(departureDate, 'departureDate');
  const requestedPrice = Number(price);
  if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) throw new Error('Invalid price.');

  const travelMonth = monthFromDate(departure);
  const baseline = await getBaseline({ originIata, destinationIata, travelMonth });
  if (!baseline) {
    return {
      dealLevel: 'unknown',
      dealScore: 50,
      why: 'No baseline available for this route/month yet.',
      confidence: { level: 'very_low', score: 0.2, observationCount: 0 }
    };
  }

  const p10 = Number(baseline.p10_price);
  const p25 = Number(baseline.p25_price);
  const p50 = Number(baseline.p50_price);
  const p75 = Number(baseline.p75_price);
  const p90 = Number(baseline.p90_price);
  const count = Number(baseline.observation_count || 0);
  const safeRange = Math.max(1, p90 - p10);
  const normalized = clamp((p90 - requestedPrice) / safeRange, 0, 1);
  const dealScore = Math.round(normalized * 100);

  let dealLevel = 'bad';
  if (requestedPrice <= p10) dealLevel = 'scream';
  else if (requestedPrice <= p25) dealLevel = 'great';
  else if (requestedPrice <= p50) dealLevel = 'good';
  else if (requestedPrice <= p75) dealLevel = 'fair';

  const confidence = confidenceForCount(count);
  const delta = round2(p50 - requestedPrice);
  const sign = delta >= 0 ? 'below' : 'above';
  const savingPct = p50 > 0 ? Math.round(((p50 - requestedPrice) / p50) * 10000) / 100 : 0;

  return {
    dealLevel,
    dealScore,
    why: `Price is ${Math.abs(delta).toFixed(2)} ${sign} route median (${p50.toFixed(2)}) for ${travelMonth}.`,
    baselineMedian: round2(p50),
    savingPct,
    confidence: {
      level: confidence.level,
      score: confidence.score,
      observationCount: count
    }
  };
}

export async function listRouteBaselinesForOrigin({ originIata, fromMonth, toMonth }) {
  await ensureInitialized();
  const origin = normalizeIata(originIata, 'originIata');
  const from = normalizeDate(fromMonth, 'fromMonth');
  const to = normalizeDate(toMonth, 'toMonth');

  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `SELECT route_id, origin_iata, destination_iata, travel_month,
              avg_price, p10_price, p25_price, p50_price, p75_price, p90_price, observation_count
       FROM route_baselines
       WHERE origin_iata = $1
         AND travel_month >= $2
         AND travel_month <= $3`,
      [origin, from, to]
    );
    return result.rows;
  }

  return sqliteDb
    .prepare(
      `SELECT route_id, origin_iata, destination_iata, travel_month,
              avg_price, p10_price, p25_price, p50_price, p75_price, p90_price, observation_count
       FROM route_baselines
       WHERE origin_iata = ?
         AND travel_month >= ?
         AND travel_month <= ?`
    )
    .all(origin, from, to);
}

export async function listPriceObservationsSince({ observedAfter = null, limit = 500 } = {}) {
  await ensureInitialized();
  const maxRows = Math.max(1, Math.min(2000, Number(limit) || 500));
  if (getMode() === 'postgres') {
    if (observedAfter) {
      const result = await pgPool.query(
        `SELECT id, origin_iata, destination_iata, departure_date, return_date, travel_month, total_price, currency, provider, cabin_class, trip_type, metadata, observed_at, fingerprint
         FROM price_observations
         WHERE observed_at > $1
         ORDER BY observed_at ASC
         LIMIT $2`,
        [observedAfter, maxRows]
      );
      return result.rows;
    }
    const result = await pgPool.query(
      `SELECT id, origin_iata, destination_iata, departure_date, return_date, travel_month, total_price, currency, provider, cabin_class, trip_type, metadata, observed_at, fingerprint
       FROM price_observations
       ORDER BY observed_at ASC
       LIMIT $1`,
      [maxRows]
    );
    return result.rows;
  }

  if (observedAfter) {
    return sqliteDb
      .prepare(
        `SELECT id, origin_iata, destination_iata, departure_date, return_date, travel_month, total_price, currency, provider, cabin_class, trip_type, metadata, observed_at, fingerprint
         FROM price_observations
         WHERE observed_at > ?
         ORDER BY observed_at ASC
         LIMIT ?`
      )
      .all(observedAfter, maxRows);
  }

  return sqliteDb
    .prepare(
      `SELECT id, origin_iata, destination_iata, departure_date, return_date, travel_month, total_price, currency, provider, cabin_class, trip_type, metadata, observed_at, fingerprint
       FROM price_observations
       ORDER BY observed_at ASC
       LIMIT ?`
    )
    .all(maxRows);
}

export async function createDiscoverySubscription({ userId, originIata, budgetEur, mood, region, dateFrom, dateTo, enabled = true }) {
  await ensureInitialized();
  const payload = {
    id: nanoid(16),
    userId: String(userId),
    originIata: normalizeIata(originIata, 'originIata'),
    budgetEur: round2(Number(budgetEur)),
    mood: String(mood || 'relax').trim().toLowerCase(),
    region: String(region || 'all').trim().toLowerCase(),
    dateFrom: normalizeDate(dateFrom, 'dateFrom'),
    dateTo: normalizeDate(dateTo, 'dateTo'),
    enabled: Boolean(enabled)
  };

  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `INSERT INTO discovery_alert_subscriptions
         (id, user_id, origin_iata, budget_eur, mood, region, date_from, date_to, enabled, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
       RETURNING *`,
      [payload.id, payload.userId, payload.originIata, payload.budgetEur, payload.mood, payload.region, payload.dateFrom, payload.dateTo, payload.enabled]
    );
    return result.rows[0];
  }

  sqliteDb
    .prepare(
      `INSERT INTO discovery_alert_subscriptions
         (id, user_id, origin_iata, budget_eur, mood, region, date_from, date_to, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .run(payload.id, payload.userId, payload.originIata, payload.budgetEur, payload.mood, payload.region, payload.dateFrom, payload.dateTo, payload.enabled ? 1 : 0);
  return payload;
}

export async function listDiscoverySubscriptions(userId) {
  await ensureInitialized();
  const id = String(userId);
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `SELECT * FROM discovery_alert_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    return result.rows;
  }
  return sqliteDb
    .prepare(`SELECT * FROM discovery_alert_subscriptions WHERE user_id = ? ORDER BY created_at DESC`)
    .all(id)
    .map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
}

export async function deleteDiscoverySubscription({ userId, subscriptionId }) {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `DELETE FROM discovery_alert_subscriptions WHERE id = $1 AND user_id = $2 RETURNING id`,
      [subscriptionId, String(userId)]
    );
    return Boolean(result.rows[0]);
  }
  const result = sqliteDb
    .prepare(`DELETE FROM discovery_alert_subscriptions WHERE id = ? AND user_id = ?`)
    .run(subscriptionId, String(userId));
  return Number(result.changes || 0) > 0;
}

export async function listActiveDiscoverySubscriptions() {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    const result = await pgPool.query(`SELECT * FROM discovery_alert_subscriptions WHERE enabled = true`);
    return result.rows;
  }
  return sqliteDb
    .prepare(`SELECT * FROM discovery_alert_subscriptions WHERE enabled = 1`)
    .all()
    .map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
}

export async function getDiscoveryWorkerCursor() {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    const result = await pgPool.query(`SELECT last_observed_at FROM discovery_worker_state WHERE id = 1`);
    return result.rows[0]?.last_observed_at || null;
  }
  const row = sqliteDb.prepare(`SELECT last_observed_at FROM discovery_worker_state WHERE id = 1`).get();
  return row?.last_observed_at || null;
}

export async function setDiscoveryWorkerCursor(lastObservedAt) {
  await ensureInitialized();
  const iso = toIsoTimestamp(lastObservedAt);
  if (getMode() === 'postgres') {
    await pgPool.query(
      `INSERT INTO discovery_worker_state (id, last_observed_at, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET last_observed_at = EXCLUDED.last_observed_at, updated_at = NOW()`,
      [iso]
    );
    return;
  }
  sqliteDb
    .prepare(
      `INSERT INTO discovery_worker_state (id, last_observed_at, updated_at)
       VALUES (1, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET last_observed_at=excluded.last_observed_at, updated_at=datetime('now')`
    )
    .run(iso);
}

export async function claimDiscoveryDedupe({ dedupeKey, userId, subscriptionId, observationFingerprint }) {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `INSERT INTO discovery_notification_dedupe
         (dedupe_key, user_id, subscription_id, observation_fingerprint, created_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING dedupe_key`,
      [dedupeKey, String(userId), String(subscriptionId), String(observationFingerprint)]
    );
    return Boolean(result.rows[0]);
  }
  const row = sqliteDb
    .prepare(
      `INSERT OR IGNORE INTO discovery_notification_dedupe
         (dedupe_key, user_id, subscription_id, observation_fingerprint, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       RETURNING dedupe_key`
    )
    .get(dedupeKey, String(userId), String(subscriptionId), String(observationFingerprint));
  return Boolean(row?.dedupe_key);
}

function coverageLevelForCount(count) {
  const n = Number(count) || 0;
  if (n >= 80) return 'high';
  if (n >= 40) return 'medium';
  if (n >= 25) return 'low';
  return 'very_low';
}

function monthStartText(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

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

async function tableExists(tableName) {
  const normalized = String(tableName || '').trim().toLowerCase();
  if (!normalized) return false;
  await ensureInitialized();
  if (getMode() === 'postgres') {
    const result = await pgPool.query('SELECT to_regclass($1) AS ref', [`public.${normalized}`]);
    return Boolean(result.rows[0]?.ref);
  }
  const row = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(normalized);
  return Boolean(row?.name);
}

export async function createIngestionJob({ jobType, source, status = 'queued', metadata = null }) {
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
    await pgPool.query(
      `INSERT INTO ingestion_jobs
       (id, job_type, status, source, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`,
      [payload.id, payload.jobType, payload.status, payload.source, JSON.stringify(payload.metadata)]
    );
    cleanupIngestionJobsIfNeeded().catch(() => {});
    return payload;
  }
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

export async function updateIngestionJob({
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

export async function listIngestionJobs({ jobTypes = [], limit = 20 } = {}) {
  await ensureInitialized();
  await cleanupIngestionJobsIfNeeded();
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  const normalizedJobTypes = Array.isArray(jobTypes)
    ? jobTypes.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  if (getMode() === 'postgres') {
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

  const whereClause = normalizedJobTypes.length > 0
    ? `WHERE job_type IN (${normalizedJobTypes.map(() => '?').join(',')})`
    : '';
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

export async function findRecentRunningIngestionJob({ jobTypes = [], withinMinutes = 30 } = {}) {
  await ensureInitialized();
  const safeWithinMinutes = Math.max(1, Math.min(24 * 60, Number(withinMinutes) || 30));
  const normalizedJobTypes = Array.isArray(jobTypes)
    ? jobTypes.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (normalizedJobTypes.length === 0) return null;

  if (getMode() === 'postgres') {
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

export async function runIngestionJobsMaintenance({ force = false } = {}) {
  await ensureInitialized();
  const cleanup = await cleanupIngestionJobsIfNeeded({ force: Boolean(force) });

  if (getMode() === 'postgres') {
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

export async function upsertProviderRunState({ providerName, lastSuccessAt = null, lastCursor = null, lastRouteBatch = null }) {
  await ensureInitialized();
  const provider = String(providerName || '').trim().toLowerCase();
  if (!provider) return;
  if (getMode() === 'postgres') {
    await pgPool.query(
      `INSERT INTO provider_run_state (provider_name, last_success_at, last_cursor, last_route_batch, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (provider_name) DO UPDATE SET
         last_success_at = COALESCE(EXCLUDED.last_success_at, provider_run_state.last_success_at),
         last_cursor = COALESCE(EXCLUDED.last_cursor, provider_run_state.last_cursor),
         last_route_batch = COALESCE(EXCLUDED.last_route_batch, provider_run_state.last_route_batch),
         updated_at = NOW()`,
      [provider, lastSuccessAt || null, lastCursor || null, lastRouteBatch || null]
    );
    return;
  }
  sqliteDb
    .prepare(
      `INSERT INTO provider_run_state (provider_name, last_success_at, last_cursor, last_route_batch, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(provider_name) DO UPDATE SET
         last_success_at=COALESCE(excluded.last_success_at, provider_run_state.last_success_at),
         last_cursor=COALESCE(excluded.last_cursor, provider_run_state.last_cursor),
         last_route_batch=COALESCE(excluded.last_route_batch, provider_run_state.last_route_batch),
         updated_at=datetime('now')`
    )
    .run(provider, lastSuccessAt || null, lastCursor || null, lastRouteBatch || null);
}

export async function getProviderRunStates() {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    const result = await pgPool.query('SELECT * FROM provider_run_state ORDER BY provider_name ASC');
    return result.rows;
  }
  return sqliteDb.prepare('SELECT * FROM provider_run_state ORDER BY provider_name ASC').all();
}

export async function listPopularRoutePairs({ limit = 200 } = {}) {
  await ensureInitialized();
  const maxRows = Math.max(1, Math.min(1000, Number(limit) || 200));
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `SELECT origin_iata, destination_iata, COUNT(*)::int AS observations
       FROM price_observations
       GROUP BY origin_iata, destination_iata
       ORDER BY observations DESC
       LIMIT $1`,
      [maxRows]
    );
    return result.rows.map((row) => ({
      originIata: String(row.origin_iata),
      destinationIata: String(row.destination_iata),
      observations: Number(row.observations || 0)
    }));
  }
  const rows = sqliteDb
    .prepare(
      `SELECT origin_iata, destination_iata, COUNT(*) AS observations
       FROM price_observations
       GROUP BY origin_iata, destination_iata
       ORDER BY observations DESC
       LIMIT ?`
    )
    .all(maxRows);
  return rows.map((row) => ({
    originIata: String(row.origin_iata),
    destinationIata: String(row.destination_iata),
    observations: Number(row.observations || 0)
  }));
}

export async function listRouteIntelligenceSignals({ limit = 300, lookbackDays = 45, seasonMonth = null } = {}) {
  await ensureInitialized();
  const maxRows = Math.max(1, Math.min(3000, Number(limit) || 300));
  const safeLookbackDays = Math.max(14, Math.min(180, Number(lookbackDays) || 45));
  const seasonMonthText = normalizeDate(seasonMonth || monthStartText(new Date()), 'seasonMonth');

  let coreRows = [];
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `
        WITH price_window AS (
          SELECT
            po.origin_iata,
            po.destination_iata,
            COUNT(*)::int AS observations,
            AVG(po.total_price)::numeric(12,4) AS avg_price,
            MIN(po.total_price)::numeric(12,4) AS min_price,
            MAX(po.total_price)::numeric(12,4) AS max_price,
            AVG(po.total_price) FILTER (WHERE po.observed_at >= NOW() - INTERVAL '7 day')::numeric(12,4) AS avg_7d,
            AVG(po.total_price) FILTER (WHERE po.observed_at < NOW() - INTERVAL '7 day')::numeric(12,4) AS avg_prev,
            SUM(CASE WHEN po.travel_month = $3::date THEN 1 ELSE 0 END)::int AS month_observations
          FROM price_observations po
          WHERE po.observed_at >= NOW() - ($2 * INTERVAL '1 day')
          GROUP BY po.origin_iata, po.destination_iata
        ),
        season_base AS (
          SELECT
            src.origin_iata,
            src.destination_iata,
            AVG(src.month_count)::numeric(12,4) AS avg_month_observations
          FROM (
            SELECT origin_iata, destination_iata, travel_month, COUNT(*)::numeric AS month_count
            FROM price_observations
            GROUP BY origin_iata, destination_iata, travel_month
          ) src
          GROUP BY src.origin_iata, src.destination_iata
        )
        SELECT
          pw.origin_iata,
          pw.destination_iata,
          pw.observations,
          CASE
            WHEN COALESCE(pw.avg_price, 0) > 0 THEN ((pw.max_price - pw.min_price) / pw.avg_price) * 100
            ELSE 0
          END AS volatility_pct,
          CASE
            WHEN COALESCE(pw.avg_prev, 0) > 0 AND COALESCE(pw.avg_7d, 0) > 0 THEN ((pw.avg_prev - pw.avg_7d) / pw.avg_prev) * 100
            ELSE 0
          END AS recent_drop_pct,
          CASE
            WHEN COALESCE(sb.avg_month_observations, 0) > 0 THEN pw.month_observations::numeric / sb.avg_month_observations
            ELSE 1
          END AS seasonality_factor
        FROM price_window pw
        LEFT JOIN season_base sb
          ON sb.origin_iata = pw.origin_iata
         AND sb.destination_iata = pw.destination_iata
        ORDER BY pw.observations DESC, recent_drop_pct DESC
        LIMIT $1
      `,
      [maxRows, safeLookbackDays, seasonMonthText]
    );
    coreRows = result.rows || [];
  } else {
    coreRows = sqliteDb
      .prepare(
        `
          WITH price_window AS (
            SELECT
              po.origin_iata AS origin_iata,
              po.destination_iata AS destination_iata,
              COUNT(*) AS observations,
              AVG(po.total_price) AS avg_price,
              MIN(po.total_price) AS min_price,
              MAX(po.total_price) AS max_price,
              AVG(CASE WHEN datetime(po.observed_at) >= datetime('now', '-7 day') THEN po.total_price END) AS avg_7d,
              AVG(CASE WHEN datetime(po.observed_at) < datetime('now', '-7 day') THEN po.total_price END) AS avg_prev,
              SUM(CASE WHEN po.travel_month = ? THEN 1 ELSE 0 END) AS month_observations
            FROM price_observations po
            WHERE datetime(po.observed_at) >= datetime('now', '-' || ? || ' day')
            GROUP BY po.origin_iata, po.destination_iata
          ),
          season_base AS (
            SELECT
              src.origin_iata AS origin_iata,
              src.destination_iata AS destination_iata,
              AVG(src.month_count) AS avg_month_observations
            FROM (
              SELECT origin_iata, destination_iata, travel_month, COUNT(*) AS month_count
              FROM price_observations
              GROUP BY origin_iata, destination_iata, travel_month
            ) src
            GROUP BY src.origin_iata, src.destination_iata
          )
          SELECT
            pw.origin_iata,
            pw.destination_iata,
            pw.observations,
            CASE
              WHEN COALESCE(pw.avg_price, 0) > 0 THEN ((pw.max_price - pw.min_price) / pw.avg_price) * 100
              ELSE 0
            END AS volatility_pct,
            CASE
              WHEN COALESCE(pw.avg_prev, 0) > 0 AND COALESCE(pw.avg_7d, 0) > 0 THEN ((pw.avg_prev - pw.avg_7d) / pw.avg_prev) * 100
              ELSE 0
            END AS recent_drop_pct,
            CASE
              WHEN COALESCE(sb.avg_month_observations, 0) > 0 THEN CAST(pw.month_observations AS REAL) / sb.avg_month_observations
              ELSE 1
            END AS seasonality_factor
          FROM price_window pw
          LEFT JOIN season_base sb
            ON sb.origin_iata = pw.origin_iata
           AND sb.destination_iata = pw.destination_iata
          ORDER BY pw.observations DESC, recent_drop_pct DESC
          LIMIT ?
        `
      )
      .all(seasonMonthText, safeLookbackDays, maxRows);
  }

  const outMap = new Map();
  for (const row of coreRows) {
    const origin = String(row?.origin_iata || '').trim().toUpperCase();
    const destination = String(row?.destination_iata || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) continue;
    const key = `${origin}-${destination}`;
    outMap.set(key, {
      originIata: origin,
      destinationIata: destination,
      observations: Math.max(0, Math.floor(toNumber(row?.observations, 0))),
      volatilityPct: toNumber(row?.volatility_pct, 0),
      recentDropPct: toNumber(row?.recent_drop_pct, 0),
      seasonalityFactor: Math.max(0, toNumber(row?.seasonality_factor, 1)),
      userSignalScore: 0
    });
  }

  if (await tableExists('user_events')) {
    let signalRows = [];
    if (getMode() === 'postgres') {
      const result = await pgPool.query(
        `
          SELECT
            r.origin_iata,
            r.destination_iata,
            SUM(
              CASE
                WHEN LOWER(ue.event_type) LIKE '%book%' OR LOWER(ue.event_type) LIKE '%purchase%' OR LOWER(ue.event_type) LIKE '%checkout%' THEN 6
                WHEN LOWER(ue.event_type) LIKE '%save%' OR LOWER(ue.event_type) LIKE '%watch%' OR LOWER(ue.event_type) LIKE '%alert%' THEN 3
                WHEN LOWER(ue.event_type) LIKE '%click%' OR LOWER(ue.event_type) LIKE '%open%' OR LOWER(ue.event_type) LIKE '%view%' THEN 1.5
                ELSE 1
              END
            )::numeric(12,2) AS user_signal_score
          FROM user_events ue
          JOIN routes r
            ON r.id = COALESCE(
              ue.route_id,
              CASE
                WHEN (ue.payload ->> 'route_id') ~ '^[0-9]+$' THEN NULLIF((ue.payload ->> 'route_id')::bigint, 0)
                ELSE NULL
              END
            )
          WHERE ue.event_ts >= NOW() - ($2 * INTERVAL '1 day')
          GROUP BY r.origin_iata, r.destination_iata
          ORDER BY user_signal_score DESC
          LIMIT $1
        `,
        [maxRows, safeLookbackDays]
      );
      signalRows = result.rows || [];
    } else {
      signalRows = sqliteDb
        .prepare(
          `
            SELECT
              r.origin_iata AS origin_iata,
              r.destination_iata AS destination_iata,
              SUM(
                CASE
                  WHEN LOWER(ue.event_type) LIKE '%book%' OR LOWER(ue.event_type) LIKE '%purchase%' OR LOWER(ue.event_type) LIKE '%checkout%' THEN 6
                  WHEN LOWER(ue.event_type) LIKE '%save%' OR LOWER(ue.event_type) LIKE '%watch%' OR LOWER(ue.event_type) LIKE '%alert%' THEN 3
                  WHEN LOWER(ue.event_type) LIKE '%click%' OR LOWER(ue.event_type) LIKE '%open%' OR LOWER(ue.event_type) LIKE '%view%' THEN 1.5
                  ELSE 1
                END
              ) AS user_signal_score
            FROM user_events ue
            JOIN routes r ON r.id = ue.route_id
            WHERE ue.route_id IS NOT NULL
              AND datetime(ue.event_ts) >= datetime('now', '-' || ? || ' day')
            GROUP BY r.origin_iata, r.destination_iata
            ORDER BY user_signal_score DESC
            LIMIT ?
          `
        )
        .all(safeLookbackDays, maxRows);
    }

    for (const row of signalRows) {
      const origin = String(row?.origin_iata || '').trim().toUpperCase();
      const destination = String(row?.destination_iata || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) continue;
      const key = `${origin}-${destination}`;
      if (!outMap.has(key)) {
        outMap.set(key, {
          originIata: origin,
          destinationIata: destination,
          observations: 0,
          volatilityPct: 0,
          recentDropPct: 0,
          seasonalityFactor: 1,
          userSignalScore: 0
        });
      }
      const entry = outMap.get(key);
      entry.userSignalScore = toNumber(row?.user_signal_score, 0);
    }
  }

  return Array.from(outMap.values())
    .sort((a, b) => b.observations - a.observations || b.userSignalScore - a.userSignalScore || b.recentDropPct - a.recentDropPct)
    .slice(0, maxRows);
}

export async function listStrongDetectedDealRoutes({ limit = 80, minScore = 80, lookbackHours = 96 } = {}) {
  await ensureInitialized();
  const maxRows = Math.max(1, Math.min(400, Number(limit) || 80));
  const safeMinScore = Math.max(0, Math.min(100, Number(minScore) || 80));
  const safeLookbackHours = Math.max(1, Math.min(720, Number(lookbackHours) || 96));

  const [hasDealsTable, hasRoutesTable] = await Promise.all([tableExists('detected_deals'), tableExists('routes')]);
  if (!hasDealsTable || !hasRoutesTable) return [];

  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `
        SELECT
          r.origin_iata,
          r.destination_iata,
          MAX(dd.final_score)::numeric(6,2) AS top_score,
          COUNT(*)::int AS hits
        FROM detected_deals dd
        JOIN routes r ON r.id = dd.route_id
        WHERE dd.final_score >= $2
          AND dd.source_observed_at >= NOW() - ($3 * INTERVAL '1 hour')
          AND dd.status IN ('candidate', 'published')
        GROUP BY r.origin_iata, r.destination_iata
        ORDER BY top_score DESC, hits DESC
        LIMIT $1
      `,
      [maxRows, safeMinScore, safeLookbackHours]
    );
    return (result.rows || []).map((row) => ({
      originIata: String(row.origin_iata || '').trim().toUpperCase(),
      destinationIata: String(row.destination_iata || '').trim().toUpperCase(),
      topScore: toNumber(row.top_score, 0),
      hits: Math.max(0, Math.floor(toNumber(row.hits, 0)))
    }));
  }

  const rows = sqliteDb
    .prepare(
      `
        SELECT
          r.origin_iata AS origin_iata,
          r.destination_iata AS destination_iata,
          MAX(dd.final_score) AS top_score,
          COUNT(*) AS hits
        FROM detected_deals dd
        JOIN routes r ON r.id = dd.route_id
        WHERE dd.final_score >= ?
          AND datetime(dd.source_observed_at) >= datetime('now', '-' || ? || ' hour')
          AND dd.status IN ('candidate', 'published')
        GROUP BY r.origin_iata, r.destination_iata
        ORDER BY top_score DESC, hits DESC
        LIMIT ?
      `
    )
    .all(safeMinScore, safeLookbackHours, maxRows);

  return rows.map((row) => ({
    originIata: String(row.origin_iata || '').trim().toUpperCase(),
    destinationIata: String(row.destination_iata || '').trim().toUpperCase(),
    topScore: toNumber(row.top_score, 0),
    hits: Math.max(0, Math.floor(toNumber(row.hits, 0)))
  }));
}

export async function refreshRouteCoverageStats() {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    await pgPool.query(
      `INSERT INTO route_coverage_stats
       (origin_iata, destination_iata, travel_month, observation_count, confidence_level, last_observed_at, updated_at)
       SELECT
         po.origin_iata,
         po.destination_iata,
         po.travel_month,
         COUNT(*)::int AS observation_count,
         CASE
           WHEN COUNT(*) >= 80 THEN 'high'
           WHEN COUNT(*) >= 40 THEN 'medium'
           WHEN COUNT(*) >= 25 THEN 'low'
           ELSE 'very_low'
         END AS confidence_level,
         MAX(po.observed_at) AS last_observed_at,
         NOW() AS updated_at
       FROM price_observations po
       GROUP BY po.origin_iata, po.destination_iata, po.travel_month
       ON CONFLICT (origin_iata, destination_iata, travel_month)
       DO UPDATE SET
         observation_count = EXCLUDED.observation_count,
         confidence_level = EXCLUDED.confidence_level,
         last_observed_at = EXCLUDED.last_observed_at,
         updated_at = NOW()`
    );
    const countRes = await pgPool.query('SELECT COUNT(*)::int AS c FROM route_coverage_stats');
    return { updatedRows: Number(countRes.rows[0]?.c || 0) };
  }

  const rows = sqliteDb
    .prepare(
      `SELECT origin_iata, destination_iata, travel_month, COUNT(*) AS observation_count, MAX(observed_at) AS last_observed_at
       FROM price_observations
       GROUP BY origin_iata, destination_iata, travel_month`
    )
    .all();
  const stmt = sqliteDb.prepare(
    `INSERT INTO route_coverage_stats
     (origin_iata, destination_iata, travel_month, observation_count, confidence_level, last_observed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(origin_iata, destination_iata, travel_month)
     DO UPDATE SET
       observation_count=excluded.observation_count,
       confidence_level=excluded.confidence_level,
       last_observed_at=excluded.last_observed_at,
       updated_at=datetime('now')`
  );
  for (const row of rows) {
    stmt.run(
      row.origin_iata,
      row.destination_iata,
      row.travel_month,
      Number(row.observation_count || 0),
      coverageLevelForCount(Number(row.observation_count || 0)),
      row.last_observed_at || null
    );
  }
  return { updatedRows: rows.length };
}

export async function getDataFoundationStatus() {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    const [obs, baselines, coverage, subs] = await Promise.all([
      pgPool.query('SELECT COUNT(*)::int AS c FROM price_observations'),
      pgPool.query('SELECT COUNT(*)::int AS c FROM route_baselines'),
      pgPool.query('SELECT confidence_level, COUNT(*)::int AS c FROM route_coverage_stats GROUP BY confidence_level'),
      pgPool.query('SELECT COUNT(*)::int AS c FROM discovery_alert_subscriptions WHERE enabled = true')
    ]);
    const coverageBuckets = { high: 0, medium: 0, low: 0, veryLow: 0 };
    for (const row of coverage.rows) {
      const level = String(row.confidence_level || '').toLowerCase();
      const count = Number(row.c || 0);
      if (level === 'high') coverageBuckets.high = count;
      else if (level === 'medium') coverageBuckets.medium = count;
      else if (level === 'low') coverageBuckets.low = count;
      else coverageBuckets.veryLow += count;
    }
    return {
      ok: true,
      mode: 'postgres',
      totals: {
        priceObservations: Number(obs.rows[0]?.c || 0),
        routeBaselines: Number(baselines.rows[0]?.c || 0),
        routeCoverageStats: coverageBuckets.high + coverageBuckets.medium + coverageBuckets.low + coverageBuckets.veryLow,
        activeSubscriptions: Number(subs.rows[0]?.c || 0)
      },
      coverage: coverageBuckets
    };
  }

  const obs = sqliteDb.prepare('SELECT COUNT(*) AS c FROM price_observations').get();
  const baselines = sqliteDb.prepare('SELECT COUNT(*) AS c FROM route_baselines').get();
  const coverageRows = sqliteDb.prepare('SELECT confidence_level, COUNT(*) AS c FROM route_coverage_stats GROUP BY confidence_level').all();
  const subs = sqliteDb.prepare('SELECT COUNT(*) AS c FROM discovery_alert_subscriptions WHERE enabled = 1').get();
  const coverageBuckets = { high: 0, medium: 0, low: 0, veryLow: 0 };
  for (const row of coverageRows) {
    const level = String(row.confidence_level || '').toLowerCase();
    const count = Number(row.c || 0);
    if (level === 'high') coverageBuckets.high = count;
    else if (level === 'medium') coverageBuckets.medium = count;
    else if (level === 'low') coverageBuckets.low = count;
    else coverageBuckets.veryLow += count;
  }
  return {
    ok: true,
    mode: 'sqlite',
    totals: {
      priceObservations: Number(obs?.c || 0),
      routeBaselines: Number(baselines?.c || 0),
      routeCoverageStats: coverageBuckets.high + coverageBuckets.medium + coverageBuckets.low + coverageBuckets.veryLow,
      activeSubscriptions: Number(subs?.c || 0)
    },
    coverage: coverageBuckets
  };
}
