import express from 'express';
import { addDays, format } from 'date-fns';
import { resolveUserPlan } from '../lib/plan-access.js';
import { runDiscoveryJustGo } from '../lib/discovery-engine.js';
import { findCheapestDestinations, findPriceDrops, findUnderratedRoutes } from '../lib/destination-discovery-engine.js';
import {
  createDiscoverySubscription,
  deleteDiscoverySubscription,
  listDiscoverySubscriptions
} from '../lib/deal-engine-store.js';
import { buildDiscoveryFeed, getDiscoveryFeedService } from '../lib/discovery-feed-service.js';
import { getCacheClient } from '../lib/free-cache.js';
import { detectPriceAnomaly } from '../lib/anomaly-detector.js';
import { decideTrips } from '../lib/flight-engine.js';
import { getHistoricalPrices, getRouteStats } from '../lib/price-history-store.js';
import { getPriceAlertsStore } from '../lib/price-alerts-store.js';
import { runPriceAlertsScanOnce } from '../lib/price-alerts-notifier.js';
import { predictPriceDirection } from '../lib/price-predictor.js';
import { logger } from '../lib/logger.js';
import { buildOpportunityFeed } from '../lib/opportunity-feed-engine.js';
import { requireForecastAccess } from '../lib/require-forecast-access.js';
import {
  DEFAULT_ORIGIN_IATA,
  FEED_CACHE_TTL_SEC,
  FEED_VERSION_CACHE_TTL_SEC,
  OPPORTUNITIES_FEED_CACHE_TTL,
  autoTripSchema,
  buildDestinationRollup,
  buildShareText,
  buildSmartCalendarPayload,
  collectFeedItems,
  countFeedItems,
  destinationCoords,
  discoveryFeedQuerySchema,
  discoverySchema,
  discoverySubSchema,
  errorFareQuerySchema,
  estimateHotelNightly,
  monthBounds,
  normalizeIataOrNull,
  opportunitiesFeedQuerySchema,
  originCoords,
  predictionQuerySchema,
  priceDropAlertCreateSchema,
  priceDropAlertUpdateSchema,
  readCachedJson,
  resolveTargetPriceFromBaseline,
  round2,
  smartCalendarQuerySchema,
  smartCheapestSchema,
  smartOriginSchema,
  sortedQueryFingerprint,
  startOfTodayIso,
  toNumber,
  travelInspirationSchema,
  trendingQuerySchema,
  viralDealsQuerySchema,
  whereCanIGoQuerySchema,
  worldMapQuerySchema,
  writeCachedJson
} from './discovery-support.js';

