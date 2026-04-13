import { nanoid } from 'nanoid';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQLITE_DB_PATH = fileURLToPath(new URL('../../data/app.db', import.meta.url));

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function normalizeIata(value, label) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error(`Invalid ${label}. Expected IATA code.`);
  return normalized;
}

function normalizeDate(value, label) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`Invalid ${label}. Expected YYYY-MM-DD.`);
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function normalizeCurrency(value) {
  const normalized = String(value || 'EUR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error('Invalid currency. Expected ISO code.');
  return normalized;
}

function normalizeChannels(channels = null) {
  const source = channels && typeof channels === 'object' && !Array.isArray(channels) ? channels : {};
  const normalized = {
    push: source.push !== false,
    email: source.email !== false,
    in_app: source.in_app === true || source.inApp === true || (source.in_app == null && source.inApp == null),
    inApp: undefined
  };
  delete normalized.inApp;
  if (!normalized.push && !normalized.email && !normalized.in_app) {
    throw new Error('Invalid channels. At least one channel must be enabled.');
  }
  return normalized;
}

function parseChannels(raw) {
  if (!raw) return { push: true, email: true, in_app: true };
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const push = raw.push !== false;
    const email = raw.email !== false;
    const inApp = raw.in_app === true || raw.inApp === true || (raw.in_app == null && raw.inApp == null);
    return { push, email, in_app: inApp };
  }
  try {
    return parseChannels(JSON.parse(String(raw)));
  } catch {
    return { push: true, email: true, in_app: true };
  }
}

function normalizeBoolean(value, fallback = true) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function assertDateWindow(dateFrom, dateTo) {
  if (dateTo < dateFrom) throw new Error('Invalid date range. dateTo must be >= dateFrom.');
}

function mapAlertRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    user_id: String(row.user_id || ''),
    origin_iata: normalizeIata(row.origin_iata, 'origin_iata'),
    destination_iata: normalizeIata(row.destination_iata, 'destination_iata'),
    date_from: String(row.date_from || '').slice(0, 10),
    date_to: String(row.date_to || '').slice(0, 10),
    max_price: Math.round(toNumber(row.max_price, 0) * 100) / 100,
    currency: normalizeCurrency(row.currency || 'EUR'),
    channels: parseChannels(row.channels_json),
    enabled: normalizeBoolean(row.enabled, true),
    last_checked_at: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
    last_triggered_at: row.last_triggered_at ? new Date(row.last_triggered_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

function mapMatchRow(row) {
  return {
    alert_id: String(row.alert_id || ''),
    user_id: String(row.user_id || ''),
    channels: parseChannels(row.channels_json),
    max_price: toNumber(row.max_price, 0),
    alert_currency: normalizeCurrency(row.alert_currency || 'EUR'),
    deal_key: String(row.deal_key || ''),
    detected_deal_id: toNumber(row.detected_deal_id, 0),
    route_id: toNumber(row.route_id, 0),
    flight_quote_id: toNumber(row.flight_quote_id, 0),
    deal_price: toNumber(row.deal_price, 0),
    final_score: toNumber(row.final_score, 0),
    savings_pct: toNumber(row.savings_pct, 0),
    origin_iata: normalizeIata(row.origin_iata, 'origin_iata'),
    destination_iata: normalizeIata(row.destination_iata, 'destination_iata'),
    departure_date: String(row.departure_date || '').slice(0, 10),
    return_date: row.return_date ? String(row.return_date).slice(0, 10) : null,
    trip_type: String(row.trip_type || 'round_trip'),
    stops: row.stops == null ? null : toNumber(row.stops, 0),
    provider: String(row.provider || '').trim() || null,
    currency: normalizeCurrency(row.currency || 'EUR'),
    source_observed_at: row.source_observed_at ? new Date(row.source_observed_at).toISOString() : null,
    published_at: row.published_at ? new Date(row.published_at).toISOString() : null
  };
}

export function createPriceAlertsStore(options = {}) {
  const forcedMode = String(options.mode || '').trim().toLowerCase();
  let mode = forcedMode === 'postgres' || forcedMode === 'sqlite' ? forcedMode : process.env.DATABASE_URL ? 'postgres' : 'sqlite';
  let pgPool = options.pgPool || null;
  let sqliteDb = options.sqliteDb || null;
  let initialized = false;

  async function ensurePostgres() {
    if (!pgPool) {
      pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    }

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS price_alert_rules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        origin_iata CHAR(3) NOT NULL,
        destination_iata CHAR(3) NOT NULL,
        date_from DATE NOT NULL,
        date_to DATE NOT NULL,
        max_price NUMERIC(10,2) NOT NULL,
        currency CHAR(3) NOT NULL DEFAULT 'EUR',
        channels_json JSONB NOT NULL DEFAULT '{"push":true,"email":true,"in_app":true}'::jsonb,
        enabled BOOLEAN NOT NULL DEFAULT true,
        last_checked_at TIMESTAMPTZ NULL,
        last_triggered_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ck_price_alert_rules_dates CHECK (date_to >= date_from),
        CONSTRAINT ck_price_alert_rules_price CHECK (max_price > 0)
      );
      CREATE INDEX IF NOT EXISTS idx_price_alert_rules_user
        ON price_alert_rules(user_id, enabled, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_price_alert_rules_route_period
        ON price_alert_rules(origin_iata, destination_iata, date_from, date_to);

      CREATE TABLE IF NOT EXISTS price_alert_deliveries (
        id BIGSERIAL PRIMARY KEY,
        alert_id TEXT NOT NULL REFERENCES price_alert_rules(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        deal_key TEXT NOT NULL,
        channel TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_price_alert_delivery UNIQUE (alert_id, deal_key, channel),
        CONSTRAINT ck_price_alert_delivery_channel CHECK (channel IN ('push', 'email', 'in_app'))
      );
      CREATE INDEX IF NOT EXISTS idx_price_alert_deliveries_user
        ON price_alert_deliveries(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_price_alert_deliveries_deal
        ON price_alert_deliveries(deal_key, created_at DESC);

      CREATE TABLE IF NOT EXISTS price_alert_worker_state (
        id SMALLINT PRIMARY KEY,
        last_observed_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ck_price_alert_worker_state_id CHECK (id = 1)
      );
    `);
  }

  async function ensureSqlite() {
    if (!sqliteDb) {
      await mkdir(dirname(fileURLToPath(new URL('../../data/app.db', import.meta.url))), { recursive: true });
      const sqlite = await import('node:sqlite');
      sqliteDb = new sqlite.DatabaseSync(SQLITE_DB_PATH);
    }

    sqliteDb.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS price_alert_rules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        origin_iata TEXT NOT NULL,
        destination_iata TEXT NOT NULL,
        date_from TEXT NOT NULL,
        date_to TEXT NOT NULL,
        max_price REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        channels_json TEXT NOT NULL DEFAULT '{"push":true,"email":true,"in_app":true}',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_checked_at TEXT NULL,
        last_triggered_at TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_price_alert_rules_user
        ON price_alert_rules(user_id, enabled, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_price_alert_rules_route_period
        ON price_alert_rules(origin_iata, destination_iata, date_from, date_to);

      CREATE TABLE IF NOT EXISTS price_alert_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        deal_key TEXT NOT NULL,
        channel TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (alert_id, deal_key, channel)
      );
      CREATE INDEX IF NOT EXISTS idx_price_alert_deliveries_user
        ON price_alert_deliveries(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_price_alert_deliveries_deal
        ON price_alert_deliveries(deal_key, created_at DESC);

      CREATE TABLE IF NOT EXISTS price_alert_worker_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_observed_at TEXT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  async function ensureInitialized() {
    if (initialized) return;
    mode = forcedMode === 'postgres' || forcedMode === 'sqlite' ? forcedMode : process.env.DATABASE_URL ? 'postgres' : 'sqlite';
    if (mode === 'postgres') await ensurePostgres();
    else await ensureSqlite();
    initialized = true;
  }

  async function ensureSourceStatus() {
    await ensureInitialized();
    if (mode === 'postgres') {
      const refs = await pgPool.query(`
        SELECT
          to_regclass('public.detected_deals') AS detected_deals_ref,
          to_regclass('public.flight_quotes') AS flight_quotes_ref,
          to_regclass('public.routes') AS routes_ref
      `);
      const row = refs.rows[0] || {};
      if (!row.detected_deals_ref) return { ok: false, reason: 'detected_deals_missing' };
      if (!row.flight_quotes_ref) return { ok: false, reason: 'flight_quotes_missing' };
      if (!row.routes_ref) return { ok: false, reason: 'routes_missing' };
      return { ok: true, reason: null };
    }

    const detectedDeals = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='detected_deals'`).get();
    const flightQuotes = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='flight_quotes'`).get();
    const routes = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='routes'`).get();
    if (!detectedDeals?.name) return { ok: false, reason: 'detected_deals_missing' };
    if (!flightQuotes?.name) return { ok: false, reason: 'flight_quotes_missing' };
    if (!routes?.name) return { ok: false, reason: 'routes_missing' };
    return { ok: true, reason: null };
  }

  async function listPriceAlerts({ userId }) {
    await ensureInitialized();
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) return [];

    if (mode === 'postgres') {
      const result = await pgPool.query(
        `SELECT *
         FROM price_alert_rules
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [normalizedUserId]
      );
      return result.rows.map(mapAlertRow).filter(Boolean);
    }

    const rows = sqliteDb
      .prepare(
        `SELECT *
         FROM price_alert_rules
         WHERE user_id = ?
         ORDER BY datetime(updated_at) DESC`
      )
      .all(normalizedUserId);
    return rows.map(mapAlertRow).filter(Boolean);
  }

  async function createPriceAlert({
    userId,
    originIata,
    destinationIata,
    dateFrom,
    dateTo,
    maxPrice,
    currency = 'EUR',
    channels = null,
    enabled = true
  }) {
    await ensureInitialized();
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) throw new Error('Invalid userId.');

    const safeOrigin = normalizeIata(originIata, 'originIata');
    const safeDestination = normalizeIata(destinationIata, 'destinationIata');
    const safeDateFrom = normalizeDate(dateFrom, 'dateFrom');
    const safeDateTo = normalizeDate(dateTo, 'dateTo');
    assertDateWindow(safeDateFrom, safeDateTo);
    const safeMaxPrice = Math.round(toNumber(maxPrice, NaN) * 100) / 100;
    if (!Number.isFinite(safeMaxPrice) || safeMaxPrice <= 0) throw new Error('Invalid maxPrice. Expected positive number.');
    const safeCurrency = normalizeCurrency(currency);
    const safeChannels = normalizeChannels(channels);
    const safeEnabled = normalizeBoolean(enabled, true);

    const id = `pa_${nanoid(12)}`;
    if (mode === 'postgres') {
      const result = await pgPool.query(
        `INSERT INTO price_alert_rules (
           id, user_id, origin_iata, destination_iata, date_from, date_to, max_price, currency,
           channels_json, enabled, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5::date, $6::date, $7, $8, $9::jsonb, $10, NOW(), NOW()
         )
         RETURNING *`,
        [id, normalizedUserId, safeOrigin, safeDestination, safeDateFrom, safeDateTo, safeMaxPrice, safeCurrency, JSON.stringify(safeChannels), safeEnabled]
      );
      return mapAlertRow(result.rows[0]);
    }

    sqliteDb
      .prepare(
        `INSERT INTO price_alert_rules (
           id, user_id, origin_iata, destination_iata, date_from, date_to, max_price, currency,
           channels_json, enabled, created_at, updated_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
         )`
      )
      .run(id, normalizedUserId, safeOrigin, safeDestination, safeDateFrom, safeDateTo, safeMaxPrice, safeCurrency, JSON.stringify(safeChannels), safeEnabled ? 1 : 0);

    const row = sqliteDb.prepare(`SELECT * FROM price_alert_rules WHERE id = ? LIMIT 1`).get(id);
    return mapAlertRow(row);
  }

  async function updatePriceAlert({ userId, alertId, patch = {} }) {
    await ensureInitialized();
    const normalizedUserId = String(userId || '').trim();
    const normalizedAlertId = String(alertId || '').trim();
    if (!normalizedUserId || !normalizedAlertId) return null;
    const updates = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};

    const existing = (
      mode === 'postgres'
        ? (await pgPool.query(`SELECT * FROM price_alert_rules WHERE id = $1 AND user_id = $2 LIMIT 1`, [normalizedAlertId, normalizedUserId])).rows[0]
        : sqliteDb.prepare(`SELECT * FROM price_alert_rules WHERE id = ? AND user_id = ? LIMIT 1`).get(normalizedAlertId, normalizedUserId)
    ) || null;
    if (!existing) return null;

    const next = {
      origin_iata: Object.hasOwn(updates, 'originIata') ? normalizeIata(updates.originIata, 'originIata') : String(existing.origin_iata || '').toUpperCase(),
      destination_iata: Object.hasOwn(updates, 'destinationIata') ? normalizeIata(updates.destinationIata, 'destinationIata') : String(existing.destination_iata || '').toUpperCase(),
      date_from: Object.hasOwn(updates, 'dateFrom') ? normalizeDate(updates.dateFrom, 'dateFrom') : String(existing.date_from || '').slice(0, 10),
      date_to: Object.hasOwn(updates, 'dateTo') ? normalizeDate(updates.dateTo, 'dateTo') : String(existing.date_to || '').slice(0, 10),
      max_price: Object.hasOwn(updates, 'maxPrice') ? Math.round(toNumber(updates.maxPrice, NaN) * 100) / 100 : toNumber(existing.max_price, 0),
      currency: Object.hasOwn(updates, 'currency') ? normalizeCurrency(updates.currency) : normalizeCurrency(existing.currency || 'EUR'),
      channels_json: Object.hasOwn(updates, 'channels') ? normalizeChannels(updates.channels) : parseChannels(existing.channels_json),
      enabled: Object.hasOwn(updates, 'enabled') ? normalizeBoolean(updates.enabled, true) : normalizeBoolean(existing.enabled, true)
    };

    if (!Number.isFinite(next.max_price) || next.max_price <= 0) throw new Error('Invalid maxPrice. Expected positive number.');
    assertDateWindow(next.date_from, next.date_to);

    if (mode === 'postgres') {
      const result = await pgPool.query(
        `UPDATE price_alert_rules
         SET origin_iata = $3,
             destination_iata = $4,
             date_from = $5::date,
             date_to = $6::date,
             max_price = $7,
             currency = $8,
             channels_json = $9::jsonb,
             enabled = $10,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [
          normalizedAlertId,
          normalizedUserId,
          next.origin_iata,
          next.destination_iata,
          next.date_from,
          next.date_to,
          next.max_price,
          next.currency,
          JSON.stringify(next.channels_json),
          next.enabled
        ]
      );
      return mapAlertRow(result.rows[0] || null);
    }

    sqliteDb
      .prepare(
        `UPDATE price_alert_rules
         SET origin_iata = ?,
             destination_iata = ?,
             date_from = ?,
             date_to = ?,
             max_price = ?,
             currency = ?,
             channels_json = ?,
             enabled = ?,
             updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`
      )
      .run(
        next.origin_iata,
        next.destination_iata,
        next.date_from,
        next.date_to,
        next.max_price,
        next.currency,
        JSON.stringify(next.channels_json),
        next.enabled ? 1 : 0,
        normalizedAlertId,
        normalizedUserId
      );
    const row = sqliteDb.prepare(`SELECT * FROM price_alert_rules WHERE id = ? AND user_id = ? LIMIT 1`).get(normalizedAlertId, normalizedUserId);
    return mapAlertRow(row || null);
  }

  async function deletePriceAlert({ userId, alertId }) {
    await ensureInitialized();
    const normalizedUserId = String(userId || '').trim();
    const normalizedAlertId = String(alertId || '').trim();
    if (!normalizedUserId || !normalizedAlertId) return { removed: false };

    if (mode === 'postgres') {
      const result = await pgPool.query(`DELETE FROM price_alert_rules WHERE id = $1 AND user_id = $2`, [normalizedAlertId, normalizedUserId]);
      return { removed: Number(result.rowCount || 0) > 0 };
    }

    const result = sqliteDb.prepare(`DELETE FROM price_alert_rules WHERE id = ? AND user_id = ?`).run(normalizedAlertId, normalizedUserId);
    return { removed: Number(result?.changes || 0) > 0 };
  }

  async function getWorkerCursor() {
    await ensureInitialized();
    if (mode === 'postgres') {
      const result = await pgPool.query(`SELECT last_observed_at FROM price_alert_worker_state WHERE id = 1`);
      return result.rows[0]?.last_observed_at ? new Date(result.rows[0].last_observed_at).toISOString() : null;
    }
    const row = sqliteDb.prepare(`SELECT last_observed_at FROM price_alert_worker_state WHERE id = 1`).get();
    return row?.last_observed_at ? new Date(row.last_observed_at).toISOString() : null;
  }

  async function setWorkerCursor(lastObservedAt) {
    await ensureInitialized();
    const iso = lastObservedAt ? new Date(lastObservedAt).toISOString() : null;
    if (mode === 'postgres') {
      await pgPool.query(
        `INSERT INTO price_alert_worker_state (id, last_observed_at, updated_at)
         VALUES (1, $1::timestamptz, NOW())
         ON CONFLICT (id) DO UPDATE
           SET last_observed_at = EXCLUDED.last_observed_at,
               updated_at = NOW()`,
        [iso]
      );
      return;
    }
    sqliteDb
      .prepare(
        `INSERT INTO price_alert_worker_state (id, last_observed_at, updated_at)
         VALUES (1, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE
           SET last_observed_at = excluded.last_observed_at,
               updated_at = datetime('now')`
      )
      .run(iso);
  }

  async function listMatchingDeals({ sinceObservedAt = null, limit = 500 } = {}) {
    const sourceStatus = await ensureSourceStatus();
    if (!sourceStatus.ok) return { skipped: true, reason: sourceStatus.reason, matches: [] };

    const safeLimit = Math.max(1, Math.min(5000, Number(limit || 500)));
    const sinceIso = sinceObservedAt ? new Date(sinceObservedAt).toISOString() : '1970-01-01T00:00:00.000Z';

    if (mode === 'postgres') {
      const result = await pgPool.query(
        `
          WITH recent_deals AS (
            SELECT
              dd.id AS detected_deal_id,
              dd.deal_key,
              dd.route_id,
              dd.flight_quote_id,
              dd.price AS deal_price,
              dd.final_score,
              dd.savings_pct,
              dd.published_at,
              dd.source_observed_at,
              fq.departure_date,
              fq.return_date,
              fq.trip_type,
              fq.stops,
              fq.provider,
              fq.currency,
              r.origin_iata,
              r.destination_iata
            FROM detected_deals dd
            JOIN flight_quotes fq ON fq.id = dd.flight_quote_id
            JOIN routes r ON r.id = dd.route_id
            WHERE dd.status = 'published'
              AND dd.source_observed_at > $1::timestamptz
              AND fq.departure_date >= CURRENT_DATE
            ORDER BY dd.source_observed_at ASC
            LIMIT $2
          )
          SELECT
            pa.id AS alert_id,
            pa.user_id,
            pa.max_price,
            pa.currency AS alert_currency,
            pa.channels_json,
            rd.*
          FROM price_alert_rules pa
          JOIN recent_deals rd
            ON UPPER(rd.origin_iata) = pa.origin_iata
           AND UPPER(rd.destination_iata) = pa.destination_iata
           AND rd.departure_date >= pa.date_from
           AND rd.departure_date <= pa.date_to
           AND rd.deal_price <= pa.max_price
           AND UPPER(rd.currency) = pa.currency
          WHERE pa.enabled = true
          ORDER BY rd.source_observed_at ASC, rd.final_score DESC
        `,
        [sinceIso, safeLimit]
      );
      return { skipped: false, reason: null, matches: result.rows.map(mapMatchRow) };
    }

    const rows = sqliteDb
      .prepare(
        `
          WITH recent_deals AS (
            SELECT
              dd.id AS detected_deal_id,
              dd.deal_key,
              dd.route_id,
              dd.flight_quote_id,
              dd.price AS deal_price,
              dd.final_score,
              dd.savings_pct,
              dd.published_at,
              dd.source_observed_at,
              fq.departure_date,
              fq.return_date,
              fq.trip_type,
              fq.stops,
              fq.provider,
              fq.currency,
              r.origin_iata,
              r.destination_iata
            FROM detected_deals dd
            JOIN flight_quotes fq ON fq.id = dd.flight_quote_id
            JOIN routes r ON r.id = dd.route_id
            WHERE dd.status = 'published'
              AND datetime(dd.source_observed_at) > datetime(?)
              AND date(fq.departure_date) >= date('now')
            ORDER BY datetime(dd.source_observed_at) ASC
            LIMIT ?
          )
          SELECT
            pa.id AS alert_id,
            pa.user_id,
            pa.max_price,
            pa.currency AS alert_currency,
            pa.channels_json,
            rd.*
          FROM price_alert_rules pa
          JOIN recent_deals rd
            ON UPPER(rd.origin_iata) = pa.origin_iata
           AND UPPER(rd.destination_iata) = pa.destination_iata
           AND date(rd.departure_date) >= date(pa.date_from)
           AND date(rd.departure_date) <= date(pa.date_to)
           AND rd.deal_price <= pa.max_price
           AND UPPER(rd.currency) = pa.currency
          WHERE pa.enabled = 1
          ORDER BY datetime(rd.source_observed_at) ASC, rd.final_score DESC
        `
      )
      .all(sinceIso, safeLimit);
    return { skipped: false, reason: null, matches: rows.map(mapMatchRow) };
  }

  async function claimDelivery({ alertId, userId, dealKey, channel }) {
    await ensureInitialized();
    const safeAlertId = String(alertId || '').trim();
    const safeUserId = String(userId || '').trim();
    const safeDealKey = String(dealKey || '').trim();
    const safeChannel = String(channel || '').trim().toLowerCase();
    if (!safeAlertId || !safeUserId || !safeDealKey || !['push', 'email', 'in_app'].includes(safeChannel)) return false;

    if (mode === 'postgres') {
      const result = await pgPool.query(
        `INSERT INTO price_alert_deliveries (alert_id, user_id, deal_key, channel, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (alert_id, deal_key, channel) DO NOTHING
         RETURNING id`,
        [safeAlertId, safeUserId, safeDealKey, safeChannel]
      );
      return Boolean(result.rows[0]?.id);
    }

    const row = sqliteDb
      .prepare(
        `INSERT OR IGNORE INTO price_alert_deliveries (alert_id, user_id, deal_key, channel, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         RETURNING id`
      )
      .get(safeAlertId, safeUserId, safeDealKey, safeChannel);
    return Boolean(row?.id);
  }

  async function markAlertsChecked(alertIds, checkedAt = new Date().toISOString()) {
    await ensureInitialized();
    const ids = [...new Set((Array.isArray(alertIds) ? alertIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (ids.length === 0) return;
    const iso = new Date(checkedAt).toISOString();
    if (mode === 'postgres') {
      await pgPool.query(
        `UPDATE price_alert_rules
         SET last_checked_at = $2::timestamptz,
             updated_at = NOW()
         WHERE id = ANY($1::text[])`,
        [ids, iso]
      );
      return;
    }
    const stmt = sqliteDb.prepare(
      `UPDATE price_alert_rules
       SET last_checked_at = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    );
    for (const id of ids) stmt.run(iso, id);
  }

  async function markAlertsTriggered(alertIds, triggeredAt = new Date().toISOString()) {
    await ensureInitialized();
    const ids = [...new Set((Array.isArray(alertIds) ? alertIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (ids.length === 0) return;
    const iso = new Date(triggeredAt).toISOString();
    if (mode === 'postgres') {
      await pgPool.query(
        `UPDATE price_alert_rules
         SET last_triggered_at = $2::timestamptz,
             updated_at = NOW()
         WHERE id = ANY($1::text[])`,
        [ids, iso]
      );
      return;
    }
    const stmt = sqliteDb.prepare(
      `UPDATE price_alert_rules
       SET last_triggered_at = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    );
    for (const id of ids) stmt.run(iso, id);
  }

  return {
    createPriceAlert,
    updatePriceAlert,
    deletePriceAlert,
    listPriceAlerts,
    listMatchingDeals,
    claimDelivery,
    getWorkerCursor,
    setWorkerCursor,
    markAlertsChecked,
    markAlertsTriggered,
    getMode: () => mode
  };
}

let singleton = null;

export function getPriceAlertsStore() {
  if (!singleton) singleton = createPriceAlertsStore();
  return singleton;
}
