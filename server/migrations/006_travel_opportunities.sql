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
  stops INTEGER NOT NULL DEFAULT 1,
  airline TEXT NOT NULL,
  booking_url TEXT NOT NULL,
  raw_score NUMERIC(6,2) NOT NULL,
  final_score NUMERIC(6,2) NOT NULL,
  opportunity_level TEXT NOT NULL,
  ai_title TEXT NULL,
  ai_description TEXT NULL,
  notification_text TEXT NULL,
  why_it_matters TEXT NULL,
  is_published BOOLEAN NOT NULL DEFAULT true,
  source_observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_travel_opportunities_feed
  ON travel_opportunities(is_published, final_score DESC, source_observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_travel_opportunities_route
  ON travel_opportunities(origin_airport, destination_airport, depart_date);
