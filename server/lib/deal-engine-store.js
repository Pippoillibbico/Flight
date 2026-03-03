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
  const allowedSource = /^(manual|partner_feed|csv_import|csv_manual|api_ingest|seed_script)([_a-z0-9-]*)$/i;
  if (!allowedSource.test(s)) {
    throw new Error('Rejected by ingestion policy: source must be internal (manual/csv/partner feed).');
  }
}

function confidenceForCount(count) {
  if (count >= 80) return { level: 'high', score: 0.95 };
  if (count >= 40) return { level: 'medium', score: 0.8 };
  if (count >= 15) return { level: 'low', score: 0.6 };
  return { level: 'very_low', score: 0.35 };
}

async function ensurePostgres() {
  if (!pgPool) {
    pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
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

  const currency = String(payload.currency || 'EUR').trim().toUpperCase();
  const provider = String(payload.provider || 'partner_feed').trim();
  const cabinClass = String(payload.cabin_class || payload.cabinClass || 'economy').trim().toLowerCase();
  const tripType = String(payload.trip_type || payload.tripType || (returnDate ? 'round_trip' : 'one_way')).trim().toLowerCase();
  const source = String(payload.source || 'manual').trim().toLowerCase();
  const observedAt = toIsoTimestamp(payload.observed_at || payload.observedAt);
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

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

  return {
    dealLevel,
    dealScore,
    why: `Price is ${Math.abs(delta).toFixed(2)} ${sign} route median (${p50.toFixed(2)}) for ${travelMonth}.`,
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
        `SELECT id, origin_iata, destination_iata, departure_date, return_date, travel_month, total_price, currency, observed_at, fingerprint
         FROM price_observations
         WHERE observed_at > $1
         ORDER BY observed_at ASC
         LIMIT $2`,
        [observedAfter, maxRows]
      );
      return result.rows;
    }
    const result = await pgPool.query(
      `SELECT id, origin_iata, destination_iata, departure_date, return_date, travel_month, total_price, currency, observed_at, fingerprint
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
        `SELECT id, origin_iata, destination_iata, departure_date, return_date, travel_month, total_price, currency, observed_at, fingerprint
         FROM price_observations
         WHERE observed_at > ?
         ORDER BY observed_at ASC
         LIMIT ?`
      )
      .all(observedAfter, maxRows);
  }

  return sqliteDb
    .prepare(
      `SELECT id, origin_iata, destination_iata, departure_date, return_date, travel_month, total_price, currency, observed_at, fingerprint
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
