/**
 * require-forecast-access.js
 *
 * Middleware to protect endpoints that provide forecast data.
 * Ensures the user has a PRO or ELITE plan.
 */

import { canAccessForecast, getUpgradeContext } from '../lib/plan-access.js';

export function requireForecastAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'authentication_required' });
  }

  if (canAccessForecast(req.user)) {
    return next();
  }

  return res.status(403).json({
    error: 'premium_required',
    message: 'Access to forecast data requires a PRO or ELITE plan.',
    upgrade_context: getUpgradeContext(req.user, 'forecast')
  });
}