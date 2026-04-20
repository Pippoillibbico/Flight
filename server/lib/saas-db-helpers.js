import { createHash, randomBytes } from 'node:crypto';

const COUNTER_NAMES = ['read', 'search', 'decision', 'alerts', 'notifications', 'export'];

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyCredits: 0,
    priceEur: 0,
    aiEnabled: false,
    apiKeysMax: 0,
    features: { exports: false, apiKeys: false, aiIncluded: false },
    // 10 searches/day × 30 = 300/month; decision disabled (AI hard-blocked for free)
    quotas: { read: 400, search: 300, decision: 0, alerts: 40, notifications: 80, export: 0 }
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyCredits: 500,
    priceEur: 12.99,
    // AI premium access is ELITE/CREATOR only (enforced in auth/plan gates).
    aiEnabled: false,
    apiKeysMax: 10,
    features: { exports: false, apiKeys: true, aiIncluded: false },
    // 40 searches/day × 30 = 1200/month; no AI decision for pro
    quotas: { read: 4000, search: 1200, decision: 0, alerts: 400, notifications: 900, export: 0 }
  },
  creator: {
    id: 'creator',
    name: 'Creator',
    monthlyCredits: 2000,
    priceEur: 29.99,
    aiEnabled: true,
    apiKeysMax: 50,
    features: { exports: true, apiKeys: true, aiIncluded: true },
    // 100 searches/day × 30 = 3000/month; 8 AI calls/day × 30 = 240/month
    quotas: { read: 16000, search: 3000, decision: 240, alerts: 2200, notifications: 4000, export: 400 }
  }
};

function randomId() {
  return randomBytes(12).toString('hex');
}

function hashKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function monthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthResetIso(periodKey) {
  const [y, m] = String(periodKey || '').split('-').map((n) => Number(n));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return nowIso();
  return new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString();
}

function normalizePlanId(planId) {
  return PLANS[planId] ? planId : 'free';
}

function mapPlanRowToModel(planId, row = null) {
  const plan = PLANS[normalizePlanId(planId)];
  return {
    id: row?.id || randomId(),
    userId: row?.user_id ?? row?.userId,
    planId: plan.id,
    status: row?.status || 'active',
    extraCredits: Number(row?.extra_credits ?? row?.extraCredits ?? 0),
    currentPeriodStart: row?.current_period_start ?? row?.currentPeriodStart ?? nowIso(),
    currentPeriodEnd:
      row?.current_period_end ??
      row?.currentPeriodEnd ??
      new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
    monthly_credits: Number(row?.monthly_credits ?? plan.monthlyCredits),
    price_monthly_eur: Number(row?.price_monthly_eur ?? plan.priceEur),
    features: row?.features || plan.features
  };
}

function planCounterLimit(planId, counter) {
  const key = String(counter || '').trim().toLowerCase();
  const plan = PLANS[normalizePlanId(planId)];
  return Number(plan.quotas?.[key] ?? 0);
}

function buildDefaultApiKeyQuota(planId) {
  const plan = PLANS[normalizePlanId(planId)];
  return {
    read: Math.max(0, Math.floor((plan.quotas.read || 0) * 0.8)),
    search: Math.max(0, Math.floor((plan.quotas.search || 0) * 0.8)),
    decision: Math.max(0, Math.floor((plan.quotas.decision || 0) * 0.8)),
    alerts: Math.max(0, Math.floor((plan.quotas.alerts || 0) * 0.8)),
    notifications: Math.max(0, Math.floor((plan.quotas.notifications || 0) * 0.8)),
    export: Math.max(0, Math.floor((plan.quotas.export || 0) * 0.8))
  };
}

function sanitizeScopes(scopes) {
  const allowed = new Set(['read', 'search', 'alerts', 'export']);
  const clean = Array.isArray(scopes) ? scopes : [];
  const unique = [...new Set(clean.map((s) => String(s || '').toLowerCase()))].filter((s) => allowed.has(s));
  return unique.length > 0 ? unique : ['read'];
}

function normalizeCounterCost(cost) {
  if (typeof cost === 'number') {
    return { counter: 'search', amount: Math.max(1, Math.floor(cost)) };
  }
  const counter = String(cost?.counter || 'search').trim().toLowerCase();
  const amount = Math.max(1, Math.floor(Number(cost?.amount ?? 1)));
  return { counter, amount };
}

function countersWithIncrement(counters, counter, amount) {
  const next = { ...(counters || {}) };
  next[counter] = Number(next[counter] || 0) + amount;
  return next;
}

function getCounter(counters, counter) {
  return Number(counters?.[counter] || 0);
}

function mapRemaining(limits, counters) {
  const out = {};
  for (const counter of COUNTER_NAMES) {
    const limit = Number(limits?.[counter] || 0);
    const used = Number(counters?.[counter] || 0);
    out[counter] = Math.max(0, limit - used);
  }
  return out;
}

export {
  COUNTER_NAMES,
  PLANS,
  buildDefaultApiKeyQuota,
  countersWithIncrement,
  getCounter,
  hashKey,
  mapPlanRowToModel,
  mapRemaining,
  monthKey,
  monthResetIso,
  normalizeCounterCost,
  normalizePlanId,
  nowIso,
  planCounterLimit,
  randomId,
  sanitizeScopes
};
