# Live Execution Tracker

Date: 2026-04-21

## Scope
- Execute production-hardening tasks in repository.
- Exclude external secret/API value provisioning.

## Tasks

- [x] Align `.env` templates to pricing/AI/free-limit baseline
  - Files: `.env.example`, `.env.staging.example`, `.env.production.example`
  - Result: `OPENAI_MODEL=gpt-5-mini`, `OPENAI_FALLBACK_MODEL=gpt-4o-mini`, Pro=12, Creator=22, strict free/demo caps.

- [x] Enforce production blocking config checks
  - Files: `server/lib/runtime-config.js`
  - Result: blocking checks already active for Stripe price IDs, provider API key, core secrets, unsafe flags.

- [x] Normalize pricing defaults across backend/storage/migrations
  - Files: `server/lib/saas-db-helpers.js`, `server/lib/saas-db.js`, `server/lib/db.js`, `server/migrations/002_saas_monetization.sql`, `server/lib/billing/stripe-billing-service.js`
  - Result: all defaults now Pro=12, Creator=22; legacy 12.99/29.99 removed.

- [x] Enforce AI gating by plan
  - Files: `server/lib/plan-access.js`, `server/bootstrap/auth-runtime.js`, `server/lib/ai-intent-service.js`
  - Result: free blocked (`upgrade_required`), pro/creator allowed with limits and default model strategy.

- [x] Enforce free-plan cost controls
  - Files: `server/lib/free-foundation-store.js`
  - Result: strict defaults 3/1/2/5/6/8 active.

- [x] Enforce Duffel live-search gating by plan
  - Files: `server/routes/search.js`
  - Result: anonymous/free cannot trigger live provider calls.

- [x] Enforce radar teaser gating (3/5/full)
  - Files: `server/routes/deal-engine.js`
  - Result: anonymous=3, free=5, paid=full; reason metadata includes `provider_unavailable`/`no_data`.

- [x] Enforce outbound click limit policy
  - Files: `server/routes/deal-engine.js`
  - Result: anonymous max 1 click then auth_required; free max 1 click then limit_reached.

- [x] Standardize error model usage
  - Files: `server/middleware/error-handler.js`, route responses in `server/routes/deal-engine.js`, AI guards
  - Result: consistent `auth_required`, `upgrade_required`, `limit_reached`, `provider_unavailable`.

- [x] Complete funnel telemetry minimum event coverage
  - Files: `server/lib/request-schemas.js`, `src/features/admin-dashboard/types/index.ts`, `src/features/admin-dashboard/domain/map-dashboard-telemetry.ts`, `src/features/app-shell/hooks/useAdminTelemetryBridge.js`, `src/features/app-shell/hooks/useAuthSessionActions.js`, `src/App.jsx`
  - Result: all required events accepted and emitted, including signup_started/signup_completed.

- [x] Local go-live smoke validation
  - Command: `npm run test:go-live`
  - Result: PASS.

- [x] Fix release gate false-positive on optional provider references
  - Files: `scripts/check-no-external-providers.mjs`
  - Result: `npm run lint:providers` now passes (`OK`).

- [x] Execute production readiness gate (local dry attempt)
  - Command: `npm run ops:prod:readiness`
  - Result: expected fail due missing external production secrets/endpoints.

- [x] Provision internal application secrets locally (no external keys)
  - File: `.env`
  - Updated:
    - `JWT_SECRET`
    - `OUTBOUND_CLICK_SECRET`
    - `AUDIT_LOG_HMAC_KEY`
    - `INTERNAL_INGEST_TOKEN`
  - Validation: `npm run preflight:prod` now no longer reports those keys as missing.

- [x] Re-run readiness after internal-secret provisioning
  - Command: `npm run ops:prod:readiness`
  - Missing set now reduced to external-only:
    - `STRIPE_SECRET_KEY`
    - `STRIPE_PUBLISHABLE_KEY`
    - `STRIPE_WEBHOOK_SECRET`
    - `STRIPE_PRICE_PRO`
    - `STRIPE_PRICE_CREATOR`
    - `AFFILIATE_TRAVELPAYOUTS_MARKER`

- [ ] Stripe live objects creation (manual external)
  - Action: create live prices in Stripe dashboard/account and set final `STRIPE_PRICE_PRO`, `STRIPE_PRICE_CREATOR`.
  - Note: repo script available: `scripts/stripe-sync-plans.mjs`.

- [ ] Production infrastructure binding (manual external)
  - Action: set final production `FRONTEND_URL/ORIGIN`, HTTPS domain, production DB/Redis endpoints.

- [ ] Production secrets provisioning and rotation (manual external)
  - Action: set/rotate strong `JWT_SECRET`, `OUTBOUND_CLICK_SECRET`, `AUDIT_LOG_HMAC_KEY`, `INTERNAL_INGEST_TOKEN`.
