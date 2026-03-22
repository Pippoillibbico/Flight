# Flight Scan Runbook

## Scope
Backend scanner for flight quotes with queue-based scheduling and provider adapters.

## Main jobs
- `flight_scan_scheduler`
- `flight_scan_worker`

## Manual commands
```bash
node scripts/run-worker.mjs flight-scan-scheduler
node scripts/run-worker.mjs flight-scan-worker
node scripts/run-worker.mjs flight-scan-cycle
```

## API control endpoints
- `GET /api/system/flight-scan/status`
- `POST /api/system/flight-scan/scheduler/run`
- `POST /api/system/flight-scan/worker/run`
- `POST /api/system/flight-scan/run`

All endpoints follow existing auth/csrf/scope/quota middleware.

## Key environment variables
- `FLIGHT_SCAN_ENABLED`
- `FLIGHT_SCAN_SCHEDULER_CRON`
- `FLIGHT_SCAN_WORKER_CRON`
- `FLIGHT_SCAN_WORKER_MAX_JOBS`
- `FLIGHT_SCAN_WINDOWS_PER_ROUTE`
- `FLIGHT_SCAN_WINDOWS_HIGH_PRIORITY`
- `FLIGHT_SCAN_WINDOWS_MEDIUM_PRIORITY`
- `FLIGHT_SCAN_WINDOWS_LOW_PRIORITY`
- `FLIGHT_SCAN_DATE_ANCHOR_DAYS`
- `FLIGHT_SCAN_WEEKEND_WINDOWS_HIGH`
- `FLIGHT_SCAN_WEEKEND_WINDOWS_MEDIUM`
- `FLIGHT_SCAN_WEEKEND_WINDOWS_LOW`
- `FLIGHT_SCAN_QUEUE_DEDUPE_TTL_SEC`
- `FLIGHT_SCAN_QUEUE_DEAD_LETTER_KEY`
- `FLIGHT_SCAN_QUEUE_DEAD_LETTER_MAX`
- `FLIGHT_SCAN_SCHEDULER_LOCK_ENABLED`
- `FLIGHT_SCAN_SCHEDULER_LOCK_TTL_SEC`
- `FLIGHT_SCAN_SCHEDULER_LOCK_KEY`
- `FLIGHT_SCAN_PRIORITY_HIGH_COOLDOWN_SEC`
- `FLIGHT_SCAN_PRIORITY_MEDIUM_COOLDOWN_SEC`
- `FLIGHT_SCAN_PRIORITY_LOW_COOLDOWN_SEC`
- `FLIGHT_SCAN_WINDOW_COOLDOWN_HIGH_SEC`
- `FLIGHT_SCAN_WINDOW_COOLDOWN_MEDIUM_SEC`
- `FLIGHT_SCAN_WINDOW_COOLDOWN_LOW_SEC`
- `FLIGHT_SCAN_CYCLE_RUN_SCHEDULER`
- `FLIGHT_SCAN_CYCLE_STOP_WHEN_QUEUE_EMPTY`
- `FLIGHT_SCAN_CYCLE_MAX_WORKER_PASSES`
- `FLIGHT_SCAN_RUN_DOWNSTREAM`
- `FLIGHT_SCAN_DOWNSTREAM_ROUTE_PRICE_STATS`
- `FLIGHT_SCAN_DOWNSTREAM_DETECTED_DEALS`
- `FLIGHT_SCAN_DOWNSTREAM_PRICE_ALERTS`
- `FLIGHT_SCAN_DOWNSTREAM_DEALS_CONTENT`
- `FLIGHT_SCAN_PROVIDER_RPM`
- `FLIGHT_SCAN_PROVIDER_CACHE_TTL_SEC`
- `FLIGHT_SCAN_PROVIDER_RPM_HIGH`
- `FLIGHT_SCAN_PROVIDER_RPM_MEDIUM`
- `FLIGHT_SCAN_PROVIDER_RPM_LOW`
- `FLIGHT_SCAN_PROVIDER_CACHE_TTL_HIGH_SEC`
- `FLIGHT_SCAN_PROVIDER_CACHE_TTL_MEDIUM_SEC`
- `FLIGHT_SCAN_PROVIDER_CACHE_TTL_LOW_SEC`
- `FLIGHT_SCAN_PROVIDER_EMPTY_CACHE_TTL_SEC`
- `FLIGHT_SCAN_RATE_LIMIT_DELAY_HIGH_SEC`
- `FLIGHT_SCAN_RATE_LIMIT_DELAY_MEDIUM_SEC`
- `FLIGHT_SCAN_RATE_LIMIT_DELAY_LOW_SEC`
- `FLIGHT_SCAN_INFLIGHT_REQUEUE_DELAY_SEC`
- `FLIGHT_SCAN_INFLIGHT_MAX_REQUEUES`
- `FLIGHT_SCAN_WINDOW_FRESHNESS_TTL_SEC`
- `FLIGHT_SCAN_STATUS_RECENT_RUNS`
- `CRON_ALLOW_OVERLAP_JOBS`
- `PROVIDER_CIRCUIT_SKIP_LOG_INTERVAL_MS`
- `PROVIDER_CONFIG_WARNING_INTERVAL_MS`
- `INGESTION_JOBS_SAME_TYPE_STALE_MINUTES`

## Priority scanning model
- High-priority routes scan more date windows and can be refreshed more often.
- Medium/low-priority routes use stronger window cooldowns to avoid repeated scans on unchanged route/date windows.
- Provider cache TTL and provider RPM can be tuned per priority (`high`, `medium`, `low`) to keep freshness where it matters and reduce low-value API calls.

## Rollout
1. Keep `FLIGHT_SCAN_ENABLED=false` and deploy.
2. Verify `GET /api/system/flight-scan/status`.
3. Trigger scheduler and worker manually through API.
4. Enable cron by setting `FLIGHT_SCAN_ENABLED=true`.
5. Monitor queue depth, dead-letter growth and ingestion job outcomes.

## Rollback
1. Set `FLIGHT_SCAN_ENABLED=false`.
2. Stop manual run triggers.
3. Investigate dead-letter payloads from status endpoint.
