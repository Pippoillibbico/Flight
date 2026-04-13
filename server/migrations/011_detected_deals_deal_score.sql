-- ============================================================
-- 011_detected_deals_deal_score.sql
-- Add persisted feed ranking score for detected deals.
-- ============================================================

ALTER TABLE IF EXISTS detected_deals
  ADD COLUMN IF NOT EXISTS deal_score NUMERIC(6,2) NULL;

DO $$
BEGIN
  IF to_regclass('public.detected_deals') IS NOT NULL THEN
    EXECUTE 'UPDATE detected_deals SET deal_score = final_score WHERE deal_score IS NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_detected_deals_feed_deal_score ON detected_deals(status, deal_score DESC NULLS LAST, source_observed_at DESC)';
  END IF;
END $$;
