import { getOrCreateSubscription } from './saas-db.js';
import { normalizePlanType, resolveUserPlan } from './plan-access.js';

export const PAID_CAPABILITIES = Object.freeze([
  'ai_live',
  'provider_live',
  'triangulation_live',
  'month_scan_live',
  'live_alerts',
  'discovery_live',
  'deal_engine_live'
]);

export const FREE_SAFE_CAPABILITIES = Object.freeze([
  'cached_preview',
  'static_recommendations',
  'local_search'
]);

const CAPABILITY_MATRIX = Object.freeze({
  free: Object.freeze({
    ai_live: false,
    provider_live: false,
    triangulation_live: false,
    month_scan_live: false,
    live_alerts: false,
    discovery_live: false,
    deal_engine_live: false,
    cached_preview: true,
    static_recommendations: true,
    local_search: true,
    advanced_automations: false,
    advanced_alerts: false,
    triangulation_monitoring: false,
    creator_power_tools: false
  }),
  pro: Object.freeze({
    ai_live: true,
    provider_live: true,
    triangulation_live: true,
    month_scan_live: true,
    live_alerts: true,
    discovery_live: true,
    deal_engine_live: true,
    cached_preview: true,
    static_recommendations: true,
    local_search: true,
    advanced_automations: false,
    advanced_alerts: false,
    triangulation_monitoring: false,
    creator_power_tools: false
  }),
  elite: Object.freeze({
    ai_live: true,
    provider_live: true,
    triangulation_live: true,
    month_scan_live: true,
    live_alerts: true,
    discovery_live: true,
    deal_engine_live: true,
    cached_preview: true,
    static_recommendations: true,
    local_search: true,
    advanced_automations: true,
    advanced_alerts: true,
    triangulation_monitoring: true,
    creator_power_tools: true
  })
});

const CAPABILITY_MODES = Object.freeze({
  ai_live: 'live',
  provider_live: 'live',
  triangulation_live: 'live_triangulation',
  month_scan_live: 'live_month_scan',
  live_alerts: 'live_alerts',
  discovery_live: 'live_discovery',
  deal_engine_live: 'live_deal_engine',
  cached_preview: 'cached_preview',
  static_recommendations: 'static_recommendations',
  local_search: 'local_search',
  advanced_automations: 'advanced_automations',
  advanced_alerts: 'advanced_alerts',
  triangulation_monitoring: 'triangulation_monitoring',
  creator_power_tools: 'creator_power_tools'
});

const CAPABILITY_REASONS = Object.freeze({
  ai_live: 'ai_live_requires_paid_plan',
  provider_live: 'provider_live_requires_paid_plan',
  triangulation_live: 'triangulation_live_requires_paid_plan',
  month_scan_live: 'month_scan_live_requires_paid_plan',
  live_alerts: 'live_alerts_requires_paid_plan',
  discovery_live: 'discovery_live_requires_paid_plan',
  deal_engine_live: 'deal_engine_live_requires_paid_plan',
  advanced_automations: 'advanced_automations_requires_creator_plan',
  advanced_alerts: 'advanced_alerts_requires_creator_plan',
  triangulation_monitoring: 'triangulation_monitoring_requires_creator_plan',
  creator_power_tools: 'creator_power_tools_requires_creator_plan'
});

function normalizeCapability(capability) {
  return String(capability || '').trim().toLowerCase();
}

function normalizePlanId(planId) {
  return normalizePlanType(planId, false);
}

export function listAllowedCapabilities(planId) {
  const matrix = CAPABILITY_MATRIX[normalizePlanId(planId)] || CAPABILITY_MATRIX.free;
  return Object.entries(matrix)
    .filter(([, allowed]) => Boolean(allowed))
    .map(([capability]) => capability);
}

export function canUsePaidCapability(planId, capability) {
  const key = normalizeCapability(capability);
  const matrix = CAPABILITY_MATRIX[normalizePlanId(planId)] || CAPABILITY_MATRIX.free;
  return Boolean(matrix[key]);
}

export function getCapabilityMode(planId, capability) {
  const key = normalizeCapability(capability);
  const normalizedPlan = normalizePlanId(planId);
  const allowed = canUsePaidCapability(normalizedPlan, key);
  if (allowed) return CAPABILITY_MODES[key] || 'live';
  if (normalizedPlan === 'free' && PAID_CAPABILITIES.includes(key)) return 'cached_preview';
  return 'blocked';
}

export function buildCapabilityBlockedPayload(planId, capability, extra = {}) {
  const key = normalizeCapability(capability);
  return {
    mode: getCapabilityMode(planId, key),
    paidCostUsed: false,
    upgradeRequired: true,
    reason: CAPABILITY_REASONS[key] || 'live_capability_requires_paid_plan',
    allowedCapabilities: listAllowedCapabilities(planId),
    ...extra
  };
}

export function buildCapabilityAllowedPayload(planId, capability, extra = {}) {
  return {
    mode: getCapabilityMode(planId, capability),
    paidCostUsed: PAID_CAPABILITIES.includes(normalizeCapability(capability)),
    upgradeRequired: false,
    ...extra
  };
}

export async function resolveRequestPlanId(req) {
  const userPlan = normalizePlanId(req?.user?.planType || req?.user?.plan || req?.user?.plan_id || '');
  if (userPlan !== 'free') return userPlan;
  const userId = req?.user?.sub || req?.user?.id || '';
  if (userId) {
    try {
      const subscription = await getOrCreateSubscription(String(userId));
      return normalizePlanId(subscription?.planId || req?.user?.planType || req?.user?.plan || 'free');
    } catch {
      // Fall through to the request user shape. Failing closed means unknown users become Free.
    }
  }
  return normalizePlanId(resolveUserPlan(req?.user || null).planType);
}

export async function assertPaidCapability(req, capability) {
  const planId = await resolveRequestPlanId(req);
  if (canUsePaidCapability(planId, capability)) {
    return buildCapabilityAllowedPayload(planId, capability, { planId });
  }
  // Cost governance rule: FREE plan must never trigger paid variable-cost capabilities.
  return buildCapabilityBlockedPayload(planId, capability, { planId });
}

export function sendCapabilityBlocked(res, guard, status = 403, extra = {}) {
  return res.status(status).json({
    ...guard,
    ...extra
  });
}
