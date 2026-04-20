/**
 * live-flight-service.js
 *
 * Intelligent caching layer for real-inventory searches (Duffel via providerRegistry).
 * Goals:
 * - reduce duplicate provider calls
 * - dedupe near-identical requests
 * - keep fallback safe if cache fails
 * - expose basic cache metrics
 */

import { logger } from './logger.js';
import { claimProviderCallBudget } from './provider-cost-guard.js';

const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const CACHE_TTL_SECONDS = Math.max(60, Number(process.env.LIVE_FLIGHT_CACHE_TTL_SECONDS || 1800));
const NEGATIVE_CACHE_TTL_SECONDS = Math.max(30, Number(process.env.LIVE_FLIGHT_NEGATIVE_CACHE_TTL_SECONDS || 300));

// Aggregated search cache (origin + sorted destinations + travel params)
const SEARCH_BUNDLE_TTL_SECONDS = Math.max(60, Number(process.env.LIVE_FLIGHT_SEARCH_BUNDLE_TTL_SECONDS || 120));
const SEARCH_BUNDLE_NEGATIVE_TTL_SECONDS = Math.max(15, Number(process.env.LIVE_FLIGHT_SEARCH_BUNDLE_NEGATIVE_TTL_SECONDS || 90));

const DEST_LIMIT = Math.max(1, Math.min(20, Number(process.env.LIVE_FLIGHT_DESTINATION_LIMIT || (IS_PRODUCTION ? 4 : 8))));

// Demand-based TTL extension for hot routes.
const POPULAR_ROUTE_THRESHOLD = Math.max(2, Number(process.env.LIVE_FLIGHT_POPULAR_ROUTE_THRESHOLD || 6));
const POPULAR_ROUTE_WINDOW_SECONDS = Math.max(60, Number(process.env.LIVE_FLIGHT_POPULAR_ROUTE_WINDOW_SECONDS || 900));
const POPULAR_ROUTE_TTL_MULTIPLIER = Math.max(1, Math.min(3, Number(process.env.LIVE_FLIGHT_POPULAR_ROUTE_TTL_MULTIPLIER || 1.35)));

// Keep very near departures fresher.
const LAST_MINUTE_DAYS = Math.max(1, Number(process.env.LIVE_FLIGHT_LAST_MINUTE_DAYS || 3));
const LAST_MINUTE_CACHE_TTL_SECONDS = Math.max(30, Number(process.env.LIVE_FLIGHT_LAST_MINUTE_CACHE_TTL_SECONDS || 180));

function normalizeIata(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizeCabinClass(value) {
  const raw = String(value || 'economy').trim().toLowerCase();
  if (raw === 'premium' || raw === 'premium_economy') return 'premium';
  if (raw === 'business') return 'business';
  if (raw === 'first') return 'first';
  return 'economy';
}

function normalizeAdults(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(9, Math.round(numeric)));
}

function normalizeSearchInput({ originIata, departureDate, returnDate, adults, cabinClass }) {
  return {
    originIata: normalizeIata(originIata),
    departureDate: normalizeDate(departureDate),
    returnDate: normalizeDate(returnDate) || null,
    adults: normalizeAdults(adults),
    cabinClass: normalizeCabinClass(cabinClass)
  };
}

function normalizeDestinationList(destinations) {
  const out = [];
  const seen = new Set();
  const source = Array.isArray(destinations) ? destinations : [];
  for (const value of source) {
    const iata = normalizeIata(value);
    if (!/^[A-Z]{3}$/.test(iata)) continue;
    if (seen.has(iata)) continue;
    seen.add(iata);
    out.push(iata);
    if (out.length >= DEST_LIMIT) break;
  }
  return out;
}

function buildDestCacheKey({ originIata, destinationIata, departureDate, returnDate, adults, cabinClass }) {
  return [
    'live:offers:v2',
    normalizeIata(originIata),
    normalizeIata(destinationIata),
    normalizeDate(departureDate),
    normalizeDate(returnDate) || 'ow',
    normalizeAdults(adults),
    normalizeCabinClass(cabinClass)
  ].join(':');
}

