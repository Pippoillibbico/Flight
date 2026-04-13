import pg from 'pg';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger as rootLogger } from './logger.js';

const SQLITE_DB_PATH = fileURLToPath(new URL('../../data/app.db', import.meta.url));
const RANKING_PROFILES = Object.freeze({
  A: Object.freeze({
    key: 'A',
    model: 'deal_score_v1',
    weights: Object.freeze({
      savings_percent: 0.4,
      route_popularity: 0.2,
      freshness: 0.15,
      user_interest: 0.15,
      low_stops: 0.1
    })
  }),
  B: Object.freeze({
    key: 'B',
    model: 'deal_score_v1',
    weights: Object.freeze({
      savings_percent: 0.32,
      route_popularity: 0.18,
      freshness: 0.1,
      user_interest: 0.25,
      low_stops: 0.15
    })
  })
});

const discoveryFeedRuntimeMetrics = {
  callsTotal: 0,
  freshBuildsTotal: 0,
  cacheHitsTotal: 0,
  skippedTotal: 0,
  sourceRowsTotal: 0,
  validCandidatesTotal: 0,
  nearDuplicateFilteredTotal: 0,
  destinationDiversityFilteredTotal: 0,
  rejectedByReason: Object.create(null),
  lastCallAt: null,
  lastBuildMeta: null
};

function cloneObject(input) {
  const out = Object.create(null);
  for (const [key, value] of Object.entries(input || {})) {
    out[String(key)] = Number(value || 0);
  }
  return out;
}

function mergeRejectReasons(target, source) {
  const out = target || Object.create(null);
  for (const [key, value] of Object.entries(source || {})) {
    out[String(key)] = Number(out[String(key)] || 0) + Number(value || 0);
  }
  return out;
}

