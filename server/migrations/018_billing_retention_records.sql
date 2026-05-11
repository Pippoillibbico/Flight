-- Minimal billing retention after account deletion.
-- Stores only pseudonymous user linkage and Stripe references required for
-- tax/accounting, payment reconciliation, chargebacks, and disputes.

CREATE TABLE IF NOT EXISTS billing_retention_records (
  id BIGSERIAL PRIMARY KEY,
  user_hash TEXT NOT NULL,
  stripe_customer_id TEXT NULL,
  stripe_subscription_id TEXT NULL,
  plan_id TEXT NULL,
  status TEXT NULL,
  current_period_start TIMESTAMPTZ NULL,
  current_period_end TIMESTAMPTZ NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  retained_reason TEXT NOT NULL,
  retained_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_retention_user_hash
  ON billing_retention_records(user_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_retention_retained_until
  ON billing_retention_records(retained_until);
