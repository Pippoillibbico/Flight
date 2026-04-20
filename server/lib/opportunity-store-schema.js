const OPPORTUNITY_POSTGRES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS travel_opportunities (
    id TEXT PRIMARY KEY,
    observation_fingerprint TEXT NOT NULL UNIQUE,
    origin_city TEXT NOT NULL,
    origin_airport TEXT NOT NULL,
    destination_city TEXT NOT NULL,
    destination_airport TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    currency TEXT NOT NULL,
    depart_date DATE NOT NULL,
    return_date DATE NULL,
    trip_length_days INTEGER NULL,
    trip_type TEXT NOT NULL DEFAULT 'round_trip',
    stops INTEGER NOT NULL DEFAULT 1,
    airline TEXT NOT NULL,
    baggage_included BOOLEAN NULL,
    travel_duration_minutes INTEGER NULL,
    distance_km INTEGER NULL,
    airline_quality_score NUMERIC(5,2) NULL,
    booking_url TEXT NOT NULL,
    raw_score NUMERIC(6,2) NOT NULL,
    final_score NUMERIC(6,2) NOT NULL,
    opportunity_level TEXT NOT NULL,
    ai_title TEXT NULL,
    ai_description TEXT NULL,
    notification_text TEXT NULL,
    why_it_matters TEXT NULL,
    baseline_price NUMERIC(10,2) NULL,
    savings_percent_if_available NUMERIC(6,2) NULL,
    dedupe_key TEXT NULL,
    is_published BOOLEAN NOT NULL DEFAULT true,
    published_at TIMESTAMPTZ NULL,
    enrichment_status TEXT NOT NULL DEFAULT 'pending',
    alert_status TEXT NOT NULL DEFAULT 'pending',
    source_observed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_travel_opportunities_feed
    ON travel_opportunities(is_published, final_score DESC, source_observed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_travel_opportunities_route
    ON travel_opportunities(origin_airport, destination_airport, depart_date);
  CREATE INDEX IF NOT EXISTS idx_travel_opportunities_dedupe
    ON travel_opportunities(dedupe_key, final_score DESC, source_observed_at DESC);
  CREATE TABLE IF NOT EXISTS opportunity_pipeline_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NULL,
    processed_count INTEGER NOT NULL DEFAULT 0,
    published_count INTEGER NOT NULL DEFAULT 0,
    deduped_count INTEGER NOT NULL DEFAULT 0,
    enriched_count INTEGER NOT NULL DEFAULT 0,
    enrich_failed_count INTEGER NOT NULL DEFAULT 0,
    provider_fetch_enabled BOOLEAN NOT NULL DEFAULT false,
    error_summary TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_opportunity_pipeline_runs_started_at
    ON opportunity_pipeline_runs(started_at DESC);
  CREATE TABLE IF NOT EXISTS opportunity_user_follows (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    follow_type TEXT NOT NULL DEFAULT 'radar',
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_user_follows_unique
    ON opportunity_user_follows(user_id, entity_type, slug, follow_type);
  CREATE INDEX IF NOT EXISTS idx_opportunity_user_follows_user
    ON opportunity_user_follows(user_id, updated_at DESC);
`;

const OPPORTUNITY_POSTGRES_ALTER_SQL = `
  ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS baseline_price NUMERIC(10,2) NULL;
  ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS savings_percent_if_available NUMERIC(6,2) NULL;
  ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL;
  ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;
  ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'pending';
  ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS alert_status TEXT NOT NULL DEFAULT 'pending';
  ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS trip_type TEXT NOT NULL DEFAULT 'round_trip';
  ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS baggage_included BOOLEAN NULL;
  ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS travel_duration_minutes INTEGER NULL;
  ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS distance_km INTEGER NULL;
  ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS airline_quality_score NUMERIC(5,2) NULL;
`;

const OPPORTUNITY_SQLITE_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS travel_opportunities (
    id TEXT PRIMARY KEY,
    observation_fingerprint TEXT NOT NULL UNIQUE,
    origin_city TEXT NOT NULL,
    origin_airport TEXT NOT NULL,
    destination_city TEXT NOT NULL,
    destination_airport TEXT NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL,
    depart_date TEXT NOT NULL,
    return_date TEXT NULL,
    trip_length_days INTEGER NULL,
    trip_type TEXT NOT NULL DEFAULT 'round_trip',
    stops INTEGER NOT NULL DEFAULT 1,
    airline TEXT NOT NULL,
    baggage_included INTEGER NULL,
    travel_duration_minutes INTEGER NULL,
    distance_km INTEGER NULL,
    airline_quality_score REAL NULL,
    booking_url TEXT NOT NULL,
    raw_score REAL NOT NULL,
    final_score REAL NOT NULL,
    opportunity_level TEXT NOT NULL,
    ai_title TEXT NULL,
    ai_description TEXT NULL,
    notification_text TEXT NULL,
    why_it_matters TEXT NULL,
    baseline_price REAL NULL,
    savings_percent_if_available REAL NULL,
    dedupe_key TEXT NULL,
    is_published INTEGER NOT NULL DEFAULT 1,
    published_at TEXT NULL,
    enrichment_status TEXT NOT NULL DEFAULT 'pending',
    alert_status TEXT NOT NULL DEFAULT 'pending',
    source_observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_travel_opportunities_feed
    ON travel_opportunities(is_published, final_score DESC, source_observed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_travel_opportunities_route
    ON travel_opportunities(origin_airport, destination_airport, depart_date);
  CREATE INDEX IF NOT EXISTS idx_travel_opportunities_dedupe
    ON travel_opportunities(dedupe_key, final_score DESC, source_observed_at DESC);
  CREATE TABLE IF NOT EXISTS opportunity_pipeline_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NULL,
    processed_count INTEGER NOT NULL DEFAULT 0,
    published_count INTEGER NOT NULL DEFAULT 0,
    deduped_count INTEGER NOT NULL DEFAULT 0,
    enriched_count INTEGER NOT NULL DEFAULT 0,
    enrich_failed_count INTEGER NOT NULL DEFAULT 0,
    provider_fetch_enabled INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_opportunity_pipeline_runs_started_at
    ON opportunity_pipeline_runs(started_at DESC);
  CREATE TABLE IF NOT EXISTS opportunity_user_follows (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    follow_type TEXT NOT NULL DEFAULT 'radar',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_user_follows_unique
    ON opportunity_user_follows(user_id, entity_type, slug, follow_type);
  CREATE INDEX IF NOT EXISTS idx_opportunity_user_follows_user
    ON opportunity_user_follows(user_id, updated_at DESC);
`;

const OPPORTUNITY_SQLITE_REQUIRED_COLUMNS = Object.freeze([
  ['baseline_price', 'REAL NULL'],
  ['savings_percent_if_available', 'REAL NULL'],
  ['dedupe_key', 'TEXT NULL'],
  ['published_at', 'TEXT NULL'],
  ['enrichment_status', "TEXT NOT NULL DEFAULT 'pending'"],
  ['alert_status', "TEXT NOT NULL DEFAULT 'pending'"],
  ['trip_type', "TEXT NOT NULL DEFAULT 'round_trip'"],
  ['baggage_included', 'INTEGER NULL'],
  ['travel_duration_minutes', 'INTEGER NULL'],
  ['distance_km', 'INTEGER NULL'],
  ['airline_quality_score', 'REAL NULL']
]);

export {
  OPPORTUNITY_POSTGRES_ALTER_SQL,
  OPPORTUNITY_POSTGRES_SCHEMA_SQL,
  OPPORTUNITY_SQLITE_REQUIRED_COLUMNS,
  OPPORTUNITY_SQLITE_SCHEMA_SQL
};
