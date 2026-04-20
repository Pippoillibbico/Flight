-- Migration 013: Economics events table for per-transaction P&L observability
-- Stores gross/net margin, cost breakdown, and guard decisions for every
-- monetised event: search, checkout, subscription webhook, offer exclusion.

CREATE TABLE IF NOT EXISTS economics_events (
  id                   BIGSERIAL        PRIMARY KEY,
  event_type           TEXT             NOT NULL,
  -- 'search_economics' | 'offer_excluded' | 'checkout_created'
  -- | 'payment_received' | 'subscription_event'

  user_id_hash         TEXT,            -- SHA-256 prefix (16 hex chars), never raw userId
  user_tier            TEXT,            -- free | pro | creator | elite

  at                   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  -- Route context (populated for flight-level events)
  origin               TEXT,
  destination          TEXT,
  trip_type            TEXT,            -- one_way | round_trip

  -- Revenue & cost breakdown (all in EUR)
  revenue_eur          NUMERIC(10, 4),
  provider_cost_eur    NUMERIC(10, 4),  -- raw Duffel cost
  stripe_fee_eur       NUMERIC(10, 4),  -- 2.9% + €0.30
  ai_cost_eur          NUMERIC(10, 4),  -- €0.10 per search
  platform_overhead_eur NUMERIC(10, 4), -- €0.05 per bookable offer
  gross_margin_eur     NUMERIC(10, 4),  -- revenue - provider_cost
  net_margin_eur       NUMERIC(10, 4),  -- gross - all fees

  -- Rates (0.0 – 1.0)
  gross_margin_rate    NUMERIC(6, 4),
  net_margin_rate      NUMERIC(6, 4),

  -- Aggregates for search events
  offer_count          INTEGER,         -- total offers evaluated
  bookable_count       INTEGER,         -- offers that passed margin guard
  excluded_count       INTEGER,         -- offers excluded / non-monetisable

  -- Margin guard decision (for offer_excluded events)
  guard_action         TEXT,            -- exclude | non_monetizable | recalculate
  guard_rules          TEXT,            -- comma-separated rule names triggered

  -- Arbitrary extra context (searchId, sessionId, planType, etc.)
  extra                JSONB
);

-- Indexes for backoffice queries
CREATE INDEX IF NOT EXISTS idx_economics_events_at
  ON economics_events (at DESC);

CREATE INDEX IF NOT EXISTS idx_economics_events_user_at
  ON economics_events (user_id_hash, at DESC);

CREATE INDEX IF NOT EXISTS idx_economics_events_type_at
  ON economics_events (event_type, at DESC);

CREATE INDEX IF NOT EXISTS idx_economics_events_tier_at
  ON economics_events (user_tier, at DESC);