function captureRuntimeMetrics({ cached = false, payload = null } = {}) {
  discoveryFeedRuntimeMetrics.callsTotal += 1;
  discoveryFeedRuntimeMetrics.lastCallAt = new Date().toISOString();
  if (cached) {
    discoveryFeedRuntimeMetrics.cacheHitsTotal += 1;
    return;
  }
  if (payload?.skipped) {
    discoveryFeedRuntimeMetrics.skippedTotal += 1;
    discoveryFeedRuntimeMetrics.lastBuildMeta = {
      skipped: true,
      reason: payload?.reason || null,
      at: new Date().toISOString()
    };
    return;
  }

  const meta = payload?.meta || {};
  discoveryFeedRuntimeMetrics.freshBuildsTotal += 1;
  discoveryFeedRuntimeMetrics.sourceRowsTotal += Number(meta.source_rows || 0);
  discoveryFeedRuntimeMetrics.validCandidatesTotal += Number(meta.valid_candidates || 0);
  discoveryFeedRuntimeMetrics.nearDuplicateFilteredTotal += Number(meta.near_duplicate_filtered || 0);
  discoveryFeedRuntimeMetrics.destinationDiversityFilteredTotal += Number(meta.destination_diversity_filtered || 0);
  discoveryFeedRuntimeMetrics.rejectedByReason = mergeRejectReasons(discoveryFeedRuntimeMetrics.rejectedByReason, meta.rejected_by_reason || {});
  discoveryFeedRuntimeMetrics.lastBuildMeta = {
    skipped: false,
    generated_at: meta.generated_at || new Date().toISOString(),
    total_candidates: Number(meta.total_candidates || 0),
    source_rows: Number(meta.source_rows || 0),
    valid_candidates: Number(meta.valid_candidates || 0),
    near_duplicate_filtered: Number(meta.near_duplicate_filtered || 0),
    destination_diversity_filtered: Number(meta.destination_diversity_filtered || 0),
    ranking_variant: String(meta.ranking_variant || 'A')
  };
}

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function round2(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function parseJsonSafe(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function stableNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function normalizeRankingVariant(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  if (normalized === 'A' || normalized === 'B') return normalized;
  return null;
}

function deterministicRatio(seed) {
  const hash = createHash('sha1').update(String(seed || '')).digest('hex').slice(0, 8);
  const parsed = Number.parseInt(hash, 16);
  if (!Number.isFinite(parsed)) return 0;
  return parsed / 0xffffffff;
}

function normalizeIata(value) {
  const out = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(out) ? out : '';
}

function parseDateOnly(value) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateYmd(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value || '').trim();
  if (!text) return '';
  const direct = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct?.[1]) return direct[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function isWeekendFlight(item) {
  const depart = parseDateOnly(item.depart_date);
  if (!depart) return false;
  const departDay = depart.getUTCDay();
  const isWeekendDepart = departDay === 5 || departDay === 6;
  if (!isWeekendDepart) return false;

  if (!item.return_date) return true;
  const ret = parseDateOnly(item.return_date);
  if (!ret) return false;
  const returnDay = ret.getUTCDay();
  const isWeekendReturn = returnDay === 0 || returnDay === 1;
  const tripDays = Math.round((ret.getTime() - depart.getTime()) / (24 * 60 * 60 * 1000));
  return isWeekendReturn && tripDays >= 1 && tripDays <= 4;
}

function isLastMinute(item, days = 14) {
  const depart = parseDateOnly(item.depart_date);
  if (!depart) return false;
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const upper = new Date(todayUtc.getTime() + Math.max(1, Number(days || 14)) * 24 * 60 * 60 * 1000);
  return depart >= todayUtc && depart <= upper;
}

function isLongHaulDiscounted(item, { minDistanceKm, minDurationMinutes, minSavingsPct }) {
  const distance = toNumber(item.distance_km, 0);
  const duration = toNumber(item.duration_minutes, 0);
  const savings = toNumber(item.savings_pct, 0);
  const longHaul = distance >= minDistanceKm || duration >= minDurationMinutes;
  return longHaul && savings >= minSavingsPct;
}

function uniqueByDeal(items, limit) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const key = String(item.deal_key || item.id || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function computeRoutePopularityScore(item) {
  const breakdown = parseJsonSafe(item.score_breakdown, {});
  const signals = parseJsonSafe(breakdown.signals, {});
  const routePopularity = toNumber(signals.route_popularity_30d, 0);
  return round2(clamp((Math.log1p(routePopularity) / Math.log1p(400)) * 100, 0, 100));
}

function computeUserInterestScore(item) {
  const breakdown = parseJsonSafe(item.score_breakdown, {});
  const signals = parseJsonSafe(breakdown.signals, {});
  const userSignals = toNumber(signals.user_signals_30d, 0);
  return round2(clamp((Math.log1p(userSignals) / Math.log1p(120)) * 100, 0, 100));
}

function computeFreshnessScore(item) {
  const observedText = item?.source_observed_at || item?.published_at || null;
  const observedTs = observedText ? new Date(observedText).getTime() : NaN;
  if (!Number.isFinite(observedTs)) return 0;
  const ageHours = Math.max(0, (Date.now() - observedTs) / (60 * 60 * 1000));
  return round2(clamp(100 - ageHours * 2, 0, 100));
}

function computeLowStopsBonus(item) {
  const stops = Math.max(0, Math.floor(toNumber(item?.stops, 1)));
  if (stops === 0) return 100;
  if (stops === 1) return 75;
  if (stops === 2) return 50;
  if (stops === 3) return 25;
  return 0;
}

function computeDealScore(item, rankingProfile = RANKING_PROFILES.A) {
  const weights = rankingProfile?.weights || RANKING_PROFILES.A.weights;
  const savingsPercent = round2(clamp(toNumber(item?.savings_pct, 0), 0, 100));
  const routePopularity = computeRoutePopularityScore(item);
  const freshnessScore = computeFreshnessScore(item);
  const userInterestScore = computeUserInterestScore(item);
  const lowStopsBonus = computeLowStopsBonus(item);
  const dealScore = round2(
    savingsPercent * toNumber(weights.savings_percent, 0) +
      routePopularity * toNumber(weights.route_popularity, 0) +
      freshnessScore * toNumber(weights.freshness, 0) +
      userInterestScore * toNumber(weights.user_interest, 0) +
      lowStopsBonus * toNumber(weights.low_stops, 0)
  );
  return {
    dealScore,
    savingsPercent,
    routePopularity,
    freshnessScore,
    userInterestScore,
    lowStopsBonus,
    weights
  };
}

function mapRow(row, { rankingProfile = RANKING_PROFILES.A } = {}) {
  const price = round2(row.price);
  const baseline = round2(row.baseline_price || row.avg_price || 0);
  const savingsAmount = round2(row.savings_amount != null ? row.savings_amount : Math.max(0, baseline - price));
  const savingsPct =
    row.savings_pct != null
      ? round2(row.savings_pct)
      : baseline > 0
      ? round2(((baseline - price) / baseline) * 100)
      : 0;
  const isBookableRaw = row.is_bookable;
  const isBookable = isBookableRaw == null ? null : toBoolean(isBookableRaw, Boolean(isBookableRaw));
  const departDate = toDateYmd(row.departure_date);
  const returnDate = toDateYmd(row.return_date);
  const item = {
    id: String(row.id ?? ''),
    deal_key: String(row.deal_key || ''),
    route_id: toNumber(row.route_id, 0),
    flight_quote_id: toNumber(row.flight_quote_id, 0),
    deal_type: String(row.deal_type || 'great_deal'),
    opportunity_level: String(row.opportunity_level || 'Great deal'),
    status: String(row.status || 'published'),
    price,
    baseline_price: baseline,
    savings_amount: savingsAmount,
    savings_pct: savingsPct,
    final_score: round2(row.final_score),
    raw_score: round2(row.raw_score),
    currency: String(row.currency || row.quote_currency || 'EUR').toUpperCase(),
    origin_iata: normalizeIata(row.origin_iata),
    destination_iata: normalizeIata(row.destination_iata),
    origin_city: String(row.origin_city || row.origin_iata || '').trim() || null,
    destination_city: String(row.destination_city || row.destination_iata || '').trim() || null,
    depart_date: departDate,
    return_date: returnDate || null,
    trip_type: String(row.trip_type || 'round_trip'),
    cabin_class: String(row.cabin_class || 'economy'),
    stops: toNumber(row.stops, 0),
    duration_minutes: row.duration_minutes == null ? null : toNumber(row.duration_minutes, 0),
    distance_km: row.distance_km == null ? null : toNumber(row.distance_km, 0),
    provider: String(row.provider || '').trim() || null,
    is_bookable: isBookable,
    published_at: toIso(row.published_at),
    expires_at: toIso(row.expires_at),
    source_observed_at: toIso(row.source_observed_at),
    score_breakdown: parseJsonSafe(row.score_breakdown, {})
  };
  const persistedDealScore = row.deal_score == null ? null : round2(row.deal_score);
  const ranking = computeDealScore(item, rankingProfile);
  item.deal_score = Number.isFinite(ranking.dealScore) ? ranking.dealScore : persistedDealScore ?? round2(row.final_score);
  item.deal_score_persisted = persistedDealScore;
  item.popularity_score = ranking.routePopularity;
  item.route_popularity_score = ranking.routePopularity;
  item.freshness_score = ranking.freshnessScore;
  item.user_interest_score = ranking.userInterestScore;
  item.low_stops_bonus = ranking.lowStopsBonus;
  return item;
}

function sortByTop(a, b) {
  return (
    toNumber(b.deal_score, 0) - toNumber(a.deal_score, 0) ||
    toNumber(b.final_score, 0) - toNumber(a.final_score, 0) ||
    toNumber(b.savings_pct, 0) - toNumber(a.savings_pct, 0) ||
    String(b.source_observed_at || '').localeCompare(String(a.source_observed_at || ''))
  );
}

function sortByRecent(a, b) {
  return (
    String(b.source_observed_at || '').localeCompare(String(a.source_observed_at || '')) ||
    toNumber(b.deal_score, 0) - toNumber(a.deal_score, 0) ||
    toNumber(b.final_score, 0) - toNumber(a.final_score, 0)
  );
}

function sortByPopular(a, b) {
  return (
    toNumber(b.deal_score, 0) - toNumber(a.deal_score, 0) ||
    toNumber(b.popularity_score, 0) - toNumber(a.popularity_score, 0) ||
    toNumber(b.final_score, 0) - toNumber(a.final_score, 0)
  );
}

function sortByCheap(a, b) {
  return (
    toNumber(a.price, 0) - toNumber(b.price, 0) ||
    toNumber(b.deal_score, 0) - toNumber(a.deal_score, 0) ||
    toNumber(b.savings_pct, 0) - toNumber(a.savings_pct, 0) ||
    toNumber(b.final_score, 0) - toNumber(a.final_score, 0)
  );
}

function validateFeedItem(
  item,
  {
    minPrice = 10,
    maxPrice = 20000,
    maxStops = 3,
    minDurationMinutes = 30,
    maxDurationMinutes = 2160,
    maxAgeHours = 168
  } = {}
) {
  if (!item || typeof item !== 'object') return 'invalid_item';
  if (!String(item.deal_key || '').trim()) return 'missing_deal_key';
  if (!normalizeIata(item.origin_iata) || !normalizeIata(item.destination_iata)) return 'invalid_iata';
  if (!parseDateOnly(item.depart_date)) return 'invalid_departure_date';
  const tripType = String(item.trip_type || '').toLowerCase();
  if (tripType === 'round_trip' && !parseDateOnly(item.return_date)) return 'invalid_return_date';
  if (tripType === 'one_way' && item.return_date) return 'one_way_has_return';
  if (!/^[A-Z]{3}$/.test(String(item.currency || '').trim().toUpperCase())) return 'invalid_currency';
  if (item.is_bookable === false) return 'not_bookable';

  const price = toNumber(item.price, NaN);
  if (!Number.isFinite(price) || price < minPrice || price > maxPrice) return 'outlier_price';

  const stops = toNumber(item.stops, NaN);
  if (Number.isFinite(stops) && stops > maxStops) return 'too_many_stops';

  const duration = toNumber(item.duration_minutes, NaN);
  if (Number.isFinite(duration) && duration > 0 && (duration < minDurationMinutes || duration > maxDurationMinutes)) return 'unrealistic_duration';

  const observedText = item.source_observed_at || item.published_at || null;
  const observedTs = observedText ? new Date(observedText).getTime() : NaN;
  if (!Number.isFinite(observedTs)) return 'invalid_observed_at';
  const ageHours = Math.max(0, (Date.now() - observedTs) / (60 * 60 * 1000));
  if (ageHours > maxAgeHours) return 'stale_offer';

  const expiresTs = item.expires_at ? new Date(item.expires_at).getTime() : NaN;
  if (Number.isFinite(expiresTs) && expiresTs <= Date.now()) return 'expired_offer';

  return null;
}

function nearDuplicateClusterKey(item) {
  return [
    normalizeIata(item.origin_iata),
    normalizeIata(item.destination_iata),
    String(item.depart_date || '').slice(0, 10),
    item.return_date ? String(item.return_date).slice(0, 10) : '',
    String(item.trip_type || '').trim().toLowerCase(),
    String(item.cabin_class || '').trim().toLowerCase()
  ].join('|');
}

function pricesAreNear(a, b, deltaPct = 3) {
  const left = Math.max(0, toNumber(a, 0));
  const right = Math.max(0, toNumber(b, 0));
  if (left <= 0 || right <= 0) return false;
  const base = Math.max(1, Math.min(left, right));
  const diff = Math.abs(left - right);
  return diff <= (base * Math.max(0.1, Number(deltaPct || 0))) / 100;
}

function dedupeNearDuplicates(items, { priceDeltaPct = 3, maxPerCluster = 2 } = {}) {
  const out = [];
  const stateByCluster = new Map();
  const safeMaxPerCluster = Math.max(1, Math.min(5, Number(maxPerCluster || 2)));

  for (const item of Array.isArray(items) ? items : []) {
    const clusterKey = nearDuplicateClusterKey(item);
    const bucket = stateByCluster.get(clusterKey) || [];
    const nearDuplicate = bucket.some((existing) => {
      const stopsGap = Math.abs(toNumber(existing.stops, 0) - toNumber(item.stops, 0));
      const durationLeft = toNumber(existing.duration_minutes, NaN);
      const durationRight = toNumber(item.duration_minutes, NaN);
      const durationGap =
        Number.isFinite(durationLeft) && Number.isFinite(durationRight)
          ? Math.abs(durationLeft - durationRight)
          : 0;
      return pricesAreNear(existing.price, item.price, priceDeltaPct) && stopsGap <= 1 && durationGap <= 90;
    });
    if (nearDuplicate) continue;
    if (bucket.length >= safeMaxPerCluster) continue;
    bucket.push(item);
    stateByCluster.set(clusterKey, bucket);
    out.push(item);
  }

  return out;
}

function diversityBucketKey(item) {
  return [
    normalizeIata(item.destination_iata),
    String(item.trip_type || '').trim().toLowerCase()
  ].join('|');
}

function capPerDestination(items, { maxPerDestination = 3, limit = 1000 } = {}) {
  const out = [];
  const counts = new Map();
  const safeMaxPerDestination = Math.max(1, Math.min(8, Number(maxPerDestination || 3)));
  const safeLimit = Math.max(1, Math.min(10000, Number(limit || 1000)));

  for (const item of Array.isArray(items) ? items : []) {
    const key = diversityBucketKey(item);
    const count = Number(counts.get(key) || 0);
    if (count >= safeMaxPerDestination) continue;
    counts.set(key, count + 1);
    out.push(item);
    if (out.length >= safeLimit) break;
  }
  return out;
}

export function createDiscoveryFeedService(options = {}) {
  const forcedMode = String(options.mode || '').trim().toLowerCase();
  let mode = forcedMode === 'postgres' || forcedMode === 'sqlite' ? forcedMode : process.env.DATABASE_URL ? 'postgres' : 'sqlite';
  const logger = options.logger || rootLogger;

  let pgPool = options.pgPool || null;
  let sqliteDb = options.sqliteDb || null;
  let initialized = false;

  const lastMinuteDays = Math.max(1, Math.min(45, Number(options.lastMinuteDays || process.env.DISCOVERY_FEED_LAST_MINUTE_DAYS || 14)));
  const longHaulMinDistanceKm = Math.max(
    1000,
    Math.min(15000, Number(options.longHaulMinDistanceKm || process.env.DISCOVERY_FEED_LONG_HAUL_MIN_DISTANCE_KM || 3500))
  );
  const longHaulMinDurationMinutes = Math.max(
    120,
    Math.min(4000, Number(options.longHaulMinDurationMinutes || process.env.DISCOVERY_FEED_LONG_HAUL_MIN_DURATION_MIN || 420))
  );
  const longHaulMinSavingsPct = Math.max(
    0,
    Math.min(90, Number(options.longHaulMinSavingsPct || process.env.DISCOVERY_FEED_LONG_HAUL_MIN_SAVINGS_PCT || 10))
  );
  const feedCacheTtlSec = Math.max(5, Math.min(600, Number(options.feedCacheTtlSec || process.env.DISCOVERY_FEED_CACHE_TTL_SEC || 45)));
  const feedCacheMaxEntries = Math.max(20, Math.min(2000, Number(options.feedCacheMaxEntries || process.env.DISCOVERY_FEED_CACHE_MAX_ENTRIES || 300)));
  const feedMinPrice = Math.max(1, Math.min(5000, Number(options.feedMinPrice || process.env.DISCOVERY_FEED_MIN_PRICE || 10)));
  const feedMaxPrice = Math.max(feedMinPrice, Math.min(200000, Number(options.feedMaxPrice || process.env.DISCOVERY_FEED_MAX_PRICE || 20000)));
  const feedMaxAgeHours = Math.max(1, Math.min(720, Number(options.feedMaxAgeHours || process.env.DISCOVERY_FEED_MAX_AGE_HOURS || 168)));
  const feedStaleFallbackEnabled = toBoolean(
    options.feedStaleFallbackEnabled ?? process.env.DISCOVERY_FEED_STALE_FALLBACK_ENABLED ?? true,
    true
  );
  const feedStaleFallbackMaxAgeHours = Math.max(
    feedMaxAgeHours,
    Math.min(
      720,
      Number(options.feedStaleFallbackMaxAgeHours || process.env.DISCOVERY_FEED_STALE_FALLBACK_MAX_AGE_HOURS || Math.max(168, feedMaxAgeHours))
    )
  );
  const feedCandidateFallbackEnabled = toBoolean(
    options.feedCandidateFallbackEnabled ?? process.env.DISCOVERY_FEED_ALLOW_CANDIDATE_FALLBACK ?? false,
    false
  );
  const feedMaxStops = Math.max(0, Math.min(6, Number(options.feedMaxStops || process.env.DISCOVERY_FEED_MAX_STOPS || 3)));
  const feedMinDurationMinutes = Math.max(10, Math.min(600, Number(options.feedMinDurationMinutes || process.env.DISCOVERY_FEED_MIN_DURATION_MIN || 30)));
  const feedMaxDurationMinutes = Math.max(
    feedMinDurationMinutes,
    Math.min(4320, Number(options.feedMaxDurationMinutes || process.env.DISCOVERY_FEED_MAX_DURATION_MIN || 2160))
  );
  const nearDuplicatePriceDeltaPct = Math.max(
    0.2,
    Math.min(25, Number(options.nearDuplicatePriceDeltaPct || process.env.DISCOVERY_FEED_NEAR_DUP_PRICE_DELTA_PCT || 3))
  );
  const nearDuplicateMaxPerCluster = Math.max(
    1,
    Math.min(5, Number(options.nearDuplicateMaxPerCluster || process.env.DISCOVERY_FEED_NEAR_DUP_MAX_PER_CLUSTER || 2))
  );
  const feedMaxPerDestination = Math.max(
    1,
    Math.min(8, Number(options.feedMaxPerDestination || process.env.DISCOVERY_FEED_MAX_PER_DESTINATION || 3))
  );
  const rankingAbEnabled = toBoolean(
    options.rankingAbEnabled ?? process.env.DISCOVERY_FEED_RANKING_AB_ENABLED ?? false,
    false
  );
  const rankingAbSplitPct = Math.max(
    0,
    Math.min(100, Number(options.rankingAbSplitPct ?? process.env.DISCOVERY_FEED_RANKING_AB_SPLIT_PCT ?? 50))
  );
  const rankingAbSalt = String(options.rankingAbSalt || process.env.DISCOVERY_FEED_RANKING_AB_SALT || 'discovery_feed_rank_ab_v1').trim();
  const localFeedCache = new Map();
  let detectedDealsHasDealScore = null;
  let detectedDealsHasExpiresAt = null;
  let flightQuotesHasIsBookable = null;

  function buildCacheKey({ origin = '', maxPrice = null, limit = 12, rankingVariant = 'A' } = {}) {
    const safeOrigin = normalizeIata(origin);
    const priceToken = maxPrice == null ? '' : String(round2(stableNumber(maxPrice, 0)));
    const variant = normalizeRankingVariant(rankingVariant) || 'A';
    return `${mode}|${safeOrigin}|${priceToken}|${Math.max(1, Math.min(60, Number(limit || 12)))}|${variant}`;
  }

  function chooseRankingVariant({ origin = '', maxPrice = null, requestedVariant = null, rankingSeed = '' } = {}) {
    const explicit = normalizeRankingVariant(requestedVariant);
    if (explicit) return explicit;
    if (!rankingAbEnabled) return 'A';
    const safeOrigin = normalizeIata(origin);
    const priceToken = maxPrice == null ? '' : String(round2(stableNumber(maxPrice, 0)));
    const seed = String(rankingSeed || `${safeOrigin}|${priceToken}|${rankingAbSalt}`);
    const ratio = deterministicRatio(seed);
    return ratio < rankingAbSplitPct / 100 ? 'B' : 'A';
  }

  function getRankingProfile(variant = 'A') {
    return RANKING_PROFILES[normalizeRankingVariant(variant) || 'A'] || RANKING_PROFILES.A;
  }

  function pruneCache(nowMs = Date.now()) {
    for (const [key, entry] of localFeedCache.entries()) {
      if (!entry || Number(entry.expiresAt || 0) <= nowMs) localFeedCache.delete(key);
    }
    if (localFeedCache.size <= feedCacheMaxEntries) return;
    const ordered = Array.from(localFeedCache.entries()).sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0));
    const toDelete = Math.max(0, ordered.length - feedCacheMaxEntries);
    for (let i = 0; i < toDelete; i += 1) {
      localFeedCache.delete(ordered[i][0]);
    }
  }

  async function ensurePostgres() {
    if (!pgPool) {
      pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    }
  }

  async function ensureSqlite() {
    if (!sqliteDb) {
      await mkdir(dirname(SQLITE_DB_PATH), { recursive: true });
      const sqlite = await import('node:sqlite');
      sqliteDb = new sqlite.DatabaseSync(SQLITE_DB_PATH);
    }
  }

  async function ensureInitialized() {
    if (initialized) return;
    mode = forcedMode === 'postgres' || forcedMode === 'sqlite' ? forcedMode : process.env.DATABASE_URL ? 'postgres' : 'sqlite';
    detectedDealsHasDealScore = null;
    detectedDealsHasExpiresAt = null;
    flightQuotesHasIsBookable = null;
    if (mode === 'postgres') await ensurePostgres();
    else await ensureSqlite();
    initialized = true;
  }

  async function ensureSourceTables() {
    if (mode === 'postgres') {
      const refs = await pgPool.query(`
        SELECT
          to_regclass('public.detected_deals') AS detected_deals_ref,
          to_regclass('public.flight_quotes') AS flight_quotes_ref
      `);
      const row = refs.rows[0] || {};
      if (!row.detected_deals_ref) return { ok: false, reason: 'detected_deals_missing' };
      if (!row.flight_quotes_ref) return { ok: false, reason: 'flight_quotes_missing' };
      return { ok: true, reason: null };
    }
    const detectedDealsTable = sqliteDb
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='detected_deals'`)
      .get();
    if (!detectedDealsTable?.name) return { ok: false, reason: 'detected_deals_missing' };
    const quotesTable = sqliteDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='flight_quotes'`).get();
    if (!quotesTable?.name) return { ok: false, reason: 'flight_quotes_missing' };
    return { ok: true, reason: null };
  }

  async function hasDetectedDealsDealScoreColumn() {
    if (detectedDealsHasDealScore != null) return detectedDealsHasDealScore;
    if (mode === 'postgres') {
      const result = await pgPool.query(`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'detected_deals'
            AND column_name = 'deal_score'
        ) AS has_column
      `);
      detectedDealsHasDealScore = Boolean(result.rows?.[0]?.has_column);
      return detectedDealsHasDealScore;
    }

    const columns = sqliteDb.prepare(`PRAGMA table_info(detected_deals)`).all();
    detectedDealsHasDealScore = Array.isArray(columns) && columns.some((column) => String(column?.name || '').toLowerCase() === 'deal_score');
    return detectedDealsHasDealScore;
  }

  async function hasDetectedDealsExpiresAtColumn() {
    if (detectedDealsHasExpiresAt != null) return detectedDealsHasExpiresAt;
    if (mode === 'postgres') {
      const result = await pgPool.query(`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'detected_deals'
            AND column_name = 'expires_at'
        ) AS has_column
      `);
      detectedDealsHasExpiresAt = Boolean(result.rows?.[0]?.has_column);
      return detectedDealsHasExpiresAt;
    }

    const columns = sqliteDb.prepare(`PRAGMA table_info(detected_deals)`).all();
    detectedDealsHasExpiresAt = Array.isArray(columns) && columns.some((column) => String(column?.name || '').toLowerCase() === 'expires_at');
    return detectedDealsHasExpiresAt;
  }

  async function hasFlightQuotesIsBookableColumn() {
    if (flightQuotesHasIsBookable != null) return flightQuotesHasIsBookable;
    if (mode === 'postgres') {
      const result = await pgPool.query(`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'flight_quotes'
            AND column_name = 'is_bookable'
        ) AS has_column
      `);
      flightQuotesHasIsBookable = Boolean(result.rows?.[0]?.has_column);
      return flightQuotesHasIsBookable;
    }

    const columns = sqliteDb.prepare(`PRAGMA table_info(flight_quotes)`).all();
    flightQuotesHasIsBookable = Array.isArray(columns) && columns.some((column) => String(column?.name || '').toLowerCase() === 'is_bookable');
    return flightQuotesHasIsBookable;
  }

  async function getFeedVersion({ origin = '', maxPrice = null } = {}) {
    await ensureInitialized();
    const source = await ensureSourceTables();
    if (!source.ok) return `missing:${source.reason}`;

    const normalizedOrigin = normalizeIata(origin);
    const normalizedMaxPrice = maxPrice == null ? null : toNumber(maxPrice, 0);
    const statuses = feedCandidateFallbackEnabled ? ['published', 'candidate'] : ['published'];
    if (mode === 'postgres') {
      const where = [];
      const params = [];
      let idx = 1;
      where.push(`dd.status = ANY($${idx++}::text[])`);
      params.push(statuses);
      if (normalizedOrigin) {
        where.push(`UPPER(r.origin_iata) = $${idx++}`);
        params.push(normalizedOrigin);
      }
      if (normalizedMaxPrice && normalizedMaxPrice > 0) {
        where.push(`dd.price <= $${idx++}`);
        params.push(normalizedMaxPrice);
      }
      const sql = `
        SELECT
          COALESCE(MAX(dd.updated_at)::text, '0') AS max_updated,
          COUNT(*)::int AS total
        FROM detected_deals dd
        LEFT JOIN routes r ON r.id = dd.route_id
        WHERE ${where.join(' AND ')}
      `;
      const result = await pgPool.query(sql, params);
      const row = result.rows[0] || {};
      return `${row.max_updated || '0'}|${Number(row.total || 0)}`;
    }

    const where = [`dd.status IN (${statuses.map(() => '?').join(', ')})`];
    const params = [...statuses];
    if (normalizedOrigin) {
      where.push(`UPPER(COALESCE(r.origin_iata, '')) = ?`);
      params.push(normalizedOrigin);
    }
    if (normalizedMaxPrice && normalizedMaxPrice > 0) {
      where.push(`dd.price <= ?`);
      params.push(normalizedMaxPrice);
    }
    const sql = `
      SELECT
        COALESCE(MAX(dd.updated_at), '0') AS max_updated,
        COUNT(*) AS total
      FROM detected_deals dd
      LEFT JOIN routes r ON r.id = dd.route_id
      WHERE ${where.join(' AND ')}
    `;
    const row = sqliteDb.prepare(sql).get(...params) || {};
    return `${String(row.max_updated || '0')}|${Number(row.total || 0)}`;
  }

  async function queryRows({ origin = '', maxPrice = null, fetchLimit = 1000, maxAgeHours = feedMaxAgeHours, status = 'published' } = {}) {
    const normalizedOrigin = normalizeIata(origin);
    const normalizedMaxPrice = maxPrice == null ? null : toNumber(maxPrice, 0);
    const safeFetchLimit = Math.max(50, Math.min(5000, Number(fetchLimit || 1000)));
    const safeMaxAgeHours = Math.max(1, Math.min(720, Number(maxAgeHours || feedMaxAgeHours)));
    const safeStatus = String(status || '').trim().toLowerCase() === 'candidate' ? 'candidate' : 'published';
    const hasDealScoreColumn = await hasDetectedDealsDealScoreColumn();
    const hasExpiresAtColumn = await hasDetectedDealsExpiresAtColumn();
    const hasIsBookableColumn = await hasFlightQuotesIsBookableColumn();
    const dealScoreSelect = hasDealScoreColumn ? 'dd.deal_score,' : 'NULL AS deal_score,';
    const expiresAtSelect = hasExpiresAtColumn ? 'dd.expires_at,' : 'NULL AS expires_at,';
    const isBookableSelect = hasIsBookableColumn ? 'fq.is_bookable,' : 'NULL AS is_bookable,';

    if (mode === 'postgres') {
      const where = [
        `dd.status = $1`,
        `dd.price >= $2`,
        `dd.price <= $3`,
        `dd.source_observed_at >= NOW() - ($4 * INTERVAL '1 hour')`,
        `fq.departure_date >= CURRENT_DATE`,
        `(fq.stops IS NULL OR fq.stops <= ${feedMaxStops})`,
        `(fq.duration_minutes IS NULL OR fq.duration_minutes <= 0 OR fq.duration_minutes BETWEEN ${feedMinDurationMinutes} AND ${feedMaxDurationMinutes})`
      ];
      if (hasExpiresAtColumn) where.push(`(dd.expires_at IS NULL OR dd.expires_at > NOW())`);
      if (hasIsBookableColumn) where.push(`(fq.is_bookable IS NULL OR fq.is_bookable = true)`);

      const params = [safeStatus, feedMinPrice, feedMaxPrice, safeMaxAgeHours];
      let idx = 5;
      if (normalizedOrigin) {
        where.push(`UPPER(COALESCE(r.origin_iata, '')) = $${idx++}`);
        params.push(normalizedOrigin);
      }
      if (normalizedMaxPrice && normalizedMaxPrice > 0) {
        where.push(`dd.price <= $${idx++}`);
        params.push(normalizedMaxPrice);
      }
      params.push(safeFetchLimit);
      const sql = `
        SELECT
          dd.id,
          dd.deal_key,
          dd.flight_quote_id,
          dd.route_id,
          dd.deal_type,
          dd.raw_score,
          dd.final_score,
          ${dealScoreSelect}
          ${expiresAtSelect}
          dd.opportunity_level,
          dd.price,
          dd.baseline_price,
          dd.savings_amount,
          dd.savings_pct,
          dd.status,
          dd.score_breakdown,
          dd.published_at,
          dd.source_observed_at,
          fq.departure_date,
          fq.return_date,
          fq.trip_type,
          fq.cabin_class,
          fq.currency AS quote_currency,
          fq.stops,
          fq.duration_minutes,
          fq.provider,
          ${isBookableSelect}
          r.origin_iata,
          r.destination_iata,
          r.distance_km,
          ao.city_name AS origin_city,
          ad.city_name AS destination_city
        FROM detected_deals dd
        JOIN flight_quotes fq ON fq.id = dd.flight_quote_id
        LEFT JOIN routes r ON r.id = dd.route_id
        LEFT JOIN airports ao ON ao.id = fq.origin_airport_id
        LEFT JOIN airports ad ON ad.id = fq.destination_airport_id
        WHERE ${where.join(' AND ')}
        ORDER BY dd.source_observed_at DESC
        LIMIT $${params.length}
      `;
      const result = await pgPool.query(sql, params);
      return result.rows || [];
    }

    const where = [
      `dd.status = ?`,
      `dd.price >= ?`,
      `dd.price <= ?`,
      `datetime(dd.source_observed_at) >= datetime('now', '-' || ? || ' hour')`,
      `date(fq.departure_date) >= date('now')`,
      `(fq.stops IS NULL OR fq.stops <= ${feedMaxStops})`,
      `(fq.duration_minutes IS NULL OR fq.duration_minutes <= 0 OR fq.duration_minutes BETWEEN ${feedMinDurationMinutes} AND ${feedMaxDurationMinutes})`
    ];
    if (hasExpiresAtColumn) where.push(`(dd.expires_at IS NULL OR datetime(dd.expires_at) > datetime('now'))`);
    if (hasIsBookableColumn) where.push(`(fq.is_bookable IS NULL OR fq.is_bookable = 1)`);

    const params = [safeStatus, feedMinPrice, feedMaxPrice, safeMaxAgeHours];
    if (normalizedOrigin) {
      where.push(`UPPER(COALESCE(r.origin_iata, '')) = ?`);
      params.push(normalizedOrigin);
    }
    if (normalizedMaxPrice && normalizedMaxPrice > 0) {
      where.push(`dd.price <= ?`);
      params.push(normalizedMaxPrice);
    }
    params.push(safeFetchLimit);
    const sql = `
      SELECT
        dd.id,
        dd.deal_key,
        dd.flight_quote_id,
        dd.route_id,
        dd.deal_type,
        dd.raw_score,
        dd.final_score,
        ${dealScoreSelect}
        ${expiresAtSelect}
        dd.opportunity_level,
        dd.price,
        dd.baseline_price,
        dd.savings_amount,
        dd.savings_pct,
        dd.status,
        dd.score_breakdown,
        dd.published_at,
        dd.source_observed_at,
        fq.departure_date,
        fq.return_date,
        fq.trip_type,
        fq.cabin_class,
        fq.currency AS quote_currency,
        fq.stops,
        fq.duration_minutes,
        fq.provider,
        ${isBookableSelect}
        r.origin_iata,
        r.destination_iata,
        r.distance_km,
        ao.city_name AS origin_city,
        ad.city_name AS destination_city
      FROM detected_deals dd
      JOIN flight_quotes fq ON fq.id = dd.flight_quote_id
      LEFT JOIN routes r ON r.id = dd.route_id
      LEFT JOIN airports ao ON ao.id = fq.origin_airport_id
      LEFT JOIN airports ad ON ad.id = fq.destination_airport_id
      WHERE ${where.join(' AND ')}
      ORDER BY datetime(dd.source_observed_at) DESC
      LIMIT ?
    `;
    return sqliteDb.prepare(sql).all(...params);
  }

  async function buildDiscoveryFeed({ origin = '', maxPrice = null, limit = 12, rankingVariant = null, rankingSeed = '' } = {}) {
    await ensureInitialized();
    const source = await ensureSourceTables();
    const safeLimit = Math.max(1, Math.min(60, Number(limit || 12)));
    const selectedRankingVariant = chooseRankingVariant({
      origin,
      maxPrice,
      requestedVariant: rankingVariant,
      rankingSeed
    });
    const rankingProfile = getRankingProfile(selectedRankingVariant);
    const cacheKey = buildCacheKey({
      origin,
      maxPrice,
      limit: safeLimit,
      rankingVariant: rankingProfile.key
    });
    const nowMs = Date.now();
    pruneCache(nowMs);

    const cached = localFeedCache.get(cacheKey);
    if (cached && Number(cached.expiresAt || 0) > nowMs && cached.payload) {
      captureRuntimeMetrics({ cached: true, payload: cached.payload });
      return cached.payload;
    }

    if (!source.ok) {
      const skippedPayload = {
        skipped: true,
        reason: source.reason,
        meta: {
          source: 'detected_deals',
          mode,
          generated_at: new Date().toISOString(),
          total_candidates: 0,
          ranking_model: rankingProfile.model,
          ranking_variant: rankingProfile.key,
          ranking_weights: rankingProfile.weights
        },
        queries: {
          top_offers: [],
          recent_offers: [],
          popular_offers: []
        },
        categories: {
          cheap_flights: [],
          weekend_flights: [],
          last_minute_flights: [],
          long_haul_discounted: []
        }
      };
      captureRuntimeMetrics({ cached: false, payload: skippedPayload });
      return skippedPayload;
    }

    const startedAt = Date.now();
    let effectiveFeedMaxAgeHours = feedMaxAgeHours;
    let rows = await queryRows({
      origin,
      maxPrice,
      fetchLimit: Math.max(200, safeLimit * 30),
      maxAgeHours: effectiveFeedMaxAgeHours,
      status: 'published'
    });
    let freshnessFallbackUsed = false;
    let candidateFallbackUsed = false;
    if (feedStaleFallbackEnabled && rows.length === 0 && feedStaleFallbackMaxAgeHours > feedMaxAgeHours) {
      const fallbackRows = await queryRows({
        origin,
        maxPrice,
        fetchLimit: Math.max(200, safeLimit * 30),
        maxAgeHours: feedStaleFallbackMaxAgeHours,
        status: 'published'
      });
      if (fallbackRows.length > 0) {
        rows = fallbackRows;
        effectiveFeedMaxAgeHours = feedStaleFallbackMaxAgeHours;
        freshnessFallbackUsed = true;
      }
    }
    if (feedCandidateFallbackEnabled && rows.length === 0) {
      const candidateRows = await queryRows({
        origin,
        maxPrice,
        fetchLimit: Math.max(200, safeLimit * 30),
        maxAgeHours: effectiveFeedMaxAgeHours,
        status: 'candidate'
      });
      if (candidateRows.length > 0) {
        rows = candidateRows;
        candidateFallbackUsed = true;
      }
    }
    const mappedItems = rows
      .map((row) =>
        mapRow(row, {
          rankingProfile
        })
      );

    const rejectedByReason = {};
    const validItems = [];
    for (const item of mappedItems) {
      const reason = validateFeedItem(item, {
        minPrice: feedMinPrice,
        maxPrice: feedMaxPrice,
        maxStops: feedMaxStops,
        minDurationMinutes: feedMinDurationMinutes,
        maxDurationMinutes: feedMaxDurationMinutes,
        maxAgeHours: effectiveFeedMaxAgeHours
      });
      if (reason) {
        rejectedByReason[reason] = Number(rejectedByReason[reason] || 0) + 1;
        continue;
      }
      validItems.push(item);
    }

    const dedupedItems = dedupeNearDuplicates([...validItems].sort(sortByTop), {
      priceDeltaPct: nearDuplicatePriceDeltaPct,
      maxPerCluster: nearDuplicateMaxPerCluster
    });
    const nearDuplicateFiltered = Math.max(0, validItems.length - dedupedItems.length);
    const diversityPool = capPerDestination([...dedupedItems].sort(sortByTop), {
      maxPerDestination: feedMaxPerDestination,
      limit: dedupedItems.length
    });
    const destinationDiversityFiltered = Math.max(0, dedupedItems.length - diversityPool.length);

    const topOffers = uniqueByDeal([...diversityPool].sort(sortByTop), safeLimit);
    const recentOffers = uniqueByDeal([...diversityPool].sort(sortByRecent), safeLimit);
    const popularOffers = uniqueByDeal([...diversityPool].sort(sortByPopular), safeLimit);

    const cheapFlights = uniqueByDeal([...diversityPool].sort(sortByCheap), safeLimit);
    const weekendFlights = uniqueByDeal(
      [...dedupedItems].filter((item) => isWeekendFlight(item)).sort(sortByTop),
      safeLimit
    );
    const lastMinuteFlights = uniqueByDeal(
      [...dedupedItems].filter((item) => isLastMinute(item, lastMinuteDays)).sort(sortByTop),
      safeLimit
    );
    const longHaulDiscounted = uniqueByDeal(
      [...dedupedItems]
        .filter((item) =>
          isLongHaulDiscounted(item, {
            minDistanceKm: longHaulMinDistanceKm,
            minDurationMinutes: longHaulMinDurationMinutes,
            minSavingsPct: longHaulMinSavingsPct
          })
        )
        .sort(sortByTop),
      safeLimit
    );

    const payload = {
      skipped: false,
      reason: null,
      meta: {
        source: 'detected_deals',
        // data_source tells clients whether prices come from live providers or the
        // internal synthetic/historical dataset.  'live' requires FLIGHT_SCAN_ENABLED
        // and at least one configured provider; otherwise 'internal'.
        data_source: (process.env.FLIGHT_SCAN_ENABLED === 'true' &&
          (process.env.ENABLE_PROVIDER_DUFFEL === 'true' || process.env.ENABLE_PROVIDER_AMADEUS === 'true'))
          ? 'live' : 'internal',
        mode,
        generated_at: new Date().toISOString(),
        total_candidates: diversityPool.length,
        source_rows: rows.length,
        mapped_candidates: mappedItems.length,
        valid_candidates: validItems.length,
        near_duplicate_filtered: nearDuplicateFiltered,
        destination_diversity_filtered: destinationDiversityFiltered,
        max_per_destination: feedMaxPerDestination,
        rejected_by_reason: rejectedByReason,
        freshness_primary_max_age_hours: feedMaxAgeHours,
        freshness_effective_max_age_hours: effectiveFeedMaxAgeHours,
        freshness_fallback_used: freshnessFallbackUsed,
        candidate_fallback_used: candidateFallbackUsed,
        duration_ms: Date.now() - startedAt,
        ranking_model: rankingProfile.model,
        ranking_variant: rankingProfile.key,
        ranking_weights: rankingProfile.weights
      },
      queries: {
        top_offers: topOffers,
        recent_offers: recentOffers,
        popular_offers: popularOffers
      },
      categories: {
        cheap_flights: cheapFlights,
        weekend_flights: weekendFlights,
        last_minute_flights: lastMinuteFlights,
        long_haul_discounted: longHaulDiscounted
      }
    };

    logger.info(
      {
        origin: normalizeIata(origin) || null,
        maxPrice: maxPrice == null ? null : toNumber(maxPrice, 0),
        limit: safeLimit,
        sourceRows: rows.length,
        validCandidates: validItems.length,
        nearDuplicateFiltered,
        destinationDiversityFiltered,
        totalCandidates: diversityPool.length,
        freshnessFallbackUsed,
        freshnessPrimaryMaxAgeHours: feedMaxAgeHours,
        freshnessEffectiveMaxAgeHours: effectiveFeedMaxAgeHours,
        durationMs: payload.meta.duration_ms,
        rankingVariant: rankingProfile.key,
        mode
      },
      'discovery_feed_built_from_detected_deals'
    );

    localFeedCache.set(cacheKey, {
      expiresAt: Date.now() + feedCacheTtlSec * 1000,
      updatedAt: Date.now(),
      payload
    });

    captureRuntimeMetrics({ cached: false, payload });
    return payload;
  }

  return {
    buildDiscoveryFeed,
    getFeedVersion,
    getMode: () => mode
  };
}

