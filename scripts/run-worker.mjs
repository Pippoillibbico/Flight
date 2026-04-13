import 'dotenv/config';
import { runDiscoveryAlertWorkerOnce } from '../server/jobs/discovery-alert-worker.js';
import { runDetectedDealsWorkerOnce } from '../server/jobs/detected-deals-worker.js';
import { runFlightScanCycleOnce, runFlightScanSchedulerOnce, runFlightScanWorkerOnce } from '../server/jobs/flight-scan-worker.js';
import { runOpportunityPipelineOnce } from '../server/jobs/opportunity-pipeline-worker.js';
import { runRadarMatchPrecomputeOnce } from '../server/jobs/radar-match-precompute-worker.js';
import { runRoutePriceStatsWorkerOnce } from '../server/jobs/route-price-stats-worker.js';
import { runPriceAlertsWorkerOnce } from '../server/jobs/price-alerts-worker.js';
import { runDealsContentWorkerOnce } from '../server/jobs/deals-content-worker.js';
import { runNightlyRouteBaselineJob } from '../server/jobs/route-baselines.js';
import { closeCacheClient } from '../server/lib/free-cache.js';
import { runPriceIngestionWorkerOnce } from '../server/lib/price-ingestion-worker.js';

const worker = String(process.argv[2] || '').trim().toLowerCase();

function compactForCli(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}...[truncated]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => compactForCli(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    const entries = Object.entries(value).slice(0, 40);
    for (const [key, item] of entries) {
      out[key] = compactForCli(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

function printWorkerResult(workerName, result) {
  try {
    console.log(JSON.stringify({ worker: workerName, ...result }, null, 2));
    return;
  } catch {}
  const compact = compactForCli(result);
  try {
    console.log(JSON.stringify({ worker: workerName, ...compact }, null, 2));
  } catch {
    console.log(JSON.stringify({ worker: workerName, status: 'completed', note: 'result output truncated' }, null, 2));
  }
}

async function run() {
  if (worker === 'price-ingestion') {
    const result = await runPriceIngestionWorkerOnce({ maxJobs: 500 });
    printWorkerResult(worker, result);
    return;
  }
  if (worker === 'route-baseline') {
    const result = await runNightlyRouteBaselineJob({ reason: 'manual_script' });
    printWorkerResult(worker, result);
    return;
  }
  if (worker === 'discovery-alert') {
    const result = await runDiscoveryAlertWorkerOnce({ limit: 500 });
    printWorkerResult(worker, result);
    return;
  }
  if (worker === 'opportunity-pipeline') {
    const result = await runOpportunityPipelineOnce();
    printWorkerResult(worker, result);
    return;
  }
  if (worker === 'radar-match-precompute') {
    const result = await runRadarMatchPrecomputeOnce();
    printWorkerResult(worker, result);
    return;
  }
  if (worker === 'flight-scan-scheduler') {
    const result = await runFlightScanSchedulerOnce({ enabled: true });
    printWorkerResult(worker, result);
    return;
  }
  if (worker === 'flight-scan-worker') {
    const result = await runFlightScanWorkerOnce({ enabled: true });
    printWorkerResult(worker, result);
    return;
  }
  if (worker === 'flight-scan-cycle') {
    const result = await runFlightScanCycleOnce({ enabled: true, runScheduler: true, stopWhenQueueEmpty: true });
    printWorkerResult(worker, result);
    return;
  }
  if (worker === 'route-price-stats') {
    const result = await runRoutePriceStatsWorkerOnce();
    printWorkerResult(worker, result);
    return;
  }
  if (worker === 'detected-deals') {
    const result = await runDetectedDealsWorkerOnce();
    printWorkerResult(worker, result);
    return;
  }
  if (worker === 'price-alerts') {
    const result = await runPriceAlertsWorkerOnce();
    printWorkerResult(worker, result);
    return;
  }
  if (worker === 'deals-content') {
    const result = await runDealsContentWorkerOnce();
    printWorkerResult(worker, result);
    return;
  }

  console.error(
    'Usage: node scripts/run-worker.mjs <price-ingestion|route-baseline|discovery-alert|opportunity-pipeline|radar-match-precompute|flight-scan-scheduler|flight-scan-worker|flight-scan-cycle|route-price-stats|detected-deals|price-alerts|deals-content>'
  );
  process.exit(1);
}

run()
  .catch((error) => {
    console.error('worker run failed', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeCacheClient();
    } catch {}
    if (process.exitCode && process.exitCode !== 0) {
      process.exit(process.exitCode);
    }
  });
