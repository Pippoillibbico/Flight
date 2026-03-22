import express from 'express';
import { addDays, format } from 'date-fns';
import countries from 'world-countries';
import { z } from 'zod';
import { runDiscoveryJustGo } from '../lib/discovery-engine.js';
import { findCheapestDestinations, findPriceDrops, findUnderratedRoutes } from '../lib/destination-discovery-engine.js';
import {
  createDiscoverySubscription,
  deleteDiscoverySubscription,
  getRouteBaselinePercentiles,
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

const MOODS = ['relax', 'adventure', 'culture', 'nature', 'nightlife'];
const REGIONS = ['all', 'eu', 'asia', 'america', 'oceania'];
const CABIN_CLASSES = ['economy', 'premium', 'business'];
const CLIMATE_PREFS = ['warm', 'cold', 'mild', 'indifferent'];
const DEFAULT_ORIGIN_IATA = String(process.env.DEFAULT_DISCOVERY_ORIGIN || 'FCO')
  .trim()
  .toUpperCase();
const FEED_CACHE_TTL_SEC = Math.max(10, Math.min(900, Number(process.env.DISCOVERY_API_CACHE_TTL_SEC || 75)));
const FEED_VERSION_CACHE_TTL_SEC = Math.max(5, Math.min(120, Number(process.env.DISCOVERY_FEED_VERSION_CACHE_TTL_SEC || 20)));

const KNOWN_ORIGIN_COORDS = {
  FCO: { lat: 41.8003, lng: 12.2389 },
  MXP: { lat: 45.6301, lng: 8.7231 },
  BLQ: { lat: 44.5354, lng: 11.2887 },
  VCE: { lat: 45.5053, lng: 12.3519 },
  NAP: { lat: 40.886, lng: 14.2908 },
  LIN: { lat: 45.4451, lng: 9.2767 }
};

const countryCoords = new Map();
for (const country of countries || []) {
  const latlng = Array.isArray(country?.latlng) ? country.latlng : [];
  const lat = Number(latlng[0]);
  const lng = Number(latlng[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  const keys = [country?.name?.common, country?.name?.official, country?.cca2, country?.cca3]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  for (const key of keys) {
    if (!countryCoords.has(key)) {
      countryCoords.set(key, { lat, lng });
    }
  }
}

const iataSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Invalid IATA code.');
const isoDateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Expected YYYY-MM-DD.');
const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Invalid currency. Expected ISO code.');

const discoverySchema = z.object({
  origin: iataSchema,
  budget: z.number().positive(),
  mood: z.enum(MOODS).default('relax'),
  region: z.enum(REGIONS).default('all'),
  dateFrom: isoDateSchema,
  dateTo: isoDateSchema
});

const discoverySubSchema = z.object({
  origin: iataSchema,
  budget: z.number().positive(),
  mood: z.enum(MOODS).default('relax'),
  region: z.enum(REGIONS).default('all'),
  dateFrom: isoDateSchema,
  dateTo: isoDateSchema,
  enabled: z.boolean().optional().default(true)
});

const smartOriginSchema = z.object({
  origin: iataSchema,
  limit: z.coerce.number().int().min(1).max(50).optional().default(12)
});

const smartCheapestSchema = z.object({
  origin: iataSchema,
  month: z.string().trim().regex(/^\d{4}-\d{2}$/),
  limit: z.coerce.number().int().min(1).max(50).optional().default(12)
});

const discoveryFeedQuerySchema = z.object({
  origin: iataSchema.optional(),
  max_price: z.coerce.number().positive().optional(),
  budget_max: z.coerce.number().positive().optional(),
  limit: z.coerce.number().int().min(1).max(60).optional().default(16)
});

const whereCanIGoQuerySchema = z
  .object({
    origin: iataSchema.optional(),
    budget: z.coerce.number().positive().optional(),
    budget_max: z.coerce.number().positive().optional(),
    period_from: isoDateSchema.optional(),
    period_to: isoDateSchema.optional(),
    dateFrom: isoDateSchema.optional(),
    dateTo: isoDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(120).optional().default(24)
  })
  .superRefine((value, ctx) => {
    const budget = Number(value.budget ?? value.budget_max);
    if (!Number.isFinite(budget) || budget <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['budget'], message: 'budget is required and must be > 0.' });
    }
    const fromDate = value.period_from || value.dateFrom || null;
    const toDate = value.period_to || value.dateTo || null;
    if (fromDate && toDate && toDate < fromDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['period_to'], message: 'period_to must be >= period_from.' });
    }
  });