export function buildDiscoveryRouter({ authGuard, csrfGuard, quotaGuard, requireApiScope }) {
  const router = express.Router();
  const cache = getCacheClient();
  const feedService = getDiscoveryFeedService();
  const priceAlertsStore = getPriceAlertsStore();

  async function getFeedCached({ origin = null, maxPrice = null, limit = 16, scope = 'feed' } = {}) {
    const safeOrigin = normalizeIataOrNull(origin);
    const safeMaxPrice = Number.isFinite(Number(maxPrice)) ? Number(maxPrice) : null;
    const safeLimit = Math.max(1, Math.min(60, Number(limit) || 16));
    const versionCacheKey = `discovery:feed:version:${safeOrigin || 'all'}:${safeMaxPrice == null ? 'any' : safeMaxPrice}`;
    let version = await readCachedJson(cache, versionCacheKey);
    if (typeof version !== 'string' || !version) {
      version = await feedService.getFeedVersion({ origin: safeOrigin || '', maxPrice: safeMaxPrice });
      await writeCachedJson(cache, versionCacheKey, FEED_VERSION_CACHE_TTL_SEC, version);
    }
    const fingerprint = sortedQueryFingerprint({
      origin: safeOrigin || '',
      max_price: safeMaxPrice == null ? '' : safeMaxPrice,
      limit: safeLimit
    });
    const cacheKey = `discovery:${scope}:v${version}:${fingerprint}`;
    const cached = await readCachedJson(cache, cacheKey);
    if (cached) return cached;
    const payload = await buildDiscoveryFeed({
      origin: safeOrigin || '',
      maxPrice: safeMaxPrice,
      limit: safeLimit
    });
    await writeCachedJson(cache, cacheKey, FEED_CACHE_TTL_SEC, payload);
    return payload;
  }

  // ── /feed ─────────────────────────────────────────────────────────────────
  // DB-backed feed with automatic heuristic fallback.
  // If the database pipeline returns fewer than MIN_DB_FEED_ITEMS the heuristic
  // engine fills the remainder so the feed is never empty.
  const MIN_DB_FEED_ITEMS = 5;

  router.get('/feed', async (req, res, next) => {
    const parsed = discoveryFeedQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const maxPrice = parsed.data.max_price ?? parsed.data.budget_max ?? null;
      let payload = await getFeedCached({
        origin: parsed.data.origin,
        maxPrice,
        limit: parsed.data.limit,
        scope: 'feed'
      });

      // Heuristic fallback: enrich sparse DB feeds so the feed is never empty
      if (countFeedItems(payload) < MIN_DB_FEED_ITEMS) {
        const month = new Date().getUTCMonth() + 1;
        const heuristic = buildOpportunityFeed({
          origin: parsed.data.origin || DEFAULT_ORIGIN_IATA,
          month,
          limitPerCategory: 6,
          limitTotal: parsed.data.limit
        });
        payload = {
          ...payload,
          heuristic_feed: heuristic,
          meta: {
            ...(payload?.meta || {}),
            heuristic_fallback: true,
            heuristic_source: 'synthetic_heuristic',
            heuristic_routes_scored: heuristic.meta.routes_scored
          }
        };
      }

      res.setHeader('Cache-Control', `private, max-age=${FEED_CACHE_TTL_SEC}`);
      return res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  // ── /opportunities-feed ───────────────────────────────────────────────────
  // Pure heuristic discovery feed. No DB required. Always non-empty.
  // Public endpoint (no auth) — safe to embed in landing pages / unauthenticated views.
  //
  // Query params:
  //   origin   IATA (default: DEFAULT_DISCOVERY_ORIGIN env or FCO)
  //   month    1–12 (default: current UTC month)
  //   limit    total items (1–40, default 24)
  router.get('/opportunities-feed', async (req, res, next) => {
    const parsed = opportunitiesFeedQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const origin = parsed.data.origin || DEFAULT_ORIGIN_IATA;
      const month = parsed.data.month || (new Date().getUTCMonth() + 1);
      const limit = parsed.data.limit;

      const cacheKey = `discovery:opportunities_feed:v1:${origin}:${month}:${limit}`;
      const cached = await readCachedJson(cache, cacheKey);
      if (cached) {
        res.setHeader('Cache-Control', `public, max-age=${OPPORTUNITIES_FEED_CACHE_TTL}`);
        return res.json(cached);
      }

      const feed = buildOpportunityFeed({ origin, month, limitPerCategory: Math.ceil(limit / 3), limitTotal: limit });
      await writeCachedJson(cache, cacheKey, OPPORTUNITIES_FEED_CACHE_TTL, feed);

      res.setHeader('Cache-Control', `public, max-age=${OPPORTUNITIES_FEED_CACHE_TTL}`);
      return res.json(feed);
    } catch (error) {
      next(error);
    }
  });

  router.get('/daily-deals', async (req, res, next) => {
    const parsed = discoveryFeedQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const maxPrice = parsed.data.max_price ?? parsed.data.budget_max ?? null;
      const feed = await getFeedCached({
        origin: parsed.data.origin,
        maxPrice,
        limit: parsed.data.limit,
        scope: 'daily_deals'
      });
      const payload = {
        meta: feed.meta,
        top_offers: feed?.queries?.top_offers || [],
        recent_offers: feed?.queries?.recent_offers || [],
        popular_offers: feed?.queries?.popular_offers || [],
        cheap_flights: feed?.categories?.cheap_flights || [],
        weekend_flights: feed?.categories?.weekend_flights || [],
        last_minute_flights: feed?.categories?.last_minute_flights || [],
        long_haul_discounted: feed?.categories?.long_haul_discounted || []
      };
      res.setHeader('Cache-Control', `private, max-age=${FEED_CACHE_TTL_SEC}`);
      return res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get('/where-can-i-go', async (req, res, next) => {
    const parsed = whereCanIGoQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const budget = toNumber(parsed.data.budget ?? parsed.data.budget_max, NaN);
      const periodFrom = parsed.data.period_from || parsed.data.dateFrom || null;
      const periodTo = parsed.data.period_to || parsed.data.dateTo || null;

      const feed = await getFeedCached({
        origin: parsed.data.origin || null,
        maxPrice: budget,
        limit: Math.max(20, parsed.data.limit * 3),
        scope: 'where_can_i_go'
      });
      const rollup = buildDestinationRollup(collectFeedItems(feed), {
        maxBudget: budget,
        periodFrom,
        periodTo,
        limit: parsed.data.limit
      });

      return res.json({
        query: {
          origin: parsed.data.origin || null,
          budget,
          period_from: periodFrom,
          period_to: periodTo,
          limit: parsed.data.limit
        },
        meta: {
          source: 'detected_deals',
          generated_at: feed?.meta?.generated_at || new Date().toISOString(),
          total_candidates: rollup.length
        },
        items: rollup
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/trending-destinations', async (req, res, next) => {
    const parsed = trendingQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const safeLimit = parsed.data.limit;
      const origin = parsed.data.origin;

      if (origin) {
        const items = await findPriceDrops(origin, safeLimit * 2);
        const payload = items.slice(0, safeLimit).map((item) => ({
          destination_iata: item.destination,
          avg_price: round2(item.avg_price),
          observations: Number(item.observations || 0),
          price_drop_pct: round2(item.price_drop_pct),
          score: round2(item.score),
          badge: item.badge || item.deal_type || null,
          confidence: item.confidence || null
        }));
        return res.json({
          query: { origin, limit: safeLimit },
          items: payload
        });
      }

      const feed = await getFeedCached({
        origin: null,
        maxPrice: null,
        limit: Math.max(24, safeLimit * 4),
        scope: 'trending_global'
      });
      const byDestination = new Map();
      for (const item of collectFeedItems(feed)) {
        const destination = normalizeIataOrNull(item.destination_iata);
        if (!destination) continue;
        const hit = byDestination.get(destination) || {
          destination_iata: destination,
          destination_city: item.destination_city || destination,
          trend_score: 0,
          best_savings_pct: 0,
          best_price: Number.POSITIVE_INFINITY,
          offers: 0
        };
        hit.offers += 1;
        hit.best_savings_pct = Math.max(hit.best_savings_pct, round2(item.savings_pct));
        hit.best_price = Math.min(hit.best_price, round2(item.price));
        hit.trend_score = round2(hit.best_savings_pct * 0.85 + Math.log1p(hit.offers) * 14 + round2(item.final_score) * 0.2);
        byDestination.set(destination, hit);
      }

      const items = [...byDestination.values()]
        .sort((a, b) => b.trend_score - a.trend_score || a.best_price - b.best_price)
        .slice(0, safeLimit);
      return res.json({
        query: { origin: null, limit: safeLimit },
        items
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/travel-inspiration', async (req, res, next) => {
    const parsed = travelInspirationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const dateFrom = parsed.data.period_from || format(addDays(new Date(), 28), 'yyyy-MM-dd');
      const dateTo = format(addDays(new Date(`${dateFrom}T00:00:00Z`), parsed.data.duration), 'yyyy-MM-dd');
      const decision = decideTrips({
        origin: parsed.data.origin || DEFAULT_ORIGIN_IATA,
        region: parsed.data.region || 'all',
        dateFrom,
        dateTo,
        tripLengthDays: parsed.data.duration,
        budget: parsed.data.budget,
        budgetMax: parsed.data.budget,
        travellers: parsed.data.travellers,
        cabinClass: parsed.data.cabin_class,
        climatePreference: parsed.data.climate
      });
      const items = (decision.recommendations || []).map((item) => ({
        destination: item.destination,
        destination_iata: item.destinationIata,
        country: item.country || null,
        price: round2(item.price),
        trip_type: item.tripType || 'round_trip',
        climate_profile: item.climateInPeriod?.profile || null,
        travel_score: round2(item.travelScore),
        comfort_score: round2(item.comfortScore),
        reasons: item.reasons || [],
        cost_breakdown: item.costBreakdown || null
      }));
      return res.json({
        query: {
          origin: parsed.data.origin || DEFAULT_ORIGIN_IATA,
          budget: parsed.data.budget,
          climate: parsed.data.climate,
          duration: parsed.data.duration,
          period_from: dateFrom,
          period_to: dateTo
        },
        meta: decision.meta || {},
        items
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/world-price-map', async (req, res, next) => {
    const parsed = worldMapQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const budget = parsed.data.budget ?? parsed.data.budget_max ?? null;
      const feed = await getFeedCached({
        origin: parsed.data.origin || null,
        maxPrice: budget,
        limit: Math.max(30, parsed.data.limit * 3),
        scope: 'world_map'
      });
      const destinations = buildDestinationRollup(collectFeedItems(feed), {
        maxBudget: budget,
        periodFrom: parsed.data.period_from || null,
        periodTo: parsed.data.period_to || null,
        limit: parsed.data.limit
      });
      const points = destinations.map((item) => ({
        ...item,
        destination_coords: destinationCoords(item.destination_country, item.destination_iata),
        origin_coords: originCoords(item.origin_iata || parsed.data.origin || DEFAULT_ORIGIN_IATA)
      }));
      return res.json({
        query: {
          origin: parsed.data.origin || null,
          budget: budget == null ? null : Number(budget),
          period_from: parsed.data.period_from || null,
          period_to: parsed.data.period_to || null,
          limit: parsed.data.limit
        },
        points
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/smart-price-calendar', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), requireForecastAccess, async (req, res, next) => {
    const parsed = smartCalendarQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const defaultFrom = startOfTodayIso();
      const defaultTo = format(addDays(new Date(), parsed.data.limit), 'yyyy-MM-dd');
      const dateFrom = parsed.data.date_from || defaultFrom;
      const dateTo = parsed.data.date_to || defaultTo;
      const history = await getHistoricalPrices({
        origin: parsed.data.origin,
        destination: parsed.data.destination,
        dateFrom,
        dateTo,
        limit: 10000
      });
      const payload = buildSmartCalendarPayload(history, {
        dateFrom,
        dateTo,
        limit: parsed.data.limit
      });
      return res.json({
        query: {
          origin: parsed.data.origin,
          destination: parsed.data.destination,
          date_from: dateFrom,
          date_to: dateTo
        },
        ...payload
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/price-prediction', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), requireForecastAccess, async (req, res, next) => {
    const parsed = predictionQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const bounds = monthBounds(parsed.data.departure_date);
      if (!bounds) return res.status(400).json({ error: 'Invalid departure_date.' });

      const [stats, history] = await Promise.all([
        getRouteStats({
          origin: parsed.data.origin,
          destination: parsed.data.destination,
          dateFrom: bounds.start,
          dateTo: bounds.end
        }),
        getHistoricalPrices({
          origin: parsed.data.origin,
          destination: parsed.data.destination,
          dateFrom: bounds.start,
          dateTo: bounds.end,
          limit: 1
        })
      ]);

      if (!stats || Number(stats.count || 0) <= 0) {
        return res.json({
          recommendation: 'insufficient_data',
          reason: 'No historical stats for selected route/month.',
          stats: {
            count: 0,
            month_start: bounds.start,
            month_end: bounds.end
          }
        });
      }

      const currentPrice = parsed.data.current_price ?? toNumber(history?.[0]?.total_price, stats.median || stats.avg || stats.min || NaN);
      if (!Number.isFinite(Number(currentPrice)) || Number(currentPrice) <= 0) {
        return res.status(400).json({ error: 'current_price missing and no historical quote found.' });
      }

      const forecast = predictPriceDirection({
        departureDate: parsed.data.departure_date,
        baselineP25: toNumber(stats.p25, stats.avg),
        baselineP50: toNumber(stats.median, stats.avg),
        baselineP75: toNumber(stats.p75, stats.max),
        currentPrice: Number(currentPrice)
      });
      const drop = toNumber(forecast.probability_drop, 0);
      const rise = toNumber(forecast.probability_rise, 0);
      const recommendation = drop - rise >= 0.08 ? 'wait' : rise - drop >= 0.08 ? 'buy_now' : 'monitor';

      return res.json({
        route: {
          origin: parsed.data.origin,
          destination: parsed.data.destination,
          departure_date: parsed.data.departure_date
        },
        current_price: round2(currentPrice),
        baseline: {
          min: round2(stats.min),
          p25: round2(stats.p25),
          median: round2(stats.median),
          p75: round2(stats.p75),
          max: round2(stats.max),
          avg: round2(stats.avg),
          observations: Number(stats.count || 0)
        },
        forecast,
        recommendation
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/error-fares', async (req, res, next) => {
    const parsed = errorFareQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const feed = await getFeedCached({
        origin: parsed.data.origin || null,
        maxPrice: null,
        limit: Math.max(20, parsed.data.limit * 4),
        scope: 'error_fares'
      });

      const candidates = [];
      for (const item of collectFeedItems(feed)) {
        const baseline = toNumber(item.baseline_price, NaN);
        const price = toNumber(item.price, NaN);
        if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(price) || price <= 0) continue;
        const anomaly = detectPriceAnomaly({
          price,
          baselineP50: baseline,
          baselineP25: baseline * 0.82,
          baselineP75: baseline * 1.15,
          stopCount: Number(item.stops || 0),
          comfortScore: 72
        });
        const savingsPct = toNumber(item.savings_pct, 0);
        const potentialErrorFare = savingsPct >= 55 || anomaly.zRobust >= 2.6;
        if (!potentialErrorFare) continue;
        candidates.push({
          deal_key: item.deal_key,
          origin_iata: normalizeIataOrNull(item.origin_iata),
          destination_iata: normalizeIataOrNull(item.destination_iata),
          destination_city: item.destination_city || null,
          price: round2(price),
          baseline_price: round2(baseline),
          savings_pct: round2(savingsPct),
          anomaly,
          risk_score: round2(savingsPct * 0.7 + anomaly.zRobust * 15 + toNumber(item.final_score, 0) * 0.2),
          observed_at: item.source_observed_at || null
        });
      }

      const items = candidates
        .sort((a, b) => b.risk_score - a.risk_score || b.savings_pct - a.savings_pct)
        .slice(0, parsed.data.limit);
      return res.json({
        query: { origin: parsed.data.origin || null, limit: parsed.data.limit },
        items
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/viral-deals', async (req, res, next) => {
    const parsed = viralDealsQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const feed = await getFeedCached({
        origin: parsed.data.origin || null,
        maxPrice: null,
        limit: Math.max(12, parsed.data.limit * 2),
        scope: 'viral_deals'
      });
      const top = (feed?.queries?.top_offers || []).slice(0, parsed.data.limit);
      const items = top.map((item, idx) => {
        const share = buildShareText(item, idx + 1);
        return {
          deal_key: item.deal_key,
          origin_iata: normalizeIataOrNull(item.origin_iata),
          destination_iata: normalizeIataOrNull(item.destination_iata),
          destination_city: item.destination_city || item.destination_iata || null,
          price: round2(item.price),
          savings_pct: round2(item.savings_pct),
          final_score: round2(item.final_score),
          ...share
        };
      });
      return res.json({
        query: { origin: parsed.data.origin || null, limit: parsed.data.limit },
        items
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auto-trip-generator', async (req, res, next) => {
    const parsed = autoTripSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const periodFrom = parsed.data.period_from;
      const periodTo = parsed.data.period_to || format(addDays(new Date(`${periodFrom}T00:00:00Z`), parsed.data.duration), 'yyyy-MM-dd');
      const decision = decideTrips({
        origin: parsed.data.origin || DEFAULT_ORIGIN_IATA,
        dateFrom: periodFrom,
        dateTo: periodTo,
        tripLengthDays: parsed.data.duration,
        budget: parsed.data.budget,
        budgetMax: parsed.data.budget,
        travellers: parsed.data.travellers,
        cabinClass: parsed.data.cabin_class,
        climatePreference: parsed.data.climate,
        packageCount: 4
      });

      const duration = parsed.data.duration;
      const itinerary = (decision.recommendations || []).map((option) => {
        const nightly = estimateHotelNightly({
          destinationIata: option.destinationIata,
          climate: parsed.data.climate,
          duration,
          budget: parsed.data.budget
        });
        const hotelTotal = round2(nightly * duration);
        const flightTotal = round2(option.price);
        const tripTotal = round2(flightTotal + hotelTotal);
        return {
          destination: option.destination,
          destination_iata: option.destinationIata,
          country: option.country || null,
          travel_score: round2(option.travelScore),
          trip_type: option.tripType || 'round_trip',
          travel_window: {
            date_from: periodFrom,
            date_to: periodTo,
            duration_days: duration
          },
          flight: {
            price_total: flightTotal,
            stops: Number(option.stopCount || 0),
            comfort_score: round2(option.comfortScore),
            provider: option.inventorySource || 'local_model'
          },
          hotel: {
            estimated_nightly: nightly,
            estimated_total: hotelTotal,
            currency: 'EUR'
          },
          total_estimated_cost: tripTotal,
          within_budget: tripTotal <= parsed.data.budget
        };
      });

      const best =
        itinerary
          .slice()
          .sort(
            (a, b) =>
              Number(b.within_budget) - Number(a.within_budget) || b.travel_score - a.travel_score || a.total_estimated_cost - b.total_estimated_cost
          )[0] || null;

      return res.json({
        query: {
          origin: parsed.data.origin || DEFAULT_ORIGIN_IATA,
          budget: parsed.data.budget,
          period_from: periodFrom,
          period_to: periodTo,
          duration: parsed.data.duration
        },
        best_trip: best,
        options: itinerary
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/price-drop-alerts', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
    try {
      const items = await priceAlertsStore.listPriceAlerts({ userId: req.user.sub });
      return res.json({ items });
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/discovery/price-drop-alerts' }, 'discovery_price_drop_alerts_list_failed');
      return res.status(500).json({ error: 'Failed to list price drop alerts.' });
    }
  });

  router.post('/price-drop-alerts', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    const parsed = priceDropAlertCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });

    try {
      const target = await resolveTargetPriceFromBaseline({
        originIata: parsed.data.originIata,
        destinationIata: parsed.data.destinationIata,
        dateFrom: parsed.data.dateFrom,
        marginPct: parsed.data.marginPct,
        explicitMaxPrice: parsed.data.maxPrice
      });
      if (!target) {
        return res.status(400).json({
          error: 'No baseline available for this route/month. Provide maxPrice explicitly or ingest more history.'
        });
      }

      const item = await priceAlertsStore.createPriceAlert({
        userId: req.user.sub,
        originIata: parsed.data.originIata,
        destinationIata: parsed.data.destinationIata,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
        maxPrice: target.targetPrice,
        currency: parsed.data.currency || 'EUR',
        channels: parsed.data.channels || undefined,
        enabled: parsed.data.enabled
      });
      try {
        await runPriceAlertsScanOnce({ limit: 250 });
      } catch {}

      return res.status(201).json({
        item,
        threshold: {
          source: target.source,
          baseline_median: target.baselineMedian,
          max_price: target.targetPrice
        }
      });
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/discovery/price-drop-alerts' }, 'discovery_price_drop_alert_create_failed');
      return res.status(500).json({ error: 'Failed to create price drop alert.' });
    }
  });

  router.patch('/price-drop-alerts/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    const parsed = priceDropAlertUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const item = await priceAlertsStore.updatePriceAlert({
        userId: req.user.sub,
        alertId: req.params.id,
        patch: parsed.data
      });
      if (!item) return res.status(404).json({ error: 'Price drop alert not found.' });
      return res.json({ item });
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/discovery/price-drop-alerts/:id' }, 'discovery_price_drop_alert_update_failed');
      return res.status(500).json({ error: 'Failed to update price drop alert.' });
    }
  });

  router.delete('/price-drop-alerts/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    try {
      const outcome = await priceAlertsStore.deletePriceAlert({
        userId: req.user.sub,
        alertId: req.params.id
      });
      if (!outcome.removed) return res.status(404).json({ error: 'Price drop alert not found.' });
      return res.status(204).send();
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/discovery/price-drop-alerts/:id' }, 'discovery_price_drop_alert_delete_failed');
      return res.status(500).json({ error: 'Failed to delete price drop alert.' });
    }
  });

  router.post('/price-drop-alerts/scan', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'notifications', amount: 1 }), async (req, res) => {
    const { planType } = resolveUserPlan(req.user);
    if (planType === 'free') {
      return res.status(402).json({ error: 'premium_required', message: 'Manual alert scans require a Pro or Elite plan.' });
    }
    try {
      const result = await runPriceAlertsScanOnce({ limit: 500 });
      return res.json({ ok: true, result });
    } catch (error) {
      logger.error({ err: error, endpoint: '/api/discovery/price-drop-alerts/scan' }, 'discovery_price_drop_alert_scan_failed');
      return res.status(500).json({ error: 'Failed to scan price drop alerts.' });
    }
  });

  router.post('/just-go', authGuard, csrfGuard, requireApiScope('search'), quotaGuard({ counter: 'decision', amount: 1 }), async (req, res, next) => {
    const parsed = discoverySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const userId = req.user?.sub || req.user?.id;
      const result = await runDiscoveryJustGo({ userId, ...parsed.data });
      return res.json(result);
    } catch (error) {
      const message = String(error?.message || '');
      if (message.toLowerCase().startsWith('invalid')) return res.status(400).json({ error: message });
      next(error);
    }
  });

  router.get('/smart/cheapest', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res, next) => {
    const parsed = smartCheapestSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const items = await findCheapestDestinations(parsed.data.origin, parsed.data.month, parsed.data.limit);
      return res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get('/smart/underrated', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res, next) => {
    const parsed = smartOriginSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const items = await findUnderratedRoutes(parsed.data.origin, parsed.data.limit);
      return res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get('/smart/price-drops', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res, next) => {
    const parsed = smartOriginSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const items = await findPriceDrops(parsed.data.origin, parsed.data.limit);
      return res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get('/subscriptions', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res, next) => {
    try {
      const userId = req.user?.sub || req.user?.id;
      const items = await listDiscoverySubscriptions(userId);
      return res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.post('/subscriptions', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res, next) => {
    const parsed = discoverySubSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const userId = req.user?.sub || req.user?.id;
      const item = await createDiscoverySubscription({
        userId,
        originIata: parsed.data.origin,
        budgetEur: parsed.data.budget,
        mood: parsed.data.mood,
        region: parsed.data.region,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
        enabled: parsed.data.enabled
      });
      return res.status(201).json({ item });
    } catch (error) {
      const message = String(error?.message || '');
      if (message.toLowerCase().startsWith('invalid')) return res.status(400).json({ error: message });
      next(error);
    }
  });

  router.delete('/subscriptions/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res, next) => {
    try {
      const userId = req.user?.sub || req.user?.id;
      const ok = await deleteDiscoverySubscription({ userId, subscriptionId: req.params.id });
      if (!ok) return res.status(404).json({ error: 'Subscription not found.' });
      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
