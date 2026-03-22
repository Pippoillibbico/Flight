import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestPriceObservation } from '../deal-engine-store.js';
import { logger } from '../logger.js';

const SQLITE_DB_PATH = fileURLToPath(new URL('../../../data/app.db', import.meta.url));

let initialized = false;
let mode = process.env.DATABASE_URL ? 'postgres' : 'sqlite';
let pgPool = null;
let sqliteDb = null;
let pgHasFlightQuotes = false;
let pgHasRoutesAirportColumns = false;

const airportIdCache = new Map();
const routeIdCache = new Map();

function toNullableInt(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const out = Number(value);
  if (!Number.isFinite(out)) return null;
  return Math.trunc(out);
}

function normalizeIata(value) {
  return String(value || '').trim().toUpperCase();
}

function routeCacheKey(originIata, destinationIata) {
  return `${normalizeIata(originIata)}-${normalizeIata(destinationIata)}`;
}

function normalizeQuote(quote) {
  const normalizedStops = toNullableInt(quote?.stops);
  const normalizedDurationMinutes = toNullableInt(quote?.durationMinutes);
  return {
    originIata: normalizeIata(quote?.originIata),
    destinationIata: normalizeIata(quote?.destinationIata),
    departureDate: String(quote?.departureDate || '').trim().slice(0, 10),
    returnDate: quote?.returnDate ? String(quote.returnDate).trim().slice(0, 10) : null,
    tripType: String(quote?.tripType || (quote?.returnDate ? 'round_trip' : 'one_way')).trim().toLowerCase(),
    cabinClass: String(quote?.cabinClass || 'economy').trim().toLowerCase(),
    adults: Math.max(1, Math.min(9, Math.floor(Number(quote?.adults || 1)))),
    currency: String(quote?.currency || 'EUR').trim().toUpperCase(),
    totalPrice: Number(quote?.totalPrice),
    provider: String(quote?.provider || 'provider').trim().toLowerCase(),
    providerOfferId: quote?.providerOfferId ? String(quote.providerOfferId) : null,
    stops: normalizedStops == null ? null : Math.max(0, normalizedStops),
    durationMinutes: normalizedDurationMinutes != null && normalizedDurationMinutes > 0 ? normalizedDurationMinutes : null,
    baggageIncluded: typeof quote?.baggageIncluded === 'boolean' ? quote.baggageIncluded : null,
    isBookable: quote?.isBookable === false ? false : true,
    observedAt: quote?.observedAt ? new Date(quote.observedAt).toISOString() : new Date().toISOString(),
    source: String(quote?.source || 'scan_worker').trim().toLowerCase(),
    fingerprint: String(quote?.fingerprint || '').trim(),
    metadata: quote?.metadata && typeof quote.metadata === 'object' ? quote.metadata : {}
  };
}

function isValidQuote(quote) {
  if (!/^[A-Z]{3}$/.test(quote.originIata) || !/^[A-Z]{3}$/.test(quote.destinationIata)) return false;
  if (quote.originIata === quote.destinationIata) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(quote.departureDate)) return false;
  if (quote.tripType === 'round_trip' && (!quote.returnDate || !/^\d{4}-\d{2}-\d{2}$/.test(quote.returnDate))) return false;
  if (quote.tripType === 'one_way' && quote.returnDate) return false;
  if (!Number.isFinite(quote.totalPrice) || quote.totalPrice <= 0) return false;
  if (!quote.fingerprint) return false;
  return true;
}

