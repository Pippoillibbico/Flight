/**
 * opportunity-feed-engine.js
 *
 * Generates a discovery-first "opportunities feed" from local route data.
 *
 * Design goals:
 *   - Always returns results (no DB, no live API required)
 *   - Heuristic price anomaly detection from seasonal price bands
 *   - Multi-signal ranking: price anomaly, value ratio, seasonality, rarity, distance
 *   - Three labelled categories: cheap_flights, unusual_routes, high_value_deals
 *
 * When live DB data (detected_deals, flight_quotes) exists, callers can merge it
 * on top — this engine is the guaranteed non-empty floor.
 */

import { ROUTES } from '../data/local-flight-data.js';
import { buildSeasonalContext } from './seasonal-context-engine.js';
import { buildAffiliateLink } from './affiliate-links.js';

// ─── Constants ────────────────────────────────────────────────────────────────

// Estimated great-circle distance proxy by region (midpoint km)
const REGION_DISTANCE_KM = {
  eu: 1400,
  africa: 3800,
  asia: 8200,
  america: 9500,
  oceania: 14500
};

// Scoring weights
const WEIGHTS = {
  anomaly: 0.40,   // how far the floor price sits below the monthly average
  value: 0.25,     // savings from high-season peak to current low
  rarity: 0.20,    // inverse overtourism — rewards under-the-radar destinations
  distance: 0.15   // longer haul = higher discovery interest
};

