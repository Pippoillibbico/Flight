# Production Infrastructure Runbook

## Scope
This runbook closes the remaining external production risks for:
- hosting/runtime
- domain + TLS
- secrets
- DB migrations/backups
- Stripe webhook live setup
- rollback

## 1. Provision runtime
1. Provision one runtime for `api` and one for `worker`.
2. Provision managed Postgres and Redis in the same region.
3. Allow network from runtime to Postgres/Redis only on required ports.
4. Deny public access to Postgres/Redis.

## 2. Domain and TLS
1. Point DNS `A/AAAA/CNAME` to the reverse proxy/load balancer.
2. Enable TLS certificate issuance/renewal.
3. Enforce HTTP to HTTPS redirect.
4. Verify HSTS and baseline security headers from edge.

## 3. Secrets and env
1. Put all production env values in a secret manager.
2. Do not mount `.env` from repository in production.
3. Rotate and version secrets (`JWT_SECRET`, `AUDIT_LOG_HMAC_KEY`, Stripe keys, ingest token).
4. Configure `RELEASE_ALERT_WEBHOOK_URL` for CI failure notifications on `release-prod-gate`.
5. Enforce production logging + DB policy values:
   - `LOG_LEVEL=info|warn|error|fatal`
   - `LOG_RETENTION_DAYS>=14`
   - `DB_REQUIRED_TX_ISOLATION=read committed` (or stricter policy intentionally chosen)
5. Run:
   - `npm run preflight:prod`
   - `RUN_DB_MIGRATION_AUDIT=true npm run release:prod:gate`

## 4. Database and backups
1. Run migrations:
   - `npm run db:migrate`
2. Verify migration alignment:
   - `npm run db:migrations:status`
3. Configure daily backup job:
   - `npm run backup:postgres`
4. Execute restore drill in staging weekly.

## 5. Stripe live webhook
1. In Stripe dashboard, configure live endpoint:
   - `https://<your-domain>/api/billing/webhook`
2. Subscribe at least to:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
3. Save live webhook secret in secret manager as `STRIPE_WEBHOOK_SECRET`.
4. Validate endpoint externally:
   - `PROD_BASE_URL=https://<your-domain> npm run test:prod:external`

## 6. Cutover checks
1. Run:
   - workflow `full-regression`
   - workflow `staging-readiness`
   - `npm run ops:prod:readiness`
2. Confirm:
   - `/health`, `/healthz`, `/readyz` all healthy
   - `billing_mock_mode` disabled
   - live Stripe checkout works
   - free users cannot access AI routes
   - load gate thresholds are green (`test:load:gate`)
   - staging smoke is green (`test:go-live` against staging URL)

## 7. Rollback policy
1. Keep previous stable image/tag deployable.
2. Rollback app image first; avoid DB rollback unless strictly required.
3. Prefer forward-fix migrations if schema already advanced.
4. After rollback, rerun:
   - `PROD_BASE_URL=https://<your-domain> npm run test:prod:external`
   - critical smoke flows (auth/search/billing)
5. One-click rollback command:
   - `ROLLBACK_DEPLOY_COMMAND="<platform rollback command>" PROD_BASE_URL=https://<your-domain> npm run ops:rollback:one-click`
