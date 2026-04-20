import { getCacheClient } from './cache/index.js';
import { getAiCostGuardMetrics } from './ai-cost-guard.js';
import { getProviderCostGuardMetrics } from './provider-cost-guard.js';
import { getAffiliateStats } from './affiliate-clicks-store.js';
import { getDailySearchUsageSnapshot } from './saas-db.js';
import { getDailyOperationalCostMetrics } from './sql-db.js';
import { readDb } from './db.js';
import { logEconomicEvent } from './economic-logger.js';
import { getQuotaRuntimeMetrics } from '../middleware/quotaGuard.js';

const cacheClient = getCacheClient();
const SNAPSHOT_TTL_MS = 30_000;
let inMemorySnapshot = { at: 0, value: null };

function toPositiveInt(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function dayBucketText(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function monthBucketText(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

function readProviderLimits(env = process.env) {
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  return {
    globalDailyCalls: toPositiveInt(env.SEARCH_PROVIDER_GLOBAL_DAILY_BUDGET, isProduction ? 2500 : 12000)
  };
}

function readAiLimits(env = process.env) {
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  return {
    globalDailyCalls: toPositiveInt(env.AI_BUDGET_GLOBAL_DAILY_CALLS, isProduction ? 320 : 2400),
    globalMonthlyTokens: toPositiveInt(env.AI_BUDGET_GLOBAL_MONTHLY_EST_TOKENS, isProduction ? 3000000 : 12000000)
  };
}

function buildAlerts({ providerUsed, providerLimit, aiUsedTokensMonthly, aiLimitMonthlyTokens, throttledSearch, searchTotal }) {
  const alerts = [];
  const providerPct = providerLimit > 0 ? (providerUsed / providerLimit) * 100 : 0;
  if (providerPct >= 100) alerts.push({ level: 'critical', code: 'provider_budget_exhausted', message: 'Provider daily budget reached 100% or more.' });
  else if (providerPct >= 80) alerts.push({ level: 'warning', code: 'provider_budget_high', message: 'Provider daily budget above 80%.' });

  const aiPct = aiLimitMonthlyTokens > 0 ? (aiUsedTokensMonthly / aiLimitMonthlyTokens) * 100 : 0;
  if (aiPct >= 90) alerts.push({ level: 'critical', code: 'ai_budget_monthly_critical', message: 'AI monthly token budget above 90%.' });
  else if (aiPct >= 70) alerts.push({ level: 'warning', code: 'ai_budget_monthly_warning', message: 'AI monthly token budget above 70%.' });

  const attempts = Number(searchTotal || 0) + Number(throttledSearch || 0);
  const throttlePct = attempts > 0 ? (Number(throttledSearch || 0) / attempts) * 100 : 0;
  if (throttlePct > 20) {
    alerts.push({ level: 'warning', code: 'ux_throttling_high', message: 'More than 20% of search attempts are throttled (429).' });
  }
  return alerts;
}

function buildSuggestions({ providerBudgetExceededEvents, aiBudgetExceededEvents, totalCostPerUser, ctrPercent }) {
  const suggestions = [];
  if (providerBudgetExceededEvents > 0) {
    suggestions.push('Many provider budget blocks detected: increase cache TTL or reduce live destination fan-out.');
  }
  if (totalCostPerUser > 4) {
    suggestions.push('Cost per user is high: reduce search/minute caps or tighten provider retries/timeouts.');
  }
  if (aiBudgetExceededEvents > 0) {
    suggestions.push('AI budget blocks detected: enforce cache-first mode for lower-value AI routes.');
  }
  if (ctrPercent < 1) {
    suggestions.push('CTR is low: review deal CTA copy and placement (product/UX tuning).');
  }
  return suggestions;
}

function countFunnelViews(events = [], sinceMs) {
  let feedViews = 0;
  const activeUsers = new Set();
  const activeSessions = new Set();
  for (const item of events) {
    const atMs = new Date(String(item?.at || 0)).getTime();
    if (!Number.isFinite(atMs) || atMs < sinceMs) continue;
    const eventType = String(item?.eventType || '').trim().toLowerCase();
    if (eventType === 'live_deal_feed_view') feedViews += 1;
    if (item?.userId) activeUsers.add(String(item.userId));
    if (item?.sessionId) activeSessions.add(String(item.sessionId));
  }
  return {
    feedViews,
    activeUsersFromTelemetry: activeUsers.size,
    activeSessionsFromTelemetry: activeSessions.size
  };
}

async function readCacheNumber(key) {
  if (!cacheClient || typeof cacheClient.get !== 'function') return 0;
  const raw = await cacheClient.get(key).catch(() => '0');
  return Number(raw || 0);
}

async function persistDailySnapshotIfNeeded(snapshot) {
  if (!cacheClient || typeof cacheClient.setnx !== 'function') return;
  const dayBucket = String(snapshot?.period?.dayBucket || dayBucketText());
  const lockKey = `cost_monitoring:daily_snapshot:${dayBucket}`;
  const claimed = Number(await cacheClient.setnx(lockKey, '1', 24 * 60 * 60 + 180).catch(() => 0));
  if (claimed !== 1) return;

  logEconomicEvent('daily_cost_per_user', {
    at: new Date().toISOString(),
    user_tier: 'all',
    provider_cost_eur: snapshot?.costs?.providerCostEur || 0,
    ai_cost_eur: snapshot?.costs?.aiCostEur || 0,
    revenue_eur: snapshot?.costs?.revenueEur || 0,
    net_margin_eur: snapshot?.costs?.netMarginEur || 0,
    extra: {
      day_bucket: dayBucket,
      daily_cost_per_user: snapshot?.costPerUser || {},
      daily_calls_per_user: snapshot?.callsPerUser || {},
      throttled_search_429: snapshot?.search?.throttled429 || 0
    }
  });
}

export async function getCostCapMonitoringSnapshot({ force = false } = {}) {
  const now = Date.now();
  if (!force && inMemorySnapshot.value && now - inMemorySnapshot.at < SNAPSHOT_TTL_MS) {
    return inMemorySnapshot.value;
  }

  const sinceIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sinceMs = new Date(sinceIso).getTime();
  const dayBucket = dayBucketText(new Date(now));
  const monthBucket = monthBucketText(new Date(now));

  const [opsCost, usageSnapshot, affiliateStats, quotaMetrics, db] = await Promise.all([
    getDailyOperationalCostMetrics({ sinceIso }),
    getDailySearchUsageSnapshot({ sinceIso }),
    getAffiliateStats(1),
    getQuotaRuntimeMetrics(),
    readDb()
  ]);

  const providerLimits = readProviderLimits(process.env);
  const aiLimits = readAiLimits(process.env);
  const providerUsed = await readCacheNumber(`provider:budget:global:day:${dayBucket}:calls`);
  const aiUsedCalls = await readCacheNumber(`ai:budget:global:day:${dayBucket}:calls`);
  const aiUsedTokensDaily = await readCacheNumber(`ai:budget:global:day:${dayBucket}:est_tokens`);
  const aiUsedTokensMonthly = await readCacheNumber(`ai:budget:global:month:${monthBucket}:est_tokens`);

  const providerMetrics = getProviderCostGuardMetrics();
  const aiMetrics = getAiCostGuardMetrics();

  const telemetryEvents = Array.isArray(db?.clientTelemetryEvents) ? db.clientTelemetryEvents : [];
  const telemetry = countFunnelViews(telemetryEvents, sinceMs);
  const redirectClicks = Number(affiliateStats?.summary?.total_clicks || 0);
  const ctrPercent = telemetry.feedViews > 0 ? round4((redirectClicks / telemetry.feedViews) * 100) : 0;

  const activeUsers = Math.max(
    Number(opsCost?.searches?.uniqueUsers || 0),
    Number(usageSnapshot?.uniqueUsers || 0),
    Number(affiliateStats?.summary?.unique_users || 0),
    Number(telemetry.activeUsersFromTelemetry || 0),
    1
  );
  const activeSessions = Math.max(Number(usageSnapshot?.uniqueSessions || 0), Number(telemetry.activeSessionsFromTelemetry || 0), 1);

  const providerCostEur = round4(Number(opsCost?.costs?.providerCostEur || 0));
  const aiCostEur = round4(Number(opsCost?.costs?.aiCostEur || 0));
  const totalCostEur = round4(providerCostEur + aiCostEur);
  const providerCostPerUser = round4(providerCostEur / activeUsers);
  const aiCostPerUser = round4(aiCostEur / activeUsers);
  const totalCostPerUser = round4(totalCostEur / activeUsers);

  const totalSearch = Number(usageSnapshot?.totalSearchEvents || opsCost?.searches?.total || 0);
  const throttledSearch = Number(quotaMetrics?.throttledSearch || 0);

  const providerBudgetExceededEvents = Object.entries(providerMetrics?.reasons || {})
    .filter(([reason]) => reason.includes('exceeded'))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);
  const aiBudgetExceededEvents = Object.entries(aiMetrics?.reasons || {})
    .filter(([reason]) => reason.includes('exceeded'))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);

  const providerBudgetUsedPercent = providerLimits.globalDailyCalls > 0 ? round4((providerUsed / providerLimits.globalDailyCalls) * 100) : 0;
  const aiBudgetMonthlyUsedPercent = aiLimits.globalMonthlyTokens > 0 ? round4((aiUsedTokensMonthly / aiLimits.globalMonthlyTokens) * 100) : 0;

  const alerts = buildAlerts({
    providerUsed,
    providerLimit: providerLimits.globalDailyCalls,
    aiUsedTokensMonthly,
    aiLimitMonthlyTokens: aiLimits.globalMonthlyTokens,
    throttledSearch,
    searchTotal: totalSearch
  });

  const suggestions = buildSuggestions({
    providerBudgetExceededEvents,
    aiBudgetExceededEvents,
    totalCostPerUser,
    ctrPercent
  });

  const snapshot = {
    generatedAt: new Date(now).toISOString(),
    period: { sinceIso, dayBucket, monthBucket },
    search: {
      total: totalSearch,
      perUser: round4(totalSearch / activeUsers),
      perSession: round4(totalSearch / activeSessions),
      throttled429: throttledSearch,
      activeUsers,
      activeSessions
    },
    provider: {
      callsTotal: providerUsed,
      callsPerUser: round4(providerUsed / activeUsers),
      blockedByBudget: Number(providerMetrics?.blocked || 0),
      budgetExceededEvents: providerBudgetExceededEvents,
      budgetUsedPercent: providerBudgetUsedPercent
    },
    ai: {
      callsTotal: aiUsedCalls,
      callsPerUser: round4(aiUsedCalls / activeUsers),
      tokensDaily: aiUsedTokensDaily,
      tokensMonthly: aiUsedTokensMonthly,
      budgetExceededEvents: aiBudgetExceededEvents,
      budgetUsedPercent: aiBudgetMonthlyUsedPercent
    },
    monetization: {
      redirectClicks,
      feedViews: telemetry.feedViews,
      ctrPercent,
      activeUsers
    },
    costs: {
      providerCostEur,
      aiCostEur,
      totalCostEur,
      revenueEur: round4(Number(opsCost?.costs?.revenueEur || 0)),
      netMarginEur: round4(Number(opsCost?.costs?.netMarginEur || 0))
    },
    costPerUser: {
      provider: providerCostPerUser,
      ai: aiCostPerUser,
      total: totalCostPerUser
    },
    callsPerUser: {
      search: round4(totalSearch / activeUsers),
      provider: round4(providerUsed / activeUsers),
      ai: round4(aiUsedCalls / activeUsers)
    },
    alerts,
    suggestions
  };

  await persistDailySnapshotIfNeeded(snapshot);
  inMemorySnapshot = { at: now, value: snapshot };
  return snapshot;
}
