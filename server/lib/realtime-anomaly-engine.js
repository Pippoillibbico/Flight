/**
 * realtime-anomaly-engine.js
 *
 * Near-real-time price anomaly detection layer.
 * Runs as a non-blocking hook after each successful price observation insert.
 * Works IN PARALLEL with the existing batch detected-deals-worker — does NOT replace it.
 *
 * Flow:
 *   ingestPriceObservation() → [inserted=true] → setImmediate(processRealtimePriceObservation)
 *     → getFastBaseline()          (Redis → route_baselines table → rolling avg fallback)
 *     → detectPriceAnomaly()       (reuses existing anomaly-detector.js)
 *     → inferDealType()            (reuses existing deal-ranking-engine.js)
 *     → rankDealV2()               (reuses existing deal-ranking-engine.js)
 *     → publishRealtimeDeal()      (ZADD to Redis sorted set)
 *
 * Redis keys:
 *   rt:bl:{ORIGIN}-{DEST}:{YYYY-MM}   baseline cache (TTL 1h)
 *   rt:deals:live                      global sorted set, score = epoch ms
 *   rt:deals:{ORIGIN}-{DEST}          per-route sorted set (TTL 2h)
 *   rt:dedup:{fingerprint_prefix}      one-shot dedup guard (TTL 30min)
 *   rt:rl:{ORIGIN}-{DEST}             per-route rate-limit counter (TTL 60s)
 */

import { getPrecomputedBaseline, getFastRollingAvg } from './deal-engine-store.js';
import { detectPriceAnomaly } from './anomaly-detector.js';
import { inferDealType, rankDealV2 } from './deal-ranking-engine.js';
import { buildSeasonalContext } from './seasonal-context-engine.js';
import { getCacheClient } from './free-cache.js';
import { logger } from './logger.js';

// ── Config ──────────────────────────────────────────────────────────────────

function cfg(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
}

const ENABLED = cfg('REALTIME_ANOMALY_ENABLED', 'true') !== 'false';

// Minimum delta (%) for a price to be considered a deal in real-time
// Defaults to same value as batch anomaly-detector: 18%
const MIN_DELTA = Math.max(
  0.05,
  Math.min(0.95, Number(cfg('REALTIME_MIN_DELTA', '0.18')))
);

// How long a live deal stays visible in the Redis sorted set (seconds)
const LIVE_TTL_SEC = Math.max(
  300,
  Math.min(86400, Number(cfg('REALTIME_DEAL_TTL_SEC', '3600')))
);

// Max members stored in the global live sorted set before old ones are evicted
const MAX_LIVE_DEALS = Math.max(
  50,
  Math.min(5000, Number(cfg('REALTIME_MAX_LIVE_DEALS', '500')))
);

// Rate limit: max real-time detections per route per 60-second window
const RATE_LIMIT_MAX = Math.max(
  1,
  Math.min(500, Number(cfg('REALTIME_RATE_LIMIT_PER_ROUTE', '30')))
);
const RATE_LIMIT_WINDOW_SEC = 60;

// Minimum observation_count in route_baselines to trust the baseline
const MIN_BASELINE_COUNT = Math.max(
  1,
  Number(cfg('REALTIME_MIN_BASELINE_COUNT', '3'))
);

// Baseline cache TTL in Redis
const BASELINE_CACHE_TTL_SEC = 3600;

// Dedup window: same fingerprint won't be processed twice within this period
const DEDUP_TTL_SEC = 1800;

// ── Key builders ────────────────────────────────────────────────────────────

const NS = 'rt';
const key = {
  baseline: (o, d, ym) => `${NS}:bl:${o}-${d}:${ym}`,
  liveSet: () => `${NS}:deals:live`,
  routeSet: (o, d) => `${NS}:deals:${o}-${d}`,
  dedup: (fp) => `${NS}:dedup:${String(fp).slice(0, 32)}`,
  rateLimit: (o, d) => `${NS}:rl:${o}-${d}`
};

// ── Fast baseline resolution ─────────────────────────────────────────────────

/**
 * Resolves baseline for a route+month using a 3-tier fallback:
 *   1. Redis cache (key: rt:bl:{O}-{D}:{YYYY-MM})
 *   2. route_baselines table (pre-computed daily by baseline-recompute-worker)
 *   3. 30-day rolling avg from price_observations (last-resort)
 *
 * Returns null if no usable baseline found (route is brand new).
 *
 * @param {string} origin
 * @param {string} dest
 * @param {string} date  YYYY-MM-DD
 * @returns {Promise<{p50,p25,p75,p10,p90,avg,count,source}|null>}
 */
