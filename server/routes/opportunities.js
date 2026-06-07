import express from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import countries from 'world-countries';
import {
  createOrUpdateUserFollow,
  deleteUserFollow,
  listDestinationClusters,
  getOpportunityById,
  getOpportunityFeedVersion,
  getOpportunityPipelineStats,
  listUserFollows,
  listPublishedOpportunities,
  listRelatedOpportunities,
  queryOpportunitiesByPrompt
} from '../lib/opportunity-store.js';
import { runOpportunityPipelineOnce } from '../jobs/opportunity-pipeline-worker.js';
import {
  canUseAITravel,
  canViewRareOpportunities,
  canViewUnlimitedOpportunities,
  canConfigureRadar,
  buildFreeAiBlockedPayload,
  getPlanCostLimits,
  getFollowsLimit,
  getUpgradeContext,
  isFreePlan,
  resolveUserPlan
} from '../lib/plan-access.js';
import {
  recordFreeAiBlocked,
  recordFreeCacheHit,
  recordUpgradePromptShown
} from '../lib/free-cost-metrics.js';
import { getCacheClient } from '../lib/free-cache.js';
import { followMetadataSchema } from '../lib/follow-metadata.js';
import { ROUTES } from '../data/local-flight-data.js';
import { loadOurAirportsCatalog } from '../lib/ourairports-catalog.js';

const ORIGIN_COORDS = {
  FCO: { lat: 41.8003, lng: 12.2389 },
  MXP: { lat: 45.6301, lng: 8.7231 },
  BLQ: { lat: 44.5354, lng: 11.2887 },
  VCE: { lat: 45.5053, lng: 12.3519 },
  NAP: { lat: 40.886, lng: 14.2908 }
};

