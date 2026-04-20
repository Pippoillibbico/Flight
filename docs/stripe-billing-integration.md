# Stripe Billing Integration (Subscriptions)

## Scope
This app uses Stripe for premium subscription monetization (`pro`, `elite/creator`) with backend authority over plan state.

## Stripe Version Baseline
- Stripe SDK: `^22.0.1`
- Stripe API version: `2026-02-25.clover`

## Environment Matrix
### Required In Production (when `STRIPE_SECRET_KEY` is configured)
- `BILLING_PROVIDER=stripe`
- `STRIPE_SECRET_KEY` (`sk_live_...` in production, `sk_test_...` in local/staging)
- `STRIPE_PUBLISHABLE_KEY` (`pk_live_...` or `pk_test_...`)
- `STRIPE_WEBHOOK_SECRET` (`whsec_...`)
- `STRIPE_PRICE_PRO` (Stripe Price ID for monthly PRO)
- `STRIPE_PRICE_CREATOR` (Stripe Price ID for monthly CREATOR/ELITE)
- `STRIPE_ALLOW_INLINE_PRICE_DATA=false`
- `ALLOW_MOCK_BILLING_UPGRADES=false`

### Optional / Dev-Test Friendly
- `STRIPE_SUBSCRIPTION_PRORATION_BEHAVIOR=create_prorations|none|always_invoice`
- `STRIPE_PRICE_LOOKUP_KEY_PRO=flight_pro_monthly`
- `STRIPE_PRICE_LOOKUP_KEY_CREATOR=flight_creator_monthly`
- `STRIPE_PRICE_CURRENCY=EUR`

## Local Setup
1. Add Stripe keys to `.env` (never commit secrets).
2. Create/sync Stripe products + prices:
   - `npm run billing:stripe:sync-plans`
   - Copy output into `.env`:
     - `STRIPE_PRICE_PRO=...`
     - `STRIPE_PRICE_CREATOR=...`
   - Keep `STRIPE_ALLOW_INLINE_PRICE_DATA=false` to mirror production behavior.
3. Start backend:
   - `npm run dev:server`
4. Start webhook forwarding:
   - `stripe login`
   - `stripe listen --forward-to http://localhost:3000/api/billing/webhook`
   - Copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`.

## How To Test Webhooks
Use Stripe CLI events:
- `stripe trigger checkout.session.completed`
- `stripe trigger customer.subscription.updated`
- `stripe trigger customer.subscription.deleted`
- `stripe trigger invoice.payment_succeeded`
- `stripe trigger invoice.payment_failed`
- replay test:
  - resend the same event payload/signature to confirm dedupe returns `deduped: true`

Expected behavior:
- Signature is verified server-side (invalid signature => `400`).
- Event dedupe/idempotency is enforced.
- On successful processing, internal subscription/user plan is synced.
- `invoice.payment_succeeded` / `invoice.payment_failed` attempt subscription sync when `invoice.subscription` is present.

## Backend Source Of Truth
Frontend must never decide premium status autonomously.
Authoritative status comes from backend records updated by Stripe events and backend mutation routes:
- `GET /api/billing/subscription`
- `POST /api/billing/subscription/sync`
- `POST /api/billing/subscription/change-plan`
- `POST /api/billing/subscription/cancel`
- `POST /api/billing/subscription/resume`

## Subscription Flow
1. Frontend starts checkout: `POST /api/billing/checkout`.
2. Backend ensures Stripe customer and creates Stripe Checkout Session.
3. User completes checkout on Stripe hosted page.
4. Stripe sends webhook (`checkout.session.completed` and subscription events).
5. Backend verifies signature, dedupes event, persists internal plan/subscription state.
6. Frontend reads updated state from backend (`/api/billing/subscription` or `/api/auth/me`).
7. On checkout return (`session_id` query param), frontend forces backend sync/read before showing premium state.

## Database Mapping
- App user:
  - JSON user record stores `stripeCustomerId`.
- Internal subscription:
  - `user_subscriptions` (Postgres) or `userSubscriptions` (JSON fallback).
  - Key fields: `plan_id`, `status`, `stripe_subscription_id`, `stripe_customer_id`, `current_period_end`, `cancel_at_period_end`.
- Webhook idempotency:
  - `stripe_webhook_events` (Postgres table via migration `012_stripe_webhook_events.sql`)
  - `stripeWebhookEvents` (JSON fallback)

## Production Critical Checks
1. `ALLOW_MOCK_BILLING_UPGRADES=false`
2. `STRIPE_WEBHOOK_SECRET` set and endpoint reachable.
3. `STRIPE_PRICE_PRO` and `STRIPE_PRICE_CREATOR` point to live monthly prices.
4. `STRIPE_ALLOW_INLINE_PRICE_DATA=false`
5. `STRIPE_PUBLISHABLE_KEY` is configured.
6. Confirm webhook retries are handled (idempotency + 5xx on processing errors).
7. Verify replay of the same webhook event is deduped.
8. Verify return-from-checkout flow updates UI state from backend (`/api/auth/me` / `/api/billing/subscription`) without local premium promotion.
