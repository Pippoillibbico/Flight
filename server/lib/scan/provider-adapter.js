import { createHash } from 'node:crypto';
import { getCacheClient } from '../free-cache.js';
import { logger as rootLogger } from '../logger.js';
import { createProviderRegistry } from '../providers/provider-registry.js';

const providerAdapterMetrics = {
  cacheHits: 0,
  cacheMisses: 0,
  staleHits: 0,
  inFlightSharedHits: 0,
  inFlightWaitTimeouts: 0,
  fetchAttempts: 0,
  fetchSuccess: 0,
  fetchFailures: 0,
  retryCount: 0,
  rateLimitRejects: 0,
  batchCalls: 0,
  batchTasks: 0,
  batchUniqueRequests: 0
};

function safeInt(value, fallback, min, max) {
  const out = Number(value);
  if (!Number.isFinite(out)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(out)));
}

function normalizePriority(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'high' || text === 'medium' || text === 'low') return text;
  return 'medium';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableRequestKey(input) {
  return createHash('sha1').update(JSON.stringify(input || {})).digest('hex');
}

function normalizeRequest(payload) {
  return {
    originIata: String(payload?.originIata || '').trim().toUpperCase(),
    destinationIata: String(payload?.destinationIata || '').trim().toUpperCase(),
    departureDate: String(payload?.departureDate || '').trim().slice(0, 10),
    returnDate: payload?.returnDate ? String(payload.returnDate).trim().slice(0, 10) : null,
    adults: safeInt(payload?.adults, 1, 1, 9),
    cabinClass: String(payload?.cabinClass || 'economy').trim().toLowerCase()
  };
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

async function readCachedOffers(cache, key) {
  const raw = await cache.get(key);
  if (!raw) return null;
  const parsed = parseJsonSafe(raw);
  return parsed && Array.isArray(parsed.offers) ? parsed.offers : null;
}

export function createScanProviderAdapter({
  cache = getCacheClient(),
  providerRegistry = createProviderRegistry(),
  logger = rootLogger,
  cacheTtlSec = Math.max(60, Number(process.env.FLIGHT_SCAN_PROVIDER_CACHE_TTL_SEC || 300)),
  maxRequestsPerMinute = Math.max(1, Number(process.env.FLIGHT_SCAN_PROVIDER_RPM || 120)),
  retries = Math.max(0, Number(process.env.FLIGHT_SCAN_PROVIDER_RETRIES || 2)),
  retryBaseMs = Math.max(100, Number(process.env.FLIGHT_SCAN_PROVIDER_RETRY_BASE_MS || 250))
} = {}) {
  const safeCacheTtlSec = Math.max(30, Number(cacheTtlSec || 300));
  const safeRetries = safeInt(retries, 2, 0, 5);
  const safeRetryBaseMs = Math.max(50, Number(retryBaseMs || 250));
  const safeMaxRequestsPerMinute = Math.max(1, Number(maxRequestsPerMinute || 120));
  const safeCacheTtlByPriority = {
    high: Math.max(30, safeInt(process.env.FLIGHT_SCAN_PROVIDER_CACHE_TTL_HIGH_SEC, Math.max(30, Math.floor(safeCacheTtlSec / 2)), 30, 7200)),
    medium: Math.max(30, safeInt(process.env.FLIGHT_SCAN_PROVIDER_CACHE_TTL_MEDIUM_SEC, safeCacheTtlSec, 30, 14400)),
    low: Math.max(30, safeInt(process.env.FLIGHT_SCAN_PROVIDER_CACHE_TTL_LOW_SEC, Math.max(safeCacheTtlSec * 3, 900), 30, 86400))
  };
  const safeRpmByPriority = {
    high: Math.max(1, safeInt(process.env.FLIGHT_SCAN_PROVIDER_RPM_HIGH, safeMaxRequestsPerMinute, 1, 100000)),
    medium: Math.max(1, safeInt(process.env.FLIGHT_SCAN_PROVIDER_RPM_MEDIUM, Math.max(1, Math.floor(safeMaxRequestsPerMinute * 0.75)), 1, 100000)),
    low: Math.max(1, safeInt(process.env.FLIGHT_SCAN_PROVIDER_RPM_LOW, Math.max(1, Math.floor(safeMaxRequestsPerMinute * 0.45)), 1, 100000))
  };
  const safeStaleTtlSec = Math.max(
    60,
    safeInt(process.env.FLIGHT_SCAN_PROVIDER_STALE_TTL_SEC, Math.max(safeCacheTtlSec * 6, 3600), 60, 604800)
  );
  const safeEmptyCacheTtlSec = Math.max(
    15,
    safeInt(
      process.env.FLIGHT_SCAN_PROVIDER_EMPTY_CACHE_TTL_SEC,
      Math.max(15, Math.min(120, Math.floor(safeCacheTtlSec / 3))),
      15,
      3600
    )
  );
  const safeInFlightLockTtlSec = Math.max(
    5,
    safeInt(process.env.FLIGHT_SCAN_PROVIDER_INFLIGHT_LOCK_TTL_SEC, 20, 5, 180)
  );
  const safeInFlightWaitMs = Math.max(
    0,
    safeInt(process.env.FLIGHT_SCAN_PROVIDER_INFLIGHT_WAIT_MS, 1200, 0, 10000)
  );
  const safeInFlightPollMs = Math.max(
    50,
    safeInt(process.env.FLIGHT_SCAN_PROVIDER_INFLIGHT_POLL_MS, 120, 50, 2000)
  );

  async function waitForInFlightResult(cacheKey) {
    if (!safeInFlightWaitMs) return null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < safeInFlightWaitMs) {
      await sleep(safeInFlightPollMs);
      const offers = await readCachedOffers(cache, cacheKey);
      if (Array.isArray(offers)) return offers;
    }
    return null;
  }

  async function claimRateLimitSlot(priority) {
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `flight_scan:provider:rate:${bucket}`;
    const priorityKey = `flight_scan:provider:rate:${priority}:${bucket}`;
    const [count, priorityCount] = await Promise.all([cache.incr(key), cache.incr(priorityKey)]);
    if (typeof cache.expire === 'function') {
      if (Number(count) === 1) await cache.expire(key, 70);
      if (Number(priorityCount) === 1) await cache.expire(priorityKey, 70);
    }
    const priorityCap = Number(safeRpmByPriority[priority] || safeRpmByPriority.medium || safeMaxRequestsPerMinute);
    const globalAllowed = Number(count) <= safeMaxRequestsPerMinute;
    const priorityAllowed = Number(priorityCount) <= priorityCap;
    return {
      allowed: globalAllowed && priorityAllowed,
      count: Number(count),
      priorityCount: Number(priorityCount),
      key,
      priorityKey,
      priorityCap,
      reason: globalAllowed ? (priorityAllowed ? null : 'priority') : 'global'
    };
  }

  async function fetchOffers(task) {
    const priority = normalizePriority(task?.metadata?.priority);
    const request = normalizeRequest(task);
    const requestKey = stableRequestKey(request);
    const cacheKey = `flight_scan:provider:offers:${requestKey}`;
    const staleCacheKey = `${cacheKey}:stale`;
    const inFlightKey = `flight_scan:provider:inflight:${requestKey}`;
    const cacheTtlForPriority = Number(safeCacheTtlByPriority[priority] || safeCacheTtlSec);

    const cachedOffers = await readCachedOffers(cache, cacheKey);
    if (Array.isArray(cachedOffers)) {
      providerAdapterMetrics.cacheHits += 1;
      logger.info(
        {
          originIata: request.originIata,
          destinationIata: request.destinationIata,
          departureDate: request.departureDate,
          cached: true,
          priority,
          offerCount: cachedOffers.length
        },
        'flight_scan_provider_cache_hit'
      );
      return { offers: cachedOffers, fromCache: true, attempt: 0 };
    }
    providerAdapterMetrics.cacheMisses += 1;

    let lockAcquired = true;
    if (typeof cache?.setnx === 'function') {
      lockAcquired = Number(await cache.setnx(inFlightKey, String(Date.now()), safeInFlightLockTtlSec)) === 1;
      if (!lockAcquired) {
        const sharedOffers = await waitForInFlightResult(cacheKey);
        if (Array.isArray(sharedOffers)) {
          providerAdapterMetrics.cacheHits += 1;
          providerAdapterMetrics.inFlightSharedHits += 1;
          logger.info(
            {
              originIata: request.originIata,
              destinationIata: request.destinationIata,
              departureDate: request.departureDate,
              cached: true,
              priority,
              sharedInFlight: true,
              offerCount: sharedOffers.length
            },
            'flight_scan_provider_cache_hit'
          );
          return { offers: sharedOffers, fromCache: true, attempt: 0, sharedInFlight: true };
        }
        providerAdapterMetrics.inFlightWaitTimeouts += 1;
        const error = new Error('provider_request_inflight');
        error.code = 'provider_request_inflight';
        error.priority = priority;
        throw error;
      }
    }

    try {
      const rate = await claimRateLimitSlot(priority);
      if (!rate.allowed) {
        providerAdapterMetrics.rateLimitRejects += 1;
        const errorCode = rate.reason === 'priority' ? 'provider_rate_limit_priority_exceeded' : 'provider_rate_limit_exceeded';
        const error = new Error(errorCode);
        error.code = errorCode;
        error.rateCounter = rate.count;
        error.priorityRateCounter = rate.priorityCount;
        error.priority = priority;
        error.priorityCap = rate.priorityCap;
        throw error;
      }

      for (let attempt = 0; attempt <= safeRetries; attempt += 1) {
        try {
          providerAdapterMetrics.fetchAttempts += 1;
          const offers = await providerRegistry.searchOffers(request);
          const safeOffers = Array.isArray(offers) ? offers : [];
          const activeCacheTtlSec = safeOffers.length > 0 ? cacheTtlForPriority : Math.min(cacheTtlForPriority, safeEmptyCacheTtlSec);
          if (typeof cache?.setex === 'function') {
            await Promise.all([
              cache.setex(cacheKey, activeCacheTtlSec, JSON.stringify({ offers: safeOffers })),
              cache.setex(staleCacheKey, safeStaleTtlSec, JSON.stringify({ offers: safeOffers }))
            ]);
          }
          providerAdapterMetrics.fetchSuccess += 1;
          logger.info(
            {
              originIata: request.originIata,
              destinationIata: request.destinationIata,
              departureDate: request.departureDate,
              cached: false,
              priority,
              cacheTtlSec: activeCacheTtlSec,
              staleTtlSec: safeStaleTtlSec,
              offerCount: safeOffers.length,
              attempt
            },
            'flight_scan_provider_fetch_completed'
          );
          return { offers: safeOffers, fromCache: false, attempt };
        } catch (error) {
          providerAdapterMetrics.fetchFailures += 1;
          const isLast = attempt >= safeRetries;
          logger.warn(
            {
              originIata: request.originIata,
              destinationIata: request.destinationIata,
              departureDate: request.departureDate,
              priority,
              attempt,
              retries: safeRetries,
              err: error?.message || String(error)
            },
            'flight_scan_provider_fetch_retryable_error'
          );
          if (isLast) {
            const staleOffers = await readCachedOffers(cache, staleCacheKey);
            if (Array.isArray(staleOffers)) {
              providerAdapterMetrics.cacheHits += 1;
              providerAdapterMetrics.staleHits += 1;
              logger.warn(
                {
                  originIata: request.originIata,
                  destinationIata: request.destinationIata,
                  departureDate: request.departureDate,
                  priority,
                  stale: true,
                  offerCount: staleOffers.length
                },
                'flight_scan_provider_stale_fallback_served'
              );
              return {
                offers: staleOffers,
                fromCache: true,
                stale: true,
                degradedReason: 'stale_provider_cache_fallback',
                attempt
              };
            }
            throw error;
          }
          providerAdapterMetrics.retryCount += 1;
          const backoffMs = safeRetryBaseMs * 2 ** attempt;
          await sleep(backoffMs);
        }
      }
    } finally {
      if (lockAcquired && typeof cache?.del === 'function') {
        try {
          await cache.del(inFlightKey);
        } catch {}
      }
    }

    return { offers: [], fromCache: false, attempt: safeRetries };
  }

  async function fetchOffersBatch(tasks) {
    const list = Array.isArray(tasks) ? tasks : [];
    const byRequestKey = new Map();
    providerAdapterMetrics.batchCalls += 1;
    providerAdapterMetrics.batchTasks += list.length;

    for (const task of list) {
      const requestKey = stableRequestKey(normalizeRequest(task));
      if (!byRequestKey.has(requestKey)) {
        byRequestKey.set(requestKey, await fetchOffers(task));
      }
    }

    providerAdapterMetrics.batchUniqueRequests += byRequestKey.size;
    return list.map((task) => {
      const requestKey = stableRequestKey(normalizeRequest(task));
      return {
        task,
        result: byRequestKey.get(requestKey) || { offers: [], fromCache: false, attempt: 0 }
      };
    });
  }

  return {
    fetchOffers,
    fetchOffersBatch
  };
}

export function getScanProviderAdapterMetrics() {
  return {
    ...providerAdapterMetrics,
    cacheHitRatio:
      providerAdapterMetrics.cacheHits + providerAdapterMetrics.cacheMisses > 0
        ? Number(
            (
              providerAdapterMetrics.cacheHits /
              (providerAdapterMetrics.cacheHits + providerAdapterMetrics.cacheMisses)
            ).toFixed(4)
          )
        : 0
  };
}
