-- ============================================================
-- 014_telemetry_events.sql
-- Durable telemetry event store for admin/dashboard analytics
-- ============================================================

CREATE TABLE IF NOT EXISTS telemetry_events (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_id TEXT NULL,
  correlation_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_created_at
  ON telemetry_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_type_created_at
  ON telemetry_events(type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_user_created_at
  ON telemetry_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_payload_fingerprint
  ON telemetry_events((payload->>'fingerprint'));

CREATE INDEX IF NOT EXISTS idx_telemetry_events_payload_event_id
  ON telemetry_events((payload->>'eventId'));

