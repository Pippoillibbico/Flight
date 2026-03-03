CREATE TABLE IF NOT EXISTS user_leads (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'register',
  channel TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'unknown',
  origin TEXT NOT NULL,
  region TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_delivery_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_leads_channel ON user_leads(channel);
CREATE INDEX IF NOT EXISTS idx_search_events_channel ON search_events(channel);
CREATE INDEX IF NOT EXISTS idx_search_events_created_at ON search_events(created_at);
CREATE INDEX IF NOT EXISTS idx_email_delivery_status ON email_delivery_log(status);
