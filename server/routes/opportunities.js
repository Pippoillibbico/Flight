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
import { canUseAITravel, canViewRareOpportunities, canViewUnlimitedOpportunities, resolveUserPlan } from '../lib/plan-access.js';
import { getCacheClient } from '../lib/free-cache.js';

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
});
const clustersQuerySchema = z.object({
  region: z.string().trim().min(2).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(40).optional().default(12)
});
const followEntitySchema = z.object({
  entityType: z.enum(['city', 'country', 'region', 'airport', 'budget_bucket', 'season', 'theme', 'destination_cluster']),
  slug: z.string().trim().min(2).max(80),
  displayName: z.string().trim().min(2).max(120).optional(),
  followType: z.enum(['radar', 'destination', 'theme']).optional().default('radar'),
  metadata: z.record(z.any()).optional().default({})
});

const radarPreferenceSchema = z.object({
  originAirports: z.array(z.string().trim().length(3)).max(8).default([]),
  favoriteDestinations: z.array(z.string().trim().min(2).max(60)).max(12).default([]),
  favoriteCountries: z.array(z.string().trim().min(2).max(60)).max(12).default([]),
  budgetCeiling: z.coerce.number().positive().max(20000).nullable().optional(),
  preferredTravelMonths: z.array(z.number().int().min(1).max(12)).max(12).default([])
});

const aiQuerySchema = z.object({
  prompt: z.string().trim().min(4).max(500),
  limit: z.coerce.number().int().min(1).max(30).optional().default(12)
});

const budgetExploreSchema = z.object({
  origin: z.string().trim().length(3),
  budget_max: z.coerce.number().positive(),
  limit: z.coerce.number().int().min(1).max(80).optional().default(20)
});

const OPPORTUNITY_FEED_SOURCE = 'travel_opportunities';

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
  return ORIGIN_COORDS[key] || null;
}

function findCountryCoords(countryName) {
  const key = String(countryName || '').trim().toLowerCase();
  if (!key) return null;
  return countryCoords.get(key) || null;
}

export function buildOpportunitiesRouter({ authGuard, csrfGuard, requireApiScope, quotaGuard, withDb, optionalAuth }) {
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
        limit: parsed.data.limit
      });

      const auth = typeof optionalAuth === 'function' ? optionalAuth(req) : null;
      let user = null;
      if (auth?.sub) {
        await withDb(async (db) => {
          user = (db.users || []).find((entry) => entry.id === auth.sub) || null;
          return null;
        });
      }

      if (!user) {
        return res.json({ source: OPPORTUNITY_FEED_SOURCE, items: sourceItems });
      }

      const plan = resolveUserPlan(user);
      const allowRare = canViewRareOpportunities(user);
      const filtered = allowRare ? sourceItems : sourceItems.filter((item) => String(item.opportunity_level || '').trim() !== 'Rare opportunity');
      const isUnlimited = canViewUnlimitedOpportunities(user);
      const cappedItems = isUnlimited ? filtered : filtered.slice(0, 3);
      const visibleCount = cappedItems.length;
      const totalCount = filtered.length;
      const showUpgradePrompt = !isUnlimited && totalCount > visibleCount;

      return res.json({
        source: OPPORTUNITY_FEED_SOURCE,
        items: cappedItems,
        access: {
          planType: plan.planType,
          planStatus: plan.planStatus,
          isUnlimited,
          allowRare,
          dailyLimit: isUnlimited ? null : 3,
          visibleCount,
          totalCount,
          showUpgradePrompt,
          upgradeMessageKey: showUpgradePrompt ? 'upgradePromptUnlockAll' : null
        }
      });
    } catch (error) {
      next(error);
    }
  };

  router.get('/', handleFeed);
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
      const version = getOpportunityFeedVersion();
      const fingerprint = sortedQueryFingerprint(parsed.data);
      const cacheKey = `opps:explore:budget:v${version}:${fingerprint}`;
      const cached = await readCachedJson(cache, cacheKey);
      if (cached) {
        res.setHeader('Cache-Control', `private, max-age=${exploreCacheTtlSec}`);
        return res.json(cached);
      }
      const items = await listPublishedOpportunities({
        originAirport: parsed.data.origin,
        maxPrice: parsed.data.budget_max,
        limit: Math.max(parsed.data.limit * 6, 120)
      });
      const destinations = toExploreDestinations(items, parsed.data.limit);
      const payload = { origin: parsed.data.origin, budget_max: parsed.data.budget_max, items: destinations };
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
      const version = getOpportunityFeedVersion();
      const fingerprint = sortedQueryFingerprint(parsed.data);
      const cacheKey = `opps:explore:map:v${version}:${fingerprint}`;
      const cached = await readCachedJson(cache, cacheKey);
      if (cached) {
        res.setHeader('Cache-Control', `private, max-age=${exploreCacheTtlSec}`);
        return res.json(cached);
      }
      const items = await listPublishedOpportunities({
        originAirport: parsed.data.origin,
        maxPrice: parsed.data.budget_max,
        limit: Math.max(parsed.data.limit * 8, 180)
      });
      const originCoords = findOriginCoords(parsed.data.origin);
      const points = toExploreDestinations(items, parsed.data.limit).map((item) => ({
        ...item,
        destination_coords: findCountryCoords(item.destination_country),
        origin_coords: originCoords
      }));
      const payload = {
        origin: parsed.data.origin,
        budget_max: parsed.data.budget_max,
        points
      };
      await writeCachedJson(cache, cacheKey, exploreCacheTtlSec, payload);
      res.setHeader('Cache-Control', `private, max-age=${exploreCacheTtlSec}`);
      return res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get('/pipeline/status', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (_req, res, next) => {
    try {
      const status = await getOpportunityPipelineStats();
      return res.json({ status });
    } catch (error) {
      next(error);
    }
  });

  router.post('/pipeline/run', authGuard, csrfGuard, requireApiScope('alerts'), quotaGuard({ counter: 'alerts', amount: 1 }), async (_req, res, next) => {
    try {
      const summary = await runOpportunityPipelineOnce();
      return res.json({ ok: true, summary });
    } catch (error) {
      next(error);
    }
  });

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

  router.get('/me/radar', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
    const userId = req.user?.sub || req.user?.id;
    let item = null;
    await withDb(async (db) => {
      const all = Array.isArray(db.radarPreferences) ? db.radarPreferences : [];
      item = all.find((entry) => entry.userId === userId) || null;
      return null;
    });
    return res.json({ item: item || buildDefaultRadarPreference(userId) });
  });

  router.post('/ai/query', authGuard, csrfGuard, requireApiScope('search'), quotaGuard({ counter: 'decision', amount: 1 }), async (req, res, next) => {
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
      if (!canUseAITravel(user)) return res.status(402).json({ error: 'premium_required', message: 'AI Travel disponibile su ELITE.' });

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
