import { createHash } from 'node:crypto';

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

  const price = toNumber(item.price, Number.NaN);
  if (!Number.isFinite(price) || price < minPrice || price > maxPrice) return 'outlier_price';

  const stops = toNumber(item.stops, Number.NaN);
  if (Number.isFinite(stops) && stops > maxStops) return 'too_many_stops';

  const duration = toNumber(item.duration_minutes, Number.NaN);
  if (Number.isFinite(duration) && duration > 0 && (duration < minDurationMinutes || duration > maxDurationMinutes)) return 'unrealistic_duration';

  const observedText = item.source_observed_at || item.published_at || null;
  const observedTs = observedText ? new Date(observedText).getTime() : Number.NaN;
  if (!Number.isFinite(observedTs)) return 'invalid_observed_at';
  const ageHours = Math.max(0, (Date.now() - observedTs) / (60 * 60 * 1000));
  if (ageHours > maxAgeHours) return 'stale_offer';

  const expiresTs = item.expires_at ? new Date(item.expires_at).getTime() : Number.NaN;
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
      const durationLeft = toNumber(existing.duration_minutes, Number.NaN);
      const durationRight = toNumber(item.duration_minutes, Number.NaN);
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

export {
  RANKING_PROFILES,
  capPerDestination,
  clamp,
  dedupeNearDuplicates,
  deterministicRatio,
  isLastMinute,
  isLongHaulDiscounted,
  isWeekendFlight,
  mapRow,
  normalizeIata,
  normalizeRankingVariant,
  parseJsonSafe,
  round2,
  sortByCheap,
  sortByPopular,
  sortByRecent,
  sortByTop,
  stableNumber,
  toBoolean,
  toNumber,
  uniqueByDeal,
  validateFeedItem
};
