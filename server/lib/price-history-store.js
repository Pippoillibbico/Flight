import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import pg from 'pg';
import { nanoid } from 'nanoid';
import { getCacheClient } from './free-cache.js';
import { logger } from './logger.js';

const DB_FILE_URL = new URL('../../data/app.db', import.meta.url);
const DB_FILE_PATH = fileURLToPath(DB_FILE_URL);

let initialized = false;
let sqliteDb = null;
let pgPool = null;

const observationSchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.number().positive(),
  timestamp: z.string().datetime().optional(),
  airline: z.string().trim().min(1).max(120).default('unknown'),
  source: z.string().trim().min(2).max(120),
  currency: z.string().trim().length(3).default('EUR'),
  returnDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  cabinClass: z.string().trim().min(2).max(40).default('economy'),
  tripType: z.string().trim().min(2).max(40).default('round_trip'),
  metadata: z.record(z.string(), z.any()).optional()
});

const pricesQuerySchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  airline: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(10000).default(1000)
});

const statsQuerySchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

function toIsoTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp.');
  return date.toISOString();
}

function normalizeIata(value, field) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error(`Invalid ${field}. Expected IATA code.`);
  return normalized;
}

function monthFromDate(dateText) {
  return `${dateText.slice(0, 7)}-01`;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const w = pos - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * w;
}

function createFingerprint(row) {
  const stable = [
    row.origin,
    row.destination,
    row.date,
    row.returnDate || '',
    row.currency,
    round2(row.price).toFixed(2),
    row.airline,
    row.source,
    row.cabinClass,
    row.tripType,
    row.timestamp
  ].join('|');
  return createHash('sha256').update(stable).digest('hex');
}

function getMode() {
  return process.env.DATABASE_URL ? 'postgres' : 'sqlite';
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_price_observations_fingerprint
      ON price_observations(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_price_observations_origin_dest_departure
      ON price_observations(origin_iata, destination_iata, departure_date);
    CREATE INDEX IF NOT EXISTS idx_price_observations_route_month
      ON price_observations(route_id, travel_month);
    CREATE INDEX IF NOT EXISTS idx_price_observations_observed_at
      ON price_observations(observed_at);
  `);
}

async function ensureInitialized() {
  if (initialized) return;
  if (getMode() === 'postgres') await ensurePostgres();
  else await ensureSqlite();
  initialized = true;
}

async function upsertRoute(originIata, destinationIata) {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `INSERT INTO routes (origin_iata, destination_iata, created_at, updated_at)
       VALUES ($1,$2,NOW(),NOW())
       ON CONFLICT (origin_iata, destination_iata) DO UPDATE SET updated_at = NOW()
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

/**
 * @typedef {Object} PriceObservation
 * @property {string} origin
 * @property {string} destination
 * @property {string} date
 * @property {number} price
 * @property {string=} timestamp
 * @property {string=} airline
 * @property {string} source
 * @property {string=} currency
 * @property {string=} returnDate
 * @property {string=} cabinClass
 * @property {string=} tripType
 * @property {Object<string, any>=} metadata
 */

/**
 * Stores a single price observation with fingerprint dedupe.
 * @param {PriceObservation} observation
 */
export async function storeObservation(observation) {
  const parsed = observationSchema.parse(observation);
  const row = {
    origin: normalizeIata(parsed.origin, 'origin'),
    destination: normalizeIata(parsed.destination, 'destination'),
    date: parsed.date,
    returnDate: parsed.returnDate || null,
    price: round2(parsed.price),
    currency: String(parsed.currency || 'EUR').toUpperCase(),
    airline: String(parsed.airline || 'unknown').trim(),
    source: String(parsed.source || 'manual').trim().toLowerCase(),
    cabinClass: String(parsed.cabinClass || 'economy').trim().toLowerCase(),
    tripType: String(parsed.tripType || 'round_trip').trim().toLowerCase(),
    timestamp: toIsoTimestamp(parsed.timestamp),
    metadata: parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {}
  };
  const fingerprint = createFingerprint(row);

  try {
    const routeId = await upsertRoute(row.origin, row.destination);
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
          row.origin,
          row.destination,
          row.date,
          row.returnDate,
          monthFromDate(row.date),
          row.currency,
          row.price,
          row.airline,
          row.cabinClass,
          row.tripType,
          row.timestamp,
          row.source,
          fingerprint,
          JSON.stringify(row.metadata)
        ]
      );
      return { inserted: Boolean(result.rows[0]), id: result.rows[0]?.id || null, fingerprint };
    }

    const sqliteRow = sqliteDb
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
        row.origin,
        row.destination,
        row.date,
        row.returnDate,
        monthFromDate(row.date),
        row.currency,
        row.price,
        row.airline,
        row.cabinClass,
        row.tripType,
        row.timestamp,
        row.source,
        fingerprint,
        JSON.stringify(row.metadata)
      );
    return { inserted: Boolean(sqliteRow?.id), id: sqliteRow?.id || null, fingerprint };
  } catch (error) {
    logger.error({ err: error, origin: row.origin, destination: row.destination }, 'store_observation_failed');
    throw error;
  }
}

