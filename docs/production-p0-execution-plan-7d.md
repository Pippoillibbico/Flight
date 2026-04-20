# Production P0 Execution Plan (7 Days)

Last updated: 2026-04-15
Scope: close real go-live blockers for Flight (Duffel + Stripe + AI), without changing public API contracts.

## Goal
- Reach deployable, auditable production baseline with:
- secure runtime config
- live Stripe subscription flow
- primary infra (Postgres + Redis)
- rollback-ready release process

## Day 1 - Infra foundation
- Provision production runtime (API + worker), database, cache, and persistent log storage.
- Configure domain + DNS + HTTPS termination.
- Set `TRUST_PROXY` according to real proxy chain.
- Done criteria:
- `/healthz` returns `200`
- `/readyz` returns `200` from production runtime
- no HTTP plaintext path exposed to users

## Day 2 - Secrets and env hardening
- Populate all blocking secrets in secret manager:
- `JWT_SECRET`, `OUTBOUND_CLICK_SECRET`, `AUDIT_LOG_HMAC_KEY`, `INTERNAL_INGEST_TOKEN`
- `DATABASE_URL`, `REDIS_URL`, `FRONTEND_ORIGIN`, CORS vars
- Stripe live vars (`STRIPE_*`, `BILLING_PROVIDER=stripe`)
- Run:
- `npm run preflight:prod`
- Done criteria:
- preflight output `ok: true`
- no blocking runtime check missing

## Day 3 - Database safety and migrations
- Run migrations on production DB:
- `npm run db:migrate`
- Set scheduled backups and retention.
- Execute one restore drill in staging with production-like snapshot.
- Done criteria:
- `schema_migrations` fully aligned
- backup artifact generated
- restore drill documented and successful

## Day 4 - Stripe live end-to-end
- Create/verify live products and prices (`pro`, `creator/elite`).
- Confirm `STRIPE_PRICE_PRO` and `STRIPE_PRICE_CREATOR`.
- Configure Stripe webhook endpoint in production:
- `/api/billing/webhook`
- Validate signature, idempotency, and replay.
- Run manual tests:
- checkout create -> completed
- subscription update/cancel/resume
- `invoice.payment_succeeded` and `invoice.payment_failed`
- Done criteria:
- user plan sync is updated by backend only
- repeated webhook event returns deduped behavior

## Day 5 - Security and abuse controls
- Validate CORS allowlist exactness and no localhost in prod.
- Validate auth flow over HTTPS cookies + CSRF.
- Validate rate limits (`/api`, `/api/auth`, outbound, telemetry).
- Run:
- `npm run test:security`
- `npm run test:security:compliance`
- Done criteria:
- security suite passes
- no insecure startup bypass flags enabled

## Day 6 - Monitoring, alerting, and operations
- Wire external monitoring/alerts for:
- 5xx rates
- auth failures spikes
- webhook failures
- provider failures (Duffel)
- Set on-call runbook and escalation contacts.
- Validate observability endpoints:
- `/api/health/deploy-readiness`
- `/api/health/observability`
- Done criteria:
- alert fires on synthetic failure test
- incident runbook reviewed and executable

## Day 7 - Release, rollback, and freeze gate
- Execute full go-live checklist + smoke tests.
- Run build/test gate:
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:go-live`
- `npm run preflight:prod`
- Prepare rollback package:
- previous image tag
- DB rollback strategy (forward-fix preferred, data-safe)
- Done criteria:
- release sign-off complete
- rollback procedure tested at least once in staging

## Mandatory go-live gate
- All P0 done criteria green.
- No mock-only billing path enabled in production.
- No unresolved blocking check in runtime/startup readiness.
- Stripe webhooks verified on live endpoint.

## Owner checklist template
- Infra owner: Day 1-3
- Billing owner: Day 4
- Security owner: Day 5
- SRE/Operations owner: Day 6-7