async function ensurePostgres() {
  if (!pgPool) {
    pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
  const [flightQuotesRes, routeColsRes] = await Promise.all([
    pgPool.query("SELECT to_regclass('public.flight_quotes') AS ref"),
    pgPool.query(
      `SELECT COUNT(*)::int AS c
       FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name='routes'
         AND column_name IN ('origin_airport_id','destination_airport_id')`
    )
  ]);
  pgHasFlightQuotes = Boolean(flightQuotesRes.rows[0]?.ref);
  pgHasRoutesAirportColumns = Number(routeColsRes.rows[0]?.c || 0) >= 2;
}

async function ensureSqlite() {
  if (sqliteDb) return;
  await mkdir(dirname(SQLITE_DB_PATH), { recursive: true });
  const sqlite = await import('node:sqlite');
  sqliteDb = new sqlite.DatabaseSync(SQLITE_DB_PATH);
  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS airports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iata_code TEXT NOT NULL UNIQUE,
      icao_code TEXT NULL,
      name TEXT NOT NULL,
      city_name TEXT NOT NULL,
      country_code TEXT NULL,
      timezone TEXT NULL,
      lat REAL NULL,
      lon REAL NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_iata TEXT NOT NULL,
      destination_iata TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (origin_iata, destination_iata)
    );
    CREATE TABLE IF NOT EXISTS flight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      origin_airport_id INTEGER NULL REFERENCES airports(id) ON DELETE SET NULL,
      destination_airport_id INTEGER NULL REFERENCES airports(id) ON DELETE SET NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_type TEXT NOT NULL DEFAULT 'round_trip',
      cabin_class TEXT NOT NULL DEFAULT 'economy',
      adults INTEGER NOT NULL DEFAULT 1,
      currency TEXT NOT NULL DEFAULT 'EUR',
      total_price REAL NOT NULL,
      provider TEXT NOT NULL,
      provider_offer_id TEXT NULL,
      stops INTEGER NULL,
      duration_minutes INTEGER NULL,
      baggage_included INTEGER NULL,
      is_bookable INTEGER NOT NULL DEFAULT 1,
      observed_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'scan_worker',
      fingerprint TEXT NOT NULL UNIQUE,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_flight_quotes_route_departure_observed
      ON flight_quotes(route_id, departure_date, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_flight_quotes_observed_at
      ON flight_quotes(observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_flight_quotes_origin_departure
      ON flight_quotes(origin_airport_id, departure_date, total_price);
    CREATE INDEX IF NOT EXISTS idx_flight_quotes_destination_departure
      ON flight_quotes(destination_airport_id, departure_date, total_price);
  `);

  try {
    sqliteDb.exec('ALTER TABLE routes ADD COLUMN origin_airport_id INTEGER NULL');
  } catch {}
  try {
    sqliteDb.exec('ALTER TABLE routes ADD COLUMN destination_airport_id INTEGER NULL');
  } catch {}
  try {
    sqliteDb.exec('ALTER TABLE routes ADD COLUMN distance_km INTEGER NULL');
  } catch {}
  try {
    sqliteDb.exec('ALTER TABLE routes ADD COLUMN typical_duration_minutes INTEGER NULL');
  } catch {}
  try {
    sqliteDb.exec('ALTER TABLE routes ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  } catch {}
}

async function ensureInitialized() {
  if (initialized) return;
  mode = process.env.DATABASE_URL ? 'postgres' : 'sqlite';
  if (mode === 'postgres') await ensurePostgres();
  else await ensureSqlite();
  initialized = true;
}

async function upsertAirportPg(client, iata) {
  if (airportIdCache.has(iata)) return airportIdCache.get(iata);
  const result = await client.query(
    `INSERT INTO airports (iata_code, name, city_name, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, true, NOW(), NOW())
     ON CONFLICT (iata_code)
     DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [iata, iata, iata]
  );
  const id = Number(result.rows[0]?.id);
  airportIdCache.set(iata, id);
  return id;
}

function upsertAirportSqlite(iata) {
  if (airportIdCache.has(iata)) return airportIdCache.get(iata);
  const row = sqliteDb
    .prepare(
      `INSERT INTO airports (iata_code, name, city_name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(iata_code) DO UPDATE SET updated_at=datetime('now')
       RETURNING id`
    )
    .get(iata, iata, iata);
  const id = Number(row?.id);
  airportIdCache.set(iata, id);
  return id;
}

async function upsertRoutePg(client, quote, originAirportId, destinationAirportId) {
  const key = routeCacheKey(quote.originIata, quote.destinationIata);
  if (routeIdCache.has(key)) return routeIdCache.get(key);

  let result;
  if (pgHasRoutesAirportColumns) {
    result = await client.query(
      `INSERT INTO routes
         (origin_iata, destination_iata, origin_airport_id, destination_airport_id, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW(), NOW())
       ON CONFLICT (origin_iata, destination_iata)
       DO UPDATE SET
         origin_airport_id = COALESCE(EXCLUDED.origin_airport_id, routes.origin_airport_id),
         destination_airport_id = COALESCE(EXCLUDED.destination_airport_id, routes.destination_airport_id),
         updated_at = NOW()
       RETURNING id`,
      [quote.originIata, quote.destinationIata, originAirportId, destinationAirportId]
    );
  } else {
    result = await client.query(
      `INSERT INTO routes (origin_iata, destination_iata, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (origin_iata, destination_iata)
       DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [quote.originIata, quote.destinationIata]
    );
  }

  const routeId = Number(result.rows[0]?.id);
  routeIdCache.set(key, routeId);
  return routeId;
}

function upsertRouteSqlite(quote, originAirportId, destinationAirportId) {
  const key = routeCacheKey(quote.originIata, quote.destinationIata);
  if (routeIdCache.has(key)) return routeIdCache.get(key);
  const row = sqliteDb
    .prepare(
      `INSERT INTO routes
         (origin_iata, destination_iata, origin_airport_id, destination_airport_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(origin_iata, destination_iata)
       DO UPDATE SET
         origin_airport_id = COALESCE(excluded.origin_airport_id, routes.origin_airport_id),
         destination_airport_id = COALESCE(excluded.destination_airport_id, routes.destination_airport_id),
         updated_at = datetime('now')
       RETURNING id`
    )
    .get(quote.originIata, quote.destinationIata, originAirportId, destinationAirportId);
  const routeId = Number(row?.id);
  routeIdCache.set(key, routeId);
  return routeId;
}

async function insertFlightQuotePg(client, quote, routeId, originAirportId, destinationAirportId) {
  const result = await client.query(
    `INSERT INTO flight_quotes (
       route_id, origin_airport_id, destination_airport_id,
       departure_date, return_date, trip_type, cabin_class, adults,
       currency, total_price, provider, provider_offer_id,
       stops, duration_minutes, baggage_included, is_bookable,
       observed_at, source, fingerprint, metadata, created_at
     )
     VALUES (
       $1, $2, $3,
       $4::date, $5::date, $6, $7, $8,
       $9, $10, $11, $12,
       $13, $14, $15, $16,
       $17::timestamptz, $18, $19, $20::jsonb, NOW()
     )
     ON CONFLICT (fingerprint) DO NOTHING
     RETURNING id`,
    [
      routeId,
      originAirportId,
      destinationAirportId,
      quote.departureDate,
      quote.returnDate,
      quote.tripType,
      quote.cabinClass,
      quote.adults,
      quote.currency,
      quote.totalPrice,
      quote.provider,
      quote.providerOfferId,
      quote.stops,
      quote.durationMinutes,
      quote.baggageIncluded,
      quote.isBookable,
      quote.observedAt,
      quote.source,
      quote.fingerprint,
      JSON.stringify(quote.metadata)
    ]
  );
  return Boolean(result.rows[0]?.id);
}

function insertFlightQuoteSqlite(quote, routeId, originAirportId, destinationAirportId) {
  const row = sqliteDb
    .prepare(
      `INSERT OR IGNORE INTO flight_quotes (
         route_id, origin_airport_id, destination_airport_id,
         departure_date, return_date, trip_type, cabin_class, adults,
         currency, total_price, provider, provider_offer_id,
         stops, duration_minutes, baggage_included, is_bookable,
         observed_at, source, fingerprint, metadata, created_at
       )
       VALUES (
         ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?, datetime('now')
       )
       RETURNING id`
    )
    .get(
      routeId,
      originAirportId,
      destinationAirportId,
      quote.departureDate,
      quote.returnDate,
      quote.tripType,
      quote.cabinClass,
      quote.adults,
      quote.currency,
      quote.totalPrice,
      quote.provider,
      quote.providerOfferId,
      quote.stops,
      quote.durationMinutes,
      quote.baggageIncluded === null ? null : quote.baggageIncluded ? 1 : 0,
      quote.isBookable ? 1 : 0,
      quote.observedAt,
      quote.source,
      quote.fingerprint,
      JSON.stringify(quote.metadata)
    );
  return Boolean(row?.id);
}

async function saveQuotesLegacy(quotes) {
  let insertedCount = 0;
  let dedupedCount = 0;
  let failedCount = 0;
  for (const quote of quotes) {
    try {
      const result = await ingestPriceObservation({
        origin_iata: quote.originIata,
        destination_iata: quote.destinationIata,
        departure_date: quote.departureDate,
        return_date: quote.returnDate,
        currency: quote.currency,
        total_price: quote.totalPrice,
        provider: quote.provider,
        cabin_class: quote.cabinClass,
        trip_type: quote.tripType,
        observed_at: quote.observedAt,
        source: quote.source,
        fingerprint: quote.fingerprint,
        metadata: {
          ...(quote.metadata || {}),
          stops: quote.stops,
          durationMinutes: quote.durationMinutes,
          baggageIncluded: quote.baggageIncluded,
          providerOfferId: quote.providerOfferId,
          isBookable: quote.isBookable
        }
      });
      if (result.inserted) insertedCount += 1;
      else dedupedCount += 1;
    } catch (error) {
      failedCount += 1;
      logger.warn({ err: error, originIata: quote.originIata, destinationIata: quote.destinationIata }, 'flight_scan_quote_storage_legacy_failed');
    }
  }
  return { insertedCount, dedupedCount, failedCount };
}

export function createQuoteStorage() {
  async function saveQuotes(quotes, { scanRunId = null } = {}) {
    await ensureInitialized();
    const list = (Array.isArray(quotes) ? quotes : []).map(normalizeQuote).filter(isValidQuote);
    if (list.length === 0) {
      return { processedCount: 0, insertedCount: 0, dedupedCount: 0, failedCount: 0, mode };
    }

    if (mode === 'postgres' && !pgHasFlightQuotes) {
      logger.warn({ scanRunId, quoteCount: list.length }, 'flight_scan_storage_fallback_legacy_price_observations');
      const legacy = await saveQuotesLegacy(list);
      return {
        processedCount: list.length,
        insertedCount: legacy.insertedCount,
        dedupedCount: legacy.dedupedCount,
        failedCount: legacy.failedCount,
        mode: 'postgres_legacy'
      };
    }

    let insertedCount = 0;
    let dedupedCount = 0;
    let failedCount = 0;

    if (mode === 'postgres') {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        for (const quote of list) {
          try {
            const originAirportId = await upsertAirportPg(client, quote.originIata);
            const destinationAirportId = await upsertAirportPg(client, quote.destinationIata);
            const routeId = await upsertRoutePg(client, quote, originAirportId, destinationAirportId);
            const inserted = await insertFlightQuotePg(client, quote, routeId, originAirportId, destinationAirportId);
            if (inserted) insertedCount += 1;
            else dedupedCount += 1;
          } catch (error) {
            failedCount += 1;
            logger.warn(
              {
                err: error,
                originIata: quote.originIata,
                destinationIata: quote.destinationIata,
                departureDate: quote.departureDate
              },
              'flight_scan_quote_storage_insert_failed'
            );
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else {
      for (const quote of list) {
        try {
          const originAirportId = upsertAirportSqlite(quote.originIata);
          const destinationAirportId = upsertAirportSqlite(quote.destinationIata);
          const routeId = upsertRouteSqlite(quote, originAirportId, destinationAirportId);
          const inserted = insertFlightQuoteSqlite(quote, routeId, originAirportId, destinationAirportId);
          if (inserted) insertedCount += 1;
          else dedupedCount += 1;
        } catch (error) {
          failedCount += 1;
          logger.warn(
            {
              err: error,
              originIata: quote.originIata,
              destinationIata: quote.destinationIata,
              departureDate: quote.departureDate
            },
            'flight_scan_quote_storage_insert_failed'
          );
        }
      }
    }

    logger.info(
      {
        scanRunId,
        mode,
        processedCount: list.length,
        insertedCount,
        dedupedCount,
        failedCount
      },
      'flight_scan_quote_storage_completed'
    );

    return {
      processedCount: list.length,
      insertedCount,
      dedupedCount,
      failedCount,
      mode
    };
  }

  return {
    saveQuotes
  };
}
