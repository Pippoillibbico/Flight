import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildBookingLink } from './flight-engine.js';
import { listPriceObservationsSince, scoreDeal } from './deal-engine-store.js';
import { parseFlag } from './env-flags.js';
import { getCacheClient } from './free-cache.js';
import { extractJsonObject, resolveOpportunityEnrichmentPayload } from './ai-output-guards.js';
import { sanitizeFollowMetadata } from './follow-metadata.js';
import { ORIGINS, ROUTES } from '../data/local-flight-data.js';
import { scoreOpportunityCandidate } from './opportunity-scoring.js';

const DB_FILE_URL = new URL('../../data/app.db', import.meta.url);
const DB_FILE_PATH = fileURLToPath(DB_FILE_URL);

const originMap = new Map(
  ORIGINS.map((item) => {
    const label = String(item.label || item.code || '').trim();
    const city = label.split('(')[0].trim() || item.code;
    return [String(item.code || '').toUpperCase(), { airport: String(item.code || '').toUpperCase(), city }];
  })
);

const routeMap = new Map(
  ROUTES.map((route) => [
    `${String(route.origin || '').toUpperCase()}-${String(route.destinationIata || '').toUpperCase()}`,
    route
  ])
);

let sqliteDb = null;
let pgPool = null;
let initialized = false;
let lastRefreshAt = 0;
let opportunityFeedVersion = '0';
let refreshInFlight = null;
let lastPipelineStats = {
  refreshedAt: null,
  processed: 0,
  published: 0,
  deduped: 0,
  skippedWeak: 0,
  enriched: 0,
  enrichFailed: 0,
  apiFilteredOut: 0
};
const OPPORTUNITY_PIPELINE_STALE_RUNNING_MINUTES = Math.max(
  10,
  Math.min(24 * 60, Number(process.env.OPPORTUNITY_PIPELINE_STALE_RUNNING_MINUTES || 60))
);
const OPPORTUNITY_PIPELINE_OVERLAP_GUARD_MINUTES = Math.max(
  1,
  Math.min(24 * 60, Number(process.env.OPPORTUNITY_PIPELINE_OVERLAP_GUARD_MINUTES || 30))
);

function getMode() {
  return process.env.DATABASE_URL ? 'postgres' : 'sqlite';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function clampMinutes(value, fallback, minValue = 1, maxValue = 24 * 60) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, Math.trunc(parsed)));
}

function toIso(value = new Date()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function shortHash(value) {
  return createHash('sha1')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 16);
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isIataCode(value) {
  return /^[A-Z]{3}$/.test(String(value || '').trim().toUpperCase());
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function toYmd(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const leadingIso = text.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (leadingIso) return leadingIso[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseJsonSafe(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return fallback;
  }
}

function compactRunMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const clone = { ...value };
  if (clone.stats && typeof clone.stats === 'object' && !Array.isArray(clone.stats)) {
    const stats = { ...clone.stats };
    if (Array.isArray(stats.recentRuns)) {
      stats.recentRuns = stats.recentRuns.slice(0, 5).map((run) => ({
        id: run?.id || null,
        status: run?.status || null,
        started_at: run?.started_at || null,
        finished_at: run?.finished_at || null,
        processed_count: Number(run?.processed_count || 0),
        published_count: Number(run?.published_count || 0),
        deduped_count: Number(run?.deduped_count || 0),
        enriched_count: Number(run?.enriched_count || 0),
        enrich_failed_count: Number(run?.enrich_failed_count || 0)
      }));
    }
    clone.stats = stats;
  }
  return clone;
}

function stringifyJsonSafe(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {}
  try {
    return JSON.stringify(compactRunMetadata(value));
  } catch {}
  try {
    return JSON.stringify({ truncated: true, reason: 'serialization_failed' });
  } catch {
    return '{"truncated":true}';
  }
}

function toRouteMeta(originAirport, destinationAirport) {
  const route = routeMap.get(`${String(originAirport || '').toUpperCase()}-${String(destinationAirport || '').toUpperCase()}`) || null;
  return {
    route,
    country: String(route?.country || '').trim(),
    region: String(route?.region || '').trim().toLowerCase()
  };
}

const EAST_COAST_CITIES = new Set(['new york', 'newark', 'boston', 'washington', 'washington dc', 'philadelphia']);
const SEA_COUNTRIES = new Set(['thailand', 'malaysia', 'vietnam', 'indonesia', 'philippines', 'singapore', 'cambodia']);

function deriveClusterInfo(opportunity) {
  const city = String(opportunity?.destination_city || '').trim();
  const cityKey = normalizeText(city);
  const { country, region } = toRouteMeta(opportunity?.origin_airport, opportunity?.destination_airport);
  const countryKey = normalizeText(opportunity?.destination_country || country);
  const regionKey = normalizeText(opportunity?.destination_region || region);

  if (countryKey === 'japan') {
    return { slug: 'japan', cluster_name: 'Japan', region: 'asia' };
  }
  if (SEA_COUNTRIES.has(countryKey)) {
    return { slug: 'southeast-asia', cluster_name: 'Southeast Asia', region: 'asia' };
  }
  if (countryKey === 'united states' && EAST_COAST_CITIES.has(cityKey)) {
    return { slug: 'usa-east-coast', cluster_name: 'USA East Coast', region: 'america' };
  }
  if (country) {
    return {
      slug: slugify(country),
      cluster_name: country,
      region: regionKey || 'global'
    };
  }
  if (regionKey) {
    const regionName = regionKey === 'eu' ? 'Europe' : regionKey.charAt(0).toUpperCase() + regionKey.slice(1);
    return {
      slug: slugify(regionName),
      cluster_name: regionName,
      region: regionKey
    };
  }
  return {
    slug: slugify(city || 'global'),
    cluster_name: city || 'Global',
    region: 'global'
  };
}

function budgetBucketFromPrice(value) {
  const price = toNumber(value, 0);
  if (price <= 200) return 'under_200';
  if (price <= 400) return 'under_400';
  if (price <= 600) return 'under_600';
  return 'over_600';
}

function matchesBudgetBucket(item, bucket) {
  const normalized = normalizeText(bucket).replace(/\s+/g, '_');
  const price = toNumber(item?.price, 0);
  if (!normalized) return true;
  if (normalized === 'under_200') return price <= 200;
  if (normalized === 'under_400') return price <= 400;
  if (normalized === 'under_600') return price <= 600;
  if (normalized === 'over_600') return price > 600;
  return normalized === budgetBucketFromPrice(price);
}

function estimateStops(route) {
  const distribution = route?.comfortMetadata?.stopCountDistribution || {};
  const candidates = [
    { stops: 0, score: toNumber(distribution[0], 0) },
    { stops: 1, score: toNumber(distribution[1], 0) },
    { stops: 2, score: toNumber(distribution[2], 0) }
  ].sort((a, b) => b.score - a.score);
  return candidates[0]?.stops ?? 1;
}

function computeTripLength(departDate, returnDate) {
  const depart = new Date(departDate);
  const ret = new Date(returnDate);
  if (Number.isNaN(depart.getTime()) || Number.isNaN(ret.getTime()) || ret <= depart) return null;
  const days = Math.round((ret.getTime() - depart.getTime()) / (24 * 3600 * 1000));
  return clamp(days, 1, 60);
}

function normalizeTripType(value, returnDate) {
  const raw = normalizeText(value);
  if (raw === 'one_way' || raw === 'round_trip') return raw;
  return returnDate ? 'round_trip' : 'one_way';
}

function toNullableInt(value) {
  const out = Math.floor(toNumber(value, NaN));
  return Number.isFinite(out) ? out : null;
}

function toNullableScore(value) {
  const out = toNumber(value, NaN);
  if (!Number.isFinite(out)) return null;
  return clamp(Math.round(out * 100) / 100, 0, 100);
}

function parseBaggageIncluded(value) {
  if (value === true || value === false) return value;
  const text = normalizeText(value);
  if (!text) return null;
  if (['1', 'true', 'yes', 'included', 'incl', 'si', 's\u00ec'].includes(text)) return true;
  if (['0', 'false', 'no', 'excluded', 'none'].includes(text)) return false;
  return null;
}

function buildAiCopy(row) {
  const level =
    row.opportunity_level === 'Rare opportunity'
      ? 'Opportunit\u00e0 rara'
      : row.opportunity_level === 'Exceptional price'
      ? 'Prezzo eccezionale'
      : row.opportunity_level === 'Great deal'
      ? 'Ottimo affare'
      : "Da tenere d'occhio";

  const period = row.return_date
    ? `${row.depart_date} - ${row.return_date}`
    : `partenza ${row.depart_date}`;

  const aiTitle = `${level}: ${row.origin_airport} -> ${row.destination_city} a ${Math.round(row.price)} ${row.currency}`;
  const aiDescription = `Questa opportunit\u00e0 combina prezzo competitivo, rotta ${row.stops === 0 ? 'diretta' : `con ${row.stops} scalo`} e finestra viaggio ${period}.`;
  const notificationText = `${level}: ${row.origin_airport} -> ${row.destination_airport} da ${Math.round(row.price)} ${row.currency}.`;
  const whyItMatters = `Score ${row.final_score}/100 con prezzo ${Math.round(row.price)} ${row.currency} e qualit\u00e0 itinerario verificata.`;

  return {
    aiTitle: aiTitle.slice(0, 180),
    aiDescription: aiDescription.slice(0, 280),
    notificationText: notificationText.slice(0, 180),
    whyItMatters: whyItMatters.slice(0, 220)
  };
}

async function enrichWithProviderIfEnabled(row, fallback) {
  const aiEnabled = parseFlag(process.env.OPPORTUNITY_AI_ENRICHMENT_ENABLED, false);
  if (!aiEnabled) return fallback;

  const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const claudeKey = String(process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
  const provider =
    String(process.env.OPPORTUNITY_AI_PROVIDER || '').trim().toLowerCase() === 'claude'
      ? 'claude'
      : openaiKey
      ? 'openai'
      : claudeKey
      ? 'claude'
      : 'none';
  if (provider === 'none') return fallback;

  const systemPrompt =
    'You are a travel opportunity enrichment engine. Return strict JSON only: {"ai_title":"","ai_description":"","notification_text":"","why_it_matters":"","short_badge_text":""}. Never invent facts or urgency.';
  const inputPayload = {
    origin_city: row.origin_city,
    origin_airport: row.origin_airport,
    destination_city: row.destination_city,
    destination_airport: row.destination_airport,
    price: row.price,
    currency: row.currency,
    depart_date: row.depart_date,
    return_date: row.return_date,
    trip_length_days: row.trip_length_days,
    stops: row.stops,
    airline: row.airline,
    raw_score: row.raw_score,
    final_score: row.final_score,
    opportunity_level: row.opportunity_level,
    baseline_price: row.baseline_price,
    savings_percent_if_available: row.savings_percent_if_available
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    let json = null;
    try {
      if (provider === 'openai' && openaiKey) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: JSON.stringify(inputPayload) }
            ]
          }),
          signal: controller.signal
        });
        if (!response.ok) return fallback;
        const payload = await response.json().catch(() => ({}));
        json = extractJsonObject(payload?.choices?.[0]?.message?.content || '');
      } else if (provider === 'claude' && claudeKey) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': claudeKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
            max_tokens: 350,
            temperature: 0.2,
            system: systemPrompt,
            messages: [{ role: 'user', content: JSON.stringify(inputPayload) }]
          }),
          signal: controller.signal
        });
        if (!response.ok) return fallback;
        const payload = await response.json().catch(() => ({}));
        const content = Array.isArray(payload?.content) ? payload.content.map((item) => item?.text || '').join('\n') : '';
        json = extractJsonObject(content);
      }
    } finally {
      clearTimeout(timer);
    }
    return resolveOpportunityEnrichmentPayload(json, fallback, row.opportunity_level || '');
  } catch {
    return fallback;
  }
}

