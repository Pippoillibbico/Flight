# Monetization Architecture (Travel/Flight)

## Revenue Layers Implemented

1. Flight margin layer (backend pricing engine)
- File: `server/lib/pricing-engine.js`
- Raw Duffel/provider cost is transformed into a monetized display price.
- Margin includes:
  - base margin rate
  - dynamic context adjustments (plan tier, mobile/desktop, returning user, route popularity, last-minute, smart deal)
  - Stripe fee estimate
  - AI/platform overhead
- Client responses are sanitized so internal raw-cost fields are not exposed.

2. Economic protection layer (margin guard)
- File: `server/lib/margin-guard.js`
- Every priced offer is validated against minimum net margin constraints.
- If below threshold, configurable behavior:
  - `recalculate` (raise price to minimum viable level)
  - `exclude` (remove from bookable inventory)
  - `non_monetizable` (keep visible but not bookable)
- Logs include reasons/rules triggered for auditability.

3. Subscription layer (Stripe)
- Entry points:
  - `server/routes/billing.js`
  - `server/lib/billing/stripe-billing-service.js`
  - `server/lib/billing/stripe-billing-state-service.js`
  - `server/lib/billing/stripe-billing-webhook-service.js`
- Supports:
  - checkout session
  - customer mapping
  - subscription sync
  - change/cancel/resume flows
  - webhook signature verification + idempotency
- Backend remains source of truth for effective plan state.

4. Feature gating layer (free/pro/elite)
- Plan rules:
  - `server/lib/plan-access.js`
  - `server/lib/saas-db.js` (quotas/counters and limits)
- Gates already active on premium-cost features:
  - radar configuration
  - smart alerts
  - AI travel
  - export
  - follows cap / opportunities cap

## Upsell and UX Hooks

- Frontend plan/upgrade UX:
  - `src/features/app-shell/domain/premium-packages.js`
  - `src/features/app-shell/hooks/useUpgradeFlowController.js`
  - `src/components/PremiumPanelSection.jsx`
  - `src/components/QuotaWarningBanner.jsx`
  - `src/components/PersonalHubSection.jsx`
  - `src/components/TrialBanner.jsx`
- Gate errors return `premium_required` + `upgrade_context` for targeted upgrade prompts.

## Cost-Protection Rules in Practice

1. Never show raw provider cost as final user price.
2. Validate each priced offer with the margin guard before marking as bookable.
3. Degrade gracefully to synthetic inventory when live provider is unavailable or blocked by budget guard.
4. Enforce plan gates + quota counters server-side (frontend can only react, not decide entitlement).

## Latest Hardening Added

1. Premium error normalization now preserves `premium_required` (no longer downgraded to generic request failures).
2. API client now forwards `upgrade_context` and limit metadata from backend errors.
3. Opportunity follows cap logic now correctly recognizes already-followed entities (no false premium block at limit).
4. AI travel gate responses now include `upgrade_context` consistently.

## Remaining Areas to Complete

1. Forecast tier evolution
- Baseline gate is now active (Pro/Elite required on forecast endpoints).
- Next decision: keep shared Pro/Elite access or introduce Elite-only advanced forecast signals.

2. Billing analytics dashboard
- Add margin guard outcomes + Stripe conversion funnel in a single operator view.

3. Advanced dynamic pricing policies
- Move current env-driven heuristics toward centrally managed rule sets (versioned and auditable).

## Subscription Flow (End-to-End)

1. User chooses Pro/Elite in frontend upgrade flow.
2. Frontend calls backend checkout API (`/api/billing/checkout` via `api.billingCheckout`).
3. Backend resolves app user, ensures Stripe customer mapping, and creates Checkout Session.
4. Stripe Checkout completes payment/authentication.
5. Stripe sends webhook events to backend (`checkout.session.completed`, `customer.subscription.*`, `invoice.payment_*`).
6. Webhook verifies Stripe signature, applies idempotency, and syncs local subscription state.
7. Backend writes effective plan (`free|pro|elite`) and status (`active|past_due|canceled`) to app user profile.
8. Frontend refreshes from backend (`/api/auth/me`, `/api/billing/subscription`) and updates UI from server truth only.

## Database Mapping (App ↔ Stripe)

Current logical mapping enforced in backend services:

- App user:
  - `users.id` (internal)
  - `users.plan_type` / `users.planType`
  - `users.plan_status` / `users.planStatus`
  - `users.is_premium`
- Stripe customer link:
  - `users.stripe_customer_id` (or equivalent persisted field in billing state service)
- Stripe subscription link:
  - `users.stripe_subscription_id` (or equivalent persisted field in billing state service)
  - `users.stripe_price_id` (effective plan price reference)
- Webhook idempotency:
  - `stripe_webhook_events` table stores processed event IDs (`server/migrations/012_stripe_webhook_events.sql`).

Design rule:
- Backend is authoritative for entitlement. Frontend never persists premium entitlement as final truth outside explicit dev/test mock mode.

## What Monetizes and Protects Margin

1. Flight margin monetization:
- `pricing-engine` applies margin on provider cost.
- `margin-guard` recalculates/excludes non-viable offers to enforce minimum net margin.

2. Subscription monetization:
- Pro unlocks higher-value discovery and forecast capabilities.
- Elite unlocks AI-intensive/high-cost features and advanced automation.

3. Premium extras / lock features:
- Radar configuration, smart alerts, AI travel, export, follows caps, rare opportunities are plan-gated with upgrade context.

4. Non-profitable usage prevention:
- Forecast endpoints now require Pro/Elite (`requireForecastAccess`).
- AI-heavy and alert-heavy features are capped/gated.
- Guard rails include quota counters, per-plan limits, and provider/AI cost guards.

## Pre-Production Critical Checks

1. Stripe config hard requirements:
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, live `STRIPE_PRICE_*` IDs.

2. Runtime policy checks:
- In production, mock billing disabled and inline price data disallowed.
- Readiness/startup fails when required Stripe env is missing.

3. Webhook security:
- Signature verification enabled.
- Idempotency table/migration applied.
- Replay/duplicate event tests passing.

4. Entitlement correctness:
- Free user cannot access forecast/AI-elite endpoints.
- Pro and Elite users pass appropriate premium gates.
- Frontend refreshes backend plan after checkout and billing portal actions.
