import { runRouteSchedulerOnce } from '../lib/scan/route-scheduler.js';
import { runFlightScanCycleOnce as runFlightScanCycleCore } from '../lib/scan/scan-orchestrator.js';
import { runScanWorkerOnce } from '../lib/scan/scan-worker.js';
import { parseFlag } from '../lib/env-flags.js';
import { runDealsContentWorkerOnce } from './deals-content-worker.js';
import { runDetectedDealsWorkerOnce } from './detected-deals-worker.js';
import { runPriceAlertsWorkerOnce } from './price-alerts-worker.js';
import { runRoutePriceStatsWorkerOnce } from './route-price-stats-worker.js';

export async function runFlightScanSchedulerOnce(options = {}) {
  return runRouteSchedulerOnce(options);
}

export async function runFlightScanWorkerOnce(options = {}) {
  return runScanWorkerOnce(options);
}

export async function runFlightScanCycleOnce(options = {}) {
  if (typeof options.runDownstreamPipeline === 'function') {
    return runFlightScanCycleCore(options);
  }

  return runFlightScanCycleCore({
    ...options,
    runDownstreamPipeline: async () => {
      const includeRoutePriceStats = parseFlag(options.includeRoutePriceStats ?? process.env.FLIGHT_SCAN_DOWNSTREAM_ROUTE_PRICE_STATS, true);
      const includeDetectedDeals = parseFlag(options.includeDetectedDeals ?? process.env.FLIGHT_SCAN_DOWNSTREAM_DETECTED_DEALS, true);
      const includePriceAlerts = parseFlag(options.includePriceAlerts ?? process.env.FLIGHT_SCAN_DOWNSTREAM_PRICE_ALERTS, false);
      const includeDealsContent = parseFlag(options.includeDealsContent ?? process.env.FLIGHT_SCAN_DOWNSTREAM_DEALS_CONTENT, false);

      const out = {};
      if (includeRoutePriceStats) {
        out.routePriceStats = await runRoutePriceStatsWorkerOnce(options.routePriceStatsOptions || {});
      }
      if (includeDetectedDeals) {
        out.detectedDeals = await runDetectedDealsWorkerOnce(options.detectedDealsOptions || {});
      }
      if (includePriceAlerts) {
        out.priceAlerts = await runPriceAlertsWorkerOnce(options.priceAlertsOptions || {});
      }
      if (includeDealsContent) {
        out.dealsContent = await runDealsContentWorkerOnce(options.dealsContentOptions || {});
      }

      return Object.keys(out).length > 0 ? out : { skipped: true, reason: 'no_downstream_selected' };
    }
  });
}
