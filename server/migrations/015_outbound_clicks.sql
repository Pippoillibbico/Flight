-- ============================================================
-- 015_outbound_clicks.sql
-- Durable outbound click / redirect outcome store
-- ============================================================

CREATE TABLE IF NOT EXISTS outbound_clicks (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NULL,
  provider TEXT NULL,
  itinerary_id TEXT NULL,
  destination_url TEXT NOT NULL,
  correlation_id TEXT NULL,
  redirect_status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_outbound_clicks_created_at
  ON outbound_clicks(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_clicks_correlation
  ON outbound_clicks(correlation_id);

CREATE INDEX IF NOT EXISTS idx_outbound_clicks_status_created_at
  ON outbound_clicks(redirect_status, created_at DESC);

