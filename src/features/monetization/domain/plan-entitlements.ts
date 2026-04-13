import type { PlanEntitlements, UsageLimitState, UserPlan } from '../types/index.ts';

const PLAN_RANK: Record<UserPlan, number> = {
  free: 0,
  pro: 1,
  elite: 2
};

const PLAN_ENTITLEMENTS: Record<UserPlan, PlanEntitlements> = {
  free: {
    plan: 'free',
    trackedRoutesLimit: 3,
    savedItinerariesLimit: 3,
    aiTravelCandidatesLimit: 3,
    radarMessagingTier: 'basic',
    hasPriorityDealsMessaging: false
  },
  pro: {
    plan: 'pro',
    trackedRoutesLimit: 10,
    savedItinerariesLimit: 10,
    aiTravelCandidatesLimit: null,
    radarMessagingTier: 'advanced',
    hasPriorityDealsMessaging: false
  },
  elite: {
    plan: 'elite',
    trackedRoutesLimit: null,
    savedItinerariesLimit: null,
    aiTravelCandidatesLimit: null,
    radarMessagingTier: 'priority',
    hasPriorityDealsMessaging: true
  }
};

export function normalizeUserPlan(value: unknown): UserPlan {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'elite' || raw === 'creator') return 'elite';
  if (raw === 'pro') return 'pro';
  return 'free';
}

export function getPlanRank(plan: UserPlan): number {
  return PLAN_RANK[plan];
}

export function resolveEffectivePlan(primaryPlan: unknown, secondaryPlan?: unknown): UserPlan {
  const first = normalizeUserPlan(primaryPlan);
  const second = normalizeUserPlan(secondaryPlan);
  return PLAN_RANK[first] >= PLAN_RANK[second] ? first : second;
}

export function getPlanEntitlements(plan: unknown): PlanEntitlements {
  const normalized = normalizeUserPlan(plan);
  return PLAN_ENTITLEMENTS[normalized];
}

export function evaluateUsageLimit(usedCount: unknown, limit: number | null): UsageLimitState {
  const used = Math.max(0, Math.round(Number(usedCount) || 0));
  if (limit === null || !Number.isFinite(limit) || limit <= 0) {
    return {
      limit: null,
      used,
      remaining: null,
      reached: false
    };
  }

  const normalizedLimit = Math.max(1, Math.round(limit));
  const remaining = Math.max(0, normalizedLimit - used);
  return {
    limit: normalizedLimit,
    used,
    remaining,
    reached: used >= normalizedLimit
  };
}
