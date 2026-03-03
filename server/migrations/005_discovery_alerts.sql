CREATE TABLE IF NOT EXISTS discovery_alert_subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  origin_iata TEXT NOT NULL,
  budget_eur NUMERIC(10,2) NOT NULL,
  mood TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'all',
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discovery_notification_dedupe (
  dedupe_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  observation_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discovery_worker_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_observed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_subscriptions_user
  ON discovery_alert_subscriptions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovery_subscriptions_match
  ON discovery_alert_subscriptions(origin_iata, region, enabled, date_from, date_to);

