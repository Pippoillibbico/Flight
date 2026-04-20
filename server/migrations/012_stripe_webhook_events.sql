-- ============================================================
-- 012_stripe_webhook_events.sql
-- Durable idempotency store for Stripe webhook processing
-- ============================================================

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing', -- processing | processed | failed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status_updated
  ON stripe_webhook_events(status, updated_at DESC);
