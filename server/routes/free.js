import express from 'express';
import { z } from 'zod';
import { listPublishedOpportunities } from '../lib/opportunity-store.js';
import { PLAN_LIMITS } from '../lib/plan-access.js';
import {
  recordFreeCacheHit,
  recordFreeProviderCallBlocked,
  recordUpgradePromptShown
} from '../lib/free-cost-metrics.js';

const iataQuerySchema = z
  .object({
    from: z.string().trim().regex(/^[A-Za-z]{3}$/),
    to: z.string().trim().regex(/^[A-Za-z]{3}$/)
  })
  .strict();

const publicDealsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(10).optional().default(10)
  })
  .strict();

const DEMO_PUBLIC_DEALS = [
  {
    id: 'demo-free-rom-tyo',
    origin_airport: 'ROM',
    destination_airport: 'TYO',
    destination_city: 'Tokyo',
    price: 590,
    currency: 'EUR',
    savingPercent: 18,
    confidence: 'demo',
    message: 'Demo snapshot based on previously observed public deal patterns.'
  },
  {
    id: 'demo-free-mil-lis',
    origin_airport: 'MIL',
    destination_airport: 'LIS',
    destination_city: 'Lisbon',
    price: 78,
    currency: 'EUR',
    savingPercent: 22,
    confidence: 'demo',
    message: 'Demo snapshot based on previously observed public deal patterns.'
  }
];

function readTimestamp(item) {
  const raw = item?.source_observed_at || item?.observed_at || item?.updated_at || item?.published_at || item?.created_at;
  const ts = raw ? Date.parse(String(raw)) : NaN;
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function readNumber(item, keys) {
  for (const key of keys) {
    const value = Number(item?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function calculateSavingPercent(item) {
  const explicit = Number(item?.savingPercent ?? item?.saving_percent ?? item?.savings_percent_if_available);
  if (Number.isFinite(explicit)) return Math.round(explicit);
  const price = readNumber(item, ['price', 'min_price', 'totalPrice']);
  const baseline = readNumber(item, ['baseline_price', 'baselinePrice', 'avg_price', 'average_price']);
  if (!price || !baseline) return 0;
  return Math.max(0, Math.round(((baseline - price) / baseline) * 100));
}

function toFreePublicDeal(item) {
  return {
    id: String(item?.id || ''),
    origin: String(item?.origin_airport || item?.origin || '').toUpperCase(),
    destination: String(item?.destination_airport || item?.destination || '').toUpperCase(),
    destinationCity: String(item?.destination_city || item?.destinationCity || ''),
    price: readNumber(item, ['price', 'min_price', 'totalPrice']),
    currency: String(item?.currency || 'EUR').toUpperCase(),
    departDate: item?.depart_date || item?.departureDate || null,
    returnDate: item?.return_date || item?.returnDate || null,
    savingPercent: calculateSavingPercent(item),
    lastScannedAt: readTimestamp(item),
    dataSource: 'cached_public_scan'
  };
}

function mostRecentScanIso(items) {
  const timestamps = (items || [])
    .map(readTimestamp)
    .filter(Boolean)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

export function buildBasicRouteInsight(route) {
  if (!route || !route.cachedPrice) {
    return {
      status: 'no_recent_public_data',
      message: 'We do not have recent public cached data for this route yet. Pro unlocks live scans and alerts.',
      dataSource: 'cached_only'
    };
  }

  if (Number(route.savingPercent || 0) >= 20) {
    return {
      status: 'interesting',
      message: 'This route is currently below its recent public baseline.',
      dataSource: 'cached_public_scan'
    };
  }

  return {
    status: 'normal',
    message: 'This route is close to its recent public baseline.',
    dataSource: 'cached_public_scan'
  };
}

export function buildFreeRouter({ listDeals = listPublishedOpportunities } = {}) {
  const router = express.Router();

  router.get('/public-deals', async (req, res, next) => {
    const parsed = publicDealsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });

    try {
      const limit = Math.min(parsed.data.limit, PLAN_LIMITS.free.publicDealsLimit);
      const rows = await listDeals({ limit });
      const items = Array.isArray(rows) ? rows.slice(0, limit).map(toFreePublicDeal) : [];
      const hasDeals = items.length > 0;
      recordFreeCacheHit(hasDeals);

      if (!hasDeals) {
        return res.json({
          items: DEMO_PUBLIC_DEALS.slice(0, limit),
          lastScannedAt: null,
          dataSource: 'demo_snapshot',
          cachedOnly: true,
          aiUsed: false,
          liveProviderUsed: false
        });
      }

      return res.json({
        items,
        lastScannedAt: mostRecentScanIso(rows),
        dataSource: 'cached_public_scan',
        cachedOnly: true,
        aiUsed: false,
        liveProviderUsed: false
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/route-insight', async (req, res, next) => {
    const parsed = iataQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid route.' });

    const from = parsed.data.from.toUpperCase();
    const to = parsed.data.to.toUpperCase();

    try {
      const rows = await listDeals({ originAirport: from, limit: 250 });
      const routeDeal = (Array.isArray(rows) ? rows : []).find(
        (item) => String(item?.destination_airport || item?.destination || '').toUpperCase() === to
      );
      const cachedPrice = readNumber(routeDeal, ['price', 'min_price', 'totalPrice']);
      const savingPercent = calculateSavingPercent(routeDeal);
      const insight = buildBasicRouteInsight(routeDeal ? { cachedPrice, savingPercent } : null);
      recordFreeCacheHit(Boolean(routeDeal && cachedPrice));

      return res.json({
        from,
        to,
        cachedPrice,
        savingPercent: routeDeal ? savingPercent : null,
        lastScannedAt: routeDeal ? readTimestamp(routeDeal) : null,
        ...insight
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/radar/refresh', (_req, res) => {
    recordFreeProviderCallBlocked();
    recordUpgradePromptShown();
    return res.status(403).json({
      code: 'LIVE_REFRESH_REQUIRES_PRO',
      message: 'Free uses cached public scans. Pro unlocks live scans, AI tools, and route alerts when delivery is enabled.'
    });
  });

  return router;
}