/**
 * Returns historical prices for a route.
 */
export async function getHistoricalPrices(query) {
  const parsed = pricesQuerySchema.parse(query);
  const origin = normalizeIata(parsed.origin, 'origin');
  const destination = normalizeIata(parsed.destination, 'destination');

  await ensureInitialized();
  try {
    if (getMode() === 'postgres') {
      const clauses = ['origin_iata = $1', 'destination_iata = $2'];
      const params = [origin, destination];
      let idx = 3;
      if (parsed.dateFrom) {
        clauses.push(`departure_date >= $${idx}`);
        params.push(parsed.dateFrom);
        idx += 1;
      }
      if (parsed.dateTo) {
        clauses.push(`departure_date <= $${idx}`);
        params.push(parsed.dateTo);
        idx += 1;
      }
      if (parsed.airline) {
        clauses.push(`provider = $${idx}`);
        params.push(parsed.airline);
        idx += 1;
      }
      params.push(parsed.limit);
      const result = await pgPool.query(
        `SELECT origin_iata, destination_iata, departure_date, return_date, travel_month, total_price, currency, provider, source, observed_at, fingerprint
         FROM price_observations
         WHERE ${clauses.join(' AND ')}
         ORDER BY observed_at DESC
         LIMIT $${idx}`,
        params
      );
      return result.rows;
    }

    const filters = ['origin_iata = ?', 'destination_iata = ?'];
    const params = [origin, destination];
    if (parsed.dateFrom) {
      filters.push('departure_date >= ?');
      params.push(parsed.dateFrom);
    }
    if (parsed.dateTo) {
      filters.push('departure_date <= ?');
      params.push(parsed.dateTo);
    }
    if (parsed.airline) {
      filters.push('provider = ?');
      params.push(parsed.airline);
    }
    params.push(parsed.limit);
    return sqliteDb
      .prepare(
        `SELECT origin_iata, destination_iata, departure_date, return_date, travel_month, total_price, currency, provider, source, observed_at, fingerprint
         FROM price_observations
         WHERE ${filters.join(' AND ')}
         ORDER BY observed_at DESC
         LIMIT ?`
      )
      .all(...params);
  } catch (error) {
    logger.error({ err: error, origin, destination }, 'get_historical_prices_failed');
    throw error;
  }
}

function buildStatsFromRows(rows) {
  const prices = rows.map((r) => Number(r.total_price)).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!prices.length) {
    return {
      count: 0,
      min: null,
      max: null,
      avg: null,
      median: null,
      p10: null,
      p25: null,
      p75: null,
      p90: null,
      stddev: null
    };
  }
  const avg = prices.reduce((acc, v) => acc + v, 0) / prices.length;
  const variance = prices.reduce((acc, v) => acc + (v - avg) ** 2, 0) / prices.length;
  return {
    count: prices.length,
    min: round2(prices[0]),
    max: round2(prices[prices.length - 1]),
    avg: round2(avg),
    median: round2(percentile(prices, 0.5)),
    p10: round2(percentile(prices, 0.1)),
    p25: round2(percentile(prices, 0.25)),
    p75: round2(percentile(prices, 0.75)),
    p90: round2(percentile(prices, 0.9)),
    stddev: round2(Math.sqrt(variance))
  };
}

/**
 * Returns route statistics with Redis caching for hot routes.
 */