const trendingQuerySchema = z.object({
  origin: iataSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});

const worldMapQuerySchema = z
  .object({
    origin: iataSchema.optional(),
    budget: z.coerce.number().positive().optional(),
    budget_max: z.coerce.number().positive().optional(),
    period_from: isoDateSchema.optional(),
    period_to: isoDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(120).optional().default(40)
  })
  .superRefine((value, ctx) => {
    if (value.period_from && value.period_to && value.period_to < value.period_from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['period_to'], message: 'period_to must be >= period_from.' });
    }
  });

const smartCalendarQuerySchema = z
  .object({
    origin: iataSchema,
    destination: iataSchema,
    date_from: isoDateSchema.optional(),
    date_to: isoDateSchema.optional(),
    limit: z.coerce.number().int().min(5).max(120).optional().default(45)
  })
  .superRefine((value, ctx) => {
    if (value.date_from && value.date_to && value.date_to < value.date_from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['date_to'], message: 'date_to must be >= date_from.' });
    }
  });

const predictionQuerySchema = z.object({
  origin: iataSchema,
  destination: iataSchema,
  departure_date: isoDateSchema,
  current_price: z.coerce.number().positive().optional()
});

const errorFareQuerySchema = z.object({
  origin: iataSchema.optional(),
  limit: z.coerce.number().int().min(1).max(80).optional().default(20)
});

const viralDealsQuerySchema = z.object({
  origin: iataSchema.optional(),
  limit: z.coerce.number().int().min(1).max(40).optional().default(12)
});

const travelInspirationSchema = z.object({
  budget: z.coerce.number().positive(),
  climate: z.enum(CLIMATE_PREFS).optional().default('indifferent'),
  duration: z.coerce.number().int().min(2).max(30).optional().default(6),
  origin: iataSchema.optional(),
  period_from: isoDateSchema.optional(),
  travellers: z.coerce.number().int().min(1).max(6).optional().default(1),
  cabin_class: z.enum(CABIN_CLASSES).optional().default('economy'),
  region: z.enum(REGIONS).optional().default('all')
});

const autoTripSchema = z
  .object({
    budget: z.coerce.number().positive(),
    period_from: isoDateSchema,
    period_to: isoDateSchema.optional(),
    duration: z.coerce.number().int().min(2).max(30),
    origin: iataSchema.optional(),
    travellers: z.coerce.number().int().min(1).max(6).optional().default(1),
    cabin_class: z.enum(CABIN_CLASSES).optional().default('economy'),
    climate: z.enum(CLIMATE_PREFS).optional().default('indifferent')
  })
  .superRefine((value, ctx) => {
    if (value.period_to && value.period_to < value.period_from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['period_to'], message: 'period_to must be >= period_from.' });
    }
  });

const channelsSchema = z
  .object({
    push: z.boolean().optional(),
    email: z.boolean().optional(),
    in_app: z.boolean().optional(),
    inApp: z.boolean().optional()
  })
  .strict();

const priceDropAlertCreateSchema = z
  .object({
    originIata: iataSchema,
    destinationIata: iataSchema,
    dateFrom: isoDateSchema,
    dateTo: isoDateSchema,
    marginPct: z.coerce.number().min(0).max(80).optional().default(0),
    maxPrice: z.coerce.number().positive().optional(),
    currency: currencySchema.optional(),
    enabled: z.boolean().optional(),
    channels: channelsSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.dateTo < value.dateFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dateTo'], message: 'dateTo must be >= dateFrom.' });
    }
    if (value.originIata === value.destinationIata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destinationIata'],
        message: 'destinationIata must be different from originIata.'
      });
    }
  });