// Category thresholds
const CHEAP_MAX_PRICE_EUR = 280;        // price_low under this → cheap category
const CHEAP_MIN_ANOMALY = 12;           // minimum savings% to qualify
const UNUSUAL_MIN_RARITY_SCORE = 45;    // rarity score floor for unusual
const UNUSUAL_EXCLUDE_EU = false;       // set true to restrict unusual to non-EU only
const HIGH_VALUE_MIN_SCORE = 52;        // composite score floor for high-value

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function firstOfNextMonth() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // next month (0-indexed)
  if (m > 11) return `${y + 1}-01-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

function resolveFallbackOrigin(preferredOrigin) {
  const safePreferred = String(preferredOrigin || '').trim().toUpperCase();
  if (safePreferred && ROUTES.some((route) => route.origin === safePreferred)) return safePreferred;
  if (ROUTES.some((route) => route.origin === 'FCO')) return 'FCO';
  return String(ROUTES[0]?.origin || safePreferred || 'FCO').trim().toUpperCase();
}

function buildEmergencyScoredItem(origin, month) {
  const emergencyRoute = {
    origin: String(origin || 'FCO').trim().toUpperCase() || 'FCO',
    destinationIata: 'ROM',
    destinationName: 'City Escape',
    country: 'Italy',
    region: 'eu',
    seasonalPriceBands: {
      [String(month)]: {
        avgPrice: 180,
        low: 130,
        high: 240
      }
    },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.7, 1: 0.25, 2: 0.05 }
    },
    decisionMetadata: {
      overtourismIndex: 55
    }
  };
  return scoreRoute(emergencyRoute, month);
}

/**
 * Returns the highest avgPrice across all months (peak season reference).
 */
function peakSeasonAvg(route) {
  const bands = route.seasonalPriceBands || {};
  let peak = 0;
  for (const band of Object.values(bands)) {
    if (Number(band.avgPrice) > peak) peak = Number(band.avgPrice);
  }
  return peak;
}

/**
 * Anomaly score [0–100]: how much the monthly floor (low) deviates from the
 * monthly average. A floor 25% below average scores 25 points.
 */
function computeAnomalyScore(band) {
  const avg = Number(band.avgPrice || 0);
  const low = Number(band.low || 0);
  if (avg <= 0) return 0;
  const savingsPct = ((avg - low) / avg) * 100;
  return clamp(Math.round(savingsPct * 2.5), 0, 100); // scale to [0,100]
}

/**
 * Value score [0–100]: savings from peak season to current month low.
 * Rewards booking a long-haul destination in its off-season.
 */
function computeValueScore(band, peak) {
  const low = Number(band.low || 0);
  if (peak <= 0 || low <= 0) return 0;
  const savingsPct = ((peak - low) / peak) * 100;
  return clamp(Math.round(savingsPct), 0, 100);
}

/**
 * Rarity score [0–100]: inverse of overtourism index, boosted for long-haul.
 */
function computeRarityScore(route) {
  const overtourism = Number(route.decisionMetadata?.overtourismIndex || 50);
  const baseRarity = clamp(100 - overtourism, 0, 100);
  // Long-haul destinations that are also low-overtourism are genuinely rare finds
  const distanceBoost = route.region === 'eu' ? 0 : route.region === 'africa' ? 8 : 16;
  return clamp(Math.round(baseRarity + distanceBoost), 0, 100);
}

/**
 * Distance score [0–100]: scaled from estimated great-circle km.
 * Normalised so ~15000 km → 100.
 */
function computeDistanceScore(route) {
  const distKm = REGION_DISTANCE_KM[route.region] || 2000;
  return clamp(Math.round((distKm / 15000) * 100), 0, 100);
}

/**
 * Seasonality adjustment: shoulder → +12, low → +8, high → -12
 */
function seasonalityAdjustment(seasonBand) {
  if (seasonBand === 'shoulder') return 12;
  if (seasonBand === 'low') return 8;
  return -12; // high season — demand is high, less of a find
}

/**
 * Build a booking link (affiliate deep-link) for a route + departure window.
 */
function bookingLink(route, departureDate, returnDate) {
  try {
    const { url } = buildAffiliateLink({
      origin: route.origin,
      destinationIata: route.destinationIata,
      dateFrom: departureDate,
      dateTo: returnDate,
      travellers: 1,
      cabinClass: 'economy'
    });
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Tags attached to a feed item for UI filtering/display.
 */
function buildTags(route, band, seasonBand, distKm) {
  const tags = [];
  const direct = Number(route.comfortMetadata?.stopCountDistribution?.[0] || 0);
  if (direct >= 0.5) tags.push('direct');
  if (distKm >= 6000) tags.push('long_haul');
  if (distKm < 2500) tags.push('short_haul');
  if (seasonBand === 'shoulder') tags.push('shoulder_season');
  if (seasonBand === 'low') tags.push('low_season');
  if (Number(route.decisionMetadata?.overtourismIndex || 50) < 40) tags.push('hidden_gem');
  if (Number(band.avgPrice || 0) < 200) tags.push('budget');
  return tags;
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

/**
 * Score and annotate a single route for a given month.
 *
 * @param {object} route    - Entry from ROUTES
 * @param {number} month    - 1–12
 * @returns {object|null}
 */
function scoreRoute(route, month) {
  const band = (route.seasonalPriceBands || {})[String(month)];
  if (!band) return null;

  const priceLow = Number(band.low || 0);
  const priceAvg = Number(band.avgPrice || 0);
  const priceHigh = Number(band.high || 0);
  if (priceLow <= 0 || priceAvg <= 0) return null;

  const peak = peakSeasonAvg(route);
  const seasonal = buildSeasonalContext({ destinationIata: route.destinationIata, month });

  const anomalyScore = computeAnomalyScore(band);
  const valueScore = computeValueScore(band, peak);
  const rarityScore = computeRarityScore(route);
  const distanceScore = computeDistanceScore(route);
  const adj = seasonalityAdjustment(seasonal.seasonBand);
  const distKm = REGION_DISTANCE_KM[route.region] || 2000;

  const composite = clamp(
    Math.round(
      anomalyScore * WEIGHTS.anomaly +
      valueScore   * WEIGHTS.value +
      rarityScore  * WEIGHTS.rarity +
      distanceScore * WEIGHTS.distance +
      adj
    ),
    0, 100
  );

  const savingsPct = priceAvg > 0
    ? round1(((priceAvg - priceLow) / priceAvg) * 100)
    : 0;

  const highSeasonSavingsPct = peak > 0
    ? round1(((peak - priceLow) / peak) * 100)
    : 0;

  return {
    route,
    band,
    month,
    seasonal,
    priceLow,
    priceAvg,
    priceHigh,
    peak,
    distKm,
    anomalyScore,
    valueScore,
    rarityScore,
    distanceScore,
    composite,
    savingsPct,
    highSeasonSavingsPct,
    tags: buildTags(route, band, seasonal.seasonBand, distKm)
  };
}

/**
 * Classify a scored route into one (or more) categories.
 */
function classifyItem(item) {
  const categories = [];

  if (item.priceLow <= CHEAP_MAX_PRICE_EUR && item.savingsPct >= CHEAP_MIN_ANOMALY) {
    categories.push('cheap_flight');
  }

  const qualifiesAsUnusual = item.rarityScore >= UNUSUAL_MIN_RARITY_SCORE &&
    (!UNUSUAL_EXCLUDE_EU || item.route.region !== 'eu');
  if (qualifiesAsUnusual) {
    categories.push('unusual_route');
  }

  if (item.composite >= HIGH_VALUE_MIN_SCORE) {
    categories.push('high_value_deal');
  }

  // Anything that didn't qualify anywhere still gets high_value if it's the best we have
  return categories.length > 0 ? categories : ['high_value_deal'];
}

/**
 * Convert a scored+classified item into the public feed item shape.
 */
function toFeedItem(item, category, departureDate, returnDate) {
  const { route } = item;
  return {
    id: `${route.origin}-${route.destinationIata}-${String(departureDate).slice(0, 7)}`,
    origin_iata: route.origin,
    destination_iata: route.destinationIata,
    destination_name: route.destinationName,
    country: route.country,
    region: route.region,
    category,
    // Prices
    price_low: item.priceLow,
    price_avg: item.priceAvg,
    price_high: item.priceHigh,
    price_peak_season: item.peak,
    currency: 'EUR',
    // Anomaly signals
    savings_pct_vs_avg: item.savingsPct,
    savings_pct_vs_peak: item.highSeasonSavingsPct,
    anomaly_score: item.anomalyScore,
    value_score: item.valueScore,
    rarity_score: item.rarityScore,
    distance_km_est: item.distKm,
    composite_score: item.composite,
    // Context
    seasonality: {
      band: item.seasonal.seasonBand,
      label: item.seasonal.seasonLabel,
      climate: item.seasonal.climateLabel,
      crowding_score: item.seasonal.crowdingScore,
      risk_note: item.seasonal.riskNote
    },
    tags: item.tags,
    // Booking
    departure_date: departureDate,
    return_date: returnDate,
    booking_link: bookingLink(route, departureDate, returnDate),
    is_bookable: false,          // synthetic heuristic — no live inventory yet
    inventory_source: 'synthetic_heuristic'
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a ranked opportunities feed for a given origin.
 *
 * @param {{
 *   origin?: string,         IATA code (defaults to 'FCO')
 *   month?: number,          1–12 (defaults to current month)
 *   limitPerCategory?: number
 *   limitTotal?: number
 * }} options
 * @returns {{ categories: object, top: object[], meta: object }}
 */
export function buildOpportunityFeed({
  origin = 'FCO',
  month,
  limitPerCategory = 8,
  limitTotal = 24
} = {}) {
  const now = new Date();
  const resolvedMonth = month != null
    ? Math.max(1, Math.min(12, Number(month)))
    : now.getUTCMonth() + 1;

  const requestedOrigin = String(origin || 'FCO').trim().toUpperCase();
  const safeOrigin = resolveFallbackOrigin(requestedOrigin);
  const departureDate = firstOfNextMonth();
  const returnDate = (() => {
    const d = new Date(departureDate);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  // Score every route for this origin and month
  const routes = ROUTES.filter((r) => r.origin === safeOrigin);
  let scored = routes
    .map((r) => scoreRoute(r, resolvedMonth))
    .filter(Boolean);

  // Safety fallback: if origin-specific data is sparse/missing, score all known routes.
  if (scored.length === 0) {
    scored = ROUTES.map((r) => scoreRoute(r, resolvedMonth)).filter(Boolean);
  }
  if (scored.length === 0) {
    const emergency = buildEmergencyScoredItem(safeOrigin, resolvedMonth);
    if (emergency) scored = [emergency];
  }

  // Sort by composite score descending
  scored.sort((a, b) => b.composite - a.composite);

  // Bucket into categories
  const byCategory = {
    cheap_flights: [],
    unusual_routes: [],
    high_value_deals: []
  };
  const categoryMap = {
    cheap_flight: 'cheap_flights',
    unusual_route: 'unusual_routes',
    high_value_deal: 'high_value_deals'
  };

  const seenDest = new Set();
  for (const item of scored) {
    const cats = classifyItem(item);
    for (const cat of cats) {
      const bucket = categoryMap[cat];
      if (!bucket) continue;
      if (byCategory[bucket].length >= limitPerCategory) continue;
      // One primary entry per destination per category to ensure diversity
      const bucketKey = `${bucket}:${item.route.destinationIata}`;
      if (seenDest.has(bucketKey)) continue;
      seenDest.add(bucketKey);
      byCategory[bucket].push(toFeedItem(item, cat, departureDate, returnDate));
    }
  }

  const cheapFallbackItem = [...scored].sort((a, b) => a.priceLow - b.priceLow || b.savingsPct - a.savingsPct)[0] || null;
  const unusualFallbackItem = [...scored].sort((a, b) => b.rarityScore - a.rarityScore || b.composite - a.composite)[0] || null;
  const highValueFallbackItem = [...scored].sort((a, b) => b.composite - a.composite || a.priceLow - b.priceLow)[0] || null;

  if (byCategory.cheap_flights.length === 0 && cheapFallbackItem) {
    byCategory.cheap_flights.push(toFeedItem(cheapFallbackItem, 'cheap_flight', departureDate, returnDate));
  }
  if (byCategory.unusual_routes.length === 0 && unusualFallbackItem) {
    byCategory.unusual_routes.push(toFeedItem(unusualFallbackItem, 'unusual_route', departureDate, returnDate));
  }
  if (byCategory.high_value_deals.length === 0 && highValueFallbackItem) {
    byCategory.high_value_deals.push(toFeedItem(highValueFallbackItem, 'high_value_deal', departureDate, returnDate));
  }

  // Top feed: best composite score across all categories (deduplicated)
  const topSeen = new Set();
  const top = [];
  for (const item of scored) {
    if (top.length >= limitTotal) break;
    const key = item.route.destinationIata;
    if (topSeen.has(key)) continue;
    topSeen.add(key);
    const primaryCat = classifyItem(item)[0];
    top.push(toFeedItem(item, primaryCat, departureDate, returnDate));
  }

  if (top.length === 0 && highValueFallbackItem) {
    top.push(toFeedItem(highValueFallbackItem, 'high_value_deal', departureDate, returnDate));
  }

  return {
    categories: byCategory,
    top,
    meta: {
      origin: safeOrigin,
      requested_origin: requestedOrigin,
      origin_fallback_used: requestedOrigin !== safeOrigin,
      month: resolvedMonth,
      generated_at: new Date().toISOString(),
      routes_scored: scored.length,
      inventory_source: 'synthetic_heuristic',
      departure_window: { from: departureDate, to: returnDate },
      thresholds: {
        cheap_max_price_eur: CHEAP_MAX_PRICE_EUR,
        cheap_min_savings_pct: CHEAP_MIN_ANOMALY,
        unusual_min_rarity: UNUSUAL_MIN_RARITY_SCORE,
        high_value_min_score: HIGH_VALUE_MIN_SCORE
      },
      scoring_weights: WEIGHTS
    }
  };
}
