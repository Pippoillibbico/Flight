import { z } from 'zod';
import { detectDeal } from './deal-detector.js';
import { listPopularRoutesByOrigin } from './price-history-store.js';
import { logger } from './logger.js';

/**
 * @typedef {{ destination: string, avg_price: number, observations: number, deal_score: number, deal_type: string, score: number }} DiscoveryItem
 */

const cheapestSchema = z.object({
  origin: z.string().trim().length(3),
  month: z.string().trim().regex(/^\d{4}-\d{2}$/),
  limit: z.number().int().min(1).max(50).default(12)
});

const routesSchema = z.object({
  origin: z.string().trim().length(3),
  limit: z.number().int().min(1).max(50).default(20)
});

function monthToDate(month) {
  return `${month}-15`;
}

function scoreForDiscovery({ avgPrice, dealScore, observations, underrated = false }) {
  const priceScore = Math.max(0, Math.min(100, 100 - avgPrice / 8));
  const volumePenalty = Math.min(30, Math.max(0, observations / 12));
  const underratedBoost = underrated ? 14 : 0;
  return Math.max(0, Math.min(100, Math.round(priceScore * 0.35 + dealScore * 0.55 - volumePenalty + underratedBoost)));
}

export async function findCheapestDestinations(origin, month, limit = 12) {
  const parsed = cheapestSchema.parse({ origin, month, limit });
  try {
    const rows = await listPopularRoutesByOrigin({ origin: parsed.origin, month: `${parsed.month}-01`, limit: parsed.limit * 3 });
    const scored = [];
    for (const row of rows) {
      const deal = await detectDeal({
        origin: parsed.origin,
        destination: row.destination,
        date: monthToDate(parsed.month),
        price: Number(row.avgPrice)
      });
      scored.push({
        destination: row.destination,
        avg_price: row.avgPrice,
        observations: row.observations,
        deal_score: deal.deal_score,
        deal_type: deal.deal_type,
        score: scoreForDiscovery({
          avgPrice: Number(row.avgPrice),
          dealScore: deal.deal_score,
          observations: row.observations
        })
      });
    }
    return scored.sort((a, b) => b.score - a.score || a.avg_price - b.avg_price).slice(0, parsed.limit);
  } catch (error) {
    logger.error({ err: error, origin: parsed.origin, month: parsed.month }, 'find_cheapest_destinations_failed');
    throw error;
  }
}

/**
 * Finds underexposed routes with good local deal profile.
 * @param {string} origin
 * @param {number=} limit
 * @returns {Promise<DiscoveryItem[]>}
 */
export async function findUnderratedRoutes(origin, limit = 20) {
  const parsed = routesSchema.parse({ origin, limit });
  try {
    const rows = await listPopularRoutesByOrigin({ origin: parsed.origin, limit: parsed.limit * 4 });
    const out = [];
    for (const row of rows) {
      const deal = await detectDeal({
        origin: parsed.origin,
        destination: row.destination,
        date: new Date().toISOString().slice(0, 10),
        price: Number(row.avgPrice)
      });
      if (row.observations > 250) continue;
      out.push({
        destination: row.destination,
        avg_price: row.avgPrice,
        observations: row.observations,
        deal_score: deal.deal_score,
        deal_type: deal.deal_type,
        score: scoreForDiscovery({
          avgPrice: Number(row.avgPrice),
          dealScore: deal.deal_score,
          observations: row.observations,
          underrated: true
        })
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, parsed.limit);
  } catch (error) {
    logger.error({ err: error, origin: parsed.origin }, 'find_underrated_routes_failed');
    throw error;
  }
}

/**
 * Finds strongest price-drop candidates from local historical baseline.
 * @param {string} origin
 * @param {number=} limit
 * @returns {Promise<Array<DiscoveryItem & { price_drop_pct: number }>>}
 */
export async function findPriceDrops(origin, limit = 20) {
  const parsed = routesSchema.parse({ origin, limit });
  try {
    const rows = await listPopularRoutesByOrigin({ origin: parsed.origin, limit: parsed.limit * 4 });
    const out = [];
    for (const row of rows) {
      const deal = await detectDeal({
        origin: parsed.origin,
        destination: row.destination,
        date: new Date().toISOString().slice(0, 10),
        price: Number(row.avgPrice)
      });
      const drop = Math.max(0, -Number(deal.deviation?.percent || 0));
      if (drop < 8) continue;
      out.push({
        destination: row.destination,
        avg_price: row.avgPrice,
        observations: row.observations,
        price_drop_pct: drop,
        deal_score: deal.deal_score,
        deal_type: deal.deal_type,
        score: scoreForDiscovery({
          avgPrice: Number(row.avgPrice),
          dealScore: deal.deal_score,
          observations: row.observations
        })
      });
    }
    return out.sort((a, b) => b.price_drop_pct - a.price_drop_pct || b.score - a.score).slice(0, parsed.limit);
  } catch (error) {
    logger.error({ err: error, origin: parsed.origin }, 'find_price_drops_failed');
    throw error;
  }
}
