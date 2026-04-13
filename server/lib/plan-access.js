const PLAN_TYPES = ['free', 'pro', 'elite'];
const PLAN_STATUS = ['active', 'past_due', 'canceled'];

export function normalizePlanType(value, fallbackPremium = false) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'creator') return 'elite';
  if (PLAN_TYPES.includes(raw)) return raw;
  return fallbackPremium ? 'pro' : 'free';
}

export function normalizePlanStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (PLAN_STATUS.includes(raw)) return raw;
  return 'active';
}

export function resolveUserPlan(user) {
  const planType = normalizePlanType(user?.planType || user?.plan_type, Boolean(user?.isPremium));
  const planStatus = normalizePlanStatus(user?.planStatus || user?.plan_status);
  return { planType, planStatus };
}

export function canViewUnlimitedOpportunities(user) {
  const { planType } = resolveUserPlan(user);
  return planType === 'pro' || planType === 'elite';
}

export function canUseRadar(user) {
  return canViewUnlimitedOpportunities(user);
}

export function canUseAITravel(user) {
  const { planType } = resolveUserPlan(user);
  return planType === 'elite';
}

export function canViewRareOpportunities(user) {
  const { planType } = resolveUserPlan(user);
  return planType === 'elite';
}

export function setUserPlan(user, nextPlanType) {
  if (!user) return user;
  const planType = normalizePlanType(nextPlanType, Boolean(user?.isPremium));
  const planStatus = 'active';
  user.planType = planType;
  user.planStatus = planStatus;
  user.isPremium = planType !== 'free';
  user.premiumSince = planType !== 'free' ? new Date().toISOString() : null;
  return user;
}

