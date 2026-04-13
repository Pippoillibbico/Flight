import { addDays, format } from 'date-fns';
import {
  createIngestionJob,
  listActiveDiscoverySubscriptions,
  listPopularRoutePairs,
  listRouteIntelligenceSignals,
  listStrongDetectedDealRoutes,
  updateIngestionJob
} from '../deal-engine-store.js';
import { getCacheClient } from '../free-cache.js';
import { loadSeedRoutes } from '../seed-routes.js';
import { logger } from '../logger.js';
import { createScanQueue } from './scan-queue.js';

function parseFlag(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function safeInt(value, fallback, min, max) {
  const out = Number(value);
  if (!Number.isFinite(out)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(out)));
}

function safeFloat(value, fallback, min, max) {
  const out = Number(value);
  if (!Number.isFinite(out)) return fallback;
  return Math.min(max, Math.max(min, out));
}

function normalizeIata(value) {
  return String(value || '').trim().toUpperCase();
}

function parseIntList(value, fallback = [], min = 1, max = 365) {
  const text = String(value ?? '').trim();
  const source = text ? text.split(',') : fallback;
  const out = [];
  for (const item of source) {
    const parsed = Number.parseInt(String(item ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) continue;
    const clamped = Math.min(max, Math.max(min, parsed));
    if (!out.includes(clamped)) out.push(clamped);
  }
  return out;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function monthStartText(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function normalizeSeasonMonth(value, fallback = monthStartText(new Date())) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text.slice(0, 7)}-01`;
  return fallback;
}

function derivePriority(priorityScore) {
  const score = Number(priorityScore) || 0;
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function buildIntelligenceScoreMap(signalRows, weights) {
  const rows = Array.isArray(signalRows) ? signalRows : [];
  const map = new Map();

  const popularityWeight = Number(weights?.popularity || 0);
  const volatilityWeight = Number(weights?.volatility || 0);
  const recentDropWeight = Number(weights?.recentDrop || 0);
  const seasonalityWeight = Number(weights?.seasonality || 0);
  const userSignalWeight = Number(weights?.userSignals || 0);
  const totalWeight = Math.max(0.0001, popularityWeight + volatilityWeight + recentDropWeight + seasonalityWeight + userSignalWeight);

  for (const row of rows) {
    const origin = normalizeIata(row?.originIata || row?.origin_iata);
    const destination = normalizeIata(row?.destinationIata || row?.destination_iata);
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) continue;

    const observations = Math.max(0, Number(row?.observations || 0));
    const volatilityPct = Math.max(0, Number(row?.volatilityPct ?? row?.volatility_pct ?? 0));
    const recentDropPct = Math.max(0, Number(row?.recentDropPct ?? row?.recent_drop_pct ?? 0));
    const seasonalityFactor = Math.max(0, Number(row?.seasonalityFactor ?? row?.seasonality_factor ?? 1));
    const userSignalScore = Math.max(0, Number(row?.userSignalScore ?? row?.user_signal_score ?? 0));

    const popularitySignal = clamp(Math.log1p(observations) / Math.log1p(500), 0, 1);
    const volatilitySignal = clamp(volatilityPct / 40, 0, 1);
    const recentDropSignal = clamp(recentDropPct / 25, 0, 1);
    const seasonalitySignal = clamp((seasonalityFactor - 0.8) / 0.6, 0, 1);
    const userSignal = clamp(Math.log1p(userSignalScore) / Math.log1p(120), 0, 1);

    const weightedSignalScore =
      ((popularitySignal * popularityWeight +
        volatilitySignal * volatilityWeight +
        recentDropSignal * recentDropWeight +
        seasonalitySignal * seasonalityWeight +
        userSignal * userSignalWeight) /
        totalWeight) *
      100;

    const priorityScore = clamp(weightedSignalScore, 0, 100);
    const priorityBoost = (priorityScore / 100) * 16;

    map.set(`${origin}-${destination}`, {
      priorityScore,
      priorityBoost,
      signals: {
        popularity: Number(popularitySignal.toFixed(3)),
        volatility: Number(volatilitySignal.toFixed(3)),
        recentDrop: Number(recentDropSignal.toFixed(3)),
        seasonality: Number(seasonalitySignal.toFixed(3)),
        userSignals: Number(userSignal.toFixed(3)),
        observations: Math.round(observations),
        volatilityPct: Number(volatilityPct.toFixed(2)),
        recentDropPct: Number(recentDropPct.toFixed(2)),
        seasonalityFactor: Number(seasonalityFactor.toFixed(3)),
        userSignalScore: Number(userSignalScore.toFixed(2))
      }
    });
  }

  return map;
}

function spreadSelectOffsets(offsets, maxCount) {
  const list = Array.isArray(offsets) ? offsets.slice().sort((a, b) => a - b) : [];
  if (list.length <= maxCount) return list;
  const chosen = [];
  for (let i = 0; i < maxCount; i += 1) {
    const index = Math.round((i * (list.length - 1)) / Math.max(1, maxCount - 1));
    const value = list[index];
    if (!chosen.includes(value)) chosen.push(value);
  }
  return chosen.sort((a, b) => a - b);
}

function weekendOffsets({
  minLeadDays,
  horizonDays,
  weekendCount
}) {
  const out = [];
  if (weekendCount <= 0) return out;
  const now = new Date();
  for (let offset = minLeadDays; offset <= horizonDays; offset += 1) {
    const date = addDays(now, offset);
    const day = date.getDay();
    if (day === 5) {
      out.push(offset);
      if (out.length >= weekendCount) break;
    }
  }
  return out;
}

function buildDateWindows({
  horizonDays,
  windows,
  minLeadDays,
  stayDays,
  anchorDays = [],
  weekendCount = 0
}) {
  const safeWindows = Math.max(1, Number(windows || 1));
  const offsets = [];
  const seen = new Set();

  const pushOffset = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const offset = Math.max(minLeadDays, Math.min(horizonDays, Math.round(parsed)));
    if (seen.has(offset)) return;
    seen.add(offset);
    offsets.push(offset);
  };

  for (const anchor of Array.isArray(anchorDays) ? anchorDays : []) {
    pushOffset(anchor);
  }

  for (let i = 1; i <= safeWindows; i += 1) {
    const rawOffset = Math.round((horizonDays / (safeWindows + 1)) * i);
    pushOffset(rawOffset);
  }

  const weekends = weekendOffsets({ minLeadDays, horizonDays, weekendCount });
  for (const offset of weekends) {
    pushOffset(offset);
  }

  const selectedOffsets = spreadSelectOffsets(offsets, safeWindows);
  return selectedOffsets.map((offset) => {
    const departure = addDays(new Date(), offset);
    const returning = addDays(departure, stayDays);
    return {
      departureDate: format(departure, 'yyyy-MM-dd'),
      returnDate: format(returning, 'yyyy-MM-dd')
    };
  });
}

function buildTaskFreshnessKey(task) {
  const origin = normalizeIata(task?.originIata);
  const destination = normalizeIata(task?.destinationIata);
  const departureDate = String(task?.departureDate || '').trim().slice(0, 10);
  const returnDate = task?.returnDate ? String(task.returnDate).trim().slice(0, 10) : 'oneway';
  const adults = Math.max(1, Math.min(9, Number(task?.adults || 1) || 1));
  const cabinClass = String(task?.cabinClass || 'economy').trim().toLowerCase();
  return `flight_scan:window:last_success:${origin}-${destination}:${departureDate}:${returnDate}:${adults}:${cabinClass}`;
}

function buildRouteCandidates({
  seedRoutes,
  popularRoutes,
  activeSubscriptions,
  intelligenceByRoute,
  strongDealRoutes,
  dealExpansionEnabled,
  dealExpansionLimit,
  routeLimit,
  perOriginCap
}) {
  const scored = new Map();

  const add = (originIata, destinationIata, weight, metadata = {}) => {
    const origin = normalizeIata(originIata);
    const destination = normalizeIata(destinationIata);
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) return;
    const key = `${origin}-${destination}`;
    const prev = scored.get(key) || {
      originIata: origin,
      destinationIata: destination,
      score: 0,
      intelligence: null,
      strongDealBoost: 0,
      expansionBoost: 0
    };
    prev.score += Number(weight || 0);
    if (metadata?.strongDealBoost) prev.strongDealBoost += Number(metadata.strongDealBoost || 0);
    if (metadata?.expansionBoost) prev.expansionBoost += Number(metadata.expansionBoost || 0);
    scored.set(key, prev);
  };

  const origins = seedRoutes?.origins && typeof seedRoutes.origins === 'object' ? seedRoutes.origins : {};
  const popularByOrigin = new Map();
  for (const row of Array.isArray(popularRoutes) ? popularRoutes : []) {
    const origin = normalizeIata(row?.originIata);
    const destination = normalizeIata(row?.destinationIata);
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) continue;
    if (!popularByOrigin.has(origin)) popularByOrigin.set(origin, []);
    popularByOrigin.get(origin).push({
      destinationIata: destination,
      observations: Math.max(0, Number(row?.observations || 0))
    });
  }
  for (const list of popularByOrigin.values()) {
    list.sort((a, b) => b.observations - a.observations);
  }

  for (const [origin, destinations] of Object.entries(origins)) {
    for (const destination of Array.isArray(destinations) ? destinations : []) {
      add(origin, destination, 2);
    }
  }

  for (const row of Array.isArray(popularRoutes) ? popularRoutes : []) {
    add(row?.originIata, row?.destinationIata, 5 + Number(row?.observations || 0) / 20);
  }

  const subscriptions = Array.isArray(activeSubscriptions) ? activeSubscriptions : [];
  const boostedOrigins = new Set();
  for (const subscription of subscriptions) {
    const origin = normalizeIata(subscription?.origin_iata || subscription?.originIata || subscription?.origin);
    if (!/^[A-Z]{3}$/.test(origin)) continue;
    boostedOrigins.add(origin);
  }

  for (const origin of boostedOrigins) {
    const seededDestinations = (origins?.[origin] || []).slice(0, 8);
    for (const destination of seededDestinations) {
      add(origin, destination, 9);
    }
  }

  const intelligenceMap = intelligenceByRoute instanceof Map ? intelligenceByRoute : new Map();
  for (const [key, intelligence] of intelligenceMap.entries()) {
    const item = scored.get(key);
    if (!item) continue;
    item.score += Number(intelligence?.priorityBoost || 0);
    item.intelligence = intelligence || null;
    scored.set(key, item);
  }

  for (const deal of Array.isArray(strongDealRoutes) ? strongDealRoutes : []) {
    const origin = normalizeIata(deal?.originIata || deal?.origin_iata);
    const destination = normalizeIata(deal?.destinationIata || deal?.destination_iata);
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) continue;
    const topScore = Math.max(0, Number(deal?.topScore || deal?.top_score || 0));
    const baseStrongBoost = 8 + topScore / 12;
    add(origin, destination, baseStrongBoost, { strongDealBoost: baseStrongBoost });

    if (!dealExpansionEnabled) continue;

    const similarDestinations = new Set();
    for (const seedDestination of (origins?.[origin] || []).slice(0, 20)) {
      const normalizedSeed = normalizeIata(seedDestination);
      if (!/^[A-Z]{3}$/.test(normalizedSeed) || normalizedSeed === destination) continue;
      similarDestinations.add(normalizedSeed);
      if (similarDestinations.size >= dealExpansionLimit) break;
    }

    if (similarDestinations.size < dealExpansionLimit) {
      for (const row of popularByOrigin.get(origin) || []) {
        if (row.destinationIata === destination) continue;
        similarDestinations.add(row.destinationIata);
        if (similarDestinations.size >= dealExpansionLimit) break;
      }
    }

    for (const similarDestination of similarDestinations) {
      const expansionBoost = 4 + topScore / 30;
      add(origin, similarDestination, expansionBoost, { expansionBoost });
    }
  }

  const sorted = Array.from(scored.values()).sort((a, b) => b.score - a.score || a.originIata.localeCompare(b.originIata));
  const byOrigin = new Map();
  const out = [];
  for (const item of sorted) {
    const used = Number(byOrigin.get(item.originIata) || 0);
    if (used >= perOriginCap) continue;
    const basePriorityScore = clamp(item.score * 8, 0, 100);
    const intelligencePriorityScore = Number(item.intelligence?.priorityScore || 0);
    const priorityScore =
      intelligencePriorityScore > 0
        ? clamp(basePriorityScore * 0.35 + intelligencePriorityScore * 0.65, 0, 100)
        : basePriorityScore;
    out.push({
      originIata: item.originIata,
      destinationIata: item.destinationIata,
      score: item.score,
      priorityScore,
      priority: derivePriority(priorityScore),
      intelligence: item.intelligence?.signals || null,
      strongDealBoost: Number(item.strongDealBoost || 0),
      expansionBoost: Number(item.expansionBoost || 0)
    });
    byOrigin.set(item.originIata, used + 1);
    if (out.length >= routeLimit) break;
  }
  return out;
}

export async function runRouteSchedulerOnce(options = {}) {
  const enabled = parseFlag(options.enabled ?? process.env.FLIGHT_SCAN_ENABLED, false);
  if (!enabled) {
    return { skipped: true, reason: 'disabled', enqueued: 0, duplicates: 0, rejected: 0, routeCount: 0 };
  }

  const routeLimit = safeInt(options.routeLimit ?? process.env.FLIGHT_SCAN_SCHEDULER_ROUTE_LIMIT, 250, 10, 2000);
  const perOriginCap = safeInt(options.perOriginCap ?? process.env.FLIGHT_SCAN_SCHEDULER_PER_ORIGIN_CAP, 20, 1, 200);
  const horizonDays = safeInt(options.horizonDays ?? process.env.FLIGHT_SCAN_HORIZON_DAYS, 180, 14, 365);
  const windows = safeInt(options.windows ?? process.env.FLIGHT_SCAN_WINDOWS_PER_ROUTE, 3, 1, 8);
  const windowsHigh = safeInt(options.windowsHigh ?? process.env.FLIGHT_SCAN_WINDOWS_HIGH_PRIORITY, Math.min(8, windows + 1), 1, 12);
  const windowsMedium = safeInt(options.windowsMedium ?? process.env.FLIGHT_SCAN_WINDOWS_MEDIUM_PRIORITY, windows, 1, 12);
  const windowsLow = safeInt(options.windowsLow ?? process.env.FLIGHT_SCAN_WINDOWS_LOW_PRIORITY, Math.max(1, windows - 1), 1, 12);
  const dateAnchorDays = parseIntList(options.dateAnchorDays ?? process.env.FLIGHT_SCAN_DATE_ANCHOR_DAYS, [30, 60, 90], 1, 365);
  const weekendHigh = safeInt(options.weekendHigh ?? process.env.FLIGHT_SCAN_WEEKEND_WINDOWS_HIGH, 2, 0, 8);
  const weekendMedium = safeInt(options.weekendMedium ?? process.env.FLIGHT_SCAN_WEEKEND_WINDOWS_MEDIUM, 1, 0, 8);
  const weekendLow = safeInt(options.weekendLow ?? process.env.FLIGHT_SCAN_WEEKEND_WINDOWS_LOW, 0, 0, 8);
  const minLeadDays = safeInt(options.minLeadDays ?? process.env.FLIGHT_SCAN_MIN_LEAD_DAYS, 14, 1, 120);
  const stayDays = safeInt(options.stayDays ?? process.env.FLIGHT_SCAN_DEFAULT_STAY_DAYS, 7, 1, 30);
  const maxAttempts = safeInt(options.maxAttempts ?? process.env.FLIGHT_SCAN_MAX_ATTEMPTS, 3, 0, 10);
  const adults = safeInt(options.adults ?? process.env.FLIGHT_SCAN_ADULTS, 1, 1, 9);
  const cabinClass = String(options.cabinClass ?? process.env.FLIGHT_SCAN_CABIN_CLASS ?? 'economy').trim().toLowerCase();
  const intelligentPriorityEnabled = parseFlag(options.intelligentPriorityEnabled ?? process.env.FLIGHT_SCAN_INTELLIGENT_PRIORITY_ENABLED, false);
  const intelligentLookbackDays = safeInt(options.intelligentLookbackDays ?? process.env.FLIGHT_SCAN_INTELLIGENT_LOOKBACK_DAYS, 45, 14, 180);
  const intelligentSeasonMonth = normalizeSeasonMonth(
    options.intelligentSeasonMonth ?? process.env.FLIGHT_SCAN_INTELLIGENT_SEASON_MONTH,
    monthStartText(addDays(new Date(), minLeadDays))
  );
  const priorityHighCooldownSec = safeInt(options.priorityHighCooldownSec ?? process.env.FLIGHT_SCAN_PRIORITY_HIGH_COOLDOWN_SEC, 900, 60, 86400);
  const priorityMediumCooldownSec = safeInt(options.priorityMediumCooldownSec ?? process.env.FLIGHT_SCAN_PRIORITY_MEDIUM_COOLDOWN_SEC, 3600, 120, 172800);
  const priorityLowCooldownSec = safeInt(options.priorityLowCooldownSec ?? process.env.FLIGHT_SCAN_PRIORITY_LOW_COOLDOWN_SEC, 14400, 300, 604800);
  const windowCooldownHighSec = safeInt(options.windowCooldownHighSec ?? process.env.FLIGHT_SCAN_WINDOW_COOLDOWN_HIGH_SEC, 1800, 60, 604800);
  const windowCooldownMediumSec = safeInt(options.windowCooldownMediumSec ?? process.env.FLIGHT_SCAN_WINDOW_COOLDOWN_MEDIUM_SEC, 14400, 120, 604800);
  const windowCooldownLowSec = safeInt(options.windowCooldownLowSec ?? process.env.FLIGHT_SCAN_WINDOW_COOLDOWN_LOW_SEC, 86400, 300, 1209600);
  const dealExpansionEnabled = parseFlag(options.dealExpansionEnabled ?? process.env.FLIGHT_SCAN_DEAL_EXPANSION_ENABLED, true);
  const dealExpansionLimit = safeInt(options.dealExpansionLimit ?? process.env.FLIGHT_SCAN_DEAL_EXPANSION_LIMIT, 3, 1, 10);
  const strongDealMinScore = safeFloat(options.strongDealMinScore ?? process.env.FLIGHT_SCAN_STRONG_DEAL_MIN_SCORE, 80, 0, 100);
  const strongDealLookbackHours = safeInt(options.strongDealLookbackHours ?? process.env.FLIGHT_SCAN_STRONG_DEAL_LOOKBACK_HOURS, 96, 1, 720);
  const weightPopularity = safeFloat(options.weightPopularity ?? process.env.FLIGHT_SCAN_PRIORITY_WEIGHT_POPULARITY, 0.28, 0, 1);
  const weightVolatility = safeFloat(options.weightVolatility ?? process.env.FLIGHT_SCAN_PRIORITY_WEIGHT_VOLATILITY, 0.19, 0, 1);
  const weightRecentDrop = safeFloat(options.weightRecentDrop ?? process.env.FLIGHT_SCAN_PRIORITY_WEIGHT_RECENT_DROP, 0.23, 0, 1);
  const weightSeasonality = safeFloat(options.weightSeasonality ?? process.env.FLIGHT_SCAN_PRIORITY_WEIGHT_SEASONALITY, 0.12, 0, 1);
  const weightUserSignals = safeFloat(options.weightUserSignals ?? process.env.FLIGHT_SCAN_PRIORITY_WEIGHT_USER_SIGNALS, 0.18, 0, 1);
  const lockEnabled = parseFlag(options.lockEnabled ?? process.env.FLIGHT_SCAN_SCHEDULER_LOCK_ENABLED, true);
  const lockTtlSec = safeInt(options.lockTtlSec ?? process.env.FLIGHT_SCAN_SCHEDULER_LOCK_TTL_SEC, 420, 30, 3600);
  const lockKey = String(options.lockKey ?? process.env.FLIGHT_SCAN_SCHEDULER_LOCK_KEY ?? 'flight_scan:scheduler:lock').trim() || 'flight_scan:scheduler:lock';
  const distributedLockRequired = parseFlag(
    options.distributedLockRequired ?? (String(process.env.REDIS_URL || '').trim() ? 'true' : 'false'),
    Boolean(String(process.env.REDIS_URL || '').trim())
  );
  const backlogSoftLimit = safeInt(options.backlogSoftLimit ?? process.env.FLIGHT_SCAN_BACKLOG_SOFT_LIMIT, 2000, 10, 500000);
  const backlogHardLimit = safeInt(options.backlogHardLimit ?? process.env.FLIGHT_SCAN_BACKLOG_HARD_LIMIT, 6000, 20, 1000000);
  const lowPriorityMaxShare = safeFloat(options.lowPriorityMaxShare ?? process.env.FLIGHT_SCAN_LOW_PRIORITY_MAX_SHARE, 0.25, 0, 1);
  const backlogThrottleStartPct = safeFloat(
    options.backlogThrottleStartPct ?? process.env.FLIGHT_SCAN_BACKLOG_THROTTLE_START_PCT,
    0.7,
    0.1,
    0.99
  );
  const lockCache = options.lockCache || getCacheClient();

  const queue = options.queue || createScanQueue(options.queueOptions || {});
  let lockAcquired = !lockEnabled;
  let lockBackendUnavailable = false;
  let lockBackendDegraded = false;
  if (lockEnabled) {
    if (typeof lockCache?.setnx !== 'function') {
      lockBackendUnavailable = distributedLockRequired;
      lockAcquired = !distributedLockRequired;
    } else {
      lockAcquired = Number(await lockCache.setnx(lockKey, String(Date.now()), lockTtlSec)) === 1;
      if (distributedLockRequired && Boolean(lockCache?.redisDegraded)) {
        lockBackendDegraded = true;
        lockAcquired = false;
      }
    }
  }

  if (!lockAcquired) {
    if (lockBackendUnavailable) {
      logger.warn(
        { lockKey, lockTtlSec, distributedLockRequired },
        'flight_scan_route_scheduler_skipped_lock_backend_unavailable'
      );
      return { skipped: true, reason: 'lock_backend_unavailable', enqueued: 0, duplicates: 0, rejected: 0, routeCount: 0 };
    }
    if (lockBackendDegraded) {
      logger.warn({ lockKey, lockTtlSec }, 'flight_scan_route_scheduler_skipped_lock_backend_degraded');
      return { skipped: true, reason: 'cache_degraded', enqueued: 0, duplicates: 0, rejected: 0, routeCount: 0 };
    }
    logger.info({ lockKey, lockTtlSec }, 'flight_scan_route_scheduler_skipped_lock_not_acquired');
    return { skipped: true, reason: 'locked', enqueued: 0, duplicates: 0, rejected: 0, routeCount: 0 };
  }

  const createJob = options.createIngestionJob || createIngestionJob;
  const updateJob = options.updateIngestionJob || updateIngestionJob;
  let job = null;

  try {
    job = await createJob({
      jobType: 'flight_scan_scheduler',
      source: 'scan_scheduler',
      status: 'running',
      metadata: {
        routeLimit,
        horizonDays,
        windows,
        windowsByPriority: {
          high: windowsHigh,
          medium: windowsMedium,
          low: windowsLow
        },
        minLeadDays,
        stayDays,
        cabinClass,
        adults,
        lockEnabled,
        lockTtlSec,
        intelligentPriorityEnabled
      }
    });

    await updateJob({
      jobId: job.id,
      status: 'running',
      startedAt: new Date().toISOString()
    });

    const loadSignals = options.listRouteIntelligenceSignals || listRouteIntelligenceSignals;
    const loadStrongDeals = options.listStrongDetectedDealRoutes || listStrongDetectedDealRoutes;

    const [seedRoutes, popularRoutes, activeSubscriptions, intelligenceSignals, strongDealRoutes, queueDepth] = await Promise.all([
      (options.loadSeedRoutes || loadSeedRoutes)().catch(() => ({ origins: {} })),
      (options.listPopularRoutePairs || listPopularRoutePairs)({ limit: routeLimit }),
      (options.listActiveDiscoverySubscriptions || listActiveDiscoverySubscriptions)(),
      intelligentPriorityEnabled
        ? loadSignals({
            limit: Math.max(routeLimit * 3, 100),
            lookbackDays: intelligentLookbackDays,
            seasonMonth: intelligentSeasonMonth
          }).catch(() => [])
        : Promise.resolve([]),
      intelligentPriorityEnabled
        ? loadStrongDeals({
            limit: Math.max(routeLimit, 50),
            minScore: strongDealMinScore,
            lookbackHours: strongDealLookbackHours
          }).catch(() => [])
        : Promise.resolve([]),
      typeof queue.getQueueDepth === 'function' ? queue.getQueueDepth() : Promise.resolve(0)
    ]);

    const initialQueueDepth = Math.max(0, Number(queueDepth || 0));
    if (initialQueueDepth >= backlogHardLimit) {
      const result = {
        skipped: true,
        reason: 'backlog_hard_limit',
        routeCount: 0,
        scheduledRouteCount: 0,
        windowsPerRoute: 0,
        taskCount: 0,
        skippedByPriorityCooldown: 0,
        skippedByWindowCooldown: 0,
        skippedByBackpressure: 0,
        initialQueueDepth,
        backlogSoftLimit,
        backlogHardLimit,
        intelligentPriorityEnabled,
        strongDealRouteCount: Array.isArray(strongDealRoutes) ? strongDealRoutes.length : 0,
        enqueued: 0,
        duplicates: 0,
        rejected: 0
      };
      await updateJob({
        jobId: job.id,
        status: 'partial',
        finishedAt: new Date().toISOString(),
        processedCount: 0,
        insertedCount: 0,
        dedupedCount: 0,
        failedCount: 0,
        metadata: result
      });
      logger.warn(result, 'flight_scan_route_scheduler_skipped_backlog_hard_limit');
      return result;
    }

    const intelligenceByRoute = intelligentPriorityEnabled
      ? buildIntelligenceScoreMap(intelligenceSignals, {
          popularity: weightPopularity,
          volatility: weightVolatility,
          recentDrop: weightRecentDrop,
          seasonality: weightSeasonality,
          userSignals: weightUserSignals
        })
      : new Map();

    const candidates = buildRouteCandidates({
      seedRoutes,
      popularRoutes,
      activeSubscriptions,
      intelligenceByRoute,
      strongDealRoutes,
      dealExpansionEnabled: intelligentPriorityEnabled && dealExpansionEnabled,
      dealExpansionLimit,
      routeLimit,
      perOriginCap
    });
    const dateWindowsByPriority = {
      high: buildDateWindows({
        horizonDays,
        windows: windowsHigh,
        minLeadDays,
        stayDays,
        anchorDays: dateAnchorDays,
        weekendCount: weekendHigh
      }),
      medium: buildDateWindows({
        horizonDays,
        windows: windowsMedium,
        minLeadDays,
        stayDays,
        anchorDays: dateAnchorDays,
        weekendCount: weekendMedium
      }),
      low: buildDateWindows({
        horizonDays,
        windows: windowsLow,
        minLeadDays,
        stayDays,
        anchorDays: dateAnchorDays,
        weekendCount: weekendLow
      })
    };

    const nowTs = Date.now();
    const cooldownByPriority = {
      high: priorityHighCooldownSec,
      medium: priorityMediumCooldownSec,
      low: priorityLowCooldownSec
    };
    const windowCooldownByPriority = {
      high: windowCooldownHighSec,
      medium: windowCooldownMediumSec,
      low: windowCooldownLowSec
    };

    let dueRoutes = [];
    let skippedByPriorityCooldown = 0;
    for (const candidate of candidates) {
      const priority = String(candidate.priority || 'medium');
      const cooldownSec = Number(cooldownByPriority[priority] || priorityMediumCooldownSec);
      const routeTickKey = `flight_scan:route:last_enqueued:${candidate.originIata}-${candidate.destinationIata}`;
      let shouldEnqueue = true;

      if (intelligentPriorityEnabled && typeof lockCache?.get === 'function') {
        const rawLast = await lockCache.get(routeTickKey);
        const lastEnqueuedTs = Number(rawLast);
        if (Number.isFinite(lastEnqueuedTs) && lastEnqueuedTs > 0 && nowTs - lastEnqueuedTs < cooldownSec * 1000) {
          shouldEnqueue = false;
        }
      }

      if (!shouldEnqueue) {
        skippedByPriorityCooldown += 1;
        continue;
      }

      dueRoutes.push({
        ...candidate,
        priority,
        cooldownSec,
        routeTickKey
      });
    }

    let skippedByLowPriorityCap = 0;
    const lowPriorityRouteCapBase = Math.floor(routeLimit * lowPriorityMaxShare);
    const hasHighOrMediumRoute = dueRoutes.some((route) => route.priority !== 'low');
    const lowPriorityRouteCap = hasHighOrMediumRoute ? Math.max(0, lowPriorityRouteCapBase) : Math.max(1, lowPriorityRouteCapBase);
    if (lowPriorityRouteCap >= 0) {
      const originalCount = dueRoutes.length;
      let allowedLowCount = 0;
      dueRoutes = dueRoutes.filter((route) => {
        if (route.priority !== 'low') return true;
        if (allowedLowCount >= lowPriorityRouteCap) return false;
        allowedLowCount += 1;
        return true;
      });
      skippedByLowPriorityCap = Math.max(0, originalCount - dueRoutes.length);
    }

    let skippedByBackpressure = 0;
    const backlogThrottleStart = Math.max(1, Math.floor(backlogSoftLimit * backlogThrottleStartPct));
    if (initialQueueDepth >= backlogThrottleStart && initialQueueDepth < backlogSoftLimit) {
      const originalCount = dueRoutes.length;
      const maxRoutesWhenThrottled = Math.max(25, Math.floor(routeLimit * 0.55));
      dueRoutes = dueRoutes.slice(0, maxRoutesWhenThrottled);
      skippedByBackpressure += Math.max(0, originalCount - dueRoutes.length);
    }

    if (initialQueueDepth >= backlogSoftLimit) {
      const originalCount = dueRoutes.length;
      dueRoutes = dueRoutes
        .filter((candidate) => candidate.priority === 'high')
        .slice(0, Math.max(10, Math.floor(routeLimit * 0.3)));
      skippedByBackpressure += Math.max(0, originalCount - dueRoutes.length);
    }

    const tasks = [];
    let skippedByWindowCooldown = 0;
    const windowsByPriority = {
      high: dateWindowsByPriority.high.length,
      medium: dateWindowsByPriority.medium.length,
      low: dateWindowsByPriority.low.length
    };
    for (const route of dueRoutes) {
      const windowsForRoute = dateWindowsByPriority[route.priority] || dateWindowsByPriority.medium;
      const routeWindowCooldownSec = Number(windowCooldownByPriority[route.priority] || windowCooldownMediumSec);
      for (const window of windowsForRoute) {
        const freshnessKey = buildTaskFreshnessKey({
          originIata: route.originIata,
          destinationIata: route.destinationIata,
          departureDate: window.departureDate,
          returnDate: window.returnDate,
          adults,
          cabinClass
        });
        if (typeof lockCache?.get === 'function') {
          const rawLastWindowScan = await lockCache.get(freshnessKey);
          const lastWindowScanTs = Number(rawLastWindowScan);
          if (
            Number.isFinite(lastWindowScanTs) &&
            lastWindowScanTs > 0 &&
            nowTs - lastWindowScanTs < routeWindowCooldownSec * 1000
          ) {
            skippedByWindowCooldown += 1;
            continue;
          }
        }

        tasks.push({
          originIata: route.originIata,
          destinationIata: route.destinationIata,
          departureDate: window.departureDate,
          returnDate: window.returnDate,
          adults,
          cabinClass,
          attempt: 0,
          maxAttempts,
          metadata: {
            score: route.score,
            priority: route.priority,
            priorityScore: Number(route.priorityScore || 0),
            intelligence: route.intelligence,
            strongDealBoost: Number(route.strongDealBoost || 0),
            expansionBoost: Number(route.expansionBoost || 0),
            windowCooldownSec: routeWindowCooldownSec,
            freshnessKey,
            freshnessTtlSec: Math.max(routeWindowCooldownSec * 2, 1800),
            source: 'route_scheduler'
          }
        });
      }
    }

    const queueResult = await queue.enqueueMany(tasks, { includeResults: true });

    let routesForTick = dueRoutes;
    if (Array.isArray(queueResult?.results) && queueResult.results.length > 0) {
      const acceptedRouteKeys = new Set(
        queueResult.results
          .filter((item) => item?.status === 'enqueued' || item?.status === 'duplicate')
          .map((item) => String(item?.routeKey || '').trim())
          .filter(Boolean)
      );
      routesForTick = dueRoutes.filter((route) => acceptedRouteKeys.has(`${route.originIata}-${route.destinationIata}`));
    } else if (Number(queueResult?.rejected || 0) > 0) {
      routesForTick = [];
      logger.warn(
        {
          rejected: Number(queueResult?.rejected || 0),
          routeCount: dueRoutes.length
        },
        'flight_scan_route_scheduler_tick_skipped_due_to_rejections_without_results'
      );
    }

    if (intelligentPriorityEnabled && typeof lockCache?.setex === 'function' && routesForTick.length > 0) {
      const stamp = String(Date.now());
      for (const route of routesForTick) {
        try {
          await lockCache.setex(route.routeTickKey, Math.max(route.cooldownSec * 4, 900), stamp);
        } catch (error) {
          logger.warn({ err: error, routeTickKey: route.routeTickKey }, 'flight_scan_route_scheduler_tick_update_failed');
        }
      }
    }

    const result = {
      skipped: false,
      reason: null,
      routeCount: candidates.length,
      scheduledRouteCount: dueRoutes.length,
      windowsPerRoute: dueRoutes.length > 0 ? Number((tasks.length / dueRoutes.length).toFixed(2)) : 0,
      windowsByPriority,
      taskCount: tasks.length,
      skippedByPriorityCooldown,
      skippedByLowPriorityCap,
      skippedByWindowCooldown,
      skippedByBackpressure,
      initialQueueDepth,
      backlogSoftLimit,
      backlogHardLimit,
      lowPriorityMaxShare,
      backlogThrottleStartPct,
      intelligentPriorityEnabled,
      strongDealRouteCount: Array.isArray(strongDealRoutes) ? strongDealRoutes.length : 0,
      enqueued: queueResult.enqueued,
      duplicates: queueResult.duplicates,
      rejected: queueResult.rejected
    };

    await updateJob({
      jobId: job.id,
      status: 'success',
      finishedAt: new Date().toISOString(),
      processedCount: tasks.length,
      insertedCount: queueResult.enqueued,
      dedupedCount: queueResult.duplicates,
      failedCount: queueResult.rejected,
      metadata: result
    });

    logger.info(result, 'flight_scan_route_scheduler_completed');
    return result;
  } catch (error) {
    if (job?.id) {
      await updateJob({
        jobId: job.id,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        errorSummary: error?.message || String(error)
      });
    }
    logger.error({ err: error }, 'flight_scan_route_scheduler_failed');
    throw error;
  } finally {
    if (lockEnabled && lockAcquired && typeof lockCache?.del === 'function') {
      try {
        await lockCache.del(lockKey);
      } catch (error) {
        logger.warn({ err: error, lockKey }, 'flight_scan_route_scheduler_lock_release_failed');
      }
    }
  }
}
