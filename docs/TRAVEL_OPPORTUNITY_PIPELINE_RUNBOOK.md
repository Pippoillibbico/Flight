# Travel Opportunity Pipeline Runbook

## Purpose
Continuously ingest real flight observations, score and publish high-quality travel opportunities, enrich shortlisted items, and precompute radar matches.

## Main workers
- `opportunity_pipeline_worker`
- `radar_match_precompute_worker`
- `price_ingestion_worker`
- `discovery_alert_worker`
- `route_baseline` / `baseline_recompute_worker`

## Manual commands
```bash
node scripts/run-worker.mjs opportunity-pipeline
node scripts/run-worker.mjs radar-match-precompute
node scripts/run-worker.mjs price-ingestion
node scripts/run-worker.mjs route-baseline
node scripts/run-worker.mjs discovery-alert
```

## Key environment variables
- `OPPORTUNITY_PIPELINE_CRON`
- `OPPORTUNITY_PIPELINE_TIMEZONE`
- `OPPORTUNITY_PIPELINE_FETCH_PROVIDERS`
- `OPPORTUNITY_LOOKBACK_DAYS`
- `OPPORTUNITY_REFRESH_LIMIT`
- `OPPORTUNITY_ENRICHMENT_BATCH`
- `OPPORTUNITY_AI_ENRICHMENT_ENABLED`
- `OPPORTUNITY_AI_PROVIDER`
- `RADAR_MATCH_PRECOMPUTE_CRON`
- `RADAR_MATCH_PRECOMPUTE_TIMEZONE`

## Health and status endpoints
- `GET /api/opportunities/pipeline/status`
- `POST /api/opportunities/pipeline/run`
- `GET /api/system/data-status`

## Rollout plan
1. Deploy with `OPPORTUNITY_PIPELINE_FETCH_PROVIDERS=false`.
2. Verify scheduled runs and `recentRuns` status.
3. Verify feed/detail/radar/ai UI paths.
4. Enable provider fetch in staging.
5. Enable provider fetch in production.
6. Optionally enable AI enrichment after cost checks.

## Rollback plan
1. Set:
   - `OPPORTUNITY_PIPELINE_FETCH_PROVIDERS=false`
   - `OPPORTUNITY_AI_ENRICHMENT_ENABLED=false`
2. Keep core app/search running (pipeline is additive).
3. If needed, disable cron entries for pipeline/radar precompute.
4. Existing search/alerts/auth flows remain available.

## Failure handling
- Provider errors do not crash the app; worker run is recorded with status.
- Enrichment failures mark records `failed` and do not block publication.
- Dedupe and publish checks prevent feed flooding.
