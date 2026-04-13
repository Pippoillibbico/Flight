# Go-Live Checklist (P0 / P1)

## P0 (blocking)
- `JWT_SECRET`, `AUDIT_LOG_HMAC_KEY`, `INTERNAL_INGEST_TOKEN` set in production secrets manager.
- `NODE_ENV=production`, HTTPS termination active, trusted reverse proxy configured.
- Postgres and Redis reachable and monitored.
- `REQUIRE_PRIMARY_INFRA_IN_PRODUCTION=true` (default) and startup logs confirm no `startup_blocked_primary_infra_unavailable`.
- Billing webhook configured with `STRIPE_WEBHOOK_SECRET`.
- `npm run test`, `npm run test:security`, `npm run test:go-live`, `npm run build` all pass.
- `npm run preflight:prod` passes (no blocking runtime config missing).
  - production policy checks pass (`FRONTEND_ORIGIN` HTTPS, CORS aligned, no localhost origins in allowlist).
- Backups configured and restore drill validated (DB + audit log).
- Legal pages published (Privacy Policy, Terms, Cookie Policy).

## P1 (recommended)
- Sentry/alerting integration for 5xx spikes and auth errors.
- Weekly dependency audit and monthly secret rotation.
- Incident runbook rehearsed with on-call.
- Dashboard for business KPIs and conversion funnel.
- Synthetic uptime checks for `/health`, `/health/db`, `/health/engine`.

## Runtime verification
- Health:
  - `GET /health`
  - `GET /health/db`
  - `GET /health/engine`
  - `GET /api/health/deploy-readiness`
- Logs:
  - `data/logs/app.log`
  - `data/logs/error.log`
  - `data/logs/security.log`
- Reporting:
  - `npm run show:report`
  - `SYSTEM_STATE_REPORT_REQUIRE_PRIMARY=true npm run report:system-state` (must not fallback to sqlite in production validation)
  - `npm run data:cleanup:dry` (verifica artefatti locali `data/` prima del rilascio)
  - `npm run test:security:compliance:strict` (solo con `DATABASE_URL` + `REDIS_URL` reali disponibili)
  - locale: `npm run test:security:compliance:strict:local` (stack docker postgres/redis)
