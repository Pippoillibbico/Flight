-- Server-side consent source of truth for GDPR tracking enforcement.

CREATE TABLE IF NOT EXISTS user_consents (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  categories JSONB NOT NULL,
  version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash TEXT NULL,
  user_agent_hash TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consent_sessions (
  anonymous_id TEXT PRIMARY KEY,
  categories JSONB NOT NULL,
  version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash TEXT NULL,
  user_agent_hash TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_consents_consented_at
  ON user_consents(consented_at DESC);

CREATE INDEX IF NOT EXISTS idx_consent_sessions_consented_at
  ON consent_sessions(consented_at DESC);
