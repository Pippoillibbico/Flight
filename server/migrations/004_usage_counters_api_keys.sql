-- Counter-based quotas for user sessions and API keys.

CREATE TABLE IF NOT EXISTS usage_counters (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'api_key')),
  actor_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  period_key TEXT NOT NULL, -- YYYY-MM
  counters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (actor_type, actor_id, period_key)
);

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS quota_limits JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS counter TEXT NOT NULL DEFAULT 'search';

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user';

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS actor_id TEXT;

UPDATE usage_events
SET actor_id = COALESCE(actor_id, user_id)
WHERE actor_id IS NULL;

ALTER TABLE usage_events
  ALTER COLUMN actor_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_counters_actor_period
  ON usage_counters(actor_type, actor_id, period_key);

CREATE INDEX IF NOT EXISTS idx_usage_counters_user_period
  ON usage_counters(user_id, period_key);

