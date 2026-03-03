CREATE TABLE IF NOT EXISTS routes (
  id BIGSERIAL PRIMARY KEY,
  origin_iata TEXT NOT NULL,
  destination_iata TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (origin_iata, destination_iata)
);

CREATE TABLE IF NOT EXISTS price_observations (
  id BIGSERIAL PRIMARY KEY,
  route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  origin_iata TEXT NOT NULL,
  destination_iata TEXT NOT NULL,
  departure_date DATE NOT NULL,
  return_date DATE NULL,
  travel_month DATE NOT NULL,
  currency TEXT NOT NULL,
  total_price NUMERIC(10,2) NOT NULL,
  provider TEXT NOT NULL,
  cabin_class TEXT NOT NULL DEFAULT 'economy',
  trip_type TEXT NOT NULL DEFAULT 'round_trip',
  observed_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  fingerprint TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS route_baselines (
  id BIGSERIAL PRIMARY KEY,
  route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  origin_iata TEXT NOT NULL,
  destination_iata TEXT NOT NULL,
  travel_month DATE NOT NULL,
  avg_price NUMERIC(10,2) NOT NULL,
  p10_price NUMERIC(10,2) NOT NULL,
  p25_price NUMERIC(10,2) NOT NULL,
  p50_price NUMERIC(10,2) NOT NULL,
  p75_price NUMERIC(10,2) NOT NULL,
  p90_price NUMERIC(10,2) NOT NULL,
  observation_count INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
