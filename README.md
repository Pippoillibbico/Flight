# Flight Suite

Production-oriented full-stack app (Vite/React + Node/Express) with a **local proprietary flight intelligence pipeline**.

## Stack
- Frontend: React + Vite (`src/`)
- Backend API: Express (`server/index.js`)
- Data stores:
  - JSON runtime store (`data/db.json`) for app state
  - SQLite/Postgres for price history (`server/lib/price-history-store.js`)
  - Redis/in-memory cache (`server/lib/free-cache.js`)

## Local Proprietary Mode (default)
- Core flight logic uses local datasets/engines.
- Outbound partner links default to `tde_booking` only.
- External partners are opt-in via `ENABLE_EXTERNAL_FLIGHT_PARTNERS=true`.

## Quick Start
1. Install dependencies:
```bash
npm i
```
2. Create env file:
```bash
cp .env.example .env
```
3. Run app (frontend + backend):
```bash
npm run dev
```
`npm run dev` starts frontend + API runtime (without cron workers).  
Use `npm run dev:all` to run frontend + API + worker + backoffice together.

## Backend Only
```bash
npm run dev:server
```
Runs API-only runtime (`server/api.js`).

## Split Runtime (API + Worker)
```bash
npm run dev:api
npm run dev:worker
```

Single command for split backend only:
```bash
npm run dev:split
```

## Tests
```bash
npm test
```

## Security Smoke Tests
```bash
npm run test:security
```

## Security Compliance (Strict Runtime)
Requires reachable `DATABASE_URL` and `REDIS_URL` (no startup bypass):
```bash
npm run test:security:compliance:strict
```

Local helper (starts/stops docker `postgres` + `redis`, then runs strict):
```bash
npm run test:security:compliance:strict:local
```

## Go-Live Smoke Tests
```bash
npm run test:go-live
```

## External Production Audit
```bash
PROD_BASE_URL=https://your-domain.tld npm run test:prod:external
```
Validates DNS + HTTPS endpoint reachability + health/readiness + security headers + billing webhook route.

## Production Ops Readiness
```bash
npm run ops:prod:readiness
```
Runs a single P0-oriented check sequence (secrets, infra reachability, preflight, migrations, external audit when configured).

## One-Click Rollback
```bash
ROLLBACK_DEPLOY_COMMAND="your platform rollback command" PROD_BASE_URL=https://your-domain.tld npm run ops:rollback:one-click
```

## Local Log Report
```bash
npm run show:report
```

## Local Data/Worker Commands
- Import monthly prices CSV -> local normalized JSON:
```bash
npm run import:prices -- path/to/prices.csv
```
- Ingest CSV into deal engine store:
```bash
npm run ingest:csv -- --file data/price-observations.template.csv
```
- Seed synthetic observations:
```bash
npm run seed:price-observations
```

- Run workers manually (one-shot):
```bash
npm run worker:price-ingestion
npm run worker:route-baseline
npm run worker:discovery-alert
npm run worker:flight-scan-scheduler
npm run worker:flight-scan
npm run worker:flight-scan-cycle
```

## Docker
```bash
docker compose up --build
```
- API: `http://localhost:3000`
- Frontend: `http://localhost`

## Production Compose Template
```bash
docker compose -f deploy/docker-compose.production.yml up -d --build
```

## Entry Points
- Combined runtime (API + worker scheduler): `server/index.js`
- API-only runtime: `server/api.js`
- Worker-only runtime: `server/worker.js`

## Important Env Vars
- `JWT_SECRET` (required)
- `CORS_ALLOWLIST`
- `DATABASE_URL` (optional; Postgres mode)
- `REDIS_URL` (optional; Redis cache)
- `BUILD_VERSION` (shown by `/api/health`)
- `ENABLE_EXTERNAL_FLIGHT_PARTNERS` (default `false`)
- `INTERNAL_INGEST_TOKEN` (required for internal ingestion routes)
- `STRIPE_WEBHOOK_SECRET` (required for secure billing webhook)

## Operations Docs
- [Go-Live Checklist](docs/go-live-checklist.md)
- [Incident Runbook](docs/incident-runbook.md)
- [Backup Strategy](docs/backup-strategy.md)
- [Security Operations Checklist](docs/SECURITY_OPERATIONS_CHECKLIST.md)
- [Threat Model P0/P1](docs/THREAT_MODEL_P0_P1.md)
- [Stripe Billing Integration](docs/stripe-billing-integration.md)
- [Production Infrastructure Runbook](docs/production-infra-runbook.md)
- [Production Cutover Playbook](docs/production-cutover-playbook.md)
