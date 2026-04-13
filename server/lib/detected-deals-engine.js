import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { logger as rootLogger } from './logger.js';

const SQLITE_DB_PATH = fileURLToPath(new URL('../../data/app.db', import.meta.url));
const DEAL_SCORE_WEIGHTS = Object.freeze({
  savings_percent: 0.4,
  route_popularity: 0.2,
  freshness: 0.15,
  user_interest: 0.15,
  low_stops: 0.1
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function toBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function round2(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function parseJsonObject(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeRouteId(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function confidenceMultiplier(level) {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'high') return 1;
  if (normalized === 'medium') return 0.95;
  if (normalized === 'low') return 0.88;
  return 0.78;
}

function opportunityLevelFromScore(score) {
  const value = toNumber(score, 0);
  if (value >= 86) return 'Rare opportunity';
  if (value >= 75) return 'Exceptional price';
  if (value >= 62) return 'Great deal';
  return 'Ignore if too weak';
}

function dealTypeFromScore(score) {
  const value = toNumber(score, 0);
  if (value >= 86) return 'rare_opportunity';
  if (value >= 75) return 'exceptional_price';
  return 'great_deal';
}

function scoreStops(stops) {
  const value = Math.max(0, Math.floor(toNumber(stops, 1)));
  if (value === 0) return 100;
  if (value === 1) return 75;
  if (value === 2) return 50;
  if (value === 3) return 25;
  return 0;
}

function scoreDurationMinutes(durationMinutes) {
  const value = toNumber(durationMinutes, NaN);
  if (!Number.isFinite(value) || value <= 0) return 60;
  if (value <= 180) return 100;
  if (value <= 360) return 88;
  if (value <= 540) return 76;
  if (value <= 780) return 62;
  if (value <= 1080) return 48;
  return 34;
}

function toIso(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function hasSqliteTable(sqliteDb, tableName) {
  const row = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(String(tableName || '').trim());
  return Boolean(row?.name);
}

function buildDealKey({ flightQuoteId, routeId, observedAt }) {
  const hash = createHash('sha1')
    .update(`${String(flightQuoteId)}|${String(routeId)}|${String(observedAt)}`)
    .digest('hex')
    .slice(0, 14);
  return `fq_${String(flightQuoteId)}_${hash}`;
}

function evaluateCandidate(row, { nowTs, minDiscountPct, nearMinRatio, rapidDropRatio, rapidDropMinPct, minScore, publishScore, expiryHours }) {
  const price = toNumber(row.total_price, 0);
  const avgPrice = toNumber(row.avg_price, 0);
  const minPrice = Math.max(0.01, toNumber(row.min_price, 0.01));
  const avg7 = Math.max(0, toNumber(row.avg_price_7d, avgPrice));
  const avg30 = Math.max(0, toNumber(row.avg_price_30d, avgPrice));
  const quoteSource = String(row.quote_source || row.source || '').trim().toLowerCase();
  const quoteMetadata = parseJsonObject(row.quote_metadata ?? row.metadata, {});
  const bootstrapFinalScore = toNumber(quoteMetadata.finalScore, NaN);
  const bootstrapBaselinePrice = toNumber(quoteMetadata.baselinePrice, NaN);
  const bootstrapSavingsPct = toNumber(quoteMetadata.savingsPct, NaN);
  const bootstrapSavingsAmount = toNumber(quoteMetadata.savingsAmount, NaN);
  const bootstrapOpportunityLevel = String(quoteMetadata.opportunityLevel || '').trim();
  const quotesCount = Math.max(0, toNumber(row.quotes_count, 0));
  const sparseHistoricalStats = quotesCount <= 2 || Math.abs(avgPrice - price) < 0.01;
  const bootstrapFallbackEligible =
    quoteSource === 'opportunity_bootstrap' &&
    quoteMetadata.bootstrap === true &&
    sparseHistoricalStats &&
    Number.isFinite(bootstrapFinalScore) &&
    bootstrapFinalScore >= minScore;
  const popularityRaw = Math.max(0, toNumber(row.route_popularity_30d, 0));
  const userSignalsRaw = Math.max(0, toNumber(row.user_signals_30d, 0));
  const observedAt = toIso(row.observed_at);
  const observedTs = new Date(observedAt).getTime();
  const ageHours = Math.max(0, (nowTs - observedTs) / (60 * 60 * 1000));

  if (price <= 0 || avgPrice <= 0) {
    return { valid: false, reason: 'invalid_price_or_baseline' };
  }

  const discountPct = ((avgPrice - price) / avgPrice) * 100;
  const nearMinDistancePct = ((price - minPrice) / minPrice) * 100;
  const rapidDropPct7d = avg7 > 0 ? ((avg7 - price) / avg7) * 100 : 0;
  const rapidDropPct30d = avg30 > 0 ? ((avg30 - price) / avg30) * 100 : 0;
  const prevPrice = toNumber(row.prev_price, 0);
  const rapidDropPctPrev = prevPrice > 0 ? ((prevPrice - price) / prevPrice) * 100 : 0;

  const isBelowHistoricalAvg = price < avgPrice && discountPct >= minDiscountPct;
  const isNearHistoricalMin = price <= minPrice * nearMinRatio;
  const isRapidDropBy7d = avg7 > 0 && price <= avg7 * rapidDropRatio && rapidDropPct7d >= rapidDropMinPct;
  const isRapidDropBy30d = avg30 > 0 && price <= avg30 * rapidDropRatio && rapidDropPct30d >= rapidDropMinPct;
  const isRapidDropByPrevious = prevPrice > 0 && rapidDropPctPrev >= rapidDropMinPct;
  const isRapidDrop = isRapidDropBy7d || isRapidDropBy30d || isRapidDropByPrevious;
  const gatesPassed = isBelowHistoricalAvg && isNearHistoricalMin && isRapidDrop;
  const usedBootstrapFallback = !gatesPassed && bootstrapFallbackEligible;

  if (!gatesPassed && !usedBootstrapFallback) {
    if (!isBelowHistoricalAvg) return { valid: false, reason: 'not_below_historical_avg' };
    if (!isNearHistoricalMin) return { valid: false, reason: 'not_near_historical_min' };
    return { valid: false, reason: 'price_not_dropping_fast' };
  }

  const discountScore = clamp((discountPct / 30) * 100, 0, 100);
  const popularityScore = clamp((Math.log1p(popularityRaw) / Math.log1p(400)) * 100, 0, 100);
  const durationScore = scoreDurationMinutes(row.duration_minutes);
  const stopsScore = scoreStops(row.stops);
  const freshnessScore = clamp(100 - ageHours * 2, 0, 100);
  const userSignalsScore = clamp((Math.log1p(userSignalsRaw) / Math.log1p(120)) * 100, 0, 100);
  const effectiveSavingsPct = Number.isFinite(bootstrapSavingsPct)
    ? bootstrapSavingsPct
    : Number.isFinite(bootstrapBaselinePrice) && bootstrapBaselinePrice > 0
      ? ((bootstrapBaselinePrice - price) / bootstrapBaselinePrice) * 100
      : discountPct;
  const savingsPercentScore = clamp(Math.max(0, effectiveSavingsPct), 0, 100);
  const lowStopsBonus = stopsScore;
  const dealScore = round2(
    savingsPercentScore * DEAL_SCORE_WEIGHTS.savings_percent +
      popularityScore * DEAL_SCORE_WEIGHTS.route_popularity +
      freshnessScore * DEAL_SCORE_WEIGHTS.freshness +
      userSignalsScore * DEAL_SCORE_WEIGHTS.user_interest +
      lowStopsBonus * DEAL_SCORE_WEIGHTS.low_stops
  );

  const rawScore =
    discountScore * 0.41 +
    popularityScore * 0.15 +
    durationScore * 0.08 +
    stopsScore * 0.12 +
    freshnessScore * 0.14 +
    userSignalsScore * 0.1;

  const nearMinStrength = clamp((nearMinRatio - price / minPrice) / Math.max(0.0001, nearMinRatio - 1), 0, 1);
  const rapidDropStrength = clamp(Math.max(rapidDropPct7d, rapidDropPct30d, rapidDropPctPrev) / 25, 0, 1);
  const confidence = confidenceMultiplier(row.confidence_level);
  const boostedFinal = rawScore * confidence + nearMinStrength * 6 + rapidDropStrength * 8;
  const computedFinalScore = clamp(round2(boostedFinal), 0, 100);
  const finalScore = usedBootstrapFallback ? clamp(Math.max(computedFinalScore, bootstrapFinalScore), 0, 100) : computedFinalScore;

  if (finalScore < minScore) return { valid: false, reason: 'score_too_low' };

  const baselinePriceRaw = Number.isFinite(bootstrapBaselinePrice) && bootstrapBaselinePrice > 0 ? bootstrapBaselinePrice : avgPrice;
  const baselinePrice = round2(Math.max(price, baselinePriceRaw));
  const savingsAmountRaw = Number.isFinite(bootstrapSavingsAmount) ? bootstrapSavingsAmount : baselinePrice - price;
  const savingsAmount = round2(Math.max(0, savingsAmountRaw));
  const savingsPct = round2(Math.max(0, Number.isFinite(bootstrapSavingsPct) ? bootstrapSavingsPct : effectiveSavingsPct));
  const status = finalScore >= publishScore ? 'published' : 'candidate';
  const publishedAt = status === 'published' ? new Date(nowTs).toISOString() : null;
  const expiresAt = new Date(observedTs + Math.max(1, Number(expiryHours || 120)) * 60 * 60 * 1000).toISOString();
  const opportunityLevel = usedBootstrapFallback && bootstrapOpportunityLevel ? bootstrapOpportunityLevel : opportunityLevelFromScore(finalScore);
  const rawRounded = round2(rawScore);
  const routeId = Number(row.route_id);
  const flightQuoteId = Number(row.flight_quote_id);

  return {
    valid: true,
    reason: null,
    finalScore,
    deal: {
      dealKey: buildDealKey({ flightQuoteId, routeId, observedAt }),
      flightQuoteId,
      routeId,
      dealType: dealTypeFromScore(finalScore),
      rawScore: rawRounded,
      finalScore,
      dealScore,
      opportunityLevel,
      price: round2(price),
      baselinePrice,
      savingsAmount,
      savingsPct,
      status,
      rejectionReason: null,
      scoreBreakdown: {
        model: 'detected_deals_v1',
        signals: {
          discount_pct: round2(discountPct),
          effective_savings_pct: round2(effectiveSavingsPct),
          near_min_distance_pct: round2(nearMinDistancePct),
          rapid_drop_pct_7d: round2(rapidDropPct7d),
          rapid_drop_pct_30d: round2(rapidDropPct30d),
          rapid_drop_pct_prev: round2(rapidDropPctPrev),
          route_popularity_30d: round2(popularityRaw),
          duration_minutes: toNumber(row.duration_minutes, 0),
          user_signals_30d: round2(userSignalsRaw),
          confidence_level: String(row.confidence_level || 'very_low')
        },
        components: {
          discount: round2(discountScore),
          popularity: round2(popularityScore),
          duration: round2(durationScore),
          stops: round2(stopsScore),
          freshness: round2(freshnessScore),
          user_signals: round2(userSignalsScore)
        },
        feed_ranking: {
          model: 'deal_score_v1',
          weights: DEAL_SCORE_WEIGHTS,
          components: {
            savings_percent: round2(savingsPercentScore),
            route_popularity: round2(popularityScore),
            freshness: round2(freshnessScore),
            user_interest: round2(userSignalsScore),
            low_stops_bonus: round2(lowStopsBonus)
          },
          deal_score: dealScore
        },
        gates: {
          below_historical_avg: isBelowHistoricalAvg,
          near_historical_min: isNearHistoricalMin,
          rapid_drop: isRapidDrop,
          bootstrap_fallback: usedBootstrapFallback
        },
        params: {
          min_discount_pct: minDiscountPct,
          near_min_ratio: nearMinRatio,
          rapid_drop_ratio: rapidDropRatio,
          rapid_drop_min_pct: rapidDropMinPct
        }
      },
      publishedAt,
      expiresAt,
      sourceObservedAt: observedAt
    }
  };
}

export function createDetectedDealsEngine(options = {}) {
  const forcedMode = String(options.mode || '').trim().toLowerCase();
  let mode = forcedMode === 'postgres' || forcedMode === 'sqlite' ? forcedMode : process.env.DATABASE_URL ? 'postgres' : 'sqlite';
  const logger = options.logger || rootLogger;

  let pgPool = options.pgPool || null;
  let sqliteDb = options.sqliteDb || null;
  let initialized = false;
  let schemaReady = true;
  let schemaReason = null;
  let pgQuoteContextColumns = null;
  let sqliteQuoteContextColumns = null;
  let pgHasTravelOpportunitiesTable = null;
  let sqliteHasTravelOpportunitiesTable = null;

  function getConfig(runtimeOptions = {}) {
    return {
      lookbackHours: Math.max(
        1,
        Math.min(720, Number(runtimeOptions.lookbackHours ?? options.lookbackHours ?? process.env.DETECTED_DEALS_LOOKBACK_HOURS ?? 72))
      ),
      signalLookbackDays: Math.max(
        1,
        Math.min(180, Number(runtimeOptions.signalLookbackDays ?? options.signalLookbackDays ?? process.env.DETECTED_DEALS_SIGNAL_LOOKBACK_DAYS ?? 30))
      ),
      maxCandidates: Math.max(
        50,
        Math.min(5000, Number(runtimeOptions.maxCandidates ?? options.maxCandidates ?? process.env.DETECTED_DEALS_MAX_CANDIDATES ?? 1000))
      ),
      maxPublishedPerRun: Math.max(
        10,
        Math.min(1000, Number(runtimeOptions.maxPublishedPerRun ?? options.maxPublishedPerRun ?? process.env.DETECTED_DEALS_MAX_PUBLISHED_PER_RUN ?? 1000))
      ),
      expiryHours: Math.max(
        12,
        Math.min(720, Number(runtimeOptions.expiryHours ?? options.expiryHours ?? process.env.DETECTED_DEALS_EXPIRY_HOURS ?? 120))
      ),
      minDiscountPct: Math.max(
        0.1,
        Math.min(70, Number(runtimeOptions.minDiscountPct ?? options.minDiscountPct ?? process.env.DETECTED_DEALS_MIN_DISCOUNT_PCT ?? 5))
      ),
      nearMinRatio: Math.max(
        1.0,
        Math.min(2.0, Number(runtimeOptions.nearMinRatio ?? options.nearMinRatio ?? process.env.DETECTED_DEALS_NEAR_MIN_RATIO ?? 1.12))
      ),
      rapidDropRatio: Math.max(
        0.5,
        Math.min(0.99, Number(runtimeOptions.rapidDropRatio ?? options.rapidDropRatio ?? process.env.DETECTED_DEALS_RAPID_DROP_RATIO ?? 0.93))
      ),
      rapidDropMinPct: Math.max(
        0.1,
        Math.min(80, Number(runtimeOptions.rapidDropMinPct ?? options.rapidDropMinPct ?? process.env.DETECTED_DEALS_RAPID_DROP_MIN_PCT ?? 6))
      ),
      minScore: Math.max(0, Math.min(100, Number(runtimeOptions.minScore ?? options.minScore ?? process.env.DETECTED_DEALS_MIN_SCORE ?? 55))),
      publishScore: Math.max(0, Math.min(100, Number(runtimeOptions.publishScore ?? options.publishScore ?? process.env.DETECTED_DEALS_PUBLISH_SCORE ?? 68))),
      publishFallbackEnabled: toBoolean(
        runtimeOptions.publishFallbackEnabled ??
          options.publishFallbackEnabled ??
          process.env.DETECTED_DEALS_PUBLISH_FALLBACK_ENABLED,
        true
      ),
      publishFallbackDelta: Math.max(
        1,
        Math.min(
          25,
          Number(runtimeOptions.publishFallbackDelta ?? options.publishFallbackDelta ?? process.env.DETECTED_DEALS_PUBLISH_FALLBACK_DELTA ?? 5)
        )
      ),
      publishFallbackMaxPerRun: Math.max(
        1,
        Math.min(
          200,
          Number(
            runtimeOptions.publishFallbackMaxPerRun ??
              options.publishFallbackMaxPerRun ??
              process.env.DETECTED_DEALS_PUBLISH_FALLBACK_MAX_PER_RUN ??
              20
          )
        )
      ),
      retentionDays: Math.max(
        7,
        Math.min(365, Number(runtimeOptions.retentionDays ?? options.retentionDays ?? process.env.DETECTED_DEALS_RETENTION_DAYS ?? 45))
      )
    };
  }

  async function ensurePostgresSchema() {
    if (!pgPool) {
      pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    }

    const refs = await pgPool.query(`
      SELECT
        to_regclass('public.routes') AS routes_ref,
        to_regclass('public.flight_quotes') AS flight_quotes_ref,
        to_regclass('public.route_price_stats') AS route_price_stats_ref
    `);
    const row = refs.rows[0] || {};
    if (!row.routes_ref || !row.flight_quotes_ref || !row.route_price_stats_ref) {
      schemaReady = false;
      schemaReason = !row.flight_quotes_ref ? 'flight_quotes_missing' : !row.route_price_stats_ref ? 'route_price_stats_missing' : 'routes_missing';
      return;
    }

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS user_events (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NULL,
        event_type TEXT NOT NULL,
        event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        session_id TEXT NULL,
        route_id BIGINT NULL,
        deal_id BIGINT NULL,
        alert_id BIGINT NULL,
        price_seen NUMERIC(10,2) NULL,
        channel TEXT NOT NULL DEFAULT 'app',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_user_events_route_ts ON user_events(route_id, event_ts DESC);
      CREATE INDEX IF NOT EXISTS idx_user_events_type_ts ON user_events(event_type, event_ts DESC);
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS detected_deals (
        id BIGSERIAL PRIMARY KEY,
        deal_key TEXT NOT NULL,
        flight_quote_id BIGINT NOT NULL REFERENCES flight_quotes(id) ON DELETE CASCADE,
        route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        deal_type TEXT NOT NULL DEFAULT 'great_deal',
        raw_score NUMERIC(6,2) NOT NULL,
        final_score NUMERIC(6,2) NOT NULL,
        deal_score NUMERIC(6,2) NULL,
        opportunity_level TEXT NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        baseline_price NUMERIC(10,2) NULL,
        savings_amount NUMERIC(10,2) NULL,
        savings_pct NUMERIC(6,2) NULL,
        status TEXT NOT NULL DEFAULT 'candidate',
        rejection_reason TEXT NULL,
        score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
        ai_title TEXT NULL,
        ai_description TEXT NULL,
        published_at TIMESTAMPTZ NULL,
        expires_at TIMESTAMPTZ NULL,
        source_observed_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_detected_deals_key UNIQUE (deal_key)
      );
      CREATE INDEX IF NOT EXISTS idx_detected_deals_feed
        ON detected_deals(status, final_score DESC, published_at DESC, source_observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_detected_deals_route_status
        ON detected_deals(route_id, status, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_detected_deals_quote
        ON detected_deals(flight_quote_id);
      CREATE INDEX IF NOT EXISTS idx_detected_deals_expiration
        ON detected_deals(status, expires_at, source_observed_at DESC);
      ALTER TABLE detected_deals
        ADD COLUMN IF NOT EXISTS deal_score NUMERIC(6,2) NULL;
      CREATE INDEX IF NOT EXISTS idx_detected_deals_feed_deal_score
        ON detected_deals(status, deal_score DESC NULLS LAST, source_observed_at DESC);
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
      CREATE TABLE IF NOT EXISTS user_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NULL,
        event_type TEXT NOT NULL,
        event_ts TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT NULL,
        route_id INTEGER NULL,
        deal_id INTEGER NULL,
        alert_id INTEGER NULL,
        price_seen REAL NULL,
        channel TEXT NOT NULL DEFAULT 'app',
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_user_events_route_ts ON user_events(route_id, event_ts DESC);
      CREATE INDEX IF NOT EXISTS idx_user_events_type_ts ON user_events(event_type, event_ts DESC);

      CREATE TABLE IF NOT EXISTS detected_deals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deal_key TEXT NOT NULL UNIQUE,
        flight_quote_id INTEGER NOT NULL,
        route_id INTEGER NOT NULL,
        deal_type TEXT NOT NULL DEFAULT 'great_deal',
        raw_score REAL NOT NULL,
        final_score REAL NOT NULL,
        deal_score REAL NULL,
        opportunity_level TEXT NOT NULL,
        price REAL NOT NULL,
        baseline_price REAL NULL,
        savings_amount REAL NULL,
        savings_pct REAL NULL,
        status TEXT NOT NULL DEFAULT 'candidate',
        rejection_reason TEXT NULL,
        score_breakdown TEXT NOT NULL DEFAULT '{}',
        ai_title TEXT NULL,
        ai_description TEXT NULL,
        published_at TEXT NULL,
        expires_at TEXT NULL,
        source_observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_detected_deals_feed
        ON detected_deals(status, final_score DESC, published_at DESC, source_observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_detected_deals_route_status
        ON detected_deals(route_id, status, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_detected_deals_quote
        ON detected_deals(flight_quote_id);
      CREATE INDEX IF NOT EXISTS idx_detected_deals_expiration
        ON detected_deals(status, expires_at, source_observed_at DESC);
    `);
    try {
      sqliteDb.exec(`ALTER TABLE detected_deals ADD COLUMN deal_score REAL NULL`);
    } catch {}
    try {
      sqliteDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_detected_deals_feed_deal_score
          ON detected_deals(status, deal_score DESC, source_observed_at DESC)
      `);
    } catch {}
  }

  async function ensureInitialized() {
    if (initialized) return;
    mode = forcedMode === 'postgres' || forcedMode === 'sqlite' ? forcedMode : process.env.DATABASE_URL ? 'postgres' : 'sqlite';
    if (mode === 'postgres') await ensurePostgresSchema();
    else await ensureSqliteSchema();
    initialized = true;
  }

  async function hasSourceTables() {
    if (mode === 'postgres') {
      const refs = await pgPool.query(`
        SELECT
          to_regclass('public.flight_quotes') AS flight_quotes_ref,
          to_regclass('public.route_price_stats') AS route_price_stats_ref
      `);
      const row = refs.rows[0] || {};
      if (!row.flight_quotes_ref) return { ok: false, reason: 'flight_quotes_missing' };
      if (!row.route_price_stats_ref) return { ok: false, reason: 'route_price_stats_missing' };
      return { ok: true, reason: null };
    }
    if (!hasSqliteTable(sqliteDb, 'flight_quotes')) return { ok: false, reason: 'flight_quotes_missing' };
    if (!hasSqliteTable(sqliteDb, 'route_price_stats')) return { ok: false, reason: 'route_price_stats_missing' };
    return { ok: true, reason: null };
  }

  async function getPostgresQuoteContextColumns() {
    if (pgQuoteContextColumns) return pgQuoteContextColumns;
    const result = await pgPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'flight_quotes'
        AND column_name IN ('source', 'metadata')
    `);
    const names = new Set((result.rows || []).map((row) => String(row.column_name || '').trim().toLowerCase()));
    pgQuoteContextColumns = {
      source: names.has('source'),
      metadata: names.has('metadata')
    };
    return pgQuoteContextColumns;
  }

  function getSqliteQuoteContextColumns() {
    if (sqliteQuoteContextColumns) return sqliteQuoteContextColumns;
    const columns = sqliteDb.prepare(`PRAGMA table_info(flight_quotes)`).all();
    const names = new Set((columns || []).map((col) => String(col.name || '').trim().toLowerCase()));
    sqliteQuoteContextColumns = {
      source: names.has('source'),
      metadata: names.has('metadata')
    };
    return sqliteQuoteContextColumns;
  }

  async function loadQuoteContextMap(candidates) {
    const ids = Array.from(
      new Set(candidates.map((row) => Number(row.flight_quote_id)).filter((id) => Number.isInteger(id) && id > 0))
    );
    const map = new Map();
    if (ids.length === 0) return map;

    if (mode === 'postgres') {
      const columns = await getPostgresQuoteContextColumns();
      if (!columns.source && !columns.metadata) return map;
      const sourceExpr = columns.source ? 'source' : 'NULL::text AS source';
      const metadataExpr = columns.metadata ? 'metadata' : `'{}'::jsonb AS metadata`;
      const result = await pgPool.query(
        `
          SELECT id, ${sourceExpr}, ${metadataExpr}
          FROM flight_quotes
          WHERE id = ANY($1::bigint[])
        `,
        [ids]
      );
      for (const row of result.rows || []) {
        map.set(Number(row.id), {
          source: row.source || null,
          metadata: row.metadata ?? null
        });
      }
      return map;
    }

    const columns = getSqliteQuoteContextColumns();
    if (!columns.source && !columns.metadata) return map;
    const placeholders = ids.map(() => '?').join(', ');
    const sourceExpr = columns.source ? 'source' : 'NULL AS source';
    const metadataExpr = columns.metadata ? 'metadata' : 'NULL AS metadata';
    const rows = sqliteDb
      .prepare(
        `
          SELECT id, ${sourceExpr}, ${metadataExpr}
          FROM flight_quotes
          WHERE id IN (${placeholders})
        `
      )
      .all(...ids);
    for (const row of rows || []) {
      map.set(Number(row.id), {
        source: row.source || null,
        metadata: row.metadata ?? null
      });
    }
    return map;
  }

  async function hasTravelOpportunitiesTable() {
    if (mode === 'postgres') {
      if (pgHasTravelOpportunitiesTable != null) return pgHasTravelOpportunitiesTable;
      const result = await pgPool.query(`SELECT to_regclass('public.travel_opportunities') AS ref`);
      pgHasTravelOpportunitiesTable = Boolean(result.rows?.[0]?.ref);
      return pgHasTravelOpportunitiesTable;
    }
    if (sqliteHasTravelOpportunitiesTable != null) return sqliteHasTravelOpportunitiesTable;
    sqliteHasTravelOpportunitiesTable = hasSqliteTable(sqliteDb, 'travel_opportunities');
    return sqliteHasTravelOpportunitiesTable;
  }

  async function enrichBootstrapQuoteContextFromOpportunities(quoteContext) {
    if (!(quoteContext instanceof Map) || quoteContext.size === 0) return;

    const opportunityIds = new Set();
    for (const context of quoteContext.values()) {
      const source = String(context?.source || '').trim().toLowerCase();
      if (source !== 'opportunity_bootstrap') continue;
      const metadata = parseJsonObject(context?.metadata, {});
      const id = String(metadata?.opportunityId || '').trim();
      if (!id) continue;
      opportunityIds.add(id);
    }

    if (opportunityIds.size === 0) return;
    if (!(await hasTravelOpportunitiesTable())) return;

    const idList = Array.from(opportunityIds);
    const opportunityMap = new Map();
    if (mode === 'postgres') {
      const result = await pgPool.query(
        `
          SELECT
            id::text AS id,
            price,
            baseline_price,
            savings_percent_if_available,
            final_score,
            opportunity_level
          FROM travel_opportunities
          WHERE id = ANY($1::text[])
        `,
        [idList]
      );
      for (const row of result.rows || []) {
        opportunityMap.set(String(row.id), row);
      }
    } else {
      const placeholders = idList.map(() => '?').join(', ');
      const rows = sqliteDb
        .prepare(
          `
            SELECT
              id,
              price,
              baseline_price,
              savings_percent_if_available,
              final_score,
              opportunity_level
            FROM travel_opportunities
            WHERE id IN (${placeholders})
          `
        )
        .all(...idList);
      for (const row of rows || []) {
        opportunityMap.set(String(row.id), row);
      }
    }

    if (opportunityMap.size === 0) return;

    for (const context of quoteContext.values()) {
      const source = String(context?.source || '').trim().toLowerCase();
      if (source !== 'opportunity_bootstrap') continue;

      const metadata = parseJsonObject(context?.metadata, {});
      const opportunityId = String(metadata?.opportunityId || '').trim();
      if (!opportunityId) continue;
      const opp = opportunityMap.get(opportunityId);
      if (!opp) continue;

      const merged = { ...metadata, bootstrap: true };
      const baselineRaw = toNumber(opp.baseline_price, NaN);
      const priceRaw = toNumber(opp.price, NaN);
      const savingsPctRaw = toNumber(opp.savings_percent_if_available, NaN);
      const derivedSavingsPct =
        Number.isFinite(savingsPctRaw)
          ? savingsPctRaw
          : Number.isFinite(baselineRaw) && baselineRaw > 0 && Number.isFinite(priceRaw)
            ? ((baselineRaw - priceRaw) / baselineRaw) * 100
            : NaN;
      const derivedSavingsAmount =
        Number.isFinite(baselineRaw) && Number.isFinite(priceRaw) ? Math.max(0, baselineRaw - priceRaw) : NaN;
      const finalScoreRaw = toNumber(opp.final_score, NaN);
      const opportunityLevel = String(opp.opportunity_level || '').trim();

      if (!Number.isFinite(toNumber(merged.baselinePrice, NaN)) && Number.isFinite(baselineRaw) && baselineRaw > 0) {
        merged.baselinePrice = round2(baselineRaw);
      }
      if (!Number.isFinite(toNumber(merged.savingsPct, NaN)) && Number.isFinite(derivedSavingsPct)) {
        merged.savingsPct = round2(Math.max(0, derivedSavingsPct));
      }
      if (!Number.isFinite(toNumber(merged.savingsAmount, NaN)) && Number.isFinite(derivedSavingsAmount)) {
        merged.savingsAmount = round2(derivedSavingsAmount);
      }
      if (!Number.isFinite(toNumber(merged.finalScore, NaN)) && Number.isFinite(finalScoreRaw)) {
        merged.finalScore = round2(finalScoreRaw);
      }
      if (!String(merged.opportunityLevel || '').trim() && opportunityLevel) {
        merged.opportunityLevel = opportunityLevel;
      }

      context.metadata = merged;
    }
  }

  async function loadCandidatesPostgres({ routeId, lookbackHours, signalLookbackDays, maxCandidates }) {
    const routeWhere = routeId != null ? 'AND fq.route_id = $4' : '';
    const params = [lookbackHours, maxCandidates, signalLookbackDays];
    if (routeId != null) params.push(routeId);

    const sql = `
      WITH route_popularity AS (
        SELECT fq.route_id, COUNT(*)::int AS observations_30d
        FROM flight_quotes fq
        WHERE fq.observed_at >= NOW() - ($3 * INTERVAL '1 day')
        GROUP BY fq.route_id
      ),
      route_signals AS (
        SELECT
          COALESCE(
            ue.route_id,
            CASE
              WHEN (ue.payload ->> 'route_id') ~ '^[0-9]+$' THEN NULLIF((ue.payload ->> 'route_id')::bigint, 0)
              ELSE NULL
            END
          ) AS route_id,
          SUM(
            (
              CASE
                WHEN LOWER(ue.event_type) LIKE '%book%' OR LOWER(ue.event_type) LIKE '%purchase%' OR LOWER(ue.event_type) LIKE '%checkout%' THEN 6
                WHEN LOWER(ue.event_type) LIKE '%save%' OR LOWER(ue.event_type) LIKE '%watch%' OR LOWER(ue.event_type) LIKE '%alert%' THEN 3
                WHEN LOWER(ue.event_type) LIKE '%click%' OR LOWER(ue.event_type) LIKE '%open%' OR LOWER(ue.event_type) LIKE '%view%' THEN 1.5
                ELSE 1
              END
            ) * (
              CASE
                WHEN ue.event_ts >= NOW() - INTERVAL '24 hours' THEN 1
                WHEN ue.event_ts >= NOW() - INTERVAL '72 hours' THEN 0.75
                WHEN ue.event_ts >= NOW() - INTERVAL '7 days' THEN 0.5
                ELSE 0.25
              END
            )
          )::numeric(12,2) AS weighted_signals
        FROM user_events ue
        WHERE ue.event_ts >= NOW() - ($3 * INTERVAL '1 day')
        GROUP BY 1
      )
      SELECT
        fq.id AS flight_quote_id,
        fq.route_id,
        fq.departure_date,
        fq.return_date,
        fq.trip_type,
        fq.cabin_class,
        fq.currency,
        fq.total_price,
        fq.stops,
        fq.duration_minutes,
        fq.observed_at,
        rps.avg_price,
        COALESCE(rps.min_price, rps.avg_price) AS min_price,
        COALESCE(rps.max_price, rps.avg_price) AS max_price,
        COALESCE(rps.avg_price_7d, rps.avg_price) AS avg_price_7d,
        COALESCE(rps.avg_price_30d, rps.avg_price) AS avg_price_30d,
        rps.quotes_count,
        rps.confidence_level,
        COALESCE(rp.observations_30d, 0)::numeric AS route_popularity_30d,
        COALESCE(rs.weighted_signals, 0)::numeric AS user_signals_30d,
        prev.prev_price,
        prev.prev_observed_at
      FROM flight_quotes fq
      JOIN route_price_stats rps
        ON rps.route_id = fq.route_id
       AND rps.departure_month = date_trunc('month', fq.departure_date)::date
       AND rps.trip_type = fq.trip_type
       AND rps.cabin_class = fq.cabin_class
       AND rps.currency = fq.currency
      LEFT JOIN route_popularity rp ON rp.route_id = fq.route_id
      LEFT JOIN route_signals rs ON rs.route_id = fq.route_id
      LEFT JOIN LATERAL (
        SELECT
          fq_prev.total_price AS prev_price,
          fq_prev.observed_at AS prev_observed_at
        FROM flight_quotes fq_prev
        WHERE fq_prev.route_id = fq.route_id
          AND fq_prev.trip_type = fq.trip_type
          AND fq_prev.cabin_class = fq.cabin_class
          AND fq_prev.currency = fq.currency
          AND fq_prev.observed_at < fq.observed_at
        ORDER BY fq_prev.observed_at DESC
        LIMIT 1
      ) prev ON TRUE
      WHERE fq.observed_at >= NOW() - ($1 * INTERVAL '1 hour')
        AND fq.departure_date >= CURRENT_DATE
        AND fq.total_price > 0
        AND (fq.is_bookable IS NULL OR fq.is_bookable = true)
        AND (fq.stops IS NULL OR fq.stops <= 3)
        AND (fq.duration_minutes IS NULL OR fq.duration_minutes <= 0 OR fq.duration_minutes BETWEEN 30 AND 2160)
        ${routeWhere}
      ORDER BY fq.observed_at DESC
      LIMIT $2
    `;

    const result = await pgPool.query(sql, params);
    return result.rows || [];
  }

  function loadCandidatesSqlite({ routeId, lookbackHours, signalLookbackDays, maxCandidates }) {
    const routeWhere = routeId != null ? 'AND fq.route_id = ?' : '';
    const params = [signalLookbackDays, signalLookbackDays, lookbackHours];
    if (routeId != null) params.push(routeId);
    params.push(maxCandidates);

    const sql = `
      WITH route_popularity AS (
        SELECT fq.route_id, COUNT(*) AS observations_30d
        FROM flight_quotes fq
        WHERE datetime(fq.observed_at) >= datetime('now', '-' || ? || ' day')
        GROUP BY fq.route_id
      ),
      route_signals AS (
        SELECT
          ue.route_id AS route_id,
          SUM(
            (
              CASE
                WHEN LOWER(ue.event_type) LIKE '%book%' OR LOWER(ue.event_type) LIKE '%purchase%' OR LOWER(ue.event_type) LIKE '%checkout%' THEN 6
                WHEN LOWER(ue.event_type) LIKE '%save%' OR LOWER(ue.event_type) LIKE '%watch%' OR LOWER(ue.event_type) LIKE '%alert%' THEN 3
                WHEN LOWER(ue.event_type) LIKE '%click%' OR LOWER(ue.event_type) LIKE '%open%' OR LOWER(ue.event_type) LIKE '%view%' THEN 1.5
                ELSE 1
              END
            ) * (
              CASE
                WHEN datetime(ue.event_ts) >= datetime('now', '-24 hour') THEN 1
                WHEN datetime(ue.event_ts) >= datetime('now', '-72 hour') THEN 0.75
                WHEN datetime(ue.event_ts) >= datetime('now', '-7 day') THEN 0.5
                ELSE 0.25
              END
            )
          ) AS weighted_signals
        FROM user_events ue
        WHERE ue.route_id IS NOT NULL
          AND datetime(ue.event_ts) >= datetime('now', '-' || ? || ' day')
        GROUP BY ue.route_id
      )
      SELECT
        fq.id AS flight_quote_id,
        fq.route_id,
        fq.departure_date,
        fq.return_date,
        fq.trip_type,
        fq.cabin_class,
        fq.currency,
        fq.total_price,
        fq.stops,
        fq.duration_minutes,
        fq.observed_at,
        rps.avg_price,
        COALESCE(rps.min_price, rps.avg_price) AS min_price,
        COALESCE(rps.max_price, rps.avg_price) AS max_price,
        COALESCE(rps.avg_price_7d, rps.avg_price) AS avg_price_7d,
        COALESCE(rps.avg_price_30d, rps.avg_price) AS avg_price_30d,
        rps.quotes_count,
        rps.confidence_level,
        COALESCE(rp.observations_30d, 0) AS route_popularity_30d,
        COALESCE(rs.weighted_signals, 0) AS user_signals_30d,
        (
          SELECT fq_prev.total_price
          FROM flight_quotes fq_prev
          WHERE fq_prev.route_id = fq.route_id
            AND fq_prev.trip_type = fq.trip_type
            AND fq_prev.cabin_class = fq.cabin_class
            AND fq_prev.currency = fq.currency
            AND datetime(fq_prev.observed_at) < datetime(fq.observed_at)
          ORDER BY datetime(fq_prev.observed_at) DESC
          LIMIT 1
        ) AS prev_price,
        (
          SELECT fq_prev.observed_at
          FROM flight_quotes fq_prev
          WHERE fq_prev.route_id = fq.route_id
            AND fq_prev.trip_type = fq.trip_type
            AND fq_prev.cabin_class = fq.cabin_class
            AND fq_prev.currency = fq.currency
            AND datetime(fq_prev.observed_at) < datetime(fq.observed_at)
          ORDER BY datetime(fq_prev.observed_at) DESC
          LIMIT 1
        ) AS prev_observed_at
      FROM flight_quotes fq
      JOIN route_price_stats rps
        ON rps.route_id = fq.route_id
       AND rps.departure_month = substr(fq.departure_date, 1, 7) || '-01'
       AND rps.trip_type = fq.trip_type
       AND rps.cabin_class = fq.cabin_class
       AND rps.currency = fq.currency
      LEFT JOIN route_popularity rp ON rp.route_id = fq.route_id
      LEFT JOIN route_signals rs ON rs.route_id = fq.route_id
      WHERE datetime(fq.observed_at) >= datetime('now', '-' || ? || ' hour')
        AND date(fq.departure_date) >= date('now')
        AND fq.total_price > 0
        AND (fq.is_bookable IS NULL OR fq.is_bookable = 1)
        AND (fq.stops IS NULL OR fq.stops <= 3)
        AND (fq.duration_minutes IS NULL OR fq.duration_minutes <= 0 OR fq.duration_minutes BETWEEN 30 AND 2160)
        ${routeWhere}
      ORDER BY datetime(fq.observed_at) DESC
      LIMIT ?
    `;

    return sqliteDb.prepare(sql).all(...params);
  }

  async function upsertDealsPostgres(deals) {
    const upsertSql = `
      INSERT INTO detected_deals (
        deal_key, flight_quote_id, route_id, deal_type, raw_score, final_score, deal_score, opportunity_level,
        price, baseline_price, savings_amount, savings_pct, status, rejection_reason, score_breakdown,
        published_at, expires_at, source_observed_at, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15::jsonb,
        $16::timestamptz, $17::timestamptz, $18::timestamptz, NOW(), NOW()
      )
      ON CONFLICT (deal_key)
      DO UPDATE SET
        flight_quote_id = EXCLUDED.flight_quote_id,
        route_id = EXCLUDED.route_id,
        deal_type = EXCLUDED.deal_type,
        raw_score = EXCLUDED.raw_score,
        final_score = EXCLUDED.final_score,
        deal_score = EXCLUDED.deal_score,
        opportunity_level = EXCLUDED.opportunity_level,
        price = EXCLUDED.price,
        baseline_price = EXCLUDED.baseline_price,
        savings_amount = EXCLUDED.savings_amount,
        savings_pct = EXCLUDED.savings_pct,
        status = EXCLUDED.status,
        rejection_reason = EXCLUDED.rejection_reason,
        score_breakdown = EXCLUDED.score_breakdown,
        published_at = EXCLUDED.published_at,
        expires_at = EXCLUDED.expires_at,
        source_observed_at = EXCLUDED.source_observed_at,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;

    let insertedDeals = 0;
    let updatedDeals = 0;
    for (const deal of deals) {
      const result = await pgPool.query(upsertSql, [
        deal.dealKey,
        deal.flightQuoteId,
        deal.routeId,
        deal.dealType,
        deal.rawScore,
        deal.finalScore,
        deal.dealScore,
        deal.opportunityLevel,
        deal.price,
        deal.baselinePrice,
        deal.savingsAmount,
        deal.savingsPct,
        deal.status,
        deal.rejectionReason || null,
        JSON.stringify(deal.scoreBreakdown || {}),
        deal.publishedAt || null,
        deal.expiresAt || null,
        deal.sourceObservedAt
      ]);
      if (result.rows[0]?.inserted) insertedDeals += 1;
      else updatedDeals += 1;
    }
    return { insertedDeals, updatedDeals };
  }

  function upsertDealsSqlite(deals) {
    const existingStmt = sqliteDb.prepare(`SELECT id FROM detected_deals WHERE deal_key = ? LIMIT 1`);
    const upsertStmt = sqliteDb.prepare(`
      INSERT INTO detected_deals (
        deal_key, flight_quote_id, route_id, deal_type, raw_score, final_score, deal_score, opportunity_level,
        price, baseline_price, savings_amount, savings_pct, status, rejection_reason, score_breakdown,
        published_at, expires_at, source_observed_at, created_at, updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, datetime('now'), datetime('now')
      )
      ON CONFLICT(deal_key) DO UPDATE SET
        flight_quote_id = excluded.flight_quote_id,
        route_id = excluded.route_id,
        deal_type = excluded.deal_type,
        raw_score = excluded.raw_score,
        final_score = excluded.final_score,
        deal_score = excluded.deal_score,
        opportunity_level = excluded.opportunity_level,
        price = excluded.price,
        baseline_price = excluded.baseline_price,
        savings_amount = excluded.savings_amount,
        savings_pct = excluded.savings_pct,
        status = excluded.status,
        rejection_reason = excluded.rejection_reason,
        score_breakdown = excluded.score_breakdown,
        published_at = excluded.published_at,
        expires_at = excluded.expires_at,
        source_observed_at = excluded.source_observed_at,
        updated_at = datetime('now')
    `);

    let insertedDeals = 0;
    let updatedDeals = 0;
    for (const deal of deals) {
      const existing = existingStmt.get(deal.dealKey);
      upsertStmt.run(
        deal.dealKey,
        deal.flightQuoteId,
        deal.routeId,
        deal.dealType,
        deal.rawScore,
        deal.finalScore,
        deal.dealScore,
        deal.opportunityLevel,
        deal.price,
        deal.baselinePrice,
        deal.savingsAmount,
        deal.savingsPct,
        deal.status,
        deal.rejectionReason || null,
        JSON.stringify(deal.scoreBreakdown || {}),
        deal.publishedAt || null,
        deal.expiresAt || null,
        deal.sourceObservedAt
      );
      if (existing?.id) updatedDeals += 1;
      else insertedDeals += 1;
    }
    return { insertedDeals, updatedDeals };
  }

  async function expireStaleDeals({ lookbackHours, routeId }) {
    if (mode === 'postgres') {
      const params = [lookbackHours];
      const routeClause = routeId != null ? 'AND route_id = $2' : '';
      if (routeId != null) params.push(routeId);
      const sql = `
        UPDATE detected_deals
        SET status = 'expired', updated_at = NOW()
        WHERE status IN ('candidate', 'published')
          AND (
            (expires_at IS NOT NULL AND expires_at < NOW())
            OR source_observed_at < NOW() - ($1 * INTERVAL '1 hour')
          )
          ${routeClause}
      `;
      const result = await pgPool.query(sql, params);
      return Number(result.rowCount || 0);
    }

    const routeClause = routeId != null ? 'AND route_id = ?' : '';
    const params = [lookbackHours];
    if (routeId != null) params.push(routeId);
    const result = sqliteDb
      .prepare(`
        UPDATE detected_deals
        SET status = 'expired', updated_at = datetime('now')
        WHERE status IN ('candidate', 'published')
          AND (
            (expires_at IS NOT NULL AND datetime(expires_at) < datetime('now'))
            OR datetime(source_observed_at) < datetime('now', '-' || ? || ' hour')
          )
          ${routeClause}
      `)
      .run(...params);
    return Number(result?.changes || 0);
  }

  async function cleanupExpiredDeals({ retentionDays, routeId }) {
    if (mode === 'postgres') {
      const params = [retentionDays];
      const routeClause = routeId != null ? 'AND route_id = $2' : '';
      if (routeId != null) params.push(routeId);
      const sql = `
        DELETE FROM detected_deals
        WHERE status = 'expired'
          AND (
            source_observed_at < NOW() - ($1 * INTERVAL '1 day')
            OR (expires_at IS NOT NULL AND expires_at < NOW() - ($1 * INTERVAL '1 day'))
          )
          ${routeClause}
      `;
      const result = await pgPool.query(sql, params);
      return Number(result.rowCount || 0);
    }

    const routeClause = routeId != null ? 'AND route_id = ?' : '';
    const result = sqliteDb
      .prepare(
        `DELETE FROM detected_deals
         WHERE status = 'expired'
           AND (
             datetime(source_observed_at) < datetime('now', '-' || ? || ' day')
             OR (expires_at IS NOT NULL AND datetime(expires_at) < datetime('now', '-' || ? || ' day'))
           )
           ${routeClause}`
      )
      .run(...(routeId != null ? [retentionDays, retentionDays, routeId] : [retentionDays, retentionDays]));
    return Number(result?.changes || 0);
  }

  async function detectDeals({ routeId = null, ...runtimeOptions } = {}) {
    await ensureInitialized();
    const normalizedRouteId = normalizeRouteId(routeId);
    const config = getConfig(runtimeOptions);
    const startedAt = Date.now();

    if (!schemaReady) {
      return {
        skipped: true,
        reason: schemaReason || 'schema_not_ready',
        processedQuotes: 0,
        validDeals: 0,
        selectedDeals: 0,
        publishedDeals: 0,
        insertedDeals: 0,
        updatedDeals: 0,
        expiredDeals: 0,
        deletedExpiredDeals: 0,
        rejectedDeals: 0,
        mode
      };
    }

    const sourceStatus = await hasSourceTables();
    if (!sourceStatus.ok) {
      return {
        skipped: true,
        reason: sourceStatus.reason,
        processedQuotes: 0,
        validDeals: 0,
        selectedDeals: 0,
        publishedDeals: 0,
        insertedDeals: 0,
        updatedDeals: 0,
        expiredDeals: 0,
        deletedExpiredDeals: 0,
        rejectedDeals: 0,
        mode
      };
    }

    const candidates =
      mode === 'postgres'
        ? await loadCandidatesPostgres({
            routeId: normalizedRouteId,
            lookbackHours: config.lookbackHours,
            signalLookbackDays: config.signalLookbackDays,
            maxCandidates: config.maxCandidates
          })
        : loadCandidatesSqlite({
            routeId: normalizedRouteId,
            lookbackHours: config.lookbackHours,
            signalLookbackDays: config.signalLookbackDays,
            maxCandidates: config.maxCandidates
          });
    const quoteContext = await loadQuoteContextMap(candidates);
    await enrichBootstrapQuoteContextFromOpportunities(quoteContext);
    if (quoteContext.size > 0) {
      for (const row of candidates) {
        const context = quoteContext.get(Number(row.flight_quote_id));
        if (!context) continue;
        row.quote_source = context.source;
        row.quote_metadata = context.metadata;
      }
    }

    const nowTs = Date.now();
    const valid = [];
    let rejectedDeals = 0;
    for (const row of candidates) {
      const evaluation = evaluateCandidate(row, { nowTs, ...config });
      if (!evaluation.valid) {
        rejectedDeals += 1;
        continue;
      }
      valid.push(evaluation.deal);
    }

    valid.sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return new Date(b.sourceObservedAt).getTime() - new Date(a.sourceObservedAt).getTime();
    });

    const selected = valid.slice(0, config.maxPublishedPerRun);
    let publishedDeals = selected.filter((item) => item.status === 'published').length;
    let fallbackPromotedDeals = 0;
    let publishFallbackThreshold = null;

    if (selected.length > 0 && publishedDeals === 0 && config.publishFallbackEnabled) {
      publishFallbackThreshold = Math.max(config.minScore, config.publishScore - config.publishFallbackDelta);
      const maxPromotions = Math.min(config.publishFallbackMaxPerRun, selected.length);
      const publishedAt = new Date(nowTs).toISOString();

      for (const deal of selected) {
        if (fallbackPromotedDeals >= maxPromotions) break;
        if (deal.status !== 'candidate') continue;
        if (toNumber(deal.finalScore, 0) < publishFallbackThreshold) continue;

        deal.status = 'published';
        deal.publishedAt = publishedAt;
        const breakdown = parseJsonObject(deal.scoreBreakdown, {});
        const gates = parseJsonObject(breakdown.gates, {});
        const publish = parseJsonObject(breakdown.publish, {});
        deal.scoreBreakdown = {
          ...breakdown,
          gates: {
            ...gates,
            publish_fallback: true
          },
          publish: {
            ...publish,
            mode: 'fallback',
            threshold: publishFallbackThreshold,
            target_publish_score: config.publishScore
          }
        };
        fallbackPromotedDeals += 1;
      }

      publishedDeals = selected.filter((item) => item.status === 'published').length;
    }

    let insertedDeals = 0;
    let updatedDeals = 0;
    if (selected.length > 0) {
      const upsertResult = mode === 'postgres' ? await upsertDealsPostgres(selected) : upsertDealsSqlite(selected);
      insertedDeals = Number(upsertResult.insertedDeals || 0);
      updatedDeals = Number(upsertResult.updatedDeals || 0);
    }

    const expiredDeals = await expireStaleDeals({ lookbackHours: config.lookbackHours, routeId: normalizedRouteId });
    const deletedExpiredDeals = await cleanupExpiredDeals({ retentionDays: config.retentionDays, routeId: normalizedRouteId });

    const result = {
      skipped: false,
      reason: null,
      processedQuotes: candidates.length,
      validDeals: valid.length,
      selectedDeals: selected.length,
      publishedDeals,
      fallbackPromotedDeals,
      publishFallbackThreshold,
      insertedDeals,
      updatedDeals,
      expiredDeals,
      deletedExpiredDeals,
      rejectedDeals,
      mode
    };

    logger.info(
      {
        routeId: normalizedRouteId,
        durationMs: Date.now() - startedAt,
        config: {
          lookbackHours: config.lookbackHours,
          signalLookbackDays: config.signalLookbackDays,
          maxCandidates: config.maxCandidates,
          maxPublishedPerRun: config.maxPublishedPerRun,
          minDiscountPct: config.minDiscountPct,
          nearMinRatio: config.nearMinRatio,
          rapidDropRatio: config.rapidDropRatio,
          rapidDropMinPct: config.rapidDropMinPct,
          minScore: config.minScore,
          publishScore: config.publishScore,
          publishFallbackEnabled: config.publishFallbackEnabled,
          publishFallbackDelta: config.publishFallbackDelta,
          publishFallbackMaxPerRun: config.publishFallbackMaxPerRun,
          retentionDays: config.retentionDays
        },
        ...result
      },
      'detected_deals_engine_completed'
    );

    return result;
  }

  return {
    detectDeals,
    getMode: () => mode
  };
}

let singleton = null;

export function getDetectedDealsEngine() {
  if (!singleton) singleton = createDetectedDealsEngine();
  return singleton;
}

export async function detectAndStoreDeals(options = {}) {
  return getDetectedDealsEngine().detectDeals(options);
}
