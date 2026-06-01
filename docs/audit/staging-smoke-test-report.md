# Staging Smoke Test Readiness Report
## Scope

This report records the Block 8 readiness audit for provider-backed staging data and the Stripe test checkout callback. It intentionally does not execute external provider calls or Stripe requests when a safe staging environment is unavailable.

## Environment Audited

Audit date: `2026-05-31`

The available local `.env` was inspected without printing secret values.

| Area | Status | Notes |
| --- | --- | --- |
| `STAGING_BASE_URL` / `PROD_BASE_URL` / `TARGET_BASE_URL` | missing | No deploy target is available for an external smoke test. |
| `FRONTEND_URL` | local only | Present, but points to a local HTTP environment. |
| `NODE_ENV` | development | Local runtime only. |
| `LAUNCH_MODE` | soft | Safe local profile. |
| Provider flags | disabled | Duffel, Amadeus, Kiwi, Skyscanner, collection worker, and flight scan are disabled. |
| Provider credentials | missing | No provider-backed smoke test can run safely. |
| Travelpayouts affiliate flag | configured | Marker is missing in the audited local environment. |
| Billing provider | Stripe | Configured locally. |
| Stripe key mode | live | Live keys are present locally. They were not used. |
| Stripe webhook secret | missing | Signed webhook callback verification cannot run. |
| Stripe price mapping | partial | PRO and ELITE mappings are present; `STRIPE_PRICE_CREATOR` is missing. |
| Explicit Stripe return URL env vars | missing | Runtime derives internal success and cancel URLs from the configured frontend origin. |

## Safety Decision

External provider smoke tests and Stripe callback tests were not executed.

Reasons:

- no staging HTTPS base URL is configured;
- provider flags are disabled and provider credentials are missing;
- the available Stripe keys are classified as live, not test;
- `STRIPE_WEBHOOK_SECRET` is missing;
- automated tests must not contact live payment or provider services.

## Verified Locally

Static review confirmed:

- subscriptions use Stripe Checkout Sessions with `mode: subscription`;
- checkout success defaults to `/billing/success?session_id={CHECKOUT_SESSION_ID}`;
- checkout cancel defaults to `/billing/cancel`;
- production return URLs are restricted to configured frontend origins unless explicitly allowed;
- the frontend detects `session_id`, calls `/api/billing/subscription/sync`, refreshes `/api/auth/me`, refreshes subscriptions, and removes the query parameter;
- the real checkout path does not promote the user plan locally;
- existing tests cover checkout creation, webhook signature rejection, webhook dedupe, subscription sync, retry behavior, and locally intercepted checkout handoff.

## Required Staging Variables

Configure these in a dedicated staging secret store. Do not place live values in local files.

```env
NODE_ENV=production
LAUNCH_MODE=soft
FRONTEND_ORIGIN=https://<staging-domain>
FRONTEND_URL=https://<staging-domain>
PROD_BASE_URL=https://<staging-domain>

BILLING_PROVIDER=stripe
ALLOW_MOCK_BILLING_UPGRADES=false
STRIPE_ALLOW_INLINE_PRICE_DATA=false
STRIPE_ALLOW_EXTERNAL_RETURN_URLS=false
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_CREATOR=price_...

ENABLE_PROVIDER_DUFFEL=true
DUFFEL_API_KEY=<staging-provider-key>
ENABLE_PROVIDER_KIWI=false
ENABLE_PROVIDER_SKYSCANNER=false
PROVIDER_COLLECTION_ENABLED=true
PROVIDER_COLLECTION_ALLOW_WITH_SCAN=true
FLIGHT_SCAN_ENABLED=true
```

Enable only the provider that has an approved staging-safe credential and budget.

## Provider-Backed Smoke Checklist

After deploying staging:

1. Run `PROD_BASE_URL=https://<staging-domain> npm run test:prod:external`.
2. Confirm `/api/system/capabilities` reports the intended provider readiness and data source.
3. Open landing, feed, Radar, Explore, AI Travel, AI Flight Hacker preview, upgrade modal, and account surfaces.
4. Check desktop `1440x900` and mobile `390x844`.
5. Verify long provider labels do not clip cards or CTA labels.
6. Verify no mojibake, raw i18n keys, technical payload values, or mixed-language copy is visible.
7. Verify provider timeout and unavailable states remain honest and readable.
8. Review logs for bounded provider calls and absence of secrets.

## Stripe Test Callback Checklist

Use Stripe test mode only:

1. Deploy with `sk_test_...`, `pk_test_...`, test Price IDs, and a staging webhook secret.
2. Configure Stripe CLI or the Stripe test dashboard to forward signed events to:
   - `https://<staging-domain>/api/billing/webhook`
3. Sign in as a Free staging user.
4. Open the PRO upgrade modal and start Checkout.
5. Confirm the created session uses Stripe test mode.
6. Complete Checkout with a Stripe test payment method.
7. Confirm return to `/billing/success?session_id=...`.
8. Confirm backend subscription sync completes before the UI shows a premium state.
9. Repeat with cancel and confirm return to `/billing/cancel` without a plan promotion.
10. Trigger a signed webhook replay and confirm idempotent dedupe.
11. Confirm no secret, card data, or full sensitive payload is logged.

## Mock, Staging, And Production

| Mode | Purpose | External calls |
| --- | --- | --- |
| Local mocked E2E | deterministic regression coverage | none |
| Staging | provider-safe and Stripe test verification | approved provider sandbox/test credentials and Stripe test mode only |
| Production | real user traffic | live credentials after staging evidence and release approval |

## Blocked Items

- Provider-backed UI smoke: blocked by missing staging target and provider credentials.
- Stripe hosted callback smoke: blocked by missing test keys, webhook secret, and staging target.
- Stripe cancel callback UI validation: blocked by the same staging prerequisites.

## Residual Risks

- Provider-backed labels can be longer than mocked labels.
- A signed Stripe callback has not yet been observed on a deployed staging endpoint.
- The backend triangulation cached-preview payload is locale-neutral and exposes stable message codes; user-facing localization remains in the frontend.