const priceDropAlertUpdateSchema = z
  .object({
    originIata: iataSchema.optional(),
    destinationIata: iataSchema.optional(),
    dateFrom: isoDateSchema.optional(),
    dateTo: isoDateSchema.optional(),
    maxPrice: z.coerce.number().positive().optional(),
    currency: currencySchema.optional(),
    enabled: z.boolean().optional(),
    channels: channelsSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one field is required for update.' });
    }
    if (value.dateFrom && value.dateTo && value.dateTo < value.dateFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dateTo'], message: 'dateTo must be >= dateFrom.' });
    }
    if (value.originIata && value.destinationIata && value.originIata === value.destinationIata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destinationIata'],
        message: 'destinationIata must be different from originIata.'
      });
    }
  });

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function round2(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeIataOrNull(value) {
  const out = String(value || '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(out) ? out : null;
}

function sortedQueryFingerprint(input = {}) {
  const entries = Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, String(value)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

function startOfTodayIso() {
  const now = new Date();
  const normalized = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return normalized.toISOString().slice(0, 10);
}

function monthBounds(dateText) {
  const safeDate = String(dateText || '').slice(0, 10);
  const year = Number(safeDate.slice(0, 4));
  const month = Number(safeDate.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const start = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  const end = `${String(endDate.getUTCFullYear()).padStart(4, '0')}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-${String(
    endDate.getUTCDate()
  ).padStart(2, '0')}`;
  return { start, end };
}

function collectFeedItems(feed) {
  const buckets = [
    ...(Array.isArray(feed?.queries?.top_offers) ? [feed.queries.top_offers] : []),
    ...(Array.isArray(feed?.queries?.recent_offers) ? [feed.queries.recent_offers] : []),
    ...(Array.isArray(feed?.queries?.popular_offers) ? [feed.queries.popular_offers] : []),
    ...(Array.isArray(feed?.categories?.cheap_flights) ? [feed.categories.cheap_flights] : []),
    ...(Array.isArray(feed?.categories?.weekend_flights) ? [feed.categories.weekend_flights] : []),
    ...(Array.isArray(feed?.categories?.last_minute_flights) ? [feed.categories.last_minute_flights] : []),
    ...(Array.isArray(feed?.categories?.long_haul_discounted) ? [feed.categories.long_haul_discounted] : [])
  ];
  return buckets.flat();
}

function fallbackCoordsFromSeed(seed) {
  const text = String(seed || '').trim().toUpperCase() || 'UNK';
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  const lat = ((hash % 1500) / 10) - 75;
  const lng = ((Math.floor(hash / 1500) % 3600) / 10) - 180;
  return { lat: round2(lat), lng: round2(lng) };
}

function destinationCoords(destinationCountry, destinationIata) {
  const countryKey = String(destinationCountry || '').trim().toLowerCase();
  if (countryKey && countryCoords.has(countryKey)) return countryCoords.get(countryKey);
  return fallbackCoordsFromSeed(destinationIata);
}

function originCoords(iata) {
  const key = normalizeIataOrNull(iata);
  if (key && KNOWN_ORIGIN_COORDS[key]) return KNOWN_ORIGIN_COORDS[key];
  return fallbackCoordsFromSeed(iata);
}

function buildDestinationRollup(feedItems, { maxBudget = null, periodFrom = null, periodTo = null, limit = 24 } = {}) {
  const fromDate = periodFrom ? String(periodFrom).slice(0, 10) : null;
  const toDate = periodTo ? String(periodTo).slice(0, 10) : null;
  const safeBudget = Number.isFinite(Number(maxBudget)) ? Number(maxBudget) : null;
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 24));

  const map = new Map();
  for (const item of feedItems || []) {
    const destinationIata = normalizeIataOrNull(item.destination_iata);
    if (!destinationIata) continue;
    const price = toNumber(item.price, NaN);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (safeBudget != null && price > safeBudget) continue;

    const departDate = String(item.depart_date || '').slice(0, 10);
    if (fromDate && departDate && departDate < fromDate) continue;
    if (toDate && departDate && departDate > toDate) continue;

    const existing = map.get(destinationIata);
    if (!existing) {
      map.set(destinationIata, {
        destination_iata: destinationIata,
        destination_city: item.destination_city || destinationIata,
        destination_country: item.destination_country || null,
        origin_iata: normalizeIataOrNull(item.origin_iata),
        min_price: round2(price),
        currency: String(item.currency || 'EUR').toUpperCase(),
        trip_type: String(item.trip_type || 'round_trip'),
        depart_date: departDate || null,
        return_date: item.return_date ? String(item.return_date).slice(0, 10) : null,
        stops: Number.isFinite(Number(item.stops)) ? Number(item.stops) : null,
        airline: item.provider || item.airline || null,
        savings_pct: round2(item.savings_pct),
        deal_count: 1,
        top_score: round2(item.final_score),
        source_observed_at: item.source_observed_at || null
      });
      continue;
    }

    existing.deal_count += 1;
    existing.top_score = Math.max(existing.top_score, round2(item.final_score));
    existing.savings_pct = Math.max(existing.savings_pct, round2(item.savings_pct));
    if (existing.source_observed_at && item.source_observed_at) {
      if (String(item.source_observed_at) > String(existing.source_observed_at)) {
        existing.source_observed_at = item.source_observed_at;
      }
    } else if (!existing.source_observed_at) {
      existing.source_observed_at = item.source_observed_at || null;
    }

    if (price < existing.min_price) {
      existing.min_price = round2(price);
      existing.trip_type = String(item.trip_type || existing.trip_type || 'round_trip');
      existing.depart_date = departDate || existing.depart_date;
      existing.return_date = item.return_date ? String(item.return_date).slice(0, 10) : existing.return_date;
      existing.stops = Number.isFinite(Number(item.stops)) ? Number(item.stops) : existing.stops;
      existing.airline = item.provider || item.airline || existing.airline;
      existing.origin_iata = normalizeIataOrNull(item.origin_iata) || existing.origin_iata;
      existing.currency = String(item.currency || existing.currency || 'EUR').toUpperCase();
    }
  }

  return [...map.values()]
    .sort((a, b) => a.min_price - b.min_price || b.deal_count - a.deal_count || b.top_score - a.top_score)
    .slice(0, safeLimit);
}

function buildSmartCalendarPayload(rows, { dateFrom = null, dateTo = null, limit = 45 } = {}) {
  const safeFrom = dateFrom ? String(dateFrom).slice(0, 10) : null;
  const safeTo = dateTo ? String(dateTo).slice(0, 10) : null;
  const safeLimit = Math.max(5, Math.min(365, Number(limit) || 45));
  const grouped = new Map();

  for (const row of rows || []) {
    const departure = String(row.departure_date || '').slice(0, 10);
    if (!departure) continue;
    if (safeFrom && departure < safeFrom) continue;
    if (safeTo && departure > safeTo) continue;
    const price = toNumber(row.total_price, NaN);
    if (!Number.isFinite(price) || price <= 0) continue;

    const hit = grouped.get(departure);
    if (!hit) {
      grouped.set(departure, {
        date: departure,
        min_price: round2(price),
        avg_price: round2(price),
        observations: 1
      });
      continue;
    }

    hit.observations += 1;
    hit.min_price = Math.min(hit.min_price, round2(price));
    hit.avg_price = round2((hit.avg_price * (hit.observations - 1) + price) / hit.observations);
  }

  const days = [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, safeLimit);
  const bestDays = [...days].sort((a, b) => a.min_price - b.min_price || b.observations - a.observations).slice(0, 10);
  const cheapest = bestDays[0] || null;
  return {
    days,
    best_days: bestDays,
    summary: {
      days_count: days.length,
      cheapest_day: cheapest?.date || null,
      cheapest_price: cheapest?.min_price ?? null
    }
  };
}

function estimateHotelNightly({ destinationIata, climate, duration, budget }) {
  const seed = String(destinationIata || 'UNK').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const base = 65 + (seed % 45);
  const climateFactor = climate === 'warm' ? 1.07 : climate === 'cold' ? 0.94 : climate === 'mild' ? 1 : 0.98;
  const tripFactor = duration >= 10 ? 0.92 : duration <= 4 ? 1.08 : 1;
  const budgetFactor = budget > 1800 ? 1.18 : budget < 600 ? 0.78 : 1;
  const nightly = round2(base * climateFactor * tripFactor * budgetFactor);
  return clamp(nightly, 35, 300);
}

function buildShareText(item, rank = 1) {
  const destination = item.destination_city || item.destination_iata || 'destination';
  const origin = item.origin_iata || 'origin';
  const savings = Math.round(toNumber(item.savings_pct, 0));
  const price = Math.round(toNumber(item.price || item.min_price, 0));
  const routeTag = `#${String(item.destination_iata || destination).toLowerCase()}`;
  return {
    title: `${rank}. ${origin} -> ${destination} from EUR ${price}`,
    caption: `${savings}% below baseline. Bookable price, limited inventory.`,
    hashtags: ['#flightdeals', '#travel', '#budgettravel', routeTag],
    share_text: `${origin} -> ${destination} from EUR ${price} (${savings}% under baseline). ${routeTag} #flightdeals`
  };
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

async function resolveTargetPriceFromBaseline({ originIata, destinationIata, dateFrom, marginPct = 0, explicitMaxPrice = null }) {
  const explicit = toNumber(explicitMaxPrice, NaN);
  if (Number.isFinite(explicit) && explicit > 0) {
    return {
      targetPrice: round2(explicit),
      baselineMedian: null,
      source: 'explicit'
    };
  }

  const month = `${String(dateFrom).slice(0, 7)}-01`;
  const baseline = await getRouteBaselinePercentiles({
    originIata,
    destinationIata,
    travelMonth: month
  });
  const p50 = toNumber(baseline?.p50_price, NaN);
  if (!Number.isFinite(p50) || p50 <= 0) return null;
  const margin = clamp(toNumber(marginPct, 0), 0, 80);
  const targetPrice = round2(Math.max(20, p50 * (1 - margin / 100)));
  return {
    targetPrice,
    baselineMedian: round2(p50),
    source: 'baseline'
  };
}

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

  router.get('/feed', async (req, res, next) => {
    const parsed = discoveryFeedQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    try {
      const maxPrice = parsed.data.max_price ?? parsed.data.budget_max ?? null;
      const payload = await getFeedCached({
        origin: parsed.data.origin,
        maxPrice,
        limit: parsed.data.limit,
        scope: 'feed'
      });
      res.setHeader('Cache-Control', `private, max-age=${FEED_CACHE_TTL_SEC}`);
      return res.json(payload);
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

  router.get('/smart-price-calendar', async (req, res, next) => {
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

  router.get('/price-prediction', async (req, res, next) => {
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
      return res.status(500).json({ error: error?.message || 'Failed to list price drop alerts.' });
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
      return res.status(500).json({ error: error?.message || 'Failed to create price drop alert.' });
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
      return res.status(500).json({ error: error?.message || 'Failed to update price drop alert.' });
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
      return res.status(500).json({ error: error?.message || 'Failed to delete price drop alert.' });
    }
  });

  router.post('/price-drop-alerts/scan', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'notifications', amount: 1 }), async (_req, res) => {
    try {
      const result = await runPriceAlertsScanOnce({ limit: 500 });
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'Failed to scan price drop alerts.' });
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