async function ensurePostgres() {
  if (!pgPool) pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS travel_opportunities (
      id TEXT PRIMARY KEY,
      observation_fingerprint TEXT NOT NULL UNIQUE,
      origin_city TEXT NOT NULL,
      origin_airport TEXT NOT NULL,
      destination_city TEXT NOT NULL,
      destination_airport TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      currency TEXT NOT NULL,
      depart_date DATE NOT NULL,
      return_date DATE NULL,
      trip_length_days INTEGER NULL,
      trip_type TEXT NOT NULL DEFAULT 'round_trip',
      stops INTEGER NOT NULL DEFAULT 1,
      airline TEXT NOT NULL,
      baggage_included BOOLEAN NULL,
      travel_duration_minutes INTEGER NULL,
      distance_km INTEGER NULL,
      airline_quality_score NUMERIC(5,2) NULL,
      booking_url TEXT NOT NULL,
      raw_score NUMERIC(6,2) NOT NULL,
      final_score NUMERIC(6,2) NOT NULL,
      opportunity_level TEXT NOT NULL,
      ai_title TEXT NULL,
      ai_description TEXT NULL,
      notification_text TEXT NULL,
      why_it_matters TEXT NULL,
      baseline_price NUMERIC(10,2) NULL,
      savings_percent_if_available NUMERIC(6,2) NULL,
      dedupe_key TEXT NULL,
      is_published BOOLEAN NOT NULL DEFAULT true,
      published_at TIMESTAMPTZ NULL,
      enrichment_status TEXT NOT NULL DEFAULT 'pending',
      alert_status TEXT NOT NULL DEFAULT 'pending',
      source_observed_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_travel_opportunities_feed
      ON travel_opportunities(is_published, final_score DESC, source_observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_travel_opportunities_route
      ON travel_opportunities(origin_airport, destination_airport, depart_date);
    CREATE INDEX IF NOT EXISTS idx_travel_opportunities_dedupe
      ON travel_opportunities(dedupe_key, final_score DESC, source_observed_at DESC);
    CREATE TABLE IF NOT EXISTS opportunity_pipeline_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ NULL,
      processed_count INTEGER NOT NULL DEFAULT 0,
      published_count INTEGER NOT NULL DEFAULT 0,
      deduped_count INTEGER NOT NULL DEFAULT 0,
      enriched_count INTEGER NOT NULL DEFAULT 0,
      enrich_failed_count INTEGER NOT NULL DEFAULT 0,
      provider_fetch_enabled BOOLEAN NOT NULL DEFAULT false,
      error_summary TEXT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_opportunity_pipeline_runs_started_at
      ON opportunity_pipeline_runs(started_at DESC);
    CREATE TABLE IF NOT EXISTS opportunity_user_follows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      follow_type TEXT NOT NULL DEFAULT 'radar',
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_user_follows_unique
      ON opportunity_user_follows(user_id, entity_type, slug, follow_type);
    CREATE INDEX IF NOT EXISTS idx_opportunity_user_follows_user
      ON opportunity_user_follows(user_id, updated_at DESC);
  `);
  await pgPool.query(`
    ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS baseline_price NUMERIC(10,2) NULL;
    ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS savings_percent_if_available NUMERIC(6,2) NULL;
    ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL;
    ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;
    ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS alert_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS trip_type TEXT NOT NULL DEFAULT 'round_trip';
    ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS baggage_included BOOLEAN NULL;
    ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS travel_duration_minutes INTEGER NULL;
    ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS distance_km INTEGER NULL;
    ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS airline_quality_score NUMERIC(5,2) NULL;
  `);
}

async function ensureSqlite() {
  if (sqliteDb) return;
  await mkdir(dirname(DB_FILE_PATH), { recursive: true });
  const sqlite = await import('node:sqlite');
  sqliteDb = new sqlite.DatabaseSync(DB_FILE_PATH);
  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS travel_opportunities (
      id TEXT PRIMARY KEY,
      observation_fingerprint TEXT NOT NULL UNIQUE,
      origin_city TEXT NOT NULL,
      origin_airport TEXT NOT NULL,
      destination_city TEXT NOT NULL,
      destination_airport TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT NOT NULL,
      depart_date TEXT NOT NULL,
      return_date TEXT NULL,
      trip_length_days INTEGER NULL,
      trip_type TEXT NOT NULL DEFAULT 'round_trip',
      stops INTEGER NOT NULL DEFAULT 1,
      airline TEXT NOT NULL,
      baggage_included INTEGER NULL,
      travel_duration_minutes INTEGER NULL,
      distance_km INTEGER NULL,
      airline_quality_score REAL NULL,
      booking_url TEXT NOT NULL,
      raw_score REAL NOT NULL,
      final_score REAL NOT NULL,
      opportunity_level TEXT NOT NULL,
      ai_title TEXT NULL,
      ai_description TEXT NULL,
      notification_text TEXT NULL,
      why_it_matters TEXT NULL,
      baseline_price REAL NULL,
      savings_percent_if_available REAL NULL,
      dedupe_key TEXT NULL,
      is_published INTEGER NOT NULL DEFAULT 1,
      published_at TEXT NULL,
      enrichment_status TEXT NOT NULL DEFAULT 'pending',
      alert_status TEXT NOT NULL DEFAULT 'pending',
      source_observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_travel_opportunities_feed
      ON travel_opportunities(is_published, final_score DESC, source_observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_travel_opportunities_route
      ON travel_opportunities(origin_airport, destination_airport, depart_date);
    CREATE INDEX IF NOT EXISTS idx_travel_opportunities_dedupe
      ON travel_opportunities(dedupe_key, final_score DESC, source_observed_at DESC);
    CREATE TABLE IF NOT EXISTS opportunity_pipeline_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NULL,
      processed_count INTEGER NOT NULL DEFAULT 0,
      published_count INTEGER NOT NULL DEFAULT 0,
      deduped_count INTEGER NOT NULL DEFAULT 0,
      enriched_count INTEGER NOT NULL DEFAULT 0,
      enrich_failed_count INTEGER NOT NULL DEFAULT 0,
      provider_fetch_enabled INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_opportunity_pipeline_runs_started_at
      ON opportunity_pipeline_runs(started_at DESC);
    CREATE TABLE IF NOT EXISTS opportunity_user_follows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      follow_type TEXT NOT NULL DEFAULT 'radar',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_user_follows_unique
      ON opportunity_user_follows(user_id, entity_type, slug, follow_type);
    CREATE INDEX IF NOT EXISTS idx_opportunity_user_follows_user
      ON opportunity_user_follows(user_id, updated_at DESC);
  `);
  const columns = sqliteDb.prepare(`PRAGMA table_info(travel_opportunities)`).all().map((row) => String(row.name));
  const ensureColumn = (name, sqlType) => {
    if (columns.includes(name)) return;
    sqliteDb.exec(`ALTER TABLE travel_opportunities ADD COLUMN ${name} ${sqlType}`);
  };
  ensureColumn('baseline_price', 'REAL NULL');
  ensureColumn('savings_percent_if_available', 'REAL NULL');
  ensureColumn('dedupe_key', 'TEXT NULL');
  ensureColumn('published_at', 'TEXT NULL');
  ensureColumn('enrichment_status', "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn('alert_status', "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn('trip_type', "TEXT NOT NULL DEFAULT 'round_trip'");
  ensureColumn('baggage_included', 'INTEGER NULL');
  ensureColumn('travel_duration_minutes', 'INTEGER NULL');
  ensureColumn('distance_km', 'INTEGER NULL');
  ensureColumn('airline_quality_score', 'REAL NULL');
}

async function ensureInitialized() {
  if (initialized) return;
  if (getMode() === 'postgres') await ensurePostgres();
  else await ensureSqlite();
  initialized = true;
}

function normalizeOpportunityRow({
  observation,
  route,
  originCity,
  scoreData,
  scoredDeal,
  bookingUrl,
  stops,
  tripLengthDays
}) {
  const departDate = toYmd(observation.departure_date) || toYmd(observation.travel_month);
  const returnDate = toYmd(observation.return_date) || null;
  const observationMeta = parseJsonSafe(observation.metadata, {});
  const tripType = normalizeTripType(observation.trip_type, returnDate);
  const baggageIncluded = parseBaggageIncluded(
    observationMeta.baggageIncluded ?? observationMeta.baggage_included ?? observationMeta.includedBaggage
  );
  const travelDurationMinutes = toNullableInt(
    observationMeta.totalDurationMinutes ?? observationMeta.durationMinutes ?? observationMeta.travelDurationMinutes
  );
  const distanceKm = toNullableInt(observationMeta.distanceKm ?? observationMeta.distance_km ?? route?.distanceKm);
  const airlineQualityScore = toNullableScore(observationMeta.airlineQualityScore ?? observationMeta.airline_quality_score);
  const originAirport = String(observation.origin_iata || '').toUpperCase();
  const destinationAirport = String(observation.destination_iata || '').toUpperCase();
  const destinationCity = String(route?.destinationName || destinationAirport);
  const baseRow = {
    id: `opp_${shortHash(observation.fingerprint || `${originAirport}-${destinationAirport}-${departDate}`)}`,
    observation_fingerprint: String(observation.fingerprint || `${originAirport}-${destinationAirport}-${departDate}`),
    origin_city: originCity,
    origin_airport: originAirport,
    destination_city: destinationCity,
    destination_airport: destinationAirport,
    price: toNumber(observation.total_price, 0),
    currency: String(observation.currency || 'EUR').toUpperCase(),
    depart_date: departDate,
    return_date: returnDate,
    trip_length_days: tripLengthDays,
    trip_type: tripType,
    stops,
    airline: String(observation.provider || 'unknown'),
    baggage_included: baggageIncluded,
    travel_duration_minutes: travelDurationMinutes,
    distance_km: distanceKm,
    airline_quality_score: airlineQualityScore,
    booking_url: bookingUrl,
    raw_score: toNumber(scoreData.rawScore, 50),
    final_score: toNumber(scoreData.finalScore, 50),
    opportunity_level: String(scoreData.opportunityLevel || 'Ignore if too weak'),
    baseline_price: toNumber(scoredDeal?.baselineMedian, 0) > 0 ? toNumber(scoredDeal?.baselineMedian, 0) : null,
    savings_percent_if_available:
      Number.isFinite(Number(scoredDeal?.savingPct)) && Number(scoredDeal?.savingPct) > 0 ? Number(scoredDeal?.savingPct) : null,
    dedupe_key: `${originAirport}:${destinationAirport}:${departDate.slice(0, 7)}:${stops}:${tripLengthDays || 'na'}`,
    is_published: toNumber(scoreData.finalScore, 0) >= 62,
    published_at: toNumber(scoreData.finalScore, 0) >= 62 ? toIso() : null,
    enrichment_status: toNumber(scoreData.finalScore, 0) >= 75 ? 'pending' : 'skipped_low_score',
    alert_status: toNumber(scoreData.finalScore, 0) >= 62 ? 'ready' : 'pending',
    source_observed_at: toIso(observation.observed_at || new Date()),
    created_at: toIso(observation.observed_at || new Date()),
    updated_at: toIso()
  };
  const aiCopy = buildAiCopy(baseRow);
  return {
    ...baseRow,
    ai_title: aiCopy.aiTitle,
    ai_description: aiCopy.aiDescription,
    notification_text: aiCopy.notificationText,
    why_it_matters: scoredDeal?.why ? `${scoredDeal.why} ${aiCopy.whyItMatters}`.slice(0, 220) : aiCopy.whyItMatters
  };
}

async function upsertOpportunity(row) {
  if (getMode() === 'postgres') {
    await pgPool.query(
      `INSERT INTO travel_opportunities (
        id, observation_fingerprint, origin_city, origin_airport, destination_city, destination_airport,
        price, currency, depart_date, return_date, trip_length_days, trip_type, stops, airline,
        baggage_included, travel_duration_minutes, distance_km, airline_quality_score, booking_url,
        raw_score, final_score, opportunity_level, ai_title, ai_description, notification_text,
        why_it_matters, baseline_price, savings_percent_if_available, dedupe_key, is_published,
        published_at, enrichment_status, alert_status, source_observed_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36
      )
      ON CONFLICT (observation_fingerprint) DO UPDATE SET
        origin_city = EXCLUDED.origin_city,
        origin_airport = EXCLUDED.origin_airport,
        destination_city = EXCLUDED.destination_city,
        destination_airport = EXCLUDED.destination_airport,
        price = EXCLUDED.price,
        currency = EXCLUDED.currency,
        depart_date = EXCLUDED.depart_date,
        return_date = EXCLUDED.return_date,
        trip_length_days = EXCLUDED.trip_length_days,
        trip_type = EXCLUDED.trip_type,
        stops = EXCLUDED.stops,
        airline = EXCLUDED.airline,
        baggage_included = EXCLUDED.baggage_included,
        travel_duration_minutes = EXCLUDED.travel_duration_minutes,
        distance_km = EXCLUDED.distance_km,
        airline_quality_score = EXCLUDED.airline_quality_score,
        booking_url = EXCLUDED.booking_url,
        raw_score = EXCLUDED.raw_score,
        final_score = EXCLUDED.final_score,
        opportunity_level = EXCLUDED.opportunity_level,
        ai_title = EXCLUDED.ai_title,
        ai_description = EXCLUDED.ai_description,
        notification_text = EXCLUDED.notification_text,
        why_it_matters = EXCLUDED.why_it_matters,
        baseline_price = EXCLUDED.baseline_price,
        savings_percent_if_available = EXCLUDED.savings_percent_if_available,
        dedupe_key = EXCLUDED.dedupe_key,
        is_published = EXCLUDED.is_published,
        published_at = EXCLUDED.published_at,
        enrichment_status = EXCLUDED.enrichment_status,
        alert_status = EXCLUDED.alert_status,
        source_observed_at = EXCLUDED.source_observed_at,
        updated_at = NOW()`,
      [
        row.id,
        row.observation_fingerprint,
        row.origin_city,
        row.origin_airport,
        row.destination_city,
        row.destination_airport,
        row.price,
        row.currency,
        row.depart_date,
        row.return_date,
        row.trip_length_days,
        row.trip_type,
        row.stops,
        row.airline,
        row.baggage_included,
        row.travel_duration_minutes,
        row.distance_km,
        row.airline_quality_score,
        row.booking_url,
        row.raw_score,
        row.final_score,
        row.opportunity_level,
        row.ai_title,
        row.ai_description,
        row.notification_text,
        row.why_it_matters,
        row.baseline_price,
        row.savings_percent_if_available,
        row.dedupe_key,
        row.is_published,
        row.published_at,
        row.enrichment_status,
        row.alert_status,
        row.source_observed_at,
        row.created_at,
        row.updated_at
      ]
    );
    return;
  }

  sqliteDb
    .prepare(
      `INSERT INTO travel_opportunities (
        id, observation_fingerprint, origin_city, origin_airport, destination_city, destination_airport,
        price, currency, depart_date, return_date, trip_length_days, trip_type, stops, airline,
        baggage_included, travel_duration_minutes, distance_km, airline_quality_score, booking_url,
        raw_score, final_score, opportunity_level, ai_title, ai_description, notification_text,
        why_it_matters, baseline_price, savings_percent_if_available, dedupe_key, is_published,
        published_at, enrichment_status, alert_status, source_observed_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(observation_fingerprint) DO UPDATE SET
        origin_city=excluded.origin_city,
        origin_airport=excluded.origin_airport,
        destination_city=excluded.destination_city,
        destination_airport=excluded.destination_airport,
        price=excluded.price,
        currency=excluded.currency,
        depart_date=excluded.depart_date,
        return_date=excluded.return_date,
        trip_length_days=excluded.trip_length_days,
        trip_type=excluded.trip_type,
        stops=excluded.stops,
        airline=excluded.airline,
        baggage_included=excluded.baggage_included,
        travel_duration_minutes=excluded.travel_duration_minutes,
        distance_km=excluded.distance_km,
        airline_quality_score=excluded.airline_quality_score,
        booking_url=excluded.booking_url,
        raw_score=excluded.raw_score,
        final_score=excluded.final_score,
        opportunity_level=excluded.opportunity_level,
        ai_title=excluded.ai_title,
        ai_description=excluded.ai_description,
        notification_text=excluded.notification_text,
        why_it_matters=excluded.why_it_matters,
        baseline_price=excluded.baseline_price,
        savings_percent_if_available=excluded.savings_percent_if_available,
        dedupe_key=excluded.dedupe_key,
        is_published=excluded.is_published,
        published_at=excluded.published_at,
        enrichment_status=excluded.enrichment_status,
        alert_status=excluded.alert_status,
        source_observed_at=excluded.source_observed_at,
        updated_at=datetime('now')`
    )
    .run(
      row.id,
      row.observation_fingerprint,
      row.origin_city,
      row.origin_airport,
      row.destination_city,
      row.destination_airport,
      row.price,
      row.currency,
      row.depart_date,
      row.return_date,
      row.trip_length_days,
      row.trip_type,
      row.stops,
      row.airline,
      row.baggage_included == null ? null : row.baggage_included ? 1 : 0,
      row.travel_duration_minutes,
      row.distance_km,
      row.airline_quality_score,
      row.booking_url,
      row.raw_score,
      row.final_score,
      row.opportunity_level,
      row.ai_title,
      row.ai_description,
      row.notification_text,
      row.why_it_matters,
      row.baseline_price,
      row.savings_percent_if_available,
      row.dedupe_key,
      row.is_published ? 1 : 0,
      row.published_at,
      row.enrichment_status,
      row.alert_status,
      row.source_observed_at,
      row.created_at,
      row.updated_at
    );
}

export async function refreshOpportunityFeed({ lookbackDays = 75, limit = 2000 } = {}) {
  await ensureInitialized();
  const now = Date.now();
  if (refreshInFlight) return refreshInFlight;
  if (now - lastRefreshAt < 2 * 60 * 1000) return { refreshed: false };

  refreshInFlight = (async () => {
    const since = new Date(Date.now() - Math.max(1, Number(lookbackDays) || 75) * 24 * 3600 * 1000).toISOString();
    const observations = await listPriceObservationsSince({
      observedAfter: since,
      limit: Math.max(200, Math.min(5000, Number(limit) || 2000))
    });

    let published = 0;
    let skippedWeak = 0;
    let skippedInvalid = 0;
    for (const observation of observations) {
      const originAirport = String(observation.origin_iata || '').toUpperCase();
      const destinationAirport = String(observation.destination_iata || '').toUpperCase();
      const departureDate = toYmd(observation.departure_date) || toYmd(observation.travel_month);
      if (!departureDate) {
        skippedInvalid += 1;
        continue;
      }
      const observationMeta = parseJsonSafe(observation.metadata, {});
      const returnDate = toYmd(observation.return_date) || null;
      const route = routeMap.get(`${originAirport}-${destinationAirport}`) || null;
      const origin = originMap.get(originAirport) || { airport: originAirport, city: originAirport };
      const stopHint = toNullableInt(observationMeta.totalStops ?? observationMeta.stops ?? observationMeta.stopCount);
      const stops = Number.isFinite(stopHint) ? Math.max(0, stopHint) : estimateStops(route);
      if (stops > 3) {
        skippedInvalid += 1;
        continue;
      }
      const travelDurationMinutes = toNullableInt(
        observationMeta.totalDurationMinutes ?? observationMeta.durationMinutes ?? observationMeta.travelDurationMinutes
      );
      if (Number.isFinite(travelDurationMinutes) && travelDurationMinutes > 45 * 60) {
        skippedInvalid += 1;
        continue;
      }
      const tripLengthDays = computeTripLength(departureDate, returnDate);

      const scoredDeal = await scoreDeal({
        origin: originAirport,
        destination: destinationAirport,
        departureDate,
        price: toNumber(observation.total_price, 0)
      });
      const baselineMedian = toNumber(scoredDeal?.baselineMedian, 0);
      const savingPct =
        baselineMedian > 0
          ? Math.round(((baselineMedian - toNumber(observation.total_price, 0)) / baselineMedian) * 10000) / 100
          : null;
      scoredDeal.baselineMedian = baselineMedian || null;
      scoredDeal.savingPct = Number.isFinite(savingPct) ? savingPct : null;

      const scoreData = scoreOpportunityCandidate({
        priceAttractiveness: toNumber(scoredDeal?.dealScore, 50),
        routeMeta: route || {},
        stopCount: stops,
        tripLengthDays,
        travelDurationMinutes,
        distanceKm: toNullableInt(observationMeta.distanceKm ?? observationMeta.distance_km ?? route?.distanceKm),
        airlineQualityScore: toNullableScore(observationMeta.airlineQualityScore ?? observationMeta.airline_quality_score),
        departDate: departureDate,
        returnDate: returnDate || '',
        observationCount: toNumber(scoredDeal?.confidence?.observationCount, 0)
      });

      const bookingUrl = buildBookingLink({
        origin: originAirport,
        destinationIata: destinationAirport,
        dateFrom: departureDate,
        dateTo: returnDate || departureDate,
        travellers: 1,
        cabinClass: 'economy'
      });

      const row = normalizeOpportunityRow({
        observation: {
          ...observation,
          departure_date: departureDate,
          return_date: returnDate
        },
        route,
        originCity: origin.city,
        scoreData,
        scoredDeal,
        bookingUrl,
        stops,
        tripLengthDays
      });

      await upsertOpportunity(row);
      if (row.is_published) published += 1;
      else skippedWeak += 1;
    }

    // Keep publication dedupe in the pipeline write-path, not in read endpoints.
    await dedupePublishedRows();

    lastRefreshAt = Date.now();
    opportunityFeedVersion = String(lastRefreshAt);
    lastPipelineStats = {
      ...lastPipelineStats,
      refreshedAt: new Date().toISOString(),
      processed: observations.length,
      published,
      skippedWeak,
      skippedInvalid
    };
    return { refreshed: true, processed: observations.length, published, skippedWeak, skippedInvalid };
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function normalizeOpportunityRowForApi(row) {
  if (!row) return null;
  const meta = toRouteMeta(row.origin_airport, row.destination_airport);
  const destinationCountry = String(row.destination_country || meta.country || '').trim();
  const destinationRegion = String(row.destination_region || meta.region || '').trim().toLowerCase();
  const departDate = toYmd(row.depart_date);
  const returnDate = toYmd(row.return_date);
  const normalized = {
    id: String(row.id),
    origin_city: String(row.origin_city),
    origin_airport: String(row.origin_airport),
    destination_city: String(row.destination_city),
    destination_airport: String(row.destination_airport),
    destination_country: destinationCountry || null,
    destination_region: destinationRegion || null,
    price: toNumber(row.price, 0),
    currency: String(row.currency || 'EUR'),
    depart_date: departDate || '',
    return_date: returnDate || null,
    trip_length_days: row.trip_length_days == null ? null : Math.max(0, Math.floor(toNumber(row.trip_length_days, 0))),
    trip_type: normalizeTripType(row.trip_type, returnDate || null),
    stops: Math.max(0, Math.floor(toNumber(row.stops, 1))),
    airline: String(row.airline || 'unknown'),
    baggage_included: parseBaggageIncluded(row.baggage_included),
    travel_duration_minutes: row.travel_duration_minutes == null ? null : Math.max(0, Math.floor(toNumber(row.travel_duration_minutes, 0))),
    distance_km: row.distance_km == null ? null : Math.max(0, Math.floor(toNumber(row.distance_km, 0))),
    airline_quality_score: row.airline_quality_score == null ? null : toNullableScore(row.airline_quality_score),
    booking_url: String(row.booking_url || ''),
    raw_score: toNumber(row.raw_score, 0),
    final_score: toNumber(row.final_score, 0),
    opportunity_level: String(row.opportunity_level || 'Ignore if too weak'),
    ai_title: String(row.ai_title || ''),
    ai_description: String(row.ai_description || ''),
    notification_text: String(row.notification_text || ''),
    why_it_matters: String(row.why_it_matters || ''),
    baseline_price: row.baseline_price == null ? null : toNumber(row.baseline_price, 0),
    savings_percent_if_available: row.savings_percent_if_available == null ? null : toNumber(row.savings_percent_if_available, 0),
    dedupe_key: String(row.dedupe_key || ''),
    is_published: Boolean(row.is_published),
    published_at: row.published_at ? toIso(row.published_at) : null,
    enrichment_status: String(row.enrichment_status || 'pending'),
    alert_status: String(row.alert_status || 'pending'),
    created_at: row.created_at ? toIso(row.created_at) : '',
    updated_at: row.updated_at ? toIso(row.updated_at) : ''
  };
  if (!normalized.id || !isIataCode(normalized.origin_airport) || !isIataCode(normalized.destination_airport) || !isYmd(normalized.depart_date)) {
    return null;
  }
  if (normalized.stops > 3) {
    return null;
  }
  if (normalized.trip_type === 'one_way' && normalized.return_date) {
    return null;
  }
  if (normalized.trip_type === 'round_trip' && normalized.return_date && normalized.return_date <= normalized.depart_date) {
    return null;
  }
  if (Number.isFinite(normalized.travel_duration_minutes) && normalized.travel_duration_minutes > 45 * 60) {
    return null;
  }
  const cluster = deriveClusterInfo(normalized);
  return {
    ...normalized,
    destination_cluster_slug: cluster.slug,
    destination_cluster_name: cluster.cluster_name,
    budget_bucket: budgetBucketFromPrice(normalized.price)
  };
}

async function dedupePublishedRows() {
  await ensureInitialized();
  if (getMode() === 'postgres') {
    await pgPool.query(`
      UPDATE travel_opportunities t
      SET is_published = false, published_at = NULL, updated_at = NOW()
      WHERE t.is_published = true
        AND EXISTS (
          SELECT 1
          FROM travel_opportunities k
          WHERE k.dedupe_key = t.dedupe_key
            AND k.id <> t.id
            AND k.is_published = true
            AND (k.final_score > t.final_score OR (k.final_score = t.final_score AND k.source_observed_at > t.source_observed_at))
        )
    `);
    return;
  }
  sqliteDb.exec(`
    UPDATE travel_opportunities
    SET is_published = 0, published_at = NULL, updated_at = datetime('now')
    WHERE is_published = 1
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, dedupe_key,
                 ROW_NUMBER() OVER (PARTITION BY dedupe_key ORDER BY final_score DESC, source_observed_at DESC) AS rn
          FROM travel_opportunities
          WHERE is_published = 1
        ) ranked
        WHERE rn = 1
      )
  `);
}

function applyOpportunityFilters(items, { country = '', region = '', cluster = '', budgetBucket = '', entity = '' } = {}) {
  const safeCountry = normalizeText(country);
  const safeRegion = normalizeText(region);
  const safeCluster = normalizeText(cluster);
  const safeEntity = normalizeText(entity);

  return items.filter((item) => {
    if (safeCountry && normalizeText(item.destination_country) !== safeCountry) return false;
    if (safeRegion && normalizeText(item.destination_region) !== safeRegion) return false;
    if (safeCluster && normalizeText(item.destination_cluster_slug) !== safeCluster) return false;
    if (budgetBucket && !matchesBudgetBucket(item, budgetBucket)) return false;
    if (safeEntity) {
      const entityPool = new Set([
        normalizeText(item.destination_city),
        normalizeText(item.destination_country),
        normalizeText(item.destination_region),
        normalizeText(item.destination_cluster_slug),
        normalizeText(item.destination_airport),
        normalizeText(item.origin_airport),
        slugify(item.destination_city),
        slugify(item.destination_country)
      ]);
      if (!entityPool.has(safeEntity)) return false;
    }
    return true;
  });
}

export async function listPublishedOpportunities({
  originAirport = '',
  maxPrice = null,
  travelMonth = '',
  country = '',
  region = '',
  cluster = '',
  budgetBucket = '',
  entity = '',
  limit = 20
} = {}) {
  await ensureInitialized();

  const safeOrigin = String(originAirport || '').trim().toUpperCase();
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 20));
  const preFilterLimit = Math.max(safeLimit * 4, 120);
  const hasMonth = /^\d{4}-\d{2}$/.test(String(travelMonth || '').trim());
  const safeMonth = hasMonth ? String(travelMonth).trim() : '';
  const safePrice = Number.isFinite(Number(maxPrice)) ? Number(maxPrice) : null;
  let rows = [];

  if (getMode() === 'postgres') {
    const where = ['is_published = true'];
    const params = [];
    if (safeOrigin) {
      params.push(safeOrigin);
      where.push(`origin_airport = $${params.length}`);
    }
    if (safePrice && safePrice > 0) {
      params.push(safePrice);
      where.push(`price <= $${params.length}`);
    }
    if (safeMonth) {
      params.push(`${safeMonth}-%`);
      where.push(`depart_date::text LIKE $${params.length}`);
    }
    params.push(preFilterLimit);
    const sql = `SELECT * FROM travel_opportunities WHERE ${where.join(' AND ')} ORDER BY final_score DESC, source_observed_at DESC LIMIT $${params.length}`;
    rows = (await pgPool.query(sql, params)).rows;
  } else {
    const where = ['is_published = 1'];
    const params = [];
    if (safeOrigin) {
      where.push('origin_airport = ?');
      params.push(safeOrigin);
    }
    if (safePrice && safePrice > 0) {
      where.push('price <= ?');
      params.push(safePrice);
    }
    if (safeMonth) {
      where.push('depart_date LIKE ?');
      params.push(`${safeMonth}-%`);
    }
    rows = sqliteDb
      .prepare(`SELECT * FROM travel_opportunities WHERE ${where.join(' AND ')} ORDER BY final_score DESC, source_observed_at DESC LIMIT ?`)
      .all(...params, preFilterLimit)
      .map((row) => ({ ...row, is_published: Boolean(row.is_published) }));
  }

  const normalized = rows.map(normalizeOpportunityRowForApi);
  const sanitized = normalized.filter(Boolean);
  const filteredOut = normalized.length - sanitized.length;
  if (filteredOut > 0) {
    lastPipelineStats = {
      ...lastPipelineStats,
      apiFilteredOut: Number(lastPipelineStats.apiFilteredOut || 0) + filteredOut
    };
  }
  const filtered = applyOpportunityFilters(sanitized, { country, region, cluster, budgetBucket, entity });
  return filtered.slice(0, safeLimit);
}

function mapUserFollowRow(row) {
  if (!row) return null;
  const metadata = sanitizeFollowMetadata(parseJsonSafe(row.metadata_json, {}));
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    follow_type: String(row.follow_type || 'radar'),
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    entity: {
      entity_type: String(row.entity_type || 'destination_cluster'),
      slug: String(row.slug || ''),
      display_name: String(row.display_name || row.slug || ''),
      metadata
    }
  };
}

export async function createOrUpdateUserFollow({ userId, entityType, slug, displayName, followType = 'radar', metadata = {} }) {
  await ensureInitialized();
  const normalizedUserId = String(userId || '').trim();
  const normalizedEntityType = String(entityType || '').trim().toLowerCase();
  const normalizedSlug = slugify(slug);
  const normalizedFollowType = String(followType || 'radar').trim().toLowerCase();
  const normalizedDisplayName = String(displayName || slug || '').trim() || normalizedSlug;
  const sanitizedMetadata = sanitizeFollowMetadata(metadata || {});
  const metadataJson = JSON.stringify(sanitizedMetadata);
  if (!normalizedUserId || !normalizedEntityType || !normalizedSlug) {
    throw new Error('invalid_follow_payload');
  }

  if (getMode() === 'postgres') {
    const existing = await pgPool.query(
      `SELECT * FROM opportunity_user_follows
       WHERE user_id = $1 AND entity_type = $2 AND slug = $3 AND follow_type = $4
       LIMIT 1`,
      [normalizedUserId, normalizedEntityType, normalizedSlug, normalizedFollowType]
    );
    if (existing.rows[0]) {
      const updated = await pgPool.query(
        `UPDATE opportunity_user_follows
         SET display_name = $2, metadata_json = $3::jsonb, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [existing.rows[0].id, normalizedDisplayName, metadataJson]
      );
      return mapUserFollowRow(updated.rows[0]);
    }
    const inserted = await pgPool.query(
      `INSERT INTO opportunity_user_follows
       (id, user_id, entity_type, slug, display_name, follow_type, metadata_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
       RETURNING *`,
      [`follow_${shortHash(`${normalizedUserId}_${normalizedEntityType}_${normalizedSlug}_${normalizedFollowType}`)}`, normalizedUserId, normalizedEntityType, normalizedSlug, normalizedDisplayName, normalizedFollowType, metadataJson]
    );
    return mapUserFollowRow(inserted.rows[0]);
  }

  const existing = sqliteDb
    .prepare(
      `SELECT * FROM opportunity_user_follows
       WHERE user_id = ? AND entity_type = ? AND slug = ? AND follow_type = ?
       LIMIT 1`
    )
    .get(normalizedUserId, normalizedEntityType, normalizedSlug, normalizedFollowType);
  if (existing) {
    sqliteDb
      .prepare(
        `UPDATE opportunity_user_follows
         SET display_name = ?, metadata_json = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(normalizedDisplayName, metadataJson, existing.id);
    const row = sqliteDb.prepare(`SELECT * FROM opportunity_user_follows WHERE id = ? LIMIT 1`).get(existing.id);
    return mapUserFollowRow(row);
  }
  const id = `follow_${shortHash(`${normalizedUserId}_${normalizedEntityType}_${normalizedSlug}_${normalizedFollowType}`)}`;
  sqliteDb
    .prepare(
      `INSERT INTO opportunity_user_follows
       (id, user_id, entity_type, slug, display_name, follow_type, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .run(id, normalizedUserId, normalizedEntityType, normalizedSlug, normalizedDisplayName, normalizedFollowType, metadataJson);
  const row = sqliteDb.prepare(`SELECT * FROM opportunity_user_follows WHERE id = ? LIMIT 1`).get(id);
  return mapUserFollowRow(row);
}

export async function listUserFollows(userId) {
  await ensureInitialized();
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return [];
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `SELECT * FROM opportunity_user_follows
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 250`,
      [normalizedUserId]
    );
    return result.rows.map(mapUserFollowRow).filter(Boolean);
  }
  const rows = sqliteDb
    .prepare(
      `SELECT * FROM opportunity_user_follows
       WHERE user_id = ?
       ORDER BY updated_at DESC
       LIMIT 250`
    )
    .all(normalizedUserId);
  return rows.map(mapUserFollowRow).filter(Boolean);
}

export async function getFollowSignalsSummary({ limit = 8 } = {}) {
  await ensureInitialized();
  const safeLimit = Math.max(1, Math.min(30, Math.round(Number(limit) || 8)));
  if (getMode() === 'postgres') {
    const totalResult = await pgPool.query(`SELECT COUNT(*)::int AS total FROM opportunity_user_follows`);
    const topResult = await pgPool.query(
      `SELECT
         slug,
         COALESCE(NULLIF(display_name, ''), slug) AS label,
         COUNT(*)::int AS total
       FROM opportunity_user_follows
       WHERE follow_type = 'radar'
       GROUP BY slug, label
       ORDER BY total DESC, label ASC
       LIMIT $1`,
      [safeLimit]
    );
    return {
      total: Number(totalResult.rows[0]?.total || 0),
      topRoutes: (topResult.rows || []).map((row) => ({
        slug: String(row?.slug || ''),
        label: String(row?.label || row?.slug || ''),
        count: Number(row?.total || 0)
      }))
    };
  }

  const totalRow = sqliteDb.prepare(`SELECT COUNT(*) AS total FROM opportunity_user_follows`).get();
  const rows = sqliteDb
    .prepare(
      `SELECT
         slug,
         COALESCE(NULLIF(display_name, ''), slug) AS label,
         COUNT(*) AS total
       FROM opportunity_user_follows
       WHERE follow_type = 'radar'
       GROUP BY slug, label
       ORDER BY total DESC, label ASC
       LIMIT ?`
    )
    .all(safeLimit);
  return {
    total: Number(totalRow?.total || 0),
    topRoutes: rows.map((row) => ({
      slug: String(row?.slug || ''),
      label: String(row?.label || row?.slug || ''),
      count: Number(row?.total || 0)
    }))
  };
}

export async function deleteUserFollow({ userId, followId }) {
  await ensureInitialized();
  const normalizedUserId = String(userId || '').trim();
  const normalizedFollowId = String(followId || '').trim();
  if (!normalizedUserId || !normalizedFollowId) return { removed: false };
  if (getMode() === 'postgres') {
    const result = await pgPool.query(`DELETE FROM opportunity_user_follows WHERE user_id = $1 AND id = $2`, [normalizedUserId, normalizedFollowId]);
    return { removed: result.rowCount > 0 };
  }
  const result = sqliteDb.prepare(`DELETE FROM opportunity_user_follows WHERE user_id = ? AND id = ?`).run(normalizedUserId, normalizedFollowId);
  return { removed: Number(result?.changes || 0) > 0 };
}

export async function listDestinationClusters({ region = '', limit = 12 } = {}) {
  const safeLimit = Math.max(1, Math.min(40, Number(limit) || 12));
  const items = await listPublishedOpportunities({
    region,
    limit: Math.max(160, safeLimit * 6)
  });
  const grouped = new Map();
  for (const item of items) {
    const cluster = deriveClusterInfo(item);
    const key = cluster.slug;
    const destinationAirport = isIataCode(item?.destination_airport) ? String(item.destination_airport).toUpperCase() : '';
    const destinationCity = String(item?.destination_city || '').trim();
    const price = toNumber(item.price, 0);
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: shortHash(`cluster_${key}`),
        cluster_name: cluster.cluster_name,
        slug: cluster.slug,
        region: cluster.region,
        min_price: price,
        opportunities_count: 1,
        representative_airport: destinationAirport || '',
        representative_city: destinationCity || '',
        representative_airport_price: destinationAirport ? price : Number.POSITIVE_INFINITY
      });
      continue;
    }
    const entry = grouped.get(key);
    entry.opportunities_count += 1;
    entry.min_price = Math.min(entry.min_price, price);
    if (destinationAirport) {
      const currentBestPrice = Number.isFinite(entry.representative_airport_price) ? entry.representative_airport_price : Number.POSITIVE_INFINITY;
      const nextBestPrice = price > 0 ? price : Number.POSITIVE_INFINITY;
      const shouldReplaceAirport =
        !entry.representative_airport ||
        nextBestPrice < currentBestPrice ||
        (nextBestPrice === currentBestPrice && destinationAirport < String(entry.representative_airport || ''));
      if (shouldReplaceAirport) {
        entry.representative_airport = destinationAirport;
        entry.representative_city = destinationCity || entry.representative_city || '';
        entry.representative_airport_price = nextBestPrice;
      }
    }
  }
  return [...grouped.values()]
    .map((entry) => ({
      id: entry.id,
      cluster_name: entry.cluster_name,
      slug: entry.slug,
      region: entry.region,
      min_price: entry.min_price,
      opportunities_count: entry.opportunities_count,
      representative_airport: entry.representative_airport || '',
      representative_city: entry.representative_city || ''
    }))
    .sort((a, b) => {
      if (b.opportunities_count !== a.opportunities_count) return b.opportunities_count - a.opportunities_count;
      return a.min_price - b.min_price;
    })
    .slice(0, safeLimit);
}

export async function getOpportunityById(opportunityId) {
  await ensureInitialized();
  const id = String(opportunityId || '').trim();
  if (!id) return null;

  if (getMode() === 'postgres') {
    const result = await pgPool.query(`SELECT * FROM travel_opportunities WHERE id = $1 LIMIT 1`, [id]);
    return normalizeOpportunityRowForApi(result.rows[0] || null);
  }
  const row = sqliteDb.prepare(`SELECT * FROM travel_opportunities WHERE id = ? LIMIT 1`).get(id);
  return normalizeOpportunityRowForApi(row ? { ...row, is_published: Boolean(row.is_published) } : null);
}

export async function listRelatedOpportunities(opportunity, limit = 4) {
  if (!opportunity) return [];
  await ensureInitialized();
  const safeLimit = Math.max(1, Math.min(12, Number(limit) || 4));

  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `SELECT * FROM travel_opportunities
       WHERE is_published = true
         AND id <> $1
         AND (origin_airport = $2 OR destination_airport = $3)
       ORDER BY final_score DESC, source_observed_at DESC
       LIMIT $4`,
      [opportunity.id, opportunity.origin_airport, opportunity.destination_airport, safeLimit]
    );
    return result.rows.map(normalizeOpportunityRowForApi);
  }

  const rows = sqliteDb
    .prepare(
      `SELECT * FROM travel_opportunities
       WHERE is_published = 1
         AND id <> ?
         AND (origin_airport = ? OR destination_airport = ?)
       ORDER BY final_score DESC, source_observed_at DESC
       LIMIT ?`
    )
    .all(opportunity.id, opportunity.origin_airport, opportunity.destination_airport, safeLimit);
  return rows.map((row) => normalizeOpportunityRowForApi({ ...row, is_published: Boolean(row.is_published) }));
}

const monthHints = [
  { pattern: /\b(gennaio|january)\b/i, month: 1 },
  { pattern: /\b(febbraio|february)\b/i, month: 2 },
  { pattern: /\b(marzo|march)\b/i, month: 3 },
  { pattern: /\b(aprile|april)\b/i, month: 4 },
  { pattern: /\b(maggio|may)\b/i, month: 5 },
  { pattern: /\b(giugno|june)\b/i, month: 6 },
  { pattern: /\b(luglio|july)\b/i, month: 7 },
  { pattern: /\b(agosto|august)\b/i, month: 8 },
  { pattern: /\b(settembre|september)\b/i, month: 9 },
  { pattern: /\b(ottobre|october)\b/i, month: 10 },
  { pattern: /\b(novembre|november)\b/i, month: 11 },
  { pattern: /\b(dicembre|december)\b/i, month: 12 }
];

function parsePromptFilters(prompt) {
  const raw = String(prompt || '').trim();
  const filters = {
    budget: null,
    originAirport: '',
    destinationKeyword: '',
    travelMonth: ''
  };
  const budgetMatch = raw.match(/(\d{2,5})\s*(eur|euro|€)/i) || raw.match(/budget[^0-9]*(\d{2,5})/i);
  if (budgetMatch) filters.budget = Number(budgetMatch[1]);

  const iataMatches = raw.match(/\b[A-Z]{3}\b/g) || [];
  if (iataMatches.length > 0) filters.originAirport = String(iataMatches[0]).toUpperCase();

  for (const hint of monthHints) {
    if (hint.pattern.test(raw)) {
      const year = new Date().getUTCFullYear();
      filters.travelMonth = `${year}-${String(hint.month).padStart(2, '0')}`;
      break;
    }
  }

  const fromMatch = raw.match(/(?:for|per|to|verso)\s+([A-Za-zÀ-ÿ'\-\s]{3,30})/i);
  if (fromMatch) filters.destinationKeyword = String(fromMatch[1]).trim();
  return filters;
}

export async function queryOpportunitiesByPrompt({ prompt, limit = 12 }) {
  const parsed = parsePromptFilters(prompt);
  const items = await listPublishedOpportunities({
    originAirport: parsed.originAirport,
    maxPrice: parsed.budget,
    travelMonth: parsed.travelMonth,
    limit: Math.max(4, Math.min(30, Number(limit) || 12))
  });
  const destinationKeyword = String(parsed.destinationKeyword || '').toLowerCase();
  const filtered =
    destinationKeyword.length >= 2
      ? items.filter((item) => `${item.destination_city} ${item.destination_airport}`.toLowerCase().includes(destinationKeyword))
      : items;
  return {
    items: filtered,
    filters: parsed,
    summary:
      filtered.length > 0
        ? `Trovate ${filtered.length} opportunit\u00e0 reali in base ai dati disponibili.`
        : 'Nessuna opportunit\u00e0 corrispondente ai filtri estratti dal prompt.'
  };
}

export async function enrichShortlistedOpportunities({ maxItems = 10 } = {}) {
  await ensureInitialized();
  const safeLimit = Math.max(1, Math.min(40, Number(maxItems) || 10));
  const perRunCap = Math.max(0, Number(process.env.OPPORTUNITY_AI_ENRICHMENT_MAX_CALLS_PER_RUN || 0));
  const dailyCap = Math.max(0, Number(process.env.OPPORTUNITY_AI_ENRICHMENT_DAILY_BUDGET || 0));
  const effectiveLimit = perRunCap > 0 ? Math.min(safeLimit, perRunCap) : safeLimit;
  const cache = getCacheClient();
  const dayStamp = (() => {
    const now = new Date();
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  })();
  const dailyKey = `opportunity:ai:enrichment:day:${dayStamp}`;

  async function claimDailyBudget() {
    if (!dailyCap || !cache || typeof cache.incr !== 'function') return true;
    const used = Number(await cache.incr(dailyKey));
    if (used === 1 && typeof cache.expire === 'function') {
      await cache.expire(dailyKey, 24 * 60 * 60 + 120);
    }
    return used <= dailyCap;
  }

  const selectSql =
    getMode() === 'postgres'
      ? `SELECT * FROM travel_opportunities
         WHERE is_published = true
           AND final_score >= 75
           AND (enrichment_status = 'pending' OR enrichment_status = 'failed')
         ORDER BY final_score DESC, source_observed_at DESC
         LIMIT $1`
      : `SELECT * FROM travel_opportunities
         WHERE is_published = 1
           AND final_score >= 75
           AND (enrichment_status = 'pending' OR enrichment_status = 'failed')
         ORDER BY final_score DESC, source_observed_at DESC
         LIMIT ?`;

  const rows =
    getMode() === 'postgres'
      ? (await pgPool.query(selectSql, [effectiveLimit])).rows
      : sqliteDb.prepare(selectSql).all(effectiveLimit);

  let enriched = 0;
  let failed = 0;
  let skippedBudget = 0;
  for (const row of rows) {
    const withinBudget = await claimDailyBudget();
    if (!withinBudget) {
      skippedBudget += 1;
      continue;
    }
    try {
      const fallback = buildAiCopy(row);
      const copy = await enrichWithProviderIfEnabled(row, fallback);
      if (getMode() === 'postgres') {
        await pgPool.query(
          `UPDATE travel_opportunities
           SET ai_title = $2, ai_description = $3, notification_text = $4, why_it_matters = $5,
               enrichment_status = 'enriched', updated_at = NOW()
           WHERE id = $1`,
          [row.id, copy.aiTitle, copy.aiDescription, copy.notificationText, copy.whyItMatters]
        );
      } else {
        sqliteDb
          .prepare(
            `UPDATE travel_opportunities
             SET ai_title = ?, ai_description = ?, notification_text = ?, why_it_matters = ?,
                 enrichment_status = 'enriched', updated_at = datetime('now')
             WHERE id = ?`
          )
          .run(copy.aiTitle, copy.aiDescription, copy.notificationText, copy.whyItMatters, row.id);
      }
      enriched += 1;
    } catch {
      failed += 1;
      if (getMode() === 'postgres') {
        await pgPool.query(`UPDATE travel_opportunities SET enrichment_status = 'failed', updated_at = NOW() WHERE id = $1`, [row.id]);
      } else {
        sqliteDb.prepare(`UPDATE travel_opportunities SET enrichment_status = 'failed', updated_at = datetime('now') WHERE id = ?`).run(row.id);
      }
    }
  }

  lastPipelineStats = {
    ...lastPipelineStats,
    enriched: (lastPipelineStats.enriched || 0) + enriched,
    enrichFailed: (lastPipelineStats.enrichFailed || 0) + failed
  };
  return { candidates: rows.length, enriched, failed, skippedBudget };
}

export async function createOpportunityPipelineRun({ providerFetchEnabled = false, metadata = {} } = {}) {
  await ensureInitialized();
  await cleanupStaleOpportunityPipelineRuns();
  const id = `oprun_${shortHash(`${Date.now()}_${Math.random()}`)}`;
  const startedAt = new Date().toISOString();
  const metadataJson = stringifyJsonSafe(metadata || {});
  if (getMode() === 'postgres') {
    await pgPool.query(
      `INSERT INTO opportunity_pipeline_runs
       (id, status, started_at, provider_fetch_enabled, metadata, created_at, updated_at)
       VALUES ($1, 'running', $2, $3, $4::jsonb, NOW(), NOW())`,
      [id, startedAt, Boolean(providerFetchEnabled), metadataJson]
    );
    return { id, startedAt };
  }
  sqliteDb
    .prepare(
      `INSERT INTO opportunity_pipeline_runs
       (id, status, started_at, provider_fetch_enabled, metadata, created_at, updated_at)
       VALUES (?, 'running', ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .run(id, startedAt, providerFetchEnabled ? 1 : 0, metadataJson);
  return { id, startedAt };
}

export async function cleanupStaleOpportunityPipelineRuns({ staleAfterMinutes = null } = {}) {
  await ensureInitialized();
  const safeMinutes = clampMinutes(staleAfterMinutes, OPPORTUNITY_PIPELINE_STALE_RUNNING_MINUTES, 10);
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `UPDATE opportunity_pipeline_runs
       SET status = 'failed',
           finished_at = COALESCE(finished_at, NOW()),
           error_summary = COALESCE(error_summary, 'stale_pipeline_run_auto_closed'),
           updated_at = NOW()
       WHERE status = 'running'
         AND started_at < NOW() - ($1::int * INTERVAL '1 minute')`,
      [safeMinutes]
    );
    return Number(result?.rowCount || 0);
  }
  const result = sqliteDb
    .prepare(
      `UPDATE opportunity_pipeline_runs
       SET status = 'failed',
           finished_at = COALESCE(finished_at, datetime('now')),
           error_summary = COALESCE(error_summary, 'stale_pipeline_run_auto_closed'),
           updated_at = datetime('now')
       WHERE status = 'running'
         AND datetime(started_at) < datetime('now', '-' || ? || ' minute')`
    )
    .run(safeMinutes);
  return Number(result?.changes || 0);
}

export async function findRecentRunningOpportunityPipelineRun({ withinMinutes = null } = {}) {
  await ensureInitialized();
  const safeMinutes = clampMinutes(withinMinutes, OPPORTUNITY_PIPELINE_OVERLAP_GUARD_MINUTES, 1);

  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `SELECT
         id,
         status,
         started_at,
         finished_at,
         processed_count,
         published_count,
         deduped_count,
         enriched_count,
         enrich_failed_count,
         provider_fetch_enabled,
         error_summary,
         metadata,
         created_at,
         updated_at
       FROM opportunity_pipeline_runs
       WHERE status = 'running'
         AND started_at >= NOW() - ($1::int * INTERVAL '1 minute')
       ORDER BY started_at DESC
       LIMIT 1`,
      [safeMinutes]
    );
    return result.rows[0] || null;
  }

  const row = sqliteDb
    .prepare(
      `SELECT
         id,
         status,
         started_at,
         finished_at,
         processed_count,
         published_count,
         deduped_count,
         enriched_count,
         enrich_failed_count,
         provider_fetch_enabled,
         error_summary,
         metadata,
         created_at,
         updated_at
       FROM opportunity_pipeline_runs
       WHERE status = 'running'
         AND datetime(started_at) >= datetime('now', '-' || ? || ' minute')
       ORDER BY datetime(started_at) DESC
       LIMIT 1`
    )
    .get(safeMinutes);
  if (!row) return null;
  return {
    ...row,
    metadata: parseJsonSafe(row.metadata, {})
  };
}

export async function finalizeOpportunityPipelineRun({
  runId,
  status = 'success',
  processedCount = 0,
  publishedCount = 0,
  dedupedCount = 0,
  enrichedCount = 0,
  enrichFailedCount = 0,
  errorSummary = null,
  metadata = null
}) {
  await ensureInitialized();
  if (!runId) return;
  const metadataJson = metadata ? stringifyJsonSafe(metadata) : null;
  if (getMode() === 'postgres') {
    await pgPool.query(
      `UPDATE opportunity_pipeline_runs
       SET status = $2,
           finished_at = NOW(),
           processed_count = $3,
           published_count = $4,
           deduped_count = $5,
           enriched_count = $6,
           enrich_failed_count = $7,
           error_summary = $8,
           metadata = COALESCE($9::jsonb, metadata),
           updated_at = NOW()
       WHERE id = $1`,
      [
        runId,
        String(status || 'success'),
        Number(processedCount || 0),
        Number(publishedCount || 0),
        Number(dedupedCount || 0),
        Number(enrichedCount || 0),
        Number(enrichFailedCount || 0),
        errorSummary ? String(errorSummary) : null,
        metadataJson
      ]
    );
    return;
  }
  sqliteDb
    .prepare(
      `UPDATE opportunity_pipeline_runs
       SET status = ?,
           finished_at = ?,
           processed_count = ?,
           published_count = ?,
           deduped_count = ?,
           enriched_count = ?,
           enrich_failed_count = ?,
           error_summary = ?,
           metadata = COALESCE(?, metadata),
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(
      String(status || 'success'),
      new Date().toISOString(),
      Number(processedCount || 0),
      Number(publishedCount || 0),
      Number(dedupedCount || 0),
      Number(enrichedCount || 0),
      Number(enrichFailedCount || 0),
      errorSummary ? String(errorSummary) : null,
      metadataJson,
      runId
    );
}

export async function listRecentOpportunityPipelineRuns(limit = 10) {
  await ensureInitialized();
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `SELECT id, status, started_at, finished_at, processed_count, published_count, deduped_count,
              enriched_count, enrich_failed_count, provider_fetch_enabled, error_summary, metadata
       FROM opportunity_pipeline_runs
       ORDER BY started_at DESC
       LIMIT $1`,
      [safeLimit]
    );
    return result.rows;
  }
  return sqliteDb
    .prepare(
      `SELECT id, status, started_at, finished_at, processed_count, published_count, deduped_count,
              enriched_count, enrich_failed_count, provider_fetch_enabled, error_summary, metadata
       FROM opportunity_pipeline_runs
       ORDER BY started_at DESC
       LIMIT ?`
    )
    .all(safeLimit);
}

export function getOpportunityFeedVersion() {
  return String(opportunityFeedVersion || '0');
}

export async function getOpportunityPipelineStats() {
  await ensureInitialized();
  let total = 0;
  let published = 0;
  let pendingEnrichment = 0;
  if (getMode() === 'postgres') {
    const result = await pgPool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE is_published = true)::int AS published,
         COUNT(*) FILTER (WHERE enrichment_status = 'pending')::int AS pending_enrichment
       FROM travel_opportunities`
    );
    total = Number(result.rows[0]?.total || 0);
    published = Number(result.rows[0]?.published || 0);
    pendingEnrichment = Number(result.rows[0]?.pending_enrichment || 0);
  } else {
    const row =
      sqliteDb
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN is_published = 1 THEN 1 ELSE 0 END) AS published,
             SUM(CASE WHEN enrichment_status = 'pending' THEN 1 ELSE 0 END) AS pending_enrichment
           FROM travel_opportunities`
        )
        .get() || {};
    total = Number(row.total || 0);
    published = Number(row.published || 0);
    pendingEnrichment = Number(row.pending_enrichment || 0);
  }
  const recentRuns = await listRecentOpportunityPipelineRuns(8);
  return {
    ...lastPipelineStats,
    totals: { total, published, pendingEnrichment },
    apiQuality: {
      filteredOutSinceBoot: Number(lastPipelineStats.apiFilteredOut || 0)
    },
    recentRuns
  };
}

export async function getOpportunityIntelligenceDebugStats() {
  await ensureInitialized();
  const opportunityPipeline = await getOpportunityPipelineStats();
  let followsTotal = 0;
  if (getMode() === 'postgres') {
    const result = await pgPool.query(`SELECT COUNT(*)::int AS total FROM opportunity_user_follows`);
    followsTotal = Number(result.rows[0]?.total || 0);
  } else {
    const row = sqliteDb.prepare(`SELECT COUNT(*) AS total FROM opportunity_user_follows`).get();
    followsTotal = Number(row?.total || 0);
  }
  return {
    opportunityPipeline,
    follows: {
      total: followsTotal
    },
    refreshedAt: new Date().toISOString()
  };
}
