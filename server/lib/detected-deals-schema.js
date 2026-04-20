const DETECTED_DEALS_POSTGRES_REFS_SQL = `
  SELECT
    to_regclass('public.routes') AS routes_ref,
    to_regclass('public.flight_quotes') AS flight_quotes_ref,
    to_regclass('public.route_price_stats') AS route_price_stats_ref
`;

const DETECTED_DEALS_POSTGRES_USER_EVENTS_SQL = `
  CREATE TABLE IF NOT EXISTS user_events (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NULL,
    event_type TEXT NOT NULL,
    event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id TEXT NULL,
    route_id BIGINT NULL,
    deal_id BIGINT NULL,
    alert_id BIGINT NULL,
    price_seen NUMERIC(10,2) NULL,
    channel TEXT NOT NULL DEFAULT 'app',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_user_events_route_ts ON user_events(route_id, event_ts DESC);
  CREATE INDEX IF NOT EXISTS idx_user_events_type_ts ON user_events(event_type, event_ts DESC);
`;

const DETECTED_DEALS_POSTGRES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS detected_deals (
    id BIGSERIAL PRIMARY KEY,
    deal_key TEXT NOT NULL,
    flight_quote_id BIGINT NOT NULL REFERENCES flight_quotes(id) ON DELETE CASCADE,
    route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    deal_type TEXT NOT NULL DEFAULT 'great_deal',
    raw_score NUMERIC(6,2) NOT NULL,
    final_score NUMERIC(6,2) NOT NULL,
    deal_score NUMERIC(6,2) NULL,
    opportunity_level TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    baseline_price NUMERIC(10,2) NULL,
    savings_amount NUMERIC(10,2) NULL,
    savings_pct NUMERIC(6,2) NULL,
    status TEXT NOT NULL DEFAULT 'candidate',
    rejection_reason TEXT NULL,
    score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    ai_title TEXT NULL,
    ai_description TEXT NULL,
    published_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NULL,
    source_observed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_detected_deals_key UNIQUE (deal_key)
  );
  CREATE INDEX IF NOT EXISTS idx_detected_deals_feed
    ON detected_deals(status, final_score DESC, published_at DESC, source_observed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_detected_deals_route_status
    ON detected_deals(route_id, status, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_detected_deals_quote
    ON detected_deals(flight_quote_id);
  CREATE INDEX IF NOT EXISTS idx_detected_deals_expiration
    ON detected_deals(status, expires_at, source_observed_at DESC);
  ALTER TABLE detected_deals
    ADD COLUMN IF NOT EXISTS deal_score NUMERIC(6,2) NULL;
  CREATE INDEX IF NOT EXISTS idx_detected_deals_feed_deal_score
    ON detected_deals(status, deal_score DESC NULLS LAST, source_observed_at DESC);
`;

const DETECTED_DEALS_SQLITE_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS user_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NULL,
    event_type TEXT NOT NULL,
    event_ts TEXT NOT NULL DEFAULT (datetime('now')),
    session_id TEXT NULL,
    route_id INTEGER NULL,
    deal_id INTEGER NULL,
    alert_id INTEGER NULL,
    price_seen REAL NULL,
    channel TEXT NOT NULL DEFAULT 'app',
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_user_events_route_ts ON user_events(route_id, event_ts DESC);
  CREATE INDEX IF NOT EXISTS idx_user_events_type_ts ON user_events(event_type, event_ts DESC);

  CREATE TABLE IF NOT EXISTS detected_deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_key TEXT NOT NULL UNIQUE,
    flight_quote_id INTEGER NOT NULL,
    route_id INTEGER NOT NULL,
    deal_type TEXT NOT NULL DEFAULT 'great_deal',
    raw_score REAL NOT NULL,
    final_score REAL NOT NULL,
    deal_score REAL NULL,
    opportunity_level TEXT NOT NULL,
    price REAL NOT NULL,
    baseline_price REAL NULL,
    savings_amount REAL NULL,
    savings_pct REAL NULL,
    status TEXT NOT NULL DEFAULT 'candidate',
    rejection_reason TEXT NULL,
    score_breakdown TEXT NOT NULL DEFAULT '{}',
    ai_title TEXT NULL,
    ai_description TEXT NULL,
    published_at TEXT NULL,
    expires_at TEXT NULL,
    source_observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_detected_deals_feed
    ON detected_deals(status, final_score DESC, published_at DESC, source_observed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_detected_deals_route_status
    ON detected_deals(route_id, status, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_detected_deals_quote
    ON detected_deals(flight_quote_id);
  CREATE INDEX IF NOT EXISTS idx_detected_deals_expiration
    ON detected_deals(status, expires_at, source_observed_at DESC);
`;

const DETECTED_DEALS_SQLITE_DEAL_SCORE_MIGRATION_SQL = `ALTER TABLE detected_deals ADD COLUMN deal_score REAL NULL`;
const DETECTED_DEALS_SQLITE_DEAL_SCORE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_detected_deals_feed_deal_score
    ON detected_deals(status, deal_score DESC, source_observed_at DESC)
`;

export {
  DETECTED_DEALS_POSTGRES_REFS_SQL,
  DETECTED_DEALS_POSTGRES_SCHEMA_SQL,
  DETECTED_DEALS_POSTGRES_USER_EVENTS_SQL,
  DETECTED_DEALS_SQLITE_DEAL_SCORE_INDEX_SQL,
  DETECTED_DEALS_SQLITE_DEAL_SCORE_MIGRATION_SQL,
  DETECTED_DEALS_SQLITE_SCHEMA_SQL
};
