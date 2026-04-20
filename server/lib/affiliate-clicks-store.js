/**
 * affiliate-clicks-store.js
 *
 * Persistent storage for affiliate click events.
 * Uses the same postgres/sqlite dual-mode pattern as deal-engine-store.js.
 *
 * Table: affiliate_clicks
 *   Stores one row per click redirect.
 *
 * Table: affiliate_conversions (schema only — populated via postback webhook)
 *   Reserved for future conversion tracking.
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { logger } from './logger.js';

const DB_FILE_PATH = fileURLToPath(new URL('../../data/app.db', import.meta.url));

let initialized = false;
let sqliteDb = null;
let pgPool = null;

function getMode() {
  return process.env.DATABASE_URL ? 'postgres' : 'sqlite';
}

// ── Schema ────────────────────────────────────────────────────────────────────

const POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS affiliate_clicks (
    id               BIGSERIAL PRIMARY KEY,
    deal_id          TEXT NOT NULL,
    provider         TEXT NOT NULL DEFAULT 'tde_booking',
    origin           TEXT NOT NULL DEFAULT '',
    destination      TEXT NOT NULL DEFAULT '',
    departure_date   TEXT,
    return_date      TEXT,
    cabin_class      TEXT NOT NULL DEFAULT 'economy',
    trip_type        TEXT NOT NULL DEFAULT 'round_trip',
    price            NUMERIC(10,2),
    deal_type        TEXT,
    deal_confidence  INTEGER,
    estimated_commission NUMERIC(8,4) DEFAULT 0,
    user_id          TEXT,
    session_id       TEXT,
    ip_hash          TEXT,
    user_agent_hash  TEXT,
    surface          TEXT NOT NULL DEFAULT 'deal_feed',
    affiliate_url    TEXT,
    clicked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS aff_clicks_clicked_at ON affiliate_clicks(clicked_at DESC);
  CREATE INDEX IF NOT EXISTS aff_clicks_provider ON affiliate_clicks(provider);
  CREATE INDEX IF NOT EXISTS aff_clicks_route ON affiliate_clicks(origin, destination);
  CREATE INDEX IF NOT EXISTS aff_clicks_deal_id ON affiliate_clicks(deal_id);
  CREATE INDEX IF NOT EXISTS aff_clicks_user_id ON affiliate_clicks(user_id) WHERE user_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS affiliate_conversions (
    id               BIGSERIAL PRIMARY KEY,
    click_id         BIGINT REFERENCES affiliate_clicks(id),
    deal_id          TEXT NOT NULL,
    provider         TEXT NOT NULL,
    origin           TEXT,
    destination      TEXT,
    booking_value    NUMERIC(10,2),
    commission_earned NUMERIC(8,4),
    postback_token   TEXT UNIQUE,
    postback_received_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS aff_conv_deal_id ON affiliate_conversions(deal_id);
  CREATE INDEX IF NOT EXISTS aff_conv_postback_token ON affiliate_conversions(postback_token) WHERE postback_token IS NOT NULL;
`;

const SQLITE_SCHEMA = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS affiliate_clicks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id          TEXT NOT NULL,
    provider         TEXT NOT NULL DEFAULT 'tde_booking',
    origin           TEXT NOT NULL DEFAULT '',
    destination      TEXT NOT NULL DEFAULT '',
    departure_date   TEXT,
    return_date      TEXT,
    cabin_class      TEXT NOT NULL DEFAULT 'economy',
    trip_type        TEXT NOT NULL DEFAULT 'round_trip',
    price            REAL,
    deal_type        TEXT,
    deal_confidence  INTEGER,
    estimated_commission REAL DEFAULT 0,
    user_id          TEXT,
    session_id       TEXT,
    ip_hash          TEXT,
    user_agent_hash  TEXT,
    surface          TEXT NOT NULL DEFAULT 'deal_feed',
    affiliate_url    TEXT,
    clicked_at       TEXT NOT NULL DEFAULT (datetime('now')),
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS aff_clicks_clicked_at ON affiliate_clicks(clicked_at DESC);
  CREATE INDEX IF NOT EXISTS aff_clicks_provider ON affiliate_clicks(provider);
  CREATE INDEX IF NOT EXISTS aff_clicks_route ON affiliate_clicks(origin, destination);
  CREATE INDEX IF NOT EXISTS aff_clicks_deal_id ON affiliate_clicks(deal_id);

  CREATE TABLE IF NOT EXISTS affiliate_conversions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    click_id         INTEGER REFERENCES affiliate_clicks(id),
    deal_id          TEXT NOT NULL,
    provider         TEXT NOT NULL,
    origin           TEXT,
    destination      TEXT,
    booking_value    REAL,
    commission_earned REAL,
    postback_token   TEXT UNIQUE,
    postback_received_at TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// ── Init ──────────────────────────────────────────────────────────────────────

async function ensureInitialized() {
  if (initialized) return;
  if (getMode() === 'postgres') {
    if (!pgPool) pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pgPool.query(POSTGRES_SCHEMA);
  } else {
    if (!sqliteDb) {
      await mkdir(dirname(DB_FILE_PATH), { recursive: true });
      const sqlite = await import('node:sqlite');
      sqliteDb = new sqlite.DatabaseSync(DB_FILE_PATH);
      sqliteDb.exec(SQLITE_SCHEMA);
    }
  }
  initialized = true;
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Persists one click event.
 * Called from the /api/redirect/:dealId handler before issuing the 302.
 *
 * @param {{
 *   dealId: string,
 *   provider: string,
 *   origin: string,
 *   destination: string,
 *   departureDate?: string,
 *   returnDate?: string,
 *   cabinClass?: string,
 *   tripType?: string,
 *   price?: number,
 *   dealType?: string,
 *   dealConfidence?: number,
 *   estimatedCommission?: number,
 *   userId?: string,
 *   sessionId?: string,
 *   ipHash?: string,
 *   userAgentHash?: string,
 *   surface?: string,
 *   affiliateUrl?: string
 * }} data
 * @returns {Promise<{id: number|bigint}>}
 */
