# Production Audit Report

Date: 2026-03-04

## Architecture Map
- Server entrypoint: `server/index.js`
- Frontend entrypoint: `src/main.jsx` (Vite + React)
- API routes:
  - Core auth/search/alerts/watchlist: inline in `server/index.js`
  - Deal engine: `server/routes/deal-engine.js`
  - Discovery: `server/routes/discovery.js`
  - Free foundation: `server/routes/free-foundation.js`
  - SaaS APIs: `server/routes/apikeys.js`, `server/routes/billing.js`, `server/routes/usage.js`
- Middleware:
  - `server/middleware/request-id.js`
  - `server/middleware/error-handler.js`
  - `server/middleware/quotaGuard.js`
- Background workers/jobs:
  - `server/jobs/free-precompute.js`
  - `server/jobs/free-alert-worker.js`
  - `server/jobs/route-baselines.js`
  - `server/jobs/discovery-alert-worker.js`
  - `server/lib/price-ingestion-worker.js`
- Deal engine modules:
  - `server/lib/baseline-price-engine.js`
  - `server/lib/price-ingestion-worker.js`
  - `server/lib/deal-detector.js`
  - `server/lib/deal-ranking-engine.js`
  - `server/lib/destination-discovery-engine.js`
  - `server/lib/alert-intelligence.js`
  - `server/lib/seasonal-context-engine.js`
  - `server/lib/window-finder-engine.js`
  - `server/lib/anomaly-detector.js`
  - `server/lib/price-predictor.js`
- Database layer:
  - Local JSON DB: `server/lib/db.js`
  - SQL/PG support: `server/lib/sql-db.js`, `server/lib/saas-db.js`
  - Price/deal store (SQLite/PG): `server/lib/price-history-store.js`, `server/lib/deal-engine-store.js`
- Auth layer:
  - JWT + refresh rotation + cookie/CSRF checks in `server/index.js`
  - Password hashing/token verification in `server/lib/auth.js`
  - OAuth flows in `server/lib/oauth.js`
- Billing layer:
  - `server/routes/billing.js` + `server/lib/saas-db.js`
- Quota guard:
  - `server/middleware/quotaGuard.js` (plan counters, API key scope checks)

## Security Risks (Found / Reviewed)
- Large monolithic `server/index.js` increases change risk and review complexity.
- Multiple auth modes (cookie + bearer + API key) require strict test coverage for regression protection.
- Some legacy i18n strings contain encoding artifacts (non-security, but quality issue).
- Local SQLite mode is suitable for dev; production should use Postgres + Redis for resilience.

## Missing / Weak Production Features (Before this pass)
- Missing canonical `/health`, `/health/db`, `/health/engine` endpoints.
- Log persistence to `data/logs/` not guaranteed.
- Generic env names requested by ops (`CORS_ORIGIN`, `RATE_LIMIT_WINDOW`, `RATE_LIMIT_MAX`, `CLAUDE_API_KEY`) not explicitly documented.
- Cron retries were best-effort without bounded retry policy.

## Improvements Applied
- Added `PRODUCTION` health endpoints:
  - `GET /health`
  - `GET /health/db`
  - `GET /health/engine`
- Added structured log persistence to `data/logs/app.log` with request metadata.
- Enhanced request logs to include:
  - `timestamp`, `request_id`, `user_id`, `endpoint`, `status_code`, `durationMs`
- Added quota usage and quota exceed logging events in `quotaGuard`.
- Added cron retry mechanism with env controls:
  - `CRON_RETRY_ATTEMPTS`
  - `CRON_RETRY_DELAY_MS`
- Updated `.env.example` with required deployment variables and aliases:
  - `CORS_ORIGIN`, `RATE_LIMIT_WINDOW`, `RATE_LIMIT_MAX`, `CLAUDE_API_KEY`, etc.
- Docker compose hardened with server healthcheck and frontend dependency on healthy server.

## Suggested Next Improvements
- Extract domain-specific route modules from `server/index.js` to reduce blast radius.
- Add integration tests for auth refresh + CSRF + CORS preflight behavior.
- Add CI step for security smoke checks plus grep guard against external flight provider calls.
- Add log rotation policy for `data/logs/app.log`.
