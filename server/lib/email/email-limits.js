import { normalizePlanType } from '../plan-access.js';

export const EMAIL_LIMITS = {
  free: {
    weeklyDigest: 1,
    instantAlerts: 0
  },
  pro: {
    dailyDigest: 1,
    instantAlertsPerDay: 5
  },
  elite: {
    dailyDigest: 3,
    instantAlertsPerDay: 20
  }
};

export function getEmailLimits(planType) {
  return EMAIL_LIMITS[normalizePlanType(planType, false)] || EMAIL_LIMITS.free;
}

export function canSendInstantAlertForPlan(planType) {
  const plan = normalizePlanType(planType, false);
  const limits = getEmailLimits(plan);
  return Number(limits.instantAlertsPerDay || limits.instantAlerts || 0) > 0;
}

export function digestCadenceForPlan(planType) {
  const plan = normalizePlanType(planType, false);
  if (plan === 'free') return 'weekly';
  return 'daily';
}
