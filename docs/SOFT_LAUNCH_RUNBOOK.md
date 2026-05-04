# Soft Launch Runbook

## Mode

Set:

```bash
LAUNCH_MODE=soft
```

Soft launch is a cached-first, honest-launch profile. It is acceptable for Duffel, SMTP, or push delivery to be unavailable only when the product clearly presents cached/public data and does not promise unavailable live or instant delivery behavior.

## Required Environment

Minimum staging profile:

```bash
NODE_ENV=production
LAUNCH_MODE=soft
FRONTEND_ORIGIN=https://<staging-domain>
PROD_BASE_URL=https://<staging-domain>
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
BILLING_PROVIDER=stripe
STRIPE_PUBLISHABLE_KEY=pk_test_or_live_...
STRIPE_SECRET_KEY=sk_test_or_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_CREATOR=price_...
ALLOW_MOCK_BILLING_UPGRADES=false
ENABLE_PROVIDER_DUFFEL=false
ENABLE_PROVIDER_KIWI=false
ENABLE_PROVIDER_SKYSCANNER=false
FLIGHT_SCAN_ENABLED=false
```

Optional readiness upgrades:

```bash
ENABLE_PROVIDER_DUFFEL=true
DUFFEL_API_KEY=duffel_...
SMTP_HOST=smtp.example.com
SMTP_USER=...
SMTP_PASS=...
PUSH_WEBHOOK_URL=https://...
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

Only enable optional readiness variables after the provider or delivery path has been tested end to end.

## Visible Core

- Public cached deals.
- Basic route search/cache.
- Basic deterministic route insights.
- Price trend preview from existing data.
- Cached radar preview.
- Signup/login.
- Pricing and Stripe readiness.
- Outbound handoff.
- GDPR and cookie controls.

## Disabled Or Hidden

- AI for Free users.
- Multi-city live for Free users.
- Advanced scan jobs for Free users.
- Per-user scan jobs for Free users.
- Live scan/live fare copy when Duffel is not configured.
- Instant alert copy and delivery when SMTP/push are not configured.
- Advanced personal hub and advanced admin surfaces not needed for soft launch.
- Unready demo features.

## Readiness Outputs

`GET /api/system/capabilities` exposes:

- `launch.launchMode`
- `capabilities.provider_readiness`: `PROVIDER_READY` or `PROVIDER_NOT_READY`
- `capabilities.alert_delivery`: `ALERT_DELIVERY_READY` or `ALERT_DELIVERY_NOT_READY`
- `capabilities.data_source`: `live` only when a live provider is configured, otherwise `internal`

## External Audit

Run against the public HTTPS domain:

```bash
PROD_BASE_URL=https://<domain> npm run test:prod:external
```

If `PROD_BASE_URL` is missing, the script fails with explicit setup guidance. On success it writes:

```txt
docs/audit/external-audit-pass.log
```

## Staging Verification Commands

Run locally before staging deploy:

```bash
npm run lint
npm run build
npm test
npm run test:security
npm run compliance:check
node --test --test-concurrency=1 --test-isolation=none test/soft-launch-readiness.test.mjs test/free-plan-cost-guard.test.mjs test/free-router.integration.test.mjs test/opportunities-router.integration.test.mjs test/prod-external-audit-script.test.mjs
```

Confirm the external audit fails clearly when no domain is provided:

```bash
npm run test:prod:external
```

Expected failure:

```txt
PROD_BASE_URL is required. Run: PROD_BASE_URL=https://<domain> npm run test:prod:external
```

Run against staging:

```bash
PROD_BASE_URL=https://<staging-domain> npm run test:prod:external
```

If the environment already contains a real HTTPS value:

```bash
npm run test:prod:external
```

## Launch Checklist

- `LAUNCH_MODE=soft` is set on the staging/prod target.
- `PROD_BASE_URL` points to the real public HTTPS domain.
- `/health`, `/healthz`, `/readyz`, and `/api/system/capabilities` pass externally.
- Legal pages are reachable at `/privacy-policy`, `/cookie-policy`, and `/terms`.
- Pricing/public billing config is reachable and mock upgrades are disabled.
- `/api/free/public-deals` returns at most 10 cached/demo items with `cachedOnly: true`.
- `/api/free/route-insight` returns deterministic cached-only messaging.
- `/api/free/radar/refresh` returns `LIVE_REFRESH_REQUIRES_PRO`.
- Anonymous AI requests return `AI_NOT_AVAILABLE_ON_FREE`.
- Public copy does not claim unavailable live inventory, immediate alert delivery, advanced scans, or AI for Free.
- Duffel is only claimed ready after a controlled real-provider test.
- SMTP/push is only claimed ready after end-to-end delivery and failure handling are tested.
- Stripe/webhooks are only claimed ready after signed webhook delivery is verified on the real domain.

## Rollback Checklist

- Revert the deployment to the last known good release.
- Set `LAUNCH_MODE=soft` and keep provider/delivery flags disabled if readiness is uncertain.
- Disable paid CTAs that depend on unverified Stripe/webhook delivery.
- Confirm `/api/system/capabilities` reports cached/internal data when providers are unavailable.
- Re-run `npm run test:prod:external` against the rolled-back domain.
- Review logs for blocked Free AI/provider events and unexpected 5xx responses.
- Keep public messaging cached-first until provider, delivery, and billing readiness are re-proven.

## Public Claims Allowed

Allowed during soft launch:

- Public cached deals.
- Basic route insights.
- Cached radar preview.
- Price trend preview from existing data.
- Upgrade path for paid tools.
- Provider, delivery, and billing readiness only when the matching external checks have passed.

Not allowed during soft launch unless proven and gated:

- Live inventory claims without provider readiness.
- Immediate alert delivery claims without SMTP or push readiness.
- AI availability for Free users.
- Advanced scan jobs for Free users.
- Multi-city live for Free users.
- Stripe/webhook live readiness without a signed webhook test on the real domain.

## Approval Rule

Do not mark soft launch approved unless:

- Free users cannot call AI.
- Free users cannot generate provider costs.
- Public copy does not promise live data when provider readiness is `PROVIDER_NOT_READY`.
- Public copy does not promise immediate alert delivery when alert delivery is `ALERT_DELIVERY_NOT_READY`.
- The external production audit passes on the real HTTPS domain.
