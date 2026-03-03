import { appendImmutableAudit } from '../lib/audit-log.js';
import { logger } from '../lib/logger.js';
import { initDealEngineStore, recomputeRouteBaselines } from '../lib/deal-engine-store.js';

export async function runNightlyRouteBaselineJob({ reason = 'manual' } = {}) {
  await initDealEngineStore();
  const result = await recomputeRouteBaselines();
  appendImmutableAudit({
    category: 'deal_engine',
    type: 'route_baseline_recompute',
    success: true,
    detail: `reason=${reason}; upsertedRows=${result.upsertedRows}; baselineRows=${result.baselineRows}`
  }).catch(() => {});
  logger.info({ reason, ...result }, 'route_baselines_recomputed');
  return result;
}