export async function getFastBaseline(origin, dest, date) {
  const cache = getCacheClient();
  // travel_month is always YYYY-MM-01
  const travelMonth = `${date.slice(0, 7)}-01`;
  const ym = date.slice(0, 7);
  const cacheKey = key.baseline(origin, dest, ym);

  // 1. Redis
  try {
    const raw = await cache.get(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.p50 === 'number') return parsed;
    }
  } catch {
    // Redis miss or parse error — fall through
  }

  // 2. route_baselines table
  let baseline = null;
  try {
    const row = await getPrecomputedBaseline(origin, dest, travelMonth);
    if (row && Number(row.observation_count) >= MIN_BASELINE_COUNT) {
      baseline = {
        p50: Number(row.p50_price),
        p25: Number(row.p25_price),
        p75: Number(row.p75_price),
        p10: Number(row.p10_price),
        p90: Number(row.p90_price),
        avg: Number(row.avg_price),
        count: Number(row.observation_count),
        source: 'route_baselines'
      };
    }
  } catch (err) {
    logger.warn({ err, origin, dest, travelMonth }, 'rt_baseline_table_error');
  }

  // 3. Rolling 30-day fallback (if no pre-computed baseline yet)
  if (!baseline) {
    try {
      const row = await getFastRollingAvg(origin, dest, 30);
      const avgPrice = Number(row?.avg_price);
      const count = Number(row?.observation_count);
      if (avgPrice > 0 && count >= MIN_BASELINE_COUNT) {
        baseline = {
          p50: avgPrice,
          p25: avgPrice * 0.85,
          p75: avgPrice * 1.15,
          p10: avgPrice * 0.72,
          p90: avgPrice * 1.28,
          avg: avgPrice,
          count,
          source: 'rolling_30d_fallback'
        };
      }
    } catch (err) {
      logger.warn({ err, origin, dest }, 'rt_baseline_rolling_error');
    }
  }

  // Cache result in Redis (shorter TTL for fallback baselines)
  if (baseline) {
    const ttl = baseline.source === 'route_baselines' ? BASELINE_CACHE_TTL_SEC : 300;
    cache
      .setex(cacheKey, ttl, JSON.stringify(baseline))
      .catch((err) => logger.debug({ err, cacheKey }, 'rt_baseline_cache_write_failed'));
  }

  return baseline;
}

// ── Rate limiting ────────────────────────────────────────────────────────────

async function isRateLimited(origin, dest) {
  const cache = getCacheClient();
  const k = key.rateLimit(origin, dest);
  try {
    const count = await cache.incr(k);
    if (count === 1) {
      await cache.expire(k, RATE_LIMIT_WINDOW_SEC).catch((err) => {
        logger.debug({ err, key: k }, 'rt_rate_limit_expire_failed');
      });
    }
    return count > RATE_LIMIT_MAX;
  } catch {
    return false; // if cache fails, don't block
  }
}

// ── Dedup guard ──────────────────────────────────────────────────────────────

/** Returns true if this fingerprint hasn't been processed in the last DEDUP_TTL_SEC */
async function acquireDedup(fingerprint) {
  const cache = getCacheClient();
  try {
    const result = await cache.setnx(key.dedup(fingerprint), '1', DEDUP_TTL_SEC);
    return result === 1;
  } catch {
    return true; // if cache fails, allow processing
  }
}

// ── Deal publishing ──────────────────────────────────────────────────────────

/**
 * Stores a live deal in Redis:
 *   - rt:deals:live  — global sorted set (score = epoch ms, higher = more recent)
 *   - rt:deals:{O}-{D} — per-route sorted set
 *
 * Also prunes members older than LIVE_TTL_SEC and caps global set at MAX_LIVE_DEALS.
 */