export async function insertAffiliateClick(data) {
  await ensureInitialized();

  const {
    dealId,
    provider = 'tde_booking',
    origin = '',
    destination = '',
    departureDate = null,
    returnDate = null,
    cabinClass = 'economy',
    tripType = 'round_trip',
    price = null,
    dealType = null,
    dealConfidence = null,
    estimatedCommission = 0,
    userId = null,
    sessionId = null,
    ipHash = null,
    userAgentHash = null,
    surface = 'deal_feed',
    affiliateUrl = null
  } = data;

  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `INSERT INTO affiliate_clicks
         (deal_id, provider, origin, destination, departure_date, return_date,
          cabin_class, trip_type, price, deal_type, deal_confidence, estimated_commission,
          user_id, session_id, ip_hash, user_agent_hash, surface, affiliate_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [dealId, provider, origin, destination, departureDate, returnDate,
       cabinClass, tripType, price, dealType, dealConfidence, estimatedCommission,
       userId, sessionId, ipHash, userAgentHash, surface, affiliateUrl]
    );
    return { id: result.rows[0]?.id };
  }

  const row = sqliteDb.prepare(
    `INSERT INTO affiliate_clicks
       (deal_id, provider, origin, destination, departure_date, return_date,
        cabin_class, trip_type, price, deal_type, deal_confidence, estimated_commission,
        user_id, session_id, ip_hash, user_agent_hash, surface, affiliate_url)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     RETURNING id`
  ).get(
    dealId, provider, origin, destination, departureDate, returnDate,
    cabinClass, tripType, price, dealType, dealConfidence, estimatedCommission,
    userId, sessionId, ipHash, userAgentHash, surface, affiliateUrl
  );
  return { id: row?.id };
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/**
 * Returns aggregated affiliate stats for the admin dashboard.
 *
 * @param {number} windowDays  Lookback window (default 30 days)
 * @returns {Promise<object>}
 */
export async function getAffiliateStats(windowDays = 30) {
  await ensureInitialized();
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString().slice(0, 10);

  if (getMode() === 'postgres') {
    const [summary, byProvider, byRoute, byDealType, conversions] = await Promise.all([
      pgPool.query(
        `SELECT
           COUNT(*) AS total_clicks,
           COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS unique_users,
           COALESCE(SUM(estimated_commission), 0)::numeric(10,4) AS estimated_revenue,
           COALESCE(AVG(price), 0)::numeric(10,2) AS avg_price,
           COUNT(*) FILTER (WHERE deal_type = 'error_fare') AS error_fare_clicks,
           COUNT(*) FILTER (WHERE deal_type = 'flash_sale') AS flash_sale_clicks,
           COUNT(*) FILTER (WHERE deal_type = 'hidden_deal') AS hidden_deal_clicks
         FROM affiliate_clicks
         WHERE clicked_at >= $1`,
        [since]
      ),
      pgPool.query(
        `SELECT provider, COUNT(*) AS clicks,
                COALESCE(SUM(estimated_commission), 0)::numeric(10,4) AS est_revenue
         FROM affiliate_clicks WHERE clicked_at >= $1
         GROUP BY provider ORDER BY clicks DESC`,
        [since]
      ),
      pgPool.query(
        `SELECT origin, destination, COUNT(*) AS clicks
         FROM affiliate_clicks WHERE clicked_at >= $1
         GROUP BY origin, destination ORDER BY clicks DESC LIMIT 20`,
        [since]
      ),
      pgPool.query(
        `SELECT deal_type, COUNT(*) AS clicks, AVG(deal_confidence)::numeric(6,1) AS avg_confidence
         FROM affiliate_clicks WHERE clicked_at >= $1 AND deal_type IS NOT NULL
         GROUP BY deal_type ORDER BY clicks DESC`,
        [since]
      ),
      pgPool.query(
        `SELECT COUNT(*) AS total_conversions,
                COALESCE(SUM(commission_earned), 0)::numeric(10,4) AS total_commission
         FROM affiliate_conversions WHERE created_at >= $1`,
        [since]
      )
    ]);
    return _buildStatsPayload(windowDays, summary.rows[0], byProvider.rows, byRoute.rows, byDealType.rows, conversions.rows[0]);
  }

  // SQLite aggregations
  const summary = sqliteDb.prepare(
    `SELECT
       COUNT(*) AS total_clicks,
       COUNT(DISTINCT user_id) AS unique_users,
       COALESCE(SUM(estimated_commission), 0) AS estimated_revenue,
       COALESCE(AVG(price), 0) AS avg_price,
       SUM(CASE WHEN deal_type='error_fare' THEN 1 ELSE 0 END) AS error_fare_clicks,
       SUM(CASE WHEN deal_type='flash_sale' THEN 1 ELSE 0 END) AS flash_sale_clicks,
       SUM(CASE WHEN deal_type='hidden_deal' THEN 1 ELSE 0 END) AS hidden_deal_clicks
     FROM affiliate_clicks WHERE clicked_at >= ?`
  ).get(since);

  const byProvider = sqliteDb.prepare(
    `SELECT provider, COUNT(*) AS clicks, COALESCE(SUM(estimated_commission), 0) AS est_revenue
     FROM affiliate_clicks WHERE clicked_at >= ? GROUP BY provider ORDER BY clicks DESC`
  ).all(since);

  const byRoute = sqliteDb.prepare(
    `SELECT origin, destination, COUNT(*) AS clicks
     FROM affiliate_clicks WHERE clicked_at >= ?
     GROUP BY origin, destination ORDER BY clicks DESC LIMIT 20`
  ).all(since);

  const byDealType = sqliteDb.prepare(
    `SELECT deal_type, COUNT(*) AS clicks, AVG(deal_confidence) AS avg_confidence
     FROM affiliate_clicks WHERE clicked_at >= ? AND deal_type IS NOT NULL
     GROUP BY deal_type ORDER BY clicks DESC`
  ).all(since);

  const conversions = sqliteDb.prepare(
    `SELECT COUNT(*) AS total_conversions, COALESCE(SUM(commission_earned), 0) AS total_commission
     FROM affiliate_conversions WHERE created_at >= ?`
  ).get(since);

  return _buildStatsPayload(windowDays, summary, byProvider, byRoute, byDealType, conversions);
}

function _buildStatsPayload(windowDays, summary, byProvider, byRoute, byDealType, conversions) {
  const totalClicks = Number(summary?.total_clicks || 0);
  const totalConversions = Number(conversions?.total_conversions || 0);
  const conversionRate = totalClicks > 0 ? Math.round((totalConversions / totalClicks) * 10000) / 100 : 0;

  return {
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    summary: {
      total_clicks: totalClicks,
      unique_users: Number(summary?.unique_users || 0),
      estimated_revenue_eur: Number(summary?.estimated_revenue || 0),
      avg_price_eur: Number(summary?.avg_price || 0),
      total_conversions: totalConversions,
      conversion_rate_pct: conversionRate,
      total_commission_earned_eur: Number(conversions?.total_commission || 0),
      by_deal_type: {
        error_fare: Number(summary?.error_fare_clicks || 0),
        flash_sale: Number(summary?.flash_sale_clicks || 0),
        hidden_deal: Number(summary?.hidden_deal_clicks || 0)
      }
    },
    by_provider: (byProvider || []).map((r) => ({
      provider: r.provider,
      clicks: Number(r.clicks),
      est_revenue_eur: Number(r.est_revenue || 0)
    })),
    top_routes: (byRoute || []).map((r) => ({
      route: `${r.origin}-${r.destination}`,
      origin: r.origin,
      destination: r.destination,
      clicks: Number(r.clicks)
    })),
    by_deal_type: (byDealType || []).map((r) => ({
      deal_type: r.deal_type,
      clicks: Number(r.clicks),
      avg_confidence: Number(r.avg_confidence || 0)
    }))
  };
}

/**
 * Records a postback conversion (called by provider webhook).
 * Schema is prepared; actual postback handling requires provider-specific
 * webhook endpoint setup (Kiwi/Skyscanner affiliate portal configuration).
 */
export async function recordConversion({ dealId, provider, postbackToken, bookingValue, commissionEarned, clickId = null }) {
  await ensureInitialized();
  try {
    if (getMode() === 'postgres') {
      await pgPool.query(
        `INSERT INTO affiliate_conversions
           (click_id, deal_id, provider, booking_value, commission_earned, postback_token, postback_received_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (postback_token) DO NOTHING`,
        [clickId, dealId, provider, bookingValue, commissionEarned, postbackToken]
      );
    } else {
      sqliteDb.prepare(
        `INSERT OR IGNORE INTO affiliate_conversions
           (click_id, deal_id, provider, booking_value, commission_earned, postback_token, postback_received_at)
         VALUES (?,?,?,?,?,?,datetime('now'))`
      ).run(clickId, dealId, provider, bookingValue, commissionEarned, postbackToken);
    }
  } catch (err) {
    logger.warn({ err, dealId, provider }, 'affiliate_conversion_record_failed');
  }
}

export async function initAffiliateClicksStore() {
  await ensureInitialized();
}
