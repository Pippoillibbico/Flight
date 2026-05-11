# Provider Ingestion Verification

Use this checklist after setting real Kiwi and Duffel credentials.

## Required env

```env
PROVIDER_COLLECTION_ENABLED=true
PROVIDER_COLLECTION_ALLOW_WITH_SCAN=true
ENABLE_PROVIDER_KIWI=true
KIWI_API_KEY=...
ENABLE_PROVIDER_DUFFEL=true
DUFFEL_API_KEY=...
ENABLE_PROVIDER_SKYSCANNER=false
FLIGHT_SCAN_ENABLED=true
FLIGHT_SCAN_RUN_DOWNSTREAM=true
FLIGHT_SCAN_DOWNSTREAM_ROUTE_PRICE_STATS=true
FLIGHT_SCAN_DOWNSTREAM_DETECTED_DEALS=true
```

## Worker commands

```bash
npm run worker:provider-collection
npm run worker:flight-scan-cycle
npm run worker:route-baseline
npm run worker:route-price-stats
npm run worker:detected-deals
```

## Postgres verification queries

Provider observations:

```sql
SELECT provider, source, COUNT(*) AS rows, MAX(observed_at) AS last_observed_at
FROM price_observations
WHERE provider IN ('kiwi', 'duffel')
GROUP BY provider, source
ORDER BY provider, source;
```

Provider quotes:

```sql
SELECT provider, source, COUNT(*) AS rows, MAX(observed_at) AS last_observed_at
FROM flight_quotes
WHERE provider IN ('kiwi', 'duffel')
GROUP BY provider, source
ORDER BY provider, source;
```

Baselines:

```sql
SELECT origin_iata, destination_iata, travel_month, observation_count, computed_at
FROM route_baselines
ORDER BY computed_at DESC
LIMIT 20;
```

Route price stats:

```sql
SELECT r.origin_iata, r.destination_iata, s.departure_month, s.quotes_count, s.min_price, s.avg_price, s.computed_at
FROM route_price_stats s
JOIN routes r ON r.id = s.route_id
ORDER BY s.computed_at DESC
LIMIT 20;
```

Worker status:

```sql
SELECT job_type, status, processed_count, inserted_count, deduped_count, failed_count, metadata, finished_at
FROM ingestion_jobs
WHERE job_type IN (
  'provider_collection',
  'flight_scan_worker',
  'flight_scan_scheduler',
  'route_baseline_recompute',
  'baseline_recompute',
  'route_price_stats_refresh',
  'detected_deals_refresh'
)
ORDER BY created_at DESC
LIMIT 20;
```
