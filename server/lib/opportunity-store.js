import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildBookingLink } from './flight-engine.js';
import { listPriceObservationsSince, scoreDeal } from './deal-engine-store.js';
import { parseFlag } from './env-flags.js';
import { getCacheClient } from './free-cache.js';
import { createAiCache } from './ai-cache.js';
import { sanitizeFollowMetadata } from './follow-metadata.js';
import { logger } from './logger.js';
import { OPPORTUNITY_UPSERT_POSTGRES_SQL, OPPORTUNITY_UPSERT_SQLITE_SQL, buildOpportunityUpsertValues } from './opportunity-store-queries.js';
import {
  OPPORTUNITY_POSTGRES_ALTER_SQL,
  OPPORTUNITY_POSTGRES_SCHEMA_SQL,
  OPPORTUNITY_SQLITE_REQUIRED_COLUMNS,
  OPPORTUNITY_SQLITE_SCHEMA_SQL
} from './opportunity-store-schema.js';
import { applyOpportunityFilters, mapUserFollowRow, parsePromptFilters } from './opportunity-store-query-helpers.js';
import { createOpportunityAiEnricher } from './opportunity-ai-enricher.js';
import { deriveClusterInfo, resolveOrigin, resolveRoute, resolveRouteMeta } from './opportunity-geo.js';
import { scoreOpportunityCandidate } from './opportunity-scoring.js';
import {
  budgetBucketFromPrice,
  buildAiCopy,
  clampMinutes,
  computeTripLength,
  estimateStops,
  isIataCode,
  isYmd,
  normalizeTripType,
  parseBaggageIncluded,
  parseJsonSafe,
  shortHash,
  slugify,
  stringifyJsonSafe,
  toIso,
  toNullableInt,
  toNullableScore,
  toNumber,
  toYmd
} from './opportunity-store-helpers.js';

const DB_FILE_URL = new URL('../../data/app.db', import.meta.url);
const DB_FILE_PATH = fileURLToPath(DB_FILE_URL);

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
const OPPORTUNITY_AI_CACHE_TTL_SECONDS = Math.max(
  60,
  Number(process.env.OPPORTUNITY_AI_ENRICHMENT_CACHE_TTL_SECONDS || 172800)
);
const OPPORTUNITY_AI_CACHE_ONLY_MODE = parseFlag(process.env.OPPORTUNITY_AI_ENRICHMENT_CACHE_ONLY_MODE, false);
const opportunityCacheClient = getCacheClient();
const opportunityAiCache = createAiCache({
  cacheClient: opportunityCacheClient,
  defaultTtlSeconds: OPPORTUNITY_AI_CACHE_TTL_SECONDS
});

function getMode() {
  return process.env.DATABASE_URL ? 'postgres' : 'sqlite';
}


const enrichWithProviderIfEnabled = createOpportunityAiEnricher({
  aiCache: opportunityAiCache,
  cacheClient: opportunityCacheClient,
  cacheTtlSeconds: OPPORTUNITY_AI_CACHE_TTL_SECONDS,
  cacheOnlyMode: OPPORTUNITY_AI_CACHE_ONLY_MODE,
  logger
});

async function ensurePostgres() {
  if (!pgPool) pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pgPool.query(OPPORTUNITY_POSTGRES_SCHEMA_SQL);
  await pgPool.query(OPPORTUNITY_POSTGRES_ALTER_SQL);
}

async function ensureSqlite() {
  if (sqliteDb) return;
  await mkdir(dirname(DB_FILE_PATH), { recursive: true });
  const sqlite = await import('node:sqlite');
  sqliteDb = new sqlite.DatabaseSync(DB_FILE_PATH);
  sqliteDb.exec(OPPORTUNITY_SQLITE_SCHEMA_SQL);
  const columns = sqliteDb.prepare(`PRAGMA table_info(travel_opportunities)`).all().map((row) => String(row.name));
  const ensureColumn = (name, sqlType) => {
    if (columns.includes(name)) return;
    sqliteDb.exec(`ALTER TABLE travel_opportunities ADD COLUMN ${name} ${sqlType}`);
  };
  for (const [name, sqlType] of OPPORTUNITY_SQLITE_REQUIRED_COLUMNS) {
    ensureColumn(name, sqlType);
  }
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
    await pgPool.query(OPPORTUNITY_UPSERT_POSTGRES_SQL, buildOpportunityUpsertValues(row));
    return;
  }

  sqliteDb
    .prepare(OPPORTUNITY_UPSERT_SQLITE_SQL)
    .run(...buildOpportunityUpsertValues(row, { sqlite: true }));
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
      const route = resolveRoute(originAirport, destinationAirport);
      const origin = resolveOrigin(originAirport);
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
  const meta = resolveRouteMeta(row.origin_airport, row.destination_airport);
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
  // Safe default: 20 enrichment calls/day in production if not explicitly configured.
  // Set OPPORTUNITY_AI_ENRICHMENT_DAILY_BUDGET=0 to fully disable budget-gating
  // (not recommended; prefer setting OPPORTUNITY_AI_ENRICHMENT_ENABLED=false instead).
  const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const dailyCap = Math.max(0, Number(process.env.OPPORTUNITY_AI_ENRICHMENT_DAILY_BUDGET || (isProduction ? 20 : 200)));
  const effectiveLimit = perRunCap > 0 ? Math.min(safeLimit, perRunCap) : safeLimit;
  const cache = getCacheClient();
  const dayStamp = (() => {
    const now = new Date();
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  })();
  const dailyKey = `opportunity:ai:enrichment:day:${dayStamp}`;

  async function claimDailyBudget() {
    // Fail closed: no Redis or cap=0 means no AI calls are allowed.
    if (!cache || typeof cache.incr !== 'function') return false;
    if (dailyCap <= 0) return false;
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

