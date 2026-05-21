import { appendImmutableAudit } from '../lib/audit-log.js';
import { logger } from '../lib/logger.js';
import { refreshOurAirportsCatalog } from '../lib/ourairports-catalog.js';

export async function runOurAirportsRefreshOnce({ reason = 'manual' } = {}) {
  const result = await refreshOurAirportsCatalog();
  appendImmutableAudit({
    category: 'flight_catalog',
    type: 'ourairports_refresh',
    success: true,
    detail: `reason=${reason}; status=${result.status}; iataCodes=${result.iataCodes}`
  }).catch(() => {});
  logger.info({ reason, ...result }, 'ourairports_catalog_refreshed');
  return result;
}
