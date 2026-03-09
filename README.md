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

## Backend Only
```bash
npm run dev:server
```

## Tests
```bash
npm test
```

## Security Smoke Tests
```bash
npm run test:security
```

## Go-Live Smoke Tests
```bash
npm run test:go-live
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
```

## Docker
```bash
docker compose up --build
```
- API: `http://localhost:3000`
- Frontend: `http://localhost`

## Entry Points
- API server: `server/index.js`
- Discovery alert worker schedule: configured in `server/index.js`
- Price ingestion worker schedule: configured in `server/index.js`

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
