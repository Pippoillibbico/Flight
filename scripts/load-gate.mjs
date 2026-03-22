import 'dotenv/config';

function toNumber(value, fallback) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function estimateScannerProviderCallsPerMonth() {
  const scanEnabled = String(process.env.FLIGHT_SCAN_ENABLED || 'false').trim().toLowerCase() === 'true';
  if (!scanEnabled) return 0;
  const routeLimit = clamp(toNumber(process.env.FLIGHT_SCAN_SCHEDULER_ROUTE_LIMIT, 250), 10, 2000);
  const windowsMedium = clamp(toNumber(process.env.FLIGHT_SCAN_WINDOWS_MEDIUM_PRIORITY, 3), 1, 12);
  const schedulerRunsPerDay = 24; // default cron hourly
  const monthlyRuns = schedulerRunsPerDay * 30;
  const tasksPerRunEstimate = routeLimit * windowsMedium;
  const cacheMissRatio = clamp(toNumber(process.env.LOAD_GATE_PROVIDER_CACHE_MISS_RATIO, 0.85), 0.05, 1);
  const retryFactor = clamp(toNumber(process.env.LOAD_GATE_PROVIDER_RETRY_FACTOR, 1.1), 1, 2);
  return Math.round(tasksPerRunEstimate * monthlyRuns * cacheMissRatio * retryFactor);
}

function estimateScenario({ users, searchesPerUserMonth, activeWindowMinutes = 10 }) {
  const providerValidationLimit = clamp(toNumber(process.env.SEARCH_PROVIDER_VALIDATION_LIMIT, 5), 1, 10);
  const flowRequestsPerUser = clamp(toNumber(process.env.LOAD_GATE_REQUESTS_PER_USER_FLOW, 4), 1, 20);
  const scannerMonthly = estimateScannerProviderCallsPerMonth();
  const scannerPerMinute = scannerMonthly / (30 * 24 * 60);

  const backendRequestsInWindow = users * flowRequestsPerUser;
  const backendRequestsPerMinute = backendRequestsInWindow / activeWindowMinutes;

  const searchesPerUserInWindow = clamp(toNumber(process.env.LOAD_GATE_SEARCHES_PER_USER_WINDOW, 1), 0, 5);
  const providerCallsInWindow = users * searchesPerUserInWindow * providerValidationLimit;
  const providerCallsPerMinute = providerCallsInWindow / activeWindowMinutes + scannerPerMinute;

  const providerCallsPerMonthUserDriven = users * searchesPerUserMonth * providerValidationLimit;
  const providerCallsPerMonthTotal = Math.round(providerCallsPerMonthUserDriven + scannerMonthly);

  return {
    users,
    activeWindowMinutes,
    backendRequestsPerMinute: Math.round(backendRequestsPerMinute),
    providerCallsPerMinute: Math.round(providerCallsPerMinute),
    providerCallsPerMonthTotal
  };
}

const thresholds = {
  backendRequestsPerMinuteMax: toNumber(process.env.LOAD_GATE_BACKEND_RPM_MAX, 120000),
  providerCallsPerMinuteMax: toNumber(process.env.LOAD_GATE_PROVIDER_RPM_MAX, 30000),
  providerCallsPerMonthMax: toNumber(process.env.LOAD_GATE_PROVIDER_MONTHLY_MAX, 10000000)
};

const scenarios = [
  { name: 'load_10k', ...estimateScenario({ users: 10_000, searchesPerUserMonth: 8, activeWindowMinutes: 10 }) },
  { name: 'viral_50k', ...estimateScenario({ users: 50_000, searchesPerUserMonth: 10, activeWindowMinutes: 10 }) }
];

let hasFailure = false;
for (const scenario of scenarios) {
  if (scenario.backendRequestsPerMinute > thresholds.backendRequestsPerMinuteMax) hasFailure = true;
  if (scenario.providerCallsPerMinute > thresholds.providerCallsPerMinuteMax) hasFailure = true;
  if (scenario.providerCallsPerMonthTotal > thresholds.providerCallsPerMonthMax) hasFailure = true;
}

const report = {
  ok: !hasFailure,
  now: new Date().toISOString(),
  thresholds,
  scenarios
};

console.log(JSON.stringify(report, null, 2));
if (hasFailure) process.exit(1);
