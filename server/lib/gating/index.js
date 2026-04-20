/**
 * Feature gating / entitlements facade.
 */

export {
  PLAN_LIMITS,
  canAccessForecast,
  canConfigureRadar,
  canExportData,
  canUseAITravel,
  canUseRadar,
  canUseSmartAlerts,
  canViewRareOpportunities,
  canViewUnlimitedOpportunities,
  getFollowsLimit,
  getRadarOriginsLimit,
  getUpgradeContext,
  normalizePlanStatus,
  normalizePlanType,
  resolveUserPlan,
  setUserPlan
} from '../plan-access.js';

export { requireForecastAccess } from '../require-forecast-access.js';
