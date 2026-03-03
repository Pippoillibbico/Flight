# Production Deployment Checklist

## Environment
- Set `NODE_ENV=production`.
- Set `JWT_SECRET` to a strong random value (32+ chars).
- Set `FRONTEND_ORIGIN` to the exact public web origin.
- Set `DATABASE_URL` and verify Postgres connectivity.
- Set `REDIS_URL` and verify connectivity.
- Set SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) for password reset email delivery.
- Set `AUDIT_LOG_HMAC_KEY`.

## Security
- Verify cookies are `httpOnly`, `secure` (production), `sameSite=lax`.
- Confirm CORS rejects origins not in `FRONTEND_ORIGIN`/allowlist.
- Confirm `X-Request-Id` is present on all responses.
- Confirm auth and API rate limits are active.
- Confirm no secrets are hardcoded in code/repo.

## Reliability
- Run DB migrations: `npm run db:migrate`.
- Check `GET /healthz` returns `200`.
- Check `GET /readyz` returns `200` with Postgres + Redis checks passing.
- Verify cron jobs start without errors in logs.

## Auth & Limits
- Test register/login/logout/refresh.
- Test password reset request + confirm flow.
- Confirm `429` contract:
  - `error: "limit_exceeded"`
  - `reset_at` ISO timestamp
  - `request_id`

## Frontend
- Confirm homepage copy is loaded from i18n keys.
- Confirm API errors are mapped through centralized `handleApiError`.
- Confirm UI never shows raw HTTP status, stack traces, or "Network Error".
- Confirm no JWT is written to `localStorage`.

## Docker
- Build backend: `docker build -f Dockerfile.server -t flight-server .`
- Build frontend: `docker build -f Dockerfile.frontend -t flight-frontend .`
- Start stack: `docker compose up -d --build`
- Smoke test:
  - `http://localhost/`
  - `http://localhost/healthz`
  - `http://localhost/readyz`