export async function getRouteStats(query) {
  const parsed = statsQuerySchema.parse(query);
  const origin = normalizeIata(parsed.origin, 'origin');
  const destination = normalizeIata(parsed.destination, 'destination');
  const cache = getCacheClient();
  const cacheKey = `price:stats:${origin}:${destination}:${parsed.dateFrom || '-'}:${parsed.dateTo || '-'}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {}

  await ensureInitialized();
  try {
    let stats;
    if (getMode() === 'postgres') {
      const clauses = ['origin_iata = $1', 'destination_iata = $2'];
      const params = [origin, destination];
      let idx = 3;
      if (parsed.dateFrom) {
        clauses.push(`departure_date >= $${idx}`);
        params.push(parsed.dateFrom);
        idx += 1;
      }
      if (parsed.dateTo) {
        clauses.push(`departure_date <= $${idx}`);
        params.push(parsed.dateTo);
      }
      const sql = `
        SELECT
          COUNT(*)::int AS count,
          MIN(total_price)::numeric(10,2) AS min,
          MAX(total_price)::numeric(10,2) AS max,
          AVG(total_price)::numeric(10,2) AS avg,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS median,
          percentile_cont(0.1) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p10,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p25,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p75,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p90,
          COALESCE(stddev_pop(total_price),0)::numeric(10,2) AS stddev
        FROM price_observations
        WHERE ${clauses.join(' AND ')}
      `;
      const result = await pgPool.query(sql, params);
      const row = result.rows[0] || {};
      stats = {
        count: Number(row.count || 0),
        min: row.min === null ? null : Number(row.min),
        max: row.max === null ? null : Number(row.max),
        avg: row.avg === null ? null : Number(row.avg),
        median: row.median === null ? null : Number(row.median),
        p10: row.p10 === null ? null : Number(row.p10),
        p25: row.p25 === null ? null : Number(row.p25),
        p75: row.p75 === null ? null : Number(row.p75),
        p90: row.p90 === null ? null : Number(row.p90),
        stddev: row.stddev === null ? null : Number(row.stddev)
      };
    } else {
      const rows = await getHistoricalPrices({ origin, destination, dateFrom: parsed.dateFrom, dateTo: parsed.dateTo, limit: 10000 });
      stats = buildStatsFromRows(rows);
    }

    try {
      await cache.setex(cacheKey, 180, JSON.stringify(stats));
    } catch {}
    return stats;
  } catch (error) {
    logger.error({ err: error, origin, destination }, 'get_route_stats_failed');
    throw error;
  }
}

export async function listPopularRoutesByOrigin({ origin, month = null, limit = 20 }) {
  const originIata = normalizeIata(origin, 'origin');
  await ensureInitialized();

  if (getMode() === 'postgres') {
    const hasMonth = Boolean(month);
    const result = await pgPool.query(
      hasMonth
        ? `SELECT destination_iata, COUNT(*)::int AS obs, AVG(total_price)::numeric(10,2) AS avg_price
           FROM price_observations
           WHERE origin_iata = $1 AND travel_month = $2
           GROUP BY destination_iata
           ORDER BY obs DESC
           LIMIT $3`
        : `SELECT destination_iata, COUNT(*)::int AS obs, AVG(total_price)::numeric(10,2) AS avg_price
           FROM price_observations
           WHERE origin_iata = $1
           GROUP BY destination_iata
           ORDER BY obs DESC
           LIMIT $2`,
      hasMonth ? [originIata, month, limit] : [originIata, limit]
    );
    return result.rows.map((r) => ({ destination: r.destination_iata, observations: Number(r.obs), avgPrice: Number(r.avg_price) }));
  }

  const rows = sqliteDb
    .prepare(
      month
        ? `SELECT destination_iata, COUNT(*) AS obs, AVG(total_price) AS avg_price
           FROM price_observations
           WHERE origin_iata = ? AND travel_month = ?
           GROUP BY destination_iata
           ORDER BY obs DESC
           LIMIT ?`
        : `SELECT destination_iata, COUNT(*) AS obs, AVG(total_price) AS avg_price
           FROM price_observations
           WHERE origin_iata = ?
           GROUP BY destination_iata
           ORDER BY obs DESC
           LIMIT ?`
    )
    .all(...(month ? [originIata, month, limit] : [originIata, limit]));
  return rows.map((r) => ({ destination: r.destination_iata, observations: Number(r.obs), avgPrice: round2(r.avg_price) }));
}

export async function initPriceHistoryStore() {
  try {
    await ensureInitialized();
  } catch (error) {
    logger.error({ err: error }, 'init_price_history_store_failed');
    throw error;
  }
}

export function buildSyntheticObservationFromCsvRow(row) {
  const parsed = observationSchema.safeParse({
    origin: row.origin || row.origin_iata,
    destination: row.destination || row.destination_iata,
    date: row.date || row.departure_date,
    price: Number(row.price || row.total_price),
    timestamp: row.timestamp || row.observed_at || new Date().toISOString(),
    airline: row.airline || row.provider || 'csv_source',
    source: row.source || 'csv_import',
    currency: row.currency || 'EUR',
    returnDate: row.return_date || row.returnDate || null,
    cabinClass: row.cabin_class || 'economy',
    tripType: row.trip_type || 'round_trip',
    metadata: { ingestionId: nanoid(10), rowType: 'csv' }
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Invalid CSV row.');
  return parsed.data;
}

