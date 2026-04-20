const POSTGRES_CORE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    started_at TIMESTAMPTZ NULL,
    finished_at TIMESTAMPTZ NULL,
    processed_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    deduped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS provider_run_state (
    provider_name TEXT PRIMARY KEY,
    last_success_at TIMESTAMPTZ NULL,
    last_cursor TEXT NULL,
    last_route_batch TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS route_coverage_stats (
    origin_iata TEXT NOT NULL,
    destination_iata TEXT NOT NULL,
    travel_month DATE NOT NULL,
    observation_count INTEGER NOT NULL,
    confidence_level TEXT NOT NULL,
    last_observed_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (origin_iata, destination_iata, travel_month)
  );
  CREATE INDEX IF NOT EXISTS idx_route_coverage_month ON route_coverage_stats(travel_month, confidence_level);
  CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_created_at ON ingestion_jobs(created_at DESC);
`;

const SQLITE_CORE_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_iata TEXT NOT NULL,
    destination_iata TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (origin_iata, destination_iata)
  );
  CREATE TABLE IF NOT EXISTS price_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    origin_iata TEXT NOT NULL,
    destination_iata TEXT NOT NULL,
    departure_date TEXT NOT NULL,
    return_date TEXT NULL,
    travel_month TEXT NOT NULL,
    currency TEXT NOT NULL,
    total_price REAL NOT NULL,
    provider TEXT NOT NULL,
    cabin_class TEXT NOT NULL DEFAULT 'economy',
    trip_type TEXT NOT NULL DEFAULT 'round_trip',
    observed_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    fingerprint TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS route_baselines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    origin_iata TEXT NOT NULL,
    destination_iata TEXT NOT NULL,
    travel_month TEXT NOT NULL,
    avg_price REAL NOT NULL,
    p10_price REAL NOT NULL,
    p25_price REAL NOT NULL,
    p50_price REAL NOT NULL,
    p75_price REAL NOT NULL,
    p90_price REAL NOT NULL,
    observation_count INTEGER NOT NULL,
    computed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (route_id, travel_month)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_price_observations_fingerprint
    ON price_observations(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_price_observations_origin_dest_departure
    ON price_observations(origin_iata, destination_iata, departure_date);
  CREATE INDEX IF NOT EXISTS idx_price_observations_route_month
    ON price_observations(route_id, travel_month);
  CREATE INDEX IF NOT EXISTS idx_route_baselines_route_month
    ON route_baselines(route_id, travel_month);
  CREATE TABLE IF NOT EXISTS discovery_alert_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    origin_iata TEXT NOT NULL,
    budget_eur REAL NOT NULL,
    mood TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'all',
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS discovery_notification_dedupe (
    dedupe_key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    observation_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS discovery_worker_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_observed_at TEXT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_discovery_subscriptions_user
    ON discovery_alert_subscriptions(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_discovery_subscriptions_match
    ON discovery_alert_subscriptions(origin_iata, region, enabled, date_from, date_to);
  CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    started_at TEXT NULL,
    finished_at TEXT NULL,
    processed_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    deduped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_created_at ON ingestion_jobs(created_at DESC);
  CREATE TABLE IF NOT EXISTS provider_run_state (
    provider_name TEXT PRIMARY KEY,
    last_success_at TEXT NULL,
    last_cursor TEXT NULL,
    last_route_batch TEXT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS route_coverage_stats (
    origin_iata TEXT NOT NULL,
    destination_iata TEXT NOT NULL,
    travel_month TEXT NOT NULL,
    observation_count INTEGER NOT NULL,
    confidence_level TEXT NOT NULL,
    last_observed_at TEXT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (origin_iata, destination_iata, travel_month)
  );
  CREATE INDEX IF NOT EXISTS idx_route_coverage_month ON route_coverage_stats(travel_month, confidence_level);
`;

export { POSTGRES_CORE_SCHEMA_SQL, SQLITE_CORE_SCHEMA_SQL };