function buildSearchBundleKey({ originIata, destinations, departureDate, returnDate, adults, cabinClass }) {
  const normalizedDestinations = normalizeDestinationList(destinations).slice().sort();
  return [
    'live:search:v2',
    normalizeIata(originIata),
    normalizeDate(departureDate),
    normalizeDate(returnDate) || 'ow',
    normalizeAdults(adults),
    normalizeCabinClass(cabinClass),
    normalizedDestinations.join(',')
  ].join(':');
}

function parseJson(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function isLastMinuteDeparture(departureDate) {
  if (!departureDate) return false;
  const ms = new Date(departureDate).getTime();
  if (!Number.isFinite(ms)) return false;
  const days = (ms - Date.now()) / 86_400_000;
  return days >= 0 && days <= LAST_MINUTE_DAYS;
}

function resolvePositiveTtl({ isPopularRoute, departureDate }) {
  let ttl = CACHE_TTL_SECONDS;
  if (isPopularRoute) ttl = Math.round(ttl * POPULAR_ROUTE_TTL_MULTIPLIER);
  if (isLastMinuteDeparture(departureDate)) ttl = Math.min(ttl, LAST_MINUTE_CACHE_TTL_SECONDS);
  return Math.max(30, ttl);
}

function createInitialMetrics() {
  return {
    searchRequests: 0,
    searchBundleHits: 0,
    searchBundleMisses: 0,
    searchBundleWrites: 0,
    searchBundleNegativeWrites: 0,
    destCacheHits: 0,
    destCacheMisses: 0,
    destCacheWrites: 0,
    destNegativeWrites: 0,
    inFlightSearchJoined: 0,
    inFlightDestJoined: 0,
    cacheReadErrors: 0,
    cacheWriteErrors: 0,
    providerFailures: 0,
    providerCallsBlockedByBudget: 0,
    budgetReasons: {},
    invalidations: 0,
    invalidatedKeys: 0
  };
}

function bumpReasonMetric(target, reason) {
  const key = String(reason || 'unknown').trim().toLowerCase() || 'unknown';
  target[key] = Number(target[key] || 0) + 1;
}

/**
 * @param {{ providerRegistry: object, cacheClient: object|null }} deps
 */
export function createLiveFlightService({ providerRegistry, cacheClient }) {
  const inFlightByDestKey = new Map();
  const inFlightBySearchKey = new Map();
  const routeDemand = new Map();
  const metrics = createInitialMetrics();

  function routeKey(originIata, destinationIata) {
    return `${normalizeIata(originIata)}-${normalizeIata(destinationIata)}`;
  }

  function registerRouteDemand(originIata, destinationIata) {
    const key = routeKey(originIata, destinationIata);
    const now = Date.now();
    const windowMs = POPULAR_ROUTE_WINDOW_SECONDS * 1000;
    const current = routeDemand.get(key);
    if (!current || now - current.windowStartMs > windowMs) {
      const next = { count: 1, windowStartMs: now };
      routeDemand.set(key, next);
      return next.count;
    }
    const next = { count: current.count + 1, windowStartMs: current.windowStartMs };
    routeDemand.set(key, next);
    return next.count;
  }

  function isPopularRoute(originIata, destinationIata) {
    const key = routeKey(originIata, destinationIata);
    const current = routeDemand.get(key);
    if (!current) return false;
    const windowMs = POPULAR_ROUTE_WINDOW_SECONDS * 1000;
    if (Date.now() - current.windowStartMs > windowMs) return false;
    return current.count >= POPULAR_ROUTE_THRESHOLD;
  }

  async function readCachedValue(key) {
    if (!cacheClient || typeof cacheClient.get !== 'function') return null;
    try {
      return await cacheClient.get(key);
    } catch (error) {
      metrics.cacheReadErrors += 1;
      logger.warn({ err: error?.message || String(error), key }, 'live_flight_cache_read_failed');
      return null;
    }
  }

  async function writeCachedValue(key, ttlSec, value) {
    if (!cacheClient || typeof cacheClient.setex !== 'function') return;
    try {
      await cacheClient.setex(key, Math.max(1, Number(ttlSec) || 1), value);
    } catch (error) {
      metrics.cacheWriteErrors += 1;
      logger.warn({ err: error?.message || String(error), key, ttlSec }, 'live_flight_cache_write_failed');
    }
  }

  async function readCachedOffers(key) {
    const raw = await readCachedValue(key);
    if (!raw) return null;
    const parsed = parseJson(raw);
    return Array.isArray(parsed) ? parsed : null;
  }

  async function readCachedBundle(key) {
    const raw = await readCachedValue(key);
    if (!raw) return null;
    const parsed = parseJson(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.offersByDest || typeof parsed.offersByDest !== 'object') return null;
    return parsed;
  }

  async function fetchOffersForDestination(normalizedParams, { userId = '', allowLiveProviderFetch = true } = {}) {
    const key = buildDestCacheKey(normalizedParams);

    // Request-rate signal used only to adapt TTL, not business logic.
    registerRouteDemand(normalizedParams.originIata, normalizedParams.destinationIata);

    const cached = await readCachedOffers(key);
    if (cached) {
      metrics.destCacheHits += 1;
      return { offers: cached, fromCache: true };
    }
    metrics.destCacheMisses += 1;

    const existing = inFlightByDestKey.get(key);
    if (existing) {
      metrics.inFlightDestJoined += 1;
      return existing;
    }

    const pending = (async () => {
      const secondChance = await readCachedOffers(key);
      if (secondChance) {
        metrics.destCacheHits += 1;
        return { offers: secondChance, fromCache: true };
      }

      if (!allowLiveProviderFetch) {
        return {
          offers: [],
          fromCache: false,
          cacheOnlySkip: true,
          cacheOnlyReason: 'free_plan_cache_only'
        };
      }

      const budgetClaim = await claimProviderCallBudget({
        cacheClient,
        env: process.env,
        userId,
        route: `${normalizedParams.originIata}-${normalizedParams.destinationIata}`,
        plannedCalls: 1
      });
      if (!budgetClaim.allowed) {
        metrics.providerCallsBlockedByBudget += 1;
        bumpReasonMetric(metrics.budgetReasons, budgetClaim.reason);
        logger.warn(
          {
            originIata: normalizedParams.originIata,
            destinationIata: normalizedParams.destinationIata,
            reason: budgetClaim.reason
          },
          'live_flight_provider_call_blocked_by_budget'
        );
        return {
          offers: [],
          fromCache: false,
          budgetBlocked: true,
          budgetReason: budgetClaim.reason || 'provider_budget_blocked'
        };
      }

      const offers = await providerRegistry.searchOffers(normalizedParams);
      const positive = offers.length > 0;
      const ttl = positive
        ? resolvePositiveTtl({
            isPopularRoute: isPopularRoute(normalizedParams.originIata, normalizedParams.destinationIata),
            departureDate: normalizedParams.departureDate
          })
        : NEGATIVE_CACHE_TTL_SECONDS;

      await writeCachedValue(key, ttl, JSON.stringify(offers));
      if (positive) metrics.destCacheWrites += 1;
      else metrics.destNegativeWrites += 1;

      return { offers, fromCache: false };
    })()
      .finally(() => {
        inFlightByDestKey.delete(key);
      })
      .catch((error) => {
        metrics.providerFailures += 1;
        throw error;
      });

    inFlightByDestKey.set(key, pending);
    return pending;
  }

  /**
   * Query live inventory for top destinations.
   * @param {{
   *   originIata: string,
   *   destinations: string[],
   *   departureDate: string,
   *   returnDate: string|null,
   *   adults: number,
   *   cabinClass: string
   * }} params
   */
  async function searchLiveFlights({
    originIata,
    destinations,
    departureDate,
    returnDate,
    adults = 1,
    cabinClass = 'economy',
    userId = '',
    cacheOnly = false
  }) {
    metrics.searchRequests += 1;

    const normalizedSearch = normalizeSearchInput({ originIata, departureDate, returnDate, adults, cabinClass });
    const destinationList = normalizeDestinationList(destinations);

    if (destinationList.length === 0) {
      return {
        offersByDest: {},
        meta: {
          queried: 0,
          cacheHits: 0,
          liveFetches: 0,
          failures: 0,
          bundleCacheHit: false,
          dedupedByInFlight: false
        }
      };
    }

    const bundleKey = buildSearchBundleKey({ ...normalizedSearch, destinations: destinationList });

    const cachedBundle = await readCachedBundle(bundleKey);
    if (cachedBundle) {
      metrics.searchBundleHits += 1;
      logger.info(
        {
          cacheKey: bundleKey,
          originIata: normalizedSearch.originIata,
          destinations: destinationList.length
        },
        'cache_hit'
      );
      const offersByDest = cachedBundle.offersByDest || {};
      const result = {
        offersByDest,
        meta: {
          queried: destinationList.length,
          cacheHits: destinationList.length,
          liveFetches: 0,
          failures: 0,
          bundleCacheHit: true,
          dedupedByInFlight: false,
          cachedAt: cachedBundle.cachedAt || null
        }
      };
      logger.info(
        {
          originIata: normalizedSearch.originIata,
          queried: destinationList.length,
          bundleCacheHit: true,
          liveFetches: 0,
          failures: 0
        },
        'live_flight_search_cache_summary'
      );
      return result;
    }

    metrics.searchBundleMisses += 1;
    logger.info(
      {
        cacheKey: bundleKey,
        originIata: normalizedSearch.originIata,
        destinations: destinationList.length
      },
      'cache_miss'
    );

    const existingSearch = inFlightBySearchKey.get(bundleKey);
    if (existingSearch) {
      metrics.inFlightSearchJoined += 1;
      const joined = await existingSearch;
      return {
        ...joined,
        meta: {
          ...(joined.meta || {}),
          dedupedByInFlight: true
        }
      };
    }

    const pendingSearch = (async () => {
      const secondChanceBundle = await readCachedBundle(bundleKey);
      if (secondChanceBundle) {
        metrics.searchBundleHits += 1;
        return {
          offersByDest: secondChanceBundle.offersByDest || {},
          meta: {
            queried: destinationList.length,
            cacheHits: destinationList.length,
            liveFetches: 0,
            failures: 0,
            bundleCacheHit: true,
            dedupedByInFlight: false,
            cachedAt: secondChanceBundle.cachedAt || null
          }
        };
      }

      const settled = await Promise.allSettled(
        destinationList.map((destinationIata) =>
          fetchOffersForDestination(
            { ...normalizedSearch, destinationIata },
            { userId, allowLiveProviderFetch: !cacheOnly }
          )
        )
      );

      const offersByDest = {};
      let cacheHits = 0;
      let liveFetches = 0;
      let failures = 0;
      let budgetBlocked = 0;
      let cacheOnlySkips = 0;
      const budgetReasons = {};

      for (let index = 0; index < settled.length; index += 1) {
        const destinationIata = destinationList[index];
        const row = settled[index];

        if (row.status === 'rejected') {
          failures += 1;
          continue;
        }

        const payload = row.value || { offers: [], fromCache: false };
        if (payload.cacheOnlySkip) {
          cacheOnlySkips += 1;
        }
        if (payload.budgetBlocked) {
          budgetBlocked += 1;
          bumpReasonMetric(budgetReasons, payload.budgetReason || 'provider_budget_blocked');
        }
        if (payload.fromCache) cacheHits += 1;
        else if (!payload.budgetBlocked) liveFetches += 1;

        const offers = Array.isArray(payload.offers) ? payload.offers : [];
        for (const offer of offers) {
          const offerDest = normalizeIata(offer?.destinationIata || destinationIata);
          const price = Number(offer?.totalPrice);
          if (!/^[A-Z]{3}$/.test(offerDest)) continue;
          if (!Number.isFinite(price) || price <= 0) continue;
          if (!offersByDest[offerDest] || price < Number(offersByDest[offerDest].totalPrice)) {
            offersByDest[offerDest] = offer;
          }
        }
      }

      const positiveBundle = Object.keys(offersByDest).length > 0;
      const bundleTtl = positiveBundle ? SEARCH_BUNDLE_TTL_SECONDS : SEARCH_BUNDLE_NEGATIVE_TTL_SECONDS;
      await writeCachedValue(
        bundleKey,
        bundleTtl,
        JSON.stringify({
          offersByDest,
          cachedAt: new Date().toISOString()
        })
      );

      if (positiveBundle) metrics.searchBundleWrites += 1;
      else metrics.searchBundleNegativeWrites += 1;

      const result = {
        offersByDest,
        meta: {
          queried: destinationList.length,
          cacheHits,
          liveFetches,
          failures,
          budgetBlocked,
          cacheOnlySkips,
          budgetReasons,
          degradedReason:
            Object.keys(offersByDest).length === 0 && failures === 0 && cacheOnlySkips > 0
              ? 'free_plan_cache_only'
              : budgetBlocked > 0 && Object.keys(offersByDest).length === 0 && failures === 0
              ? Object.keys(budgetReasons)[0] || 'provider_budget_blocked'
              : null,
          bundleCacheHit: false,
          dedupedByInFlight: false,
          bundleTtlSec: bundleTtl
        }
      };

      logger.info(
        {
          originIata: normalizedSearch.originIata,
          queried: destinationList.length,
          bundleCacheHit: false,
          cacheHits,
          liveFetches,
          failures,
          budgetBlocked,
          budgetReasons,
          bundleTtlSec: bundleTtl
        },
        'live_flight_search_cache_summary'
      );

      return result;
    })().finally(() => {
      inFlightBySearchKey.delete(bundleKey);
    });

    inFlightBySearchKey.set(bundleKey, pendingSearch);
    return pendingSearch;
  }

  async function invalidateLiveSearchCache({ originIata, destinations, departureDate, returnDate, adults = 1, cabinClass = 'economy' }) {
    if (!cacheClient || typeof cacheClient.del !== 'function') {
      return { deleted: 0, reason: 'cache_del_not_supported' };
    }

    const normalizedSearch = normalizeSearchInput({ originIata, departureDate, returnDate, adults, cabinClass });
    const destinationList = normalizeDestinationList(destinations);

    const keys = [];
    keys.push(buildSearchBundleKey({ ...normalizedSearch, destinations: destinationList }));
    for (const destinationIata of destinationList) {
      keys.push(buildDestCacheKey({ ...normalizedSearch, destinationIata }));
    }

    const settled = await Promise.allSettled(keys.map((key) => cacheClient.del(key)));
    const deleted = settled.reduce((sum, row) => {
      if (row.status !== 'fulfilled') return sum;
      const count = Number(row.value);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);

    metrics.invalidations += 1;
    metrics.invalidatedKeys += deleted;

    logger.info({ deleted, keyCount: keys.length }, 'live_flight_cache_invalidated');
    return { deleted, keyCount: keys.length };
  }

  function getCacheMetrics() {
    return {
      ...metrics,
      inFlightDestinations: inFlightByDestKey.size,
      inFlightSearches: inFlightBySearchKey.size,
      routeDemandEntries: routeDemand.size
    };
  }

  return {
    searchLiveFlights,
    invalidateLiveSearchCache,
    getCacheMetrics
  };
}