const countryCoords = new Map();
for (const country of countries || []) {
  const latlng = Array.isArray(country?.latlng) ? country.latlng : [];
  const lat = Number(latlng[0]);
  const lng = Number(latlng[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  const names = [country?.name?.common, country?.name?.official, country?.cca2, country?.cca3]
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean);
  for (const key of names) {
    if (!countryCoords.has(key)) countryCoords.set(key, { lat, lng });
  }
}

const feedQuerySchema = z.object({
  origin: z.string().trim().length(3).optional(),
  budget_max: z.coerce.number().positive().optional(),
  travel_month: z.string().trim().regex(/^\d{4}-\d{2}$/).optional(),
  country: z.string().trim().min(2).max(80).optional(),
  region: z.string().trim().min(2).max(40).optional(),
  cluster: z.string().trim().min(2).max(80).optional(),
  budget_bucket: z.string().trim().min(2).max(40).optional(),
  entity: z.string().trim().min(3).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional().default(20)
}).strict();
const clustersQuerySchema = z.object({
  region: z.string().trim().min(2).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(40).optional().default(12)
}).strict();
const followEntitySchema = z.object({
  entityType: z.enum(['city', 'country', 'region', 'airport', 'budget_bucket', 'season', 'theme', 'destination_cluster']),
  slug: z.string().trim().min(2).max(80),
  displayName: z.string().trim().min(2).max(120).optional(),
  followType: z.enum(['radar', 'destination', 'theme']).optional().default('radar'),
  metadata: followMetadataSchema.optional().default({})
}).strict();

const radarPreferenceSchema = z.object({
  originAirports: z.array(z.string().trim().length(3)).max(8).default([]),
  favoriteDestinations: z.array(z.string().trim().min(2).max(60)).max(12).default([]),
  favoriteCountries: z.array(z.string().trim().min(2).max(60)).max(12).default([]),
  budgetCeiling: z.coerce.number().positive().max(20000).nullable().optional(),
  preferredTravelMonths: z.array(z.number().int().min(1).max(12)).max(12).default([])
}).strict();

const aiQuerySchema = z.object({
  prompt: z.string().trim().min(4).max(500),
  limit: z.coerce.number().int().min(1).max(30).optional().default(12)
}).strict();

const budgetExploreSchema = z.object({
  origin: z.string().trim().length(3),
  budget_max: z.coerce.number().positive(),
  region: z.string().trim().min(2).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(80).optional().default(20)
}).strict();

const OPPORTUNITY_FEED_SOURCE = 'travel_opportunities';
const EXPLORE_CACHE_SCHEMA_VERSION = 'region-fallback-v6';
const EXPLORE_MAP_MAX_POINTS = 6;

const EXPLORE_REGION_ALIASES = new Map([
  ['europe', 'eu'],
  ['north_america', 'america'],
  ['north-america', 'america'],
  ['americas', 'america'],
  ['south-america', 'south_america']
]);

const EXPLORE_REGION_FALLBACK_ROUTES = [
  {
    origin: 'FCO',
    destinationIata: 'LIS',
    destinationName: 'Lisbon',
    country: 'Portugal',
    region: 'eu',
    priceLow: 90,
    tripType: 'round_trip',
    stops: 0
  },
  {
    origin: 'FCO',
    destinationIata: 'ATH',
    destinationName: 'Athens',
    country: 'Greece',
    region: 'eu',
    priceLow: 120,
    tripType: 'round_trip',
    stops: 0
  },
  {
    origin: 'FCO',
    destinationIata: 'JFK',
    destinationName: 'New York',
    country: 'United States',
    region: 'america',
    priceLow: 420,
    tripType: 'round_trip',
    stops: 1
  },
  {
    origin: 'FCO',
    destinationIata: 'YYZ',
    destinationName: 'Toronto',
    country: 'Canada',
    region: 'america',
    priceLow: 480,
    tripType: 'round_trip',
    stops: 1
  },
  {
    origin: 'FCO',
    destinationIata: 'CAI',
    destinationName: 'Cairo',
    country: 'Egypt',
    region: 'africa',
    priceLow: 260,
    tripType: 'round_trip',
    stops: 1
  },
  {
    origin: 'FCO',
    destinationIata: 'BKK',
    destinationName: 'Bangkok',
    country: 'Thailand',
    region: 'asia',
    priceLow: 520,
    tripType: 'round_trip',
    stops: 1
  },
  {
    origin: 'FCO',
    destinationIata: 'TYO',
    destinationName: 'Tokyo',
    country: 'Japan',
    region: 'asia',
    priceLow: 620,
    tripType: 'round_trip',
    stops: 1
  },
  {
    origin: 'FCO',
    destinationIata: 'SYD',
    destinationName: 'Sydney',
    country: 'Australia',
    region: 'oceania',
    priceLow: 820,
    tripType: 'round_trip',
    stops: 1
  },
  {
    origin: 'FCO',
    destinationIata: 'AKL',
    destinationName: 'Auckland',
    country: 'New Zealand',
    region: 'oceania',
    priceLow: 900,
    tripType: 'round_trip',
    stops: 1
  },
  {
    origin: 'FCO',
    destinationIata: 'EZE',
    destinationName: 'Buenos Aires',
    country: 'Argentina',
    region: 'south_america',
    priceLow: 690,
    tripType: 'round_trip',
    stops: 1
  },
  {
    origin: 'FCO',
    destinationIata: 'GIG',
    destinationName: 'Rio de Janeiro',
    country: 'Brazil',
    region: 'south_america',
    priceLow: 640,
    tripType: 'round_trip',
    stops: 1
  },
  {
    origin: 'FCO',
    destinationIata: 'LIM',
    destinationName: 'Lima',
    country: 'Peru',
    region: 'south_america',
    priceLow: 610,
    tripType: 'round_trip',
    stops: 1
  }
];

function normalizeExploreRegion(region) {
  const raw = String(region || '').trim().toLowerCase();
  if (!raw || raw === 'all') return '';
  return EXPLORE_REGION_ALIASES.get(raw) || raw;
}

function readNumberFromItem(item, keys) {
  for (const key of keys) {
    const value = Number(item?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function calculateDealConfidence(price, baselinePrice, ageHours) {
  const safePrice = Number(price);
  const safeBaseline = Number(baselinePrice);
  const safeAge = Math.max(0, Number(ageHours) || 0);
  if (!Number.isFinite(safePrice) || !Number.isFinite(safeBaseline) || safePrice <= 0 || safeBaseline <= 0) {
    return 'medium';
  }
  const savingPercent = Math.round(((safeBaseline - safePrice) / safeBaseline) * 100);
  if (savingPercent >= 30 && safeAge <= 12) return 'high';
  if (savingPercent >= 15 && safeAge <= 24) return 'medium';
  if (safeAge > 24) return 'low';
  return 'medium';
}

export function buildBasicRouteInsight(route) {
  if (Number(route?.savingPercent || 0) >= 25) {
    return 'This route is currently well below its recent baseline.';
  }
  if (Number(route?.ageHours || 0) > 24) {
    return 'This deal is based on an older scan. Pro users can refresh it more often.';
  }
  return 'This route is available from the latest public scan.';
}

function calculateAgeHours(item) {
  const raw = item?.source_observed_at || item?.observed_at || item?.updated_at || item?.published_at || item?.created_at;
  const timestamp = raw ? Date.parse(String(raw)) : NaN;
  if (!Number.isFinite(timestamp)) return 24;
  return Math.max(0, Math.round((Date.now() - timestamp) / 36_000) / 100);
}

function enrichPublicDealForFree(item) {
  const price = readNumberFromItem(item, ['price', 'min_price', 'totalPrice']);
  const baselinePrice = readNumberFromItem(item, ['baseline_price', 'baselinePrice', 'avg_price', 'average_price', 'avg_2024']);
  const ageHours = calculateAgeHours(item);
  const savingPercent = Number.isFinite(Number(item?.saving_percent))
    ? Math.round(Number(item.saving_percent))
    : price && baselinePrice
      ? Math.max(0, Math.round(((baselinePrice - price) / baselinePrice) * 100))
      : 0;
  const confidence = calculateDealConfidence(price, baselinePrice, ageHours);
  return {
    ...item,
    savingPercent,
    confidence,
    basicRouteInsight: buildBasicRouteInsight({ savingPercent, ageHours }),
    freeDataSource: 'public_cached_deal_feed',
    refreshIntervalHours: 24
  };
}

function buildDefaultRadarPreference(userId) {
  return {
    id: nanoid(12),
    userId,
    originAirports: [],
    favoriteDestinations: [],
    favoriteCountries: [],
    budgetCeiling: null,
    preferredTravelMonths: [],
    updatedAt: new Date().toISOString()
  };
}

function sortedQueryFingerprint(input = {}) {
  const entries = Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, String(value)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

async function loadUserFromStore(withDb, userId) {
  if (!userId) return null;
  let user = null;
  await withDb(async (db) => {
    user = (db.users || []).find((entry) => entry.id === userId) || null;
    return null;
  });
  return user;
}

function hasAuthMaterial(req) {
  return Boolean(String(req.headers.authorization || '').trim() || String(req.headers.cookie || '').trim());
}

function rejectAnonymousAiRequest(req, res, next) {
  if (hasAuthMaterial(req)) return next();
  recordFreeAiBlocked();
  return res.status(403).json({
    ...buildFreeAiBlockedPayload(),
    request_id: req.id || null
  });
}

async function readCachedJson(cache, key) {
  try {
    const raw = await cache.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCachedJson(cache, key, ttlSec, payload) {
  try {
    await cache.setex(key, Math.max(1, Number(ttlSec) || 60), JSON.stringify(payload));
  } catch {}
}

function findOriginCoords(iata) {
  const key = String(iata || '').trim().toUpperCase();
  if (ORIGIN_COORDS[key]) return ORIGIN_COORDS[key];
  const airport = loadOurAirportsCatalog()?.airportsByIata?.[key];
  const lat = Number(airport?.latitude);
  const lng = Number(airport?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function findCountryCoords(countryName) {
  const key = String(countryName || '').trim().toLowerCase();
  if (!key) return null;
  return countryCoords.get(key) || null;
}

function nextExploreDepartureWindow() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 28);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 5);
  return {
    departDate: start.toISOString().slice(0, 10),
    returnDate: end.toISOString().slice(0, 10)
  };
}

function readRouteFallbackPrice(route, month = new Date().getUTCMonth() + 1) {
  const band = route?.seasonalPriceBands?.[String(month)];
  const price = Number(route?.priceLow || band?.low || band?.avgPrice || 0);
  return Number.isFinite(price) && price > 0 ? Math.round(price) : null;
}

function toFallbackExploreDestinations({ origin, region, budgetMax, limit, allowMapAnchorFallback = false }) {
  const safeOrigin = String(origin || '').trim().toUpperCase();
  const safeRegion = normalizeExploreRegion(region);

  const budget = Number(budgetMax);
  const maxPrice = Number.isFinite(budget) && budget > 0 ? budget : Number.POSITIVE_INFINITY;
  const routePool = [
    ...ROUTES.map((route) => ({ ...route, isLocalRoute: true })),
    ...EXPLORE_REGION_FALLBACK_ROUTES.map((route) => ({ ...route, isExploreRegionFallback: true }))
  ];
  const isRegionFiltered = Boolean(safeRegion && safeRegion !== 'all');
  const scopedRoutes = isRegionFiltered
    ? routePool.filter((route) => String(route.region || '').trim().toLowerCase() === safeRegion)
    : routePool;
  const exactOriginRoutes = scopedRoutes.filter((route) => String(route.origin || '').trim().toUpperCase() === safeOrigin);
  const selectedRoutes = exactOriginRoutes.length > 0 || !allowMapAnchorFallback
    ? exactOriginRoutes
    : scopedRoutes.filter((route) => Boolean(route.isExploreRegionFallback));
  if (selectedRoutes.length === 0) return [];
  const { departDate, returnDate } = nextExploreDepartureWindow();

  const candidates = selectedRoutes
    .map((route) => {
      const minPrice = readRouteFallbackPrice(route);
      if (!minPrice) return null;
      const destinationRegion = String(route.region || safeRegion || '').trim().toLowerCase();
      return {
        destination_airport: String(route.destinationIata || '').trim().toUpperCase(),
        destination_city: route.destinationName || route.destinationIata,
        destination_country: route.country || null,
        destination_region: destinationRegion || null,
        min_price: minPrice,
        currency: 'EUR',
        trip_type: route.tripType || 'round_trip',
        depart_date: departDate,
        return_date: returnDate,
        stops: Number.isFinite(Number(route.stops)) ? Number(route.stops) : 1,
        airline: 'route_signal',
        baggage_included: null,
        opportunity_count: 1
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.min_price - b.min_price);

  const withinBudget = candidates.filter((item) => item.min_price <= maxPrice);
  if (allowMapAnchorFallback && isRegionFiltered && withinBudget.length === 0) {
    return candidates.slice(0, Math.max(1, Number(limit) || 20));
  }
  return withinBudget.slice(0, Math.max(1, Number(limit) || 20));
}

export function buildOpportunitiesRouter({
  authGuard,
  requireSessionAuth = (_req, _res, next) => next(),
  adminGuard = (_req, _res, next) => next(),
  csrfGuard,
  requireApiScope,
  quotaGuard,
  withDb,
  optionalAuth
}) {
  const router = express.Router();
  const cache = getCacheClient();
  const exploreCacheTtlSec = Math.max(5, Math.min(300, Number(process.env.OPPORTUNITY_EXPLORE_CACHE_TTL_SEC || 60)));

  function toExploreDestinations(items, limit = 20) {
    const byDestination = new Map();
    for (const item of items || []) {
      const key = String(item.destination_airport || '').toUpperCase();
      if (!key) continue;
      const existing = byDestination.get(key);
      if (!existing) {
        byDestination.set(key, {
          destination_airport: key,
          destination_city: item.destination_city,
          destination_country: item.destination_country || null,
          destination_region: item.destination_region || null,
          min_price: Number(item.price || 0),
          currency: item.currency || 'EUR',
          trip_type: item.trip_type || 'round_trip',
          depart_date: item.depart_date || null,
          return_date: item.return_date || null,
          stops: Number(item.stops || 0),
          airline: item.airline || 'unknown',
          baggage_included: item.baggage_included == null ? null : Boolean(item.baggage_included),
          opportunity_count: 1
        });
        continue;
      }
      existing.opportunity_count += 1;
      const price = Number(item.price || 0);
      if (Number.isFinite(price) && price > 0 && price < existing.min_price) {
        existing.min_price = price;
        existing.trip_type = item.trip_type || existing.trip_type;
        existing.depart_date = item.depart_date || existing.depart_date;
        existing.return_date = item.return_date || existing.return_date;
        existing.stops = Number(item.stops || existing.stops || 0);
        existing.airline = item.airline || existing.airline;
        existing.baggage_included = item.baggage_included == null ? existing.baggage_included : Boolean(item.baggage_included);
      }
    }
    return [...byDestination.values()]
      .sort((a, b) => a.min_price - b.min_price || b.opportunity_count - a.opportunity_count)
      .slice(0, Math.max(1, Number(limit) || 20));
  }

  function toExploreMapDestinations(destinations) {
    const byCountryOrDestination = new Map();
    for (const item of destinations || []) {
      const country = String(item?.destination_country || '').trim().toLowerCase();
      const fallbackKey = String(item?.destination_airport || '').trim().toUpperCase();
      const key = country || fallbackKey;
      if (!key) continue;
      const existing = byCountryOrDestination.get(key);
      if (!existing) {
        byCountryOrDestination.set(key, { ...item });
        continue;
      }
      existing.opportunity_count = Number(existing.opportunity_count || 1) + Number(item?.opportunity_count || 1);
      const existingPrice = Number(existing.min_price || 0);
      const nextPrice = Number(item?.min_price || 0);
      if (Number.isFinite(nextPrice) && nextPrice > 0 && (!Number.isFinite(existingPrice) || existingPrice <= 0 || nextPrice < existingPrice)) {
        Object.assign(existing, item, { opportunity_count: existing.opportunity_count });
      }
    }
    return [...byCountryOrDestination.values()]
      .sort((a, b) => Number(a.min_price || 0) - Number(b.min_price || 0) || Number(b.opportunity_count || 1) - Number(a.opportunity_count || 1))
      .slice(0, EXPLORE_MAP_MAX_POINTS);
  }

  const handleFeed = async (req, res, next) => {
    const parsed = feedQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const sourceItems = await listPublishedOpportunities({
        originAirport: parsed.data.origin,
        maxPrice: parsed.data.budget_max,
        travelMonth: parsed.data.travel_month,
        country: parsed.data.country,
        region: parsed.data.region,
        cluster: parsed.data.cluster,
        budgetBucket: parsed.data.budget_bucket,
        entity: parsed.data.entity,
        limit: parsed.data.limit,
        publicDiscoveryOnly: true
      });

      const auth = typeof optionalAuth === 'function' ? optionalAuth(req) : null;
      const user = await loadUserFromStore(withDb, auth?.sub);

      if (!user) {
        recordFreeCacheHit(true);
        return res.json({
          source: OPPORTUNITY_FEED_SOURCE,
          items: sourceItems.slice(0, 10).map(enrichPublicDealForFree),
          access: {
            planType: 'free',
            publicDealsLimit: 10,
            radarUsesCachedDataOnly: true,
            refreshIntervalHours: 24,
            showUpgradePrompt: sourceItems.length > 10,
            upgradeMessage: 'Free shows public cached opportunities. Upgrade for live scans, AI tools, and route alerts when delivery is enabled.'
          }
        });
      }

      const plan = resolveUserPlan(user);
      const costLimits = getPlanCostLimits(plan.planType);
      const allowRare = canViewRareOpportunities(user);
      const filtered = allowRare ? sourceItems : sourceItems.filter((item) => String(item.opportunity_level || '').trim() !== 'Rare opportunity');
      const isUnlimited = canViewUnlimitedOpportunities(user);
      const publicDealsLimit = Number(costLimits.publicDealsLimit || 10);
      const cappedItems = isUnlimited ? filtered : filtered.slice(0, publicDealsLimit);
      const visibleCount = cappedItems.length;
      const totalCount = filtered.length;
      const showUpgradePrompt = !isUnlimited && totalCount > visibleCount;
      if (isFreePlan(user)) recordFreeCacheHit(true);
      if (showUpgradePrompt) recordUpgradePromptShown();

      return res.json({
        source: OPPORTUNITY_FEED_SOURCE,
        items: isFreePlan(user) ? cappedItems.map(enrichPublicDealForFree) : cappedItems,
        access: {
          planType: plan.planType,
          planStatus: plan.planStatus,
          isUnlimited,
          allowRare,
          dailyLimit: isUnlimited ? null : publicDealsLimit,
          publicDealsLimit: isUnlimited ? null : publicDealsLimit,
          radarUsesCachedDataOnly: Boolean(costLimits.radarUsesCachedDataOnly),
          refreshIntervalHours: costLimits.refreshIntervalHours,
          visibleCount,
          totalCount,
          showUpgradePrompt,
          upgradeMessageKey: showUpgradePrompt ? 'upgradePromptUnlockAll' : null,
          upgradeMessage: showUpgradePrompt
            ? 'Free shows public cached opportunities. Upgrade for live scans, AI tools, and route alerts when delivery is enabled.'
            : null
        }
      });
    } catch (error) {
      next(error);
    }
  };

  router.get('/feed', handleFeed);
  router.get('/clusters', async (req, res, next) => {
    const parsed = clustersQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const items = await listDestinationClusters({
        region: parsed.data.region,
        limit: parsed.data.limit
      });
      return res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get('/explore/budget', async (req, res, next) => {
    const parsed = budgetExploreSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const requestedRegion = normalizeExploreRegion(parsed.data.region);
      const regionFilter = requestedRegion && requestedRegion !== 'all' ? requestedRegion : '';
      const version = getOpportunityFeedVersion();
      const fingerprint = sortedQueryFingerprint({ ...parsed.data, region: regionFilter });
      const cacheKey = `opps:explore:budget:${EXPLORE_CACHE_SCHEMA_VERSION}:v${version}:${fingerprint}`;
      const cached = await readCachedJson(cache, cacheKey);
      if (cached) {
        res.setHeader('Cache-Control', `private, max-age=${exploreCacheTtlSec}`);
        return res.json(cached);
      }
      const items = await listPublishedOpportunities({
        originAirport: parsed.data.origin,
        maxPrice: parsed.data.budget_max,
        region: regionFilter,
        limit: Math.max(parsed.data.limit * 6, 120)
      });
      const destinations = toExploreDestinations(items, parsed.data.limit);
      const resolvedDestinations = destinations.length > 0
        ? destinations
        : toFallbackExploreDestinations({
            origin: parsed.data.origin,
            region: regionFilter,
            budgetMax: parsed.data.budget_max,
            limit: parsed.data.limit
          });
      const payload = { origin: parsed.data.origin, budget_max: parsed.data.budget_max, region: regionFilter || 'all', items: resolvedDestinations };
      await writeCachedJson(cache, cacheKey, exploreCacheTtlSec, payload);
      res.setHeader('Cache-Control', `private, max-age=${exploreCacheTtlSec}`);
      return res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get('/explore/map', async (req, res, next) => {
    const parsed = budgetExploreSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const requestedRegion = normalizeExploreRegion(parsed.data.region);
      const regionFilter = requestedRegion && requestedRegion !== 'all' ? requestedRegion : '';
      const version = getOpportunityFeedVersion();
      const fingerprint = sortedQueryFingerprint({ ...parsed.data, region: regionFilter });
      const cacheKey = `opps:explore:map:${EXPLORE_CACHE_SCHEMA_VERSION}:v${version}:${fingerprint}`;
      const cached = await readCachedJson(cache, cacheKey);
      if (cached) {
        res.setHeader('Cache-Control', `private, max-age=${exploreCacheTtlSec}`);
        return res.json(cached);
      }
      const items = await listPublishedOpportunities({
        originAirport: parsed.data.origin,
        maxPrice: parsed.data.budget_max,
        region: regionFilter,
        limit: Math.max(parsed.data.limit * 8, 180)
      });
      const originCoords = findOriginCoords(parsed.data.origin);
      const destinations = toExploreDestinations(items, parsed.data.limit);
      const resolvedDestinations = destinations.length > 0
        ? destinations
        : toFallbackExploreDestinations({
            origin: parsed.data.origin,
            region: regionFilter,
            budgetMax: parsed.data.budget_max,
            limit: parsed.data.limit,
            allowMapAnchorFallback: true
          });
      const mapDestinations = toExploreMapDestinations(resolvedDestinations);
      const points = mapDestinations.map((item) => ({
        ...item,
        destination_coords: findCountryCoords(item.destination_country),
        origin_coords: originCoords
      }));
      const payload = {
        origin: parsed.data.origin,
        budget_max: parsed.data.budget_max,
        region: regionFilter || 'all',
        points
      };
      await writeCachedJson(cache, cacheKey, exploreCacheTtlSec, payload);
      res.setHeader('Cache-Control', `private, max-age=${exploreCacheTtlSec}`);
      return res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/pipeline/status',
    authGuard,
    requireSessionAuth,
    adminGuard,
    requireApiScope('read'),
    quotaGuard({ counter: 'read', amount: 1 }),
    async (_req, res, next) => {
    try {
      const status = await getOpportunityPipelineStats();
      return res.json({ status });
    } catch (error) {
      next(error);
    }
    }
  );

  router.post(
    '/pipeline/run',
    authGuard,
    requireSessionAuth,
    adminGuard,
    csrfGuard,
    requireApiScope('alerts'),
    quotaGuard({ counter: 'alerts', amount: 1 }),
    async (_req, res, next) => {
    try {
      const summary = await runOpportunityPipelineOnce();
      return res.json({ ok: true, summary });
    } catch (error) {
      next(error);
    }
    }
  );

  router.get('/radar/preferences', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
    const userId = req.user?.sub || req.user?.id;
    let item = null;
    await withDb(async (db) => {
      const all = Array.isArray(db.radarPreferences) ? db.radarPreferences : [];
      item = all.find((entry) => entry.userId === userId) || null;
      return null;
    });
    return res.json({ item: item || buildDefaultRadarPreference(userId) });
  });

  router.put('/radar/preferences', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    const parsed = radarPreferenceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    const userId = req.user?.sub || req.user?.id;
    const storedUser = await loadUserFromStore(withDb, userId);
    const planUser = storedUser || req.user || null;

    // ── Plan gate: radar configuration requires Pro or Elite ──────────────────
    if (!canConfigureRadar(planUser)) {
      return res.status(402).json({
        error: 'premium_required',
        message: 'Radar is available on the Pro and Elite plans.',
        upgrade_context: getUpgradeContext(planUser, 'radar'),
        request_id: req.id || null
      });
    }

    let item = null;

    await withDb(async (db) => {
      db.radarPreferences = Array.isArray(db.radarPreferences) ? db.radarPreferences : [];
      const hit = db.radarPreferences.find((entry) => entry.userId === userId);
      if (hit) {
        Object.assign(hit, {
          originAirports: parsed.data.originAirports.map((x) => x.toUpperCase()),
          favoriteDestinations: parsed.data.favoriteDestinations,
          favoriteCountries: parsed.data.favoriteCountries,
          budgetCeiling: parsed.data.budgetCeiling ?? null,
          preferredTravelMonths: parsed.data.preferredTravelMonths,
          updatedAt: new Date().toISOString()
        });
        item = hit;
      } else {
        item = {
          ...buildDefaultRadarPreference(userId),
          originAirports: parsed.data.originAirports.map((x) => x.toUpperCase()),
          favoriteDestinations: parsed.data.favoriteDestinations,
          favoriteCountries: parsed.data.favoriteCountries,
          budgetCeiling: parsed.data.budgetCeiling ?? null,
          preferredTravelMonths: parsed.data.preferredTravelMonths,
          updatedAt: new Date().toISOString()
        };
        db.radarPreferences.push(item);
      }
      return db;
    });

    return res.json({ item });
  });

  router.get('/radar/matches', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
    const userId = req.user?.sub || req.user?.id;
    let items = [];
    await withDb(async (db) => {
      const all = Array.isArray(db.radarMatchSnapshots) ? db.radarMatchSnapshots : [];
      items = all
        .filter((entry) => entry.userId === userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 20);
      return null;
    });
    return res.json({ items });
  });

  router.post('/ai/query', rejectAnonymousAiRequest, authGuard, csrfGuard, requireApiScope('search'), quotaGuard({ counter: 'decision', amount: 1 }), async (req, res, next) => {
    const parsed = aiQuerySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const userId = req.user?.sub || req.user?.id;
      let user = null;
      await withDb(async (db) => {
        user = (db.users || []).find((entry) => entry.id === userId) || null;
        return null;
      });
      if (!user) return res.status(404).json({ error: 'User not found.' });
      if (isFreePlan(user)) {
        recordFreeAiBlocked();
        return res.status(403).json({
          ...buildFreeAiBlockedPayload(),
          request_id: req.id || null
        });
      }
      if (!canUseAITravel(user)) {
        return res.status(402).json({
          error: 'premium_required',
          message: 'AI Travel is available on Pro and Elite plans.',
          upgrade_context: getUpgradeContext(user, 'ai_travel'),
          request_id: req.id || null
        });
      }

      const result = await queryOpportunitiesByPrompt({
        prompt: parsed.data.prompt,
        limit: parsed.data.limit
      });
      return res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/follow', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res) => {
    const userId = req.user?.sub || req.user?.id;
    const item = await getOpportunityById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Opportunity not found.' });

    let created = null;
    await withDb(async (db) => {
      db.alertSubscriptions = Array.isArray(db.alertSubscriptions) ? db.alertSubscriptions : [];
      const existing = db.alertSubscriptions.find(
        (sub) =>
          sub.userId === userId &&
          sub.origin === item.origin_airport &&
          sub.destinationIata === item.destination_airport &&
          sub.enabled
      );

      if (existing) {
        created = existing;
        return db;
      }

      const targetPrice = Math.max(30, Math.floor(item.price * 0.95));
      created = {
        id: nanoid(10),
        userId,
        createdAt: new Date().toISOString(),
        enabled: true,
        origin: item.origin_airport,
        region: 'all',
        country: undefined,
        destinationQuery: item.destination_city,
        destinationIata: item.destination_airport,
        targetPrice,
        cheapOnly: false,
        travellers: 1,
        cabinClass: 'economy',
        connectionType: item.stops === 0 ? 'direct' : 'all',
        maxStops: Math.max(0, Number(item.stops || 1)),
        travelTime: 'all',
        minComfortScore: undefined,
        stayDays: item.trip_length_days || 7,
        daysFromNow: 14,
        scanMode: 'price_target'
      };
      db.alertSubscriptions.push(created);
      return db;
    });

    return res.status(201).json({ item: created });
  });

  router.get('/me/follows', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res, next) => {
    try {
      const userId = req.user?.sub || req.user?.id;
      const items = await listUserFollows(userId);
      return res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.post('/follows', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res, next) => {
    const parsed = followEntitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const userId = req.user?.sub || req.user?.id;

      // ── Plan gate: check active follows limit ────────────────────────────────
      const storedUser = await loadUserFromStore(withDb, userId);
      const planUser = storedUser || req.user || null;
      const requestedEntityType = String(parsed.data.entityType || '').trim().toLowerCase();
      const requestedSlug = String(parsed.data.slug || '').trim().toLowerCase();
      const requestedFollowType = String(parsed.data.followType || 'radar').trim().toLowerCase();
      const followsLimit = getFollowsLimit(planUser);
      if (followsLimit !== null) {
        const existingFollows = await listUserFollows(userId);
        // Only count against the limit when creating a NEW follow entry
        const alreadyFollowing = existingFollows.some((f) => {
          const existingEntityType = String(f?.entityType || f?.entity_type || f?.entity?.entity_type || '')
            .trim()
            .toLowerCase();
          const existingSlug = String(f?.slug || f?.entity?.slug || '').trim().toLowerCase();
          const existingFollowType = String(f?.followType || f?.follow_type || 'radar').trim().toLowerCase();
          return (
            existingEntityType === requestedEntityType &&
            existingSlug === requestedSlug &&
            existingFollowType === requestedFollowType
          );
        });
        if (!alreadyFollowing && existingFollows.length >= followsLimit) {
          return res.status(402).json({
            error: 'premium_required',
            message: `You have reached the ${followsLimit}-follow limit on your current plan. Upgrade to follow more destinations.`,
            follows_limit: followsLimit,
            follows_used:  existingFollows.length,
            upgrade_context: getUpgradeContext(planUser, 'follows_limit'),
            request_id: req.id || null
          });
        }
      }

      const item = await createOrUpdateUserFollow({
        userId,
        entityType: parsed.data.entityType,
        slug: parsed.data.slug,
        displayName: parsed.data.displayName || parsed.data.slug,
        followType: parsed.data.followType,
        metadata: parsed.data.metadata || {}
      });
      return res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/follows/:id', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (req, res, next) => {
    try {
      const userId = req.user?.sub || req.user?.id;
      const result = await deleteUserFollow({ userId, followId: req.params.id });
      return res.json({ ok: true, removed: result.removed });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const item = await getOpportunityById(req.params.id);
      if (!item) return res.status(404).json({ error: 'Opportunity not found.' });
      const related = await listRelatedOpportunities(item, 4);
      return res.json({ item, related });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/related', async (req, res, next) => {
    try {
      const item = await getOpportunityById(req.params.id);
      if (!item) return res.status(404).json({ error: 'Opportunity not found.' });
      const related = await listRelatedOpportunities(item, 8);
      return res.json({ items: related });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
