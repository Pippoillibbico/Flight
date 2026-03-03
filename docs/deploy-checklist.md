# Deploy Checklist

## 1) Environment
1. Copy `.env.example` to `.env`.
2. Set required secrets:
   - `JWT_SECRET`
   - `AUDIT_LOG_HMAC_KEY`
   - `INTERNAL_INGEST_TOKEN`
3. Set production values:
   - `NODE_ENV=production`
   - `DATABASE_URL`
   - `REDIS_URL`
   - `FRONTEND_ORIGIN`
   - `BODY_JSON_LIMIT`

## 2) Validation before deploy
1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run build`

## 3) Run prod-like locally (docker compose)
1. `docker compose up --build`
2. Verify:
   - `GET /api/health`
   - `GET /api/health/security`
   - `GET /api/engine/deal-score` with sample query.

## 4) Post-deploy checks
1. Health endpoints return `ok`.
2. Cookie auth works over HTTPS only in production.
3. Rate limits and quota responses are returned correctly.
4. Cron jobs running:
   - free alert worker
   - route baseline job
   - discovery alert worker

## 5) Backups
1. Run `npm run backup:postgres`.
2. Confirm both Postgres dump and audit log copy exist in `backups/`.
3. Perform periodic restore drill in staging.

