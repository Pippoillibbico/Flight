-- ============================================================
-- 002_saas_monetization.sql
-- API monetization: plans, subscriptions, api_keys, quotas
-- ============================================================

-- Plans catalogue (seeded once)
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_credits INTEGER NOT NULL DEFAULT 0,
  price_monthly_eur NUMERIC(10,2) NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO plans (id, name, monthly_credits, price_monthly_eur, features) VALUES
  ('free',    'Free',    50,    0.00,  '{"search":true,"alerts":1,"justGo":false,"aiSearch":false,"csvExport":false,"apiAccess":false}'),
  ('pro',     'Pro',     500,   12.99, '{"search":true,"alerts":10,"justGo":true,"aiSearch":true,"csvExport":false,"apiAccess":false}'),
  ('creator', 'Creator', 2000,  29.99, '{"search":true,"alerts":50,"justGo":true,"aiSearch":true,"csvExport":true,"apiAccess":true}')
ON CONFLICT (id) DO NOTHING;

-- One subscription per user
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL REFERENCES plans(id) DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',          -- active | past_due | canceled | trialing
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 month'),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  extra_credits INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Monthly credit quotas (one row per user per billing period)
CREATE TABLE IF NOT EXISTS monthly_quotas (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  credits_total INTEGER NOT NULL,
  UNIQUE (user_id, period_start)
);

-- API keys (hashed — raw key is never stored)
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Default key',
  key_prefix TEXT NOT NULL,       -- e.g. "fsk_live_4a2b" — shown in UI
  key_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hex of full raw key
  scopes TEXT[] NOT NULL DEFAULT '{"search","alerts","decision"}',
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every metered API call
CREATE TABLE IF NOT EXISTS usage_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  api_key_id TEXT,
  endpoint TEXT NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 1,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One-time credit top-ups
CREATE TABLE IF NOT EXISTS credit_topups (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  price_eur NUMERIC(10,2) NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | completed | failed | refunded
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indices
CREATE INDEX IF NOT EXISTS idx_user_sub_user_id        ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_quota_user_per  ON monthly_quotas(user_id, period_start);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id        ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash_active    ON api_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_usage_events_user_ts    ON usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_topups_user      ON credit_topups(user_id);
