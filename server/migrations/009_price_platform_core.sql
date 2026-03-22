-- ============================================================
-- 009_price_platform_core.sql
-- Core PostgreSQL schema for price history, discovery feed, alerts and ranking.
-- Additive migration: does not remove or break existing tables.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- airports
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS airports (
  id BIGSERIAL PRIMARY KEY,
  iata_code CHAR(3) NOT NULL,
  icao_code CHAR(4) NULL,
  name TEXT NOT NULL,
  city_name TEXT NOT NULL,
  country_code CHAR(2) NULL,
  timezone TEXT NULL,
  lat NUMERIC(9,6) NULL,
  lon NUMERIC(9,6) NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_airports_iata UNIQUE (iata_code)
);

CREATE INDEX IF NOT EXISTS idx_airports_city_country
  ON airports(country_code, city_name);

CREATE INDEX IF NOT EXISTS idx_airports_active
  ON airports(is_active, iata_code);

-- ------------------------------------------------------------
-- routes (extend existing table from previous migrations)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routes (
  id BIGSERIAL PRIMARY KEY,
  origin_iata TEXT NOT NULL,
  destination_iata TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_routes_iata_pair UNIQUE (origin_iata, destination_iata)
);

ALTER TABLE routes ADD COLUMN IF NOT EXISTS origin_airport_id BIGINT NULL;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS destination_airport_id BIGINT NULL;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS distance_km INTEGER NULL;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS typical_duration_minutes INTEGER NULL;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS route_group TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_routes_origin_airport'
  ) THEN
    ALTER TABLE routes
      ADD CONSTRAINT fk_routes_origin_airport
      FOREIGN KEY (origin_airport_id) REFERENCES airports(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_routes_destination_airport'
  ) THEN
    ALTER TABLE routes
      ADD CONSTRAINT fk_routes_destination_airport
      FOREIGN KEY (destination_airport_id) REFERENCES airports(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_routes_airport_pair
  ON routes(origin_airport_id, destination_airport_id);

CREATE INDEX IF NOT EXISTS idx_routes_origin_active
  ON routes(origin_iata, is_active, destination_iata);

-- ------------------------------------------------------------
-- users (price platform domain table; keeps app auth compatibility with TEXT id)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NULL,
  home_airport_id BIGINT NULL REFERENCES airports(id) ON DELETE SET NULL,
  plan_id TEXT NOT NULL DEFAULT 'free',
  plan_status TEXT NOT NULL DEFAULT 'active',
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  auth_channel TEXT NOT NULL DEFAULT 'email_password',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON users (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_users_plan_status
  ON users(plan_id, plan_status);

-- ------------------------------------------------------------
-- flight_quotes (historical time-series)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flight_quotes (
  id BIGSERIAL PRIMARY KEY,
  route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  origin_airport_id BIGINT NULL REFERENCES airports(id) ON DELETE SET NULL,
  destination_airport_id BIGINT NULL REFERENCES airports(id) ON DELETE SET NULL,
  departure_date DATE NOT NULL,
  return_date DATE NULL,
  trip_type TEXT NOT NULL DEFAULT 'round_trip',
  cabin_class TEXT NOT NULL DEFAULT 'economy',
  adults SMALLINT NOT NULL DEFAULT 1,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  total_price NUMERIC(10,2) NOT NULL,
  provider TEXT NOT NULL,
  provider_offer_id TEXT NULL,
  stops SMALLINT NOT NULL DEFAULT 0,
  duration_minutes INTEGER NULL,
  baggage_included BOOLEAN NULL,
  is_bookable BOOLEAN NOT NULL DEFAULT true,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'partner_feed',
  fingerprint TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_flight_quotes_fingerprint UNIQUE (fingerprint),
  CONSTRAINT ck_flight_quotes_trip_type CHECK (trip_type IN ('one_way', 'round_trip')),
  CONSTRAINT ck_flight_quotes_trip_dates CHECK (
    (trip_type = 'one_way' AND return_date IS NULL)
    OR (trip_type = 'round_trip' AND return_date IS NOT NULL)
  ),
  CONSTRAINT ck_flight_quotes_price CHECK (total_price > 0),
  CONSTRAINT ck_flight_quotes_stops CHECK (stops BETWEEN 0 AND 6),
  CONSTRAINT ck_flight_quotes_adults CHECK (adults BETWEEN 1 AND 9),
  CONSTRAINT ck_flight_quotes_duration CHECK (duration_minutes IS NULL OR duration_minutes > 0)
);

CREATE INDEX IF NOT EXISTS idx_flight_quotes_route_departure_observed
  ON flight_quotes(route_id, departure_date, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_flight_quotes_route_observed
  ON flight_quotes(route_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_flight_quotes_origin_departure_price
  ON flight_quotes(origin_airport_id, departure_date, total_price);

CREATE INDEX IF NOT EXISTS idx_flight_quotes_destination_departure_price
  ON flight_quotes(destination_airport_id, departure_date, total_price);

CREATE INDEX IF NOT EXISTS idx_flight_quotes_observed_at
  ON flight_quotes(observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_flight_quotes_trip_cabin_departure
  ON flight_quotes(trip_type, cabin_class, departure_date);

-- ------------------------------------------------------------
-- route_price_stats (ranking/discovery aggregates)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_price_stats (
  id BIGSERIAL PRIMARY KEY,
  route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  departure_month DATE NOT NULL,
  trip_type TEXT NOT NULL DEFAULT 'round_trip',
  cabin_class TEXT NOT NULL DEFAULT 'economy',
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  quotes_count INTEGER NOT NULL DEFAULT 0,
  min_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  avg_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  median_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  p10_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  p25_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  p75_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  p90_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  stddev_price NUMERIC(12,4) NULL,
  confidence_level TEXT NOT NULL DEFAULT 'low',
  last_quote_at TIMESTAMPTZ NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_route_price_stats_dim UNIQUE (route_id, departure_month, trip_type, cabin_class, currency),
  CONSTRAINT ck_route_price_stats_trip_type CHECK (trip_type IN ('one_way', 'round_trip')),
  CONSTRAINT ck_route_price_stats_confidence CHECK (confidence_level IN ('very_low', 'low', 'medium', 'high')),
  CONSTRAINT ck_route_price_stats_count CHECK (quotes_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_route_price_stats_route_month
  ON route_price_stats(route_id, departure_month DESC);

CREATE INDEX IF NOT EXISTS idx_route_price_stats_month_confidence
  ON route_price_stats(departure_month, confidence_level);

CREATE INDEX IF NOT EXISTS idx_route_price_stats_avg
  ON route_price_stats(avg_price);

-- ------------------------------------------------------------
-- detected_deals (dynamic feed + ranking output)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS detected_deals (
  id BIGSERIAL PRIMARY KEY,
  deal_key TEXT NOT NULL,
  flight_quote_id BIGINT NOT NULL REFERENCES flight_quotes(id) ON DELETE CASCADE,
  route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  deal_type TEXT NOT NULL DEFAULT 'great_deal',
  raw_score NUMERIC(6,2) NOT NULL,
  final_score NUMERIC(6,2) NOT NULL,
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
  CONSTRAINT uq_detected_deals_key UNIQUE (deal_key),
  CONSTRAINT ck_detected_deals_scores CHECK (raw_score BETWEEN 0 AND 100 AND final_score BETWEEN 0 AND 100),
  CONSTRAINT ck_detected_deals_status CHECK (status IN ('candidate', 'published', 'expired', 'rejected')),
  CONSTRAINT ck_detected_deals_price CHECK (price > 0)
);

CREATE INDEX IF NOT EXISTS idx_detected_deals_feed
  ON detected_deals(status, final_score DESC, published_at DESC, source_observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_detected_deals_route_status
  ON detected_deals(route_id, status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_detected_deals_quote
  ON detected_deals(flight_quote_id);

CREATE INDEX IF NOT EXISTS idx_detected_deals_savings
  ON detected_deals(savings_pct DESC NULLS LAST);

-- ------------------------------------------------------------
-- price_alerts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'price_target',
  status TEXT NOT NULL DEFAULT 'active',
  origin_airport_id BIGINT NOT NULL REFERENCES airports(id) ON DELETE RESTRICT,
  destination_airport_id BIGINT NULL REFERENCES airports(id) ON DELETE SET NULL,
  route_id BIGINT NULL REFERENCES routes(id) ON DELETE SET NULL,
  target_price NUMERIC(10,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  trip_type_preference TEXT NOT NULL DEFAULT 'any',
  connection_type TEXT NOT NULL DEFAULT 'all',
  max_stops SMALLINT NULL,
  travel_time TEXT NOT NULL DEFAULT 'all',
  min_comfort_score SMALLINT NULL,
  cabin_class TEXT NOT NULL DEFAULT 'economy',
  travellers SMALLINT NOT NULL DEFAULT 1,
  stay_days SMALLINT NULL,
  days_from_now SMALLINT NULL,
  last_checked_at TIMESTAMPTZ NULL,
  last_triggered_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_price_alerts_mode CHECK (mode IN ('price_target', 'discovery_auto')),
  CONSTRAINT ck_price_alerts_status CHECK (status IN ('active', 'paused', 'triggered', 'disabled')),
  CONSTRAINT ck_price_alerts_target CHECK (
    (mode = 'price_target' AND target_price IS NOT NULL AND target_price > 0)
    OR (mode = 'discovery_auto')
  ),
  CONSTRAINT ck_price_alerts_trip_pref CHECK (trip_type_preference IN ('any', 'one_way', 'round_trip')),
  CONSTRAINT ck_price_alerts_connection CHECK (connection_type IN ('all', 'direct', 'with_stops')),
  CONSTRAINT ck_price_alerts_travel_time CHECK (travel_time IN ('all', 'day', 'night')),
  CONSTRAINT ck_price_alerts_max_stops CHECK (max_stops IS NULL OR max_stops BETWEEN 0 AND 3),
  CONSTRAINT ck_price_alerts_travellers CHECK (travellers BETWEEN 1 AND 9),
  CONSTRAINT ck_price_alerts_comfort CHECK (min_comfort_score IS NULL OR min_comfort_score BETWEEN 1 AND 100),
  CONSTRAINT ck_price_alerts_stay_days CHECK (stay_days IS NULL OR stay_days BETWEEN 1 AND 30),
  CONSTRAINT ck_price_alerts_days_from_now CHECK (days_from_now IS NULL OR days_from_now BETWEEN 1 AND 365)
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_status
  ON price_alerts(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_alerts_scan
  ON price_alerts(status, origin_airport_id, destination_airport_id, target_price);

CREATE INDEX IF NOT EXISTS idx_price_alerts_polling
  ON price_alerts(status, last_checked_at);

-- ------------------------------------------------------------
-- user_events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id TEXT NULL,
  route_id BIGINT NULL REFERENCES routes(id) ON DELETE SET NULL,
  deal_id BIGINT NULL REFERENCES detected_deals(id) ON DELETE SET NULL,
  alert_id BIGINT NULL REFERENCES price_alerts(id) ON DELETE SET NULL,
  price_seen NUMERIC(10,2) NULL,
  channel TEXT NOT NULL DEFAULT 'app',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_user_ts
  ON user_events(user_id, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_type_ts
  ON user_events(event_type, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_route_ts
  ON user_events(route_id, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_deal_ts
  ON user_events(deal_id, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_alert_ts
  ON user_events(alert_id, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_payload_gin
  ON user_events USING GIN (payload);

-- ------------------------------------------------------------
-- saved_deals
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_deals (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deal_id BIGINT NOT NULL REFERENCES detected_deals(id) ON DELETE CASCADE,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_saved_deals_user_deal UNIQUE (user_id, deal_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_deals_user_created
  ON saved_deals(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_deals_deal
  ON saved_deals(deal_id);
