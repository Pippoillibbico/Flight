CREATE TABLE IF NOT EXISTS free_destination_rankings_daily (
  score_date DATE NOT NULL,
  origin_iata TEXT NOT NULL,
  budget_bucket TEXT NOT NULL,
  season TEXT NOT NULL,
  mood TEXT NOT NULL,
  destination_iata TEXT NOT NULL,
  destination_city TEXT NOT NULL,
  rank_position INTEGER NOT NULL,
  final_score NUMERIC(6,2) NOT NULL,
  travel_score NUMERIC(6,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (score_date, origin_iata, budget_bucket, season, mood, destination_iata)
);

CREATE INDEX IF NOT EXISTS idx_free_rankings_lookup
  ON free_destination_rankings_daily(score_date, origin_iata, budget_bucket, season, mood, rank_position);

CREATE TABLE IF NOT EXISTS free_travel_scores_daily (
  score_date DATE NOT NULL,
  origin_iata TEXT NOT NULL,
  destination_iata TEXT NOT NULL,
  destination_city TEXT NOT NULL,
  travel_score NUMERIC(6,2) NOT NULL,
  flight_factor NUMERIC(6,2) NOT NULL,
  lodging_factor NUMERIC(6,2) NOT NULL,
  climate_factor NUMERIC(6,2) NOT NULL,
  crowding_factor NUMERIC(6,2) NOT NULL,
  seasonality_factor NUMERIC(6,2) NOT NULL,
  events_factor NUMERIC(6,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (score_date, origin_iata, destination_iata)
);

CREATE INDEX IF NOT EXISTS idx_free_travel_scores_lookup
  ON free_travel_scores_daily(score_date, origin_iata, destination_iata);

CREATE TABLE IF NOT EXISTS free_alert_signals_daily (
  score_date DATE NOT NULL,
  origin_iata TEXT NOT NULL,
  destination_iata TEXT NOT NULL,
  strategic_window_start DATE NOT NULL,
  strategic_window_end DATE NOT NULL,
  anomaly_price_threshold NUMERIC(10,2) NOT NULL,
  trend_direction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (score_date, origin_iata, destination_iata)
);

CREATE INDEX IF NOT EXISTS idx_free_alert_signals_lookup
  ON free_alert_signals_daily(score_date, origin_iata, destination_iata);

CREATE TABLE IF NOT EXISTS free_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  origin_iata TEXT NOT NULL,
  destination_iata TEXT NOT NULL,
  target_price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_free_alerts_user_active
  ON free_alerts(user_id, created_at DESC)
  WHERE deleted_at IS NULL;