export async function publishRealtimeDeal(deal) {
  const cache = getCacheClient();
  const nowMs = Date.now();
  const member = JSON.stringify(deal);
  const liveKey = key.liveSet();
  const routeKey = key.routeSet(deal.origin, deal.destination);
  const expiryScore = nowMs - LIVE_TTL_SEC * 1000;

  const safeGlobalWrite = async () => {
    await cache.zadd(liveKey, nowMs, member);
    await cache.zremrangebyscore(liveKey, '-inf', expiryScore);
    const total = await cache.zcard(liveKey);
    if (total > MAX_LIVE_DEALS) {
      // Keep pruning independent from route writes.
      await cache.zremrangebyscore(liveKey, '-inf', nowMs - LIVE_TTL_SEC * 1000);
    }
  };

  const safeRouteWrite = async () => {
    await cache.zadd(routeKey, nowMs, member);
    await cache.zremrangebyscore(routeKey, '-inf', expiryScore);
    await cache.expire(routeKey, LIVE_TTL_SEC * 2);
  };

  const settled = await Promise.allSettled([safeGlobalWrite(), safeRouteWrite()]);
  const rejected = settled.filter((entry) => entry.status === 'rejected');
  if (rejected.length > 0) {
    logger.warn(
      { errors: rejected.map((entry) => entry.reason?.message || String(entry.reason || 'unknown_error')) },
      'rt_publish_redis_error'
    );
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Called via setImmediate after a successful price observation insert.
 * NEVER throws — any error is logged and swallowed to protect the ingestion pipeline.
 *
 * @param {object} normalized   The normalized observation from ingestPriceObservation
 * @param {object} insertResult {inserted, id, routeId, fingerprint}
 */
export async function processRealtimePriceObservation(normalized, insertResult) {
  if (!ENABLED) return;
  if (!insertResult?.inserted) return; // deduped at DB level — skip

  const origin = normalized.originIata;
  const dest = normalized.destinationIata;
  const date = normalized.departureDate;
  const price = normalized.totalPrice;
  const fingerprint = normalized.fingerprint;
  logger.debug(
    {
      origin,
      dest,
      date,
      price,
      fingerprint,
      observationId: insertResult?.id || null
    },
    'rt_processing_started'
  );

  try {
    // Rate limit — prevents cascade if a provider dumps thousands of observations at once
    if (await isRateLimited(origin, dest)) {
      logger.info({ origin, dest, reason: 'rate_limited' }, 'rt_deal_skipped');
      return;
    }

    // Dedup guard — same fingerprint can't trigger twice within DEDUP_TTL_SEC
    if (!(await acquireDedup(fingerprint))) {
      logger.info({ fingerprint, origin, dest, reason: 'dedup_guard' }, 'rt_deal_skipped');
      return;
    }

    // Fast baseline resolution (no 1-year history scan)
    const baseline = await getFastBaseline(origin, dest, date);
    if (!baseline) {
      logger.info({ origin, dest, date, reason: 'no_baseline' }, 'rt_deal_skipped');
      return;
    }

    // Anomaly detection — reuses anomaly-detector.js unchanged
    const anomaly = detectPriceAnomaly({
      price,
      baselineP50: baseline.p50,
      baselineP25: baseline.p25,
      baselineP75: baseline.p75
    });

    if (!anomaly.isDeal || anomaly.dealDelta < MIN_DELTA) {
      logger.info(
        {
          origin,
          dest,
          date,
          reason: 'below_anomaly_threshold',
          dealDelta: anomaly.dealDelta,
          minDelta: MIN_DELTA
        },
        'rt_deal_skipped'
      );
      return;
    }

    // Deal classification — reuses deal-ranking-engine.js unchanged
    const dropPct = Math.max(0, anomaly.rawDealDelta * 100);
    const belowP10 = baseline.p10 > 0 && price < baseline.p10;
    const belowP25 = baseline.p25 > 0 && price < baseline.p25;
    const dealType = inferDealType({ dropPct, belowP10, anomaly: anomaly.isDeal, belowP25 });

    // Only publish deals that exceed the classification threshold
    // (error_fare, flash_sale, hidden_deal) — skip "seasonal_drop" for RT feed to reduce noise
    if (dealType === 'normal' || dealType === 'seasonal_drop') {
      logger.info(
        {
          origin,
          dest,
          date,
          reason: 'deal_type_filtered',
          dealType
        },
        'rt_deal_skipped'
      );
      return;
    }

    // Seasonal context — synchronous, no DB
    const month = Number(date.slice(5, 7));
    const season = buildSeasonalContext({ destinationIata: dest, month });
    const seasonalityBonus =
      season.seasonBand === 'shoulder' ? 0.2 :
      season.seasonBand === 'low' ? 0.14 : -0.08;

    // Confidence ranking — reuses deal-ranking-engine.js unchanged
    const ranked = rankDealV2({
      dealDelta: anomaly.dealDelta,
      zRobust: anomaly.zRobust,
      comfortScore: 70,
      seasonalityBonus,
      penalties: anomaly.penalty,
      riskNote: ''
    });

    const nowIso = new Date().toISOString();
    const deal = {
      origin,
      destination: dest,
      departure_date: date,
      return_date: normalized.returnDate || null,
      trip_type: normalized.tripType,
      cabin_class: normalized.cabinClass,
      price,
      currency: normalized.currency || 'EUR',
      provider: normalized.provider,
      deal_type: dealType,
      deal_confidence: ranked.dealConfidence,
      deal_delta: anomaly.dealDelta,
      z_robust: anomaly.zRobust,
      raw_deal_delta: anomaly.rawDealDelta,
      baseline_p50: baseline.p50,
      baseline_p25: baseline.p25,
      baseline_p75: baseline.p75,
      savings_pct: Math.round(anomaly.rawDealDelta * 100),
      savings_amount: Math.round((baseline.p50 - price) * 100) / 100,
      why: ranked.why,
      season_band: season.seasonBand,
      baseline_source: baseline.source,
      baseline_count: baseline.count,
      fingerprint,
      observation_id: insertResult.id,
      detected_at: nowIso,
      expires_at: new Date(Date.now() + LIVE_TTL_SEC * 1000).toISOString()
    };

    await publishRealtimeDeal(deal);

    logger.info(
      {
        origin,
        dest,
        date,
        price,
        dealType,
        confidence: ranked.dealConfidence,
        delta: anomaly.dealDelta,
        baselineSource: baseline.source
      },
      'rt_deal_published'
    );
  } catch (err) {
    // Must never propagate — real-time layer is fully fire-and-forget
    logger.warn({ err, origin, dest, date }, 'rt_processing_error');
  }
}

// ── Query API ────────────────────────────────────────────────────────────────

/**
 * Returns live deals from Redis sorted set, sorted by deal_confidence desc.
 *
 * @param {{limit?:number, origin?:string, minConfidence?:number, minDelta?:number}} opts
 * @returns {Promise<object[]>}
 */
export async function getLiveDeals(opts = {}) {
  const cache = getCacheClient();
  const limit = Math.max(1, Math.min(200, Number(opts.limit || 50)));
  const originFilter = opts.origin ? String(opts.origin).trim().toUpperCase() : null;
  const minConf = Number(opts.minConfidence || 0);
  const minDelta = Number(opts.minDelta || 0);

  const nowMs = Date.now();
  const windowStart = nowMs - LIVE_TTL_SEC * 1000;

  // Pull 3× the requested limit to allow for client-side filtering
  const fetchCount = Math.min(1000, limit * 4);

  let members;
  try {
    members = await cache.zrevrangebyscore(
      key.liveSet(),
      nowMs,
      windowStart,
      'LIMIT', 0, fetchCount
    );
  } catch (err) {
    logger.warn({ err }, 'rt_get_live_deals_error');
    return [];
  }

  const deals = [];
  for (const m of (members || [])) {
    try {
      const deal = JSON.parse(m);
      if (deal.deal_confidence < minConf) continue;
      if (deal.deal_delta < minDelta) continue;
      if (originFilter && deal.origin !== originFilter) continue;
      deals.push(deal);
    } catch {
      // skip malformed JSON
    }
  }

  // Sort by confidence desc, then detected_at desc
  deals.sort((a, b) => {
    const diff = b.deal_confidence - a.deal_confidence;
    if (diff !== 0) return diff;
    return new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime();
  });

  return deals.slice(0, limit);
}

/**
 * Stats about the current live deals store.
 * Used by the /api/engine/status and /api/engine/realtime-deals/stats endpoints.
 */
export async function getRealtimeStats() {
  const cache = getCacheClient();
  const nowMs = Date.now();
  const windowStart = nowMs - LIVE_TTL_SEC * 1000;

  try {
    const [total, windowDeals] = await Promise.all([
      cache.zcard(key.liveSet()),
      cache.zrevrangebyscore(key.liveSet(), nowMs, windowStart, 'LIMIT', 0, 1000)
    ]);
    return {
      enabled: ENABLED,
      live_deal_count: Array.isArray(windowDeals) ? windowDeals.length : 0,
      total_stored: Number(total),
      window_seconds: LIVE_TTL_SEC,
      min_delta: MIN_DELTA,
      max_live_deals: MAX_LIVE_DEALS,
      rate_limit_per_route_per_min: RATE_LIMIT_MAX
    };
  } catch {
    return {
      enabled: ENABLED,
      live_deal_count: 0,
      total_stored: 0,
      window_seconds: LIVE_TTL_SEC,
      min_delta: MIN_DELTA
    };
  }
}
