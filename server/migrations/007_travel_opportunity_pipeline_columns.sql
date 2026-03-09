ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS baseline_price NUMERIC(10,2) NULL;
ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS savings_percent_if_available NUMERIC(6,2) NULL;
ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL;
ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;
ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE travel_opportunities ADD COLUMN IF NOT EXISTS alert_status TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_travel_opportunities_dedupe
  ON travel_opportunities(dedupe_key, final_score DESC, source_observed_at DESC);
