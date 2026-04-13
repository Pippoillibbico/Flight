import { runDiscoveryAlertWorkerOnce } from '../server/jobs/discovery-alert-worker.js';
import { runOpportunityPipelineOnce } from '../server/jobs/opportunity-pipeline-worker.js';
import { runRadarMatchPrecomputeOnce } from '../server/jobs/radar-match-precompute-worker.js';
import { runNightlyRouteBaselineJob } from '../server/jobs/route-baselines.js';
import { runPriceIngestionWorkerOnce } from '../server/lib/price-ingestion-worker.js';

const worker = String(process.argv[2] || '').trim().toLowerCase();

async function run() {
  if (worker === 'price-ingestion') {
    const result = await runPriceIngestionWorkerOnce({ maxJobs: 500 });
    console.log(JSON.stringify({ worker, ...result }, null, 2));
    return;
  }
  if (worker === 'route-baseline') {
    const result = await runNightlyRouteBaselineJob({ reason: 'manual_script' });
    console.log(JSON.stringify({ worker, ...result }, null, 2));
    return;
  }
  if (worker === 'discovery-alert') {
    const result = await runDiscoveryAlertWorkerOnce({ limit: 500 });
    console.log(JSON.stringify({ worker, ...result }, null, 2));
    return;
  }
  if (worker === 'opportunity-pipeline') {
    const result = await runOpportunityPipelineOnce();
    console.log(JSON.stringify({ worker, ...result }, null, 2));
    return;
  }
  if (worker === 'radar-match-precompute') {
    const result = await runRadarMatchPrecomputeOnce();
    console.log(JSON.stringify({ worker, ...result }, null, 2));
    return;
  }

  console.error('Usage: node scripts/run-worker.mjs <price-ingestion|route-baseline|discovery-alert|opportunity-pipeline|radar-match-precompute>');
  process.exit(1);
}

run().catch((error) => {
  console.error('worker run failed', error?.message || error);
  process.exit(1);
});