export function getDiscoveryFeedRuntimeMetrics() {
  return {
    callsTotal: Number(discoveryFeedRuntimeMetrics.callsTotal || 0),
    freshBuildsTotal: Number(discoveryFeedRuntimeMetrics.freshBuildsTotal || 0),
    cacheHitsTotal: Number(discoveryFeedRuntimeMetrics.cacheHitsTotal || 0),
    skippedTotal: Number(discoveryFeedRuntimeMetrics.skippedTotal || 0),
    sourceRowsTotal: Number(discoveryFeedRuntimeMetrics.sourceRowsTotal || 0),
    validCandidatesTotal: Number(discoveryFeedRuntimeMetrics.validCandidatesTotal || 0),
    nearDuplicateFilteredTotal: Number(discoveryFeedRuntimeMetrics.nearDuplicateFilteredTotal || 0),
    destinationDiversityFilteredTotal: Number(discoveryFeedRuntimeMetrics.destinationDiversityFilteredTotal || 0),
    rejectedByReason: cloneObject(discoveryFeedRuntimeMetrics.rejectedByReason),
    lastCallAt: discoveryFeedRuntimeMetrics.lastCallAt || null,
    lastBuildMeta: discoveryFeedRuntimeMetrics.lastBuildMeta ? { ...discoveryFeedRuntimeMetrics.lastBuildMeta } : null
  };
}

let singleton = null;

export function getDiscoveryFeedService() {
  if (!singleton) singleton = createDiscoveryFeedService();
  return singleton;
}

export async function buildDiscoveryFeed(options = {}) {
  return getDiscoveryFeedService().buildDiscoveryFeed(options);
}
