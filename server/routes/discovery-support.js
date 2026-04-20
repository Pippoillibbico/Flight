import countries from 'world-countries';
import { z } from 'zod';
import { getRouteBaselinePercentiles } from '../lib/deal-engine-store.js';

const MOODS = ['relax', 'adventure', 'culture', 'nature', 'nightlife'];
const REGIONS = ['all', 'eu', 'asia', 'america', 'oceania'];
const CABIN_CLASSES = ['economy', 'premium', 'business'];
const CLIMATE_PREFS = ['warm', 'cold', 'mild', 'indifferent'];
const DEFAULT_ORIGIN_IATA = String(process.env.DEFAULT_DISCOVERY_ORIGIN || 'FCO')
  .trim()
  .toUpperCase();
const FEED_CACHE_TTL_SEC = Math.max(10, Math.min(900, Number(process.env.DISCOVERY_API_CACHE_TTL_SEC || 75)));
const FEED_VERSION_CACHE_TTL_SEC = Math.max(5, Math.min(120, Number(process.env.DISCOVERY_FEED_VERSION_CACHE_TTL_SEC || 20)));
const OPPORTUNITIES_FEED_CACHE_TTL = 300; // 5 min - heuristic is cheap to recompute

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
}).strict();

const discoverySubSchema = z.object({
  origin: iataSchema,
  budget: z.number().positive(),
  mood: z.enum(MOODS).default('relax'),
  region: z.enum(REGIONS).default('all'),
  dateFrom: isoDateSchema,
  dateTo: isoDateSchema,
  enabled: z.boolean().optional().default(true)
}).strict();

const smartOriginSchema = z.object({
  origin: iataSchema,
  limit: z.coerce.number().int().min(1).max(50).optional().default(12)
}).strict();

const smartCheapestSchema = z.object({
  origin: iataSchema,
  month: z.string().trim().regex(/^\d{4}-\d{2}$/),
  limit: z.coerce.number().int().min(1).max(50).optional().default(12)
}).strict();

const discoveryFeedQuerySchema = z.object({
  origin: iataSchema.optional(),
  max_price: z.coerce.number().positive().optional(),
  budget_max: z.coerce.number().positive().optional(),
  limit: z.coerce.number().int().min(1).max(60).optional().default(16)
}).strict();

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
  .strict()
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
}).strict();

const worldMapQuerySchema = z
  .object({
    origin: iataSchema.optional(),
    budget: z.coerce.number().positive().optional(),
    budget_max: z.coerce.number().positive().optional(),
    period_from: isoDateSchema.optional(),
    period_to: isoDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(120).optional().default(40)
  })
  .strict()
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
  .strict()
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
}).strict();

const errorFareQuerySchema = z.object({
  origin: iataSchema.optional(),
  limit: z.coerce.number().int().min(1).max(80).optional().default(20)
}).strict();

const viralDealsQuerySchema = z.object({
  origin: iataSchema.optional(),
  limit: z.coerce.number().int().min(1).max(40).optional().default(12)
}).strict();

const travelInspirationSchema = z.object({
  budget: z.coerce.number().positive(),
  climate: z.enum(CLIMATE_PREFS).optional().default('indifferent'),
  duration: z.coerce.number().int().min(2).max(30).optional().default(6),
  origin: iataSchema.optional(),
  period_from: isoDateSchema.optional(),
  travellers: z.coerce.number().int().min(1).max(6).optional().default(1),
  cabin_class: z.enum(CABIN_CLASSES).optional().default('economy'),
  region: z.enum(REGIONS).optional().default('all')
}).strict();

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
  .strict()
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
  .strict()
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

const opportunitiesFeedQuerySchema = z.object({
  origin: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  limit: z.coerce.number().int().min(1).max(40).optional().default(24)
}).strict();

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

function countFeedItems(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  const queries = payload.queries || {};
  const cats = payload.categories || {};
  return [
    ...(queries.top_offers || []),
    ...(queries.recent_offers || []),
    ...(queries.popular_offers || []),
    ...(cats.cheap_flights || []),
    ...(cats.weekend_flights || []),
    ...(cats.last_minute_flights || []),
    ...(cats.long_haul_discounted || [])
  ].length;
}

export {
  DEFAULT_ORIGIN_IATA,
  FEED_CACHE_TTL_SEC,
  FEED_VERSION_CACHE_TTL_SEC,
  OPPORTUNITIES_FEED_CACHE_TTL,
  autoTripSchema,
  buildDestinationRollup,
  buildShareText,
  buildSmartCalendarPayload,
  clamp,
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
};
