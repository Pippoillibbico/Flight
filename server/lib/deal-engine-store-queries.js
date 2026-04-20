const UPSERT_ROUTE_POSTGRES_SQL = `
  INSERT INTO routes (origin_iata, destination_iata, created_at, updated_at)
  VALUES ($1, $2, NOW(), NOW())
  ON CONFLICT (origin_iata, destination_iata)
  DO UPDATE SET updated_at = NOW()
  RETURNING id
`;

const UPSERT_ROUTE_SQLITE_SQL = `
  INSERT INTO routes (origin_iata, destination_iata, created_at, updated_at)
  VALUES (?, ?, datetime('now'), datetime('now'))
  ON CONFLICT(origin_iata, destination_iata) DO UPDATE SET updated_at=datetime('now')
  RETURNING id
`;

const INSERT_OBSERVATION_POSTGRES_SQL = `
  INSERT INTO price_observations (
     route_id, origin_iata, destination_iata, departure_date, return_date, travel_month,
     currency, total_price, provider, cabin_class, trip_type, observed_at, source, fingerprint, metadata, created_at
   )
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
   ON CONFLICT (fingerprint) DO NOTHING
   RETURNING id
`;

const INSERT_OBSERVATION_SQLITE_SQL = `
  INSERT OR IGNORE INTO price_observations (
     route_id, origin_iata, destination_iata, departure_date, return_date, travel_month,
     currency, total_price, provider, cabin_class, trip_type, observed_at, source, fingerprint, metadata, created_at
   )
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
   RETURNING id
`;

const RECOMPUTE_BASELINES_POSTGRES_SQL = `
  WITH agg AS (
     SELECT
       route_id,
       origin_iata,
       destination_iata,
       travel_month,
       AVG(total_price)::numeric(10,2) AS avg_price,
       percentile_cont(0.10) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p10_price,
       percentile_cont(0.25) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p25_price,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p50_price,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p75_price,
       percentile_cont(0.90) WITHIN GROUP (ORDER BY total_price)::numeric(10,2) AS p90_price,
       COUNT(*)::int AS observation_count
     FROM price_observations
     GROUP BY route_id, origin_iata, destination_iata, travel_month
   )
   INSERT INTO route_baselines (
     route_id, origin_iata, destination_iata, travel_month, avg_price,
     p10_price, p25_price, p50_price, p75_price, p90_price, observation_count, computed_at
   )
   SELECT
     route_id, origin_iata, destination_iata, travel_month, avg_price,
     p10_price, p25_price, p50_price, p75_price, p90_price, observation_count, NOW()
   FROM agg
   ON CONFLICT (route_id, travel_month)
   DO UPDATE SET
     avg_price = EXCLUDED.avg_price,
     p10_price = EXCLUDED.p10_price,
     p25_price = EXCLUDED.p25_price,
     p50_price = EXCLUDED.p50_price,
     p75_price = EXCLUDED.p75_price,
     p90_price = EXCLUDED.p90_price,
     observation_count = EXCLUDED.observation_count,
     computed_at = NOW()
`;

const UPSERT_BASELINE_SQLITE_SQL = `
  INSERT INTO route_baselines (
     route_id, origin_iata, destination_iata, travel_month, avg_price,
     p10_price, p25_price, p50_price, p75_price, p90_price, observation_count, computed_at
   )
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
   ON CONFLICT(route_id, travel_month) DO UPDATE SET
     avg_price=excluded.avg_price,
     p10_price=excluded.p10_price,
     p25_price=excluded.p25_price,
     p50_price=excluded.p50_price,
     p75_price=excluded.p75_price,
     p90_price=excluded.p90_price,
     observation_count=excluded.observation_count,
     computed_at=datetime('now')
`;

export {
  INSERT_OBSERVATION_POSTGRES_SQL,
  INSERT_OBSERVATION_SQLITE_SQL,
  RECOMPUTE_BASELINES_POSTGRES_SQL,
  UPSERT_BASELINE_SQLITE_SQL,
  UPSERT_ROUTE_POSTGRES_SQL,
  UPSERT_ROUTE_SQLITE_SQL
};
