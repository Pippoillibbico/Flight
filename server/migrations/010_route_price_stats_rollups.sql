ALTER TABLE route_price_stats ADD COLUMN IF NOT EXISTS max_price NUMERIC(10,2) NULL;
ALTER TABLE route_price_stats ADD COLUMN IF NOT EXISTS avg_price_7d NUMERIC(10,2) NULL;
ALTER TABLE route_price_stats ADD COLUMN IF NOT EXISTS avg_price_30d NUMERIC(10,2) NULL;

CREATE INDEX IF NOT EXISTS idx_route_price_stats_route_computed
  ON route_price_stats(route_id, computed_at DESC);
