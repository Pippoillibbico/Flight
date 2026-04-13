import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const appLogPath = resolve(root, 'data', 'logs', 'app.log');
const outputPath = resolve(root, 'data', 'logs', 'slo-dashboard.json');

const SLO_ERROR_RATE_MAX = Number(process.env.SLO_ERROR_RATE_MAX || 0.01);
const SLO_P95_MS_MAX = Number(process.env.SLO_P95_MS_MAX || 800);
const SLO_WORKER_FAILURES_MAX = Number(process.env.SLO_WORKER_FAILURES_MAX || 3);
const SLO_MIN_REQUESTS = Math.max(0, Number(process.env.SLO_MIN_REQUESTS || 100));
const windowHours = Math.max(1, Number(process.env.SLO_WINDOW_HOURS || 24));
const enforce = process.argv.includes('--enforce');
const requireSample = String(process.env.SLO_REQUIRE_SAMPLE || 'false').trim().toLowerCase() === 'true';
const includeHealthEndpoints = String(process.env.SLO_INCLUDE_HEALTH_ENDPOINTS || 'false').trim().toLowerCase() === 'true';
const excludedEndpointPrefixes = includeHealthEndpoints
  ? []
  : String(process.env.SLO_EXCLUDED_ENDPOINT_PREFIXES || '/health,/healthz,/api/health')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[pos];
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isWorkerFailure(entry) {
  const msg = String(entry?.msg || '').toLowerCase();
  return msg.includes('worker_failed') || msg.includes('cron_job_failed') || msg.includes('startup_task_failed');
}

function endpointWithoutQuery(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) return '';
  const queryIndex = value.indexOf('?');
  return queryIndex === -1 ? value : value.slice(0, queryIndex);
}

function isExcludedEndpoint(endpoint) {
  if (!endpoint || excludedEndpointPrefixes.length === 0) return false;
  return excludedEndpointPrefixes.some((prefix) => endpoint === prefix || endpoint.startsWith(prefix));
}

async function readEntries() {
  try {
    const raw = await readFile(appLogPath, 'utf8');
    return String(raw || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(safeJson)
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function main() {
  const entries = await readEntries();
  const thresholdMs = Date.now() - windowHours * 60 * 60 * 1000;
  const windowEntries = entries.filter((entry) => {
    const at = Date.parse(entry?.time || '');
    return Number.isFinite(at) ? at >= thresholdMs : false;
  });

  const requestEntriesAll = windowEntries.filter((entry) => String(entry?.msg || '').startsWith('request_'));
  const requestEntries = requestEntriesAll.filter((entry) => {
    const endpoint = endpointWithoutQuery(entry?.endpoint);
    return !isExcludedEndpoint(endpoint);
  });
  const latencyValues = requestEntries.map((entry) => Number(entry?.durationMs || 0)).filter((v) => Number.isFinite(v) && v >= 0);
  const totalRequests = requestEntries.length;
  const excludedRequests = Math.max(0, requestEntriesAll.length - totalRequests);
  const errors5xx = requestEntries.filter((entry) => Number(entry?.status_code || 0) >= 500).length;
  const errorRate = totalRequests > 0 ? errors5xx / totalRequests : 0;
  const p95LatencyMs = quantile(latencyValues, 0.95);
  const workerFailures = windowEntries.filter(isWorkerFailure).length;
  const requestSampleSufficient = totalRequests >= SLO_MIN_REQUESTS;
  const errorRateOk = requestSampleSufficient ? errorRate <= SLO_ERROR_RATE_MAX : true;
  const p95LatencyOk = requestSampleSufficient ? p95LatencyMs <= SLO_P95_MS_MAX : true;
  const sampleGateOk = requestSampleSufficient || !requireSample;

  const alerts = [
    {
      id: 'request_sample',
      threshold: SLO_MIN_REQUESTS,
      value: totalRequests,
      ok: sampleGateOk,
      required: requireSample
    },
    {
      id: 'error_rate',
      threshold: SLO_ERROR_RATE_MAX,
      value: Number(errorRate.toFixed(6)),
      ok: errorRateOk,
      sampleSufficient: requestSampleSufficient
    },
    {
      id: 'latency_p95_ms',
      threshold: SLO_P95_MS_MAX,
      value: Number(p95LatencyMs.toFixed(2)),
      ok: p95LatencyOk,
      sampleSufficient: requestSampleSufficient
    },
    { id: 'worker_failures', threshold: SLO_WORKER_FAILURES_MAX, value: workerFailures, ok: workerFailures <= SLO_WORKER_FAILURES_MAX }
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    windowHours,
    config: {
      includeHealthEndpoints,
      excludedEndpointPrefixes
    },
    slo: {
      errorRate: { value: Number(errorRate.toFixed(6)), max: SLO_ERROR_RATE_MAX },
      p95LatencyMs: { value: Number(p95LatencyMs.toFixed(2)), max: SLO_P95_MS_MAX },
      workerFailures: { value: workerFailures, max: SLO_WORKER_FAILURES_MAX }
    },
    totals: {
      entries: windowEntries.length,
      requestsRaw: requestEntriesAll.length,
      requestsExcluded: excludedRequests,
      requests: totalRequests,
      errors5xx,
      minRequestsForSlo: SLO_MIN_REQUESTS,
      requestSampleSufficient,
      requestSampleRequired: requireSample
    },
    alerts,
    ok: alerts.every((item) => item.ok)
  };

  await mkdir(resolve(root, 'data', 'logs'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`slo-report: ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(JSON.stringify(report, null, 2));

  if (enforce && !report.ok) process.exit(1);
}

main().catch((error) => {
  console.error('slo-report failed:', error?.message || error);
  process.exit(1);
});
