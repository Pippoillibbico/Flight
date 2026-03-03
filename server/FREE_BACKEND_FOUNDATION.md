## Free Backend Foundation (Implemented)

### Stack choice
- Node.js (existing Express backend) extended with:
  - Postgres (via existing `pg` pool when `DATABASE_URL` is set)
  - Redis (`ioredis`, with in-memory fallback in local dev)
  - Worker queue skeleton (Redis list `free:queue:alerts:evaluate`)

### Endpoints added
- `POST /auth/register`
- `POST /auth/login`
- `POST /demo/just-go`
- `POST /just-go`
- `GET /alerts`
- `POST /alerts`
- `DELETE /alerts/:id`
- `GET /usage`

### Limit enforcement
- HTTP `429` payload (exact shape):
```json
{
  "error": "limit_exceeded",
  "message": "You have exceeded the free plan limit. Try again later.",
  "reset_at": "<ISO timestamp>"
}
```
- Demo limits:
  - per-IP/minute
  - per-device/minute
  - daily demo search quota
- Logged free limits:
  - per-user/minute
  - daily search quota
  - active alert limit

### Precompute / jobs
- Nightly precompute skeleton:
  - destination rankings per `origin + budget_bucket + season + mood`
  - travel score factors
  - alert trigger signals
- Cron jobs configured:
  - `FREE_PRECOMPUTE_CRON` (default `20 2 * * *`, UTC)
  - `FREE_ALERT_WORKER_CRON` (default `*/15 * * * *`, UTC)

### Files added
- `server/lib/free-cache.js`
- `server/lib/free-foundation-store.js`
- `server/routes/free-foundation.js`
- `server/jobs/free-precompute.js`
- `server/jobs/free-alert-worker.js`
- `server/migrations/003_free_plan_foundation.sql`
- `server/MICROCOPY_FREE_PLAN.md`

### Files updated
- `server/index.js`
- `server/lib/db.js`
- `server/lib/saas-db.js`
- `.env.example`
- `package.json` / `package-lock.json` (`ioredis`)

### Security baseline implemented
- Zod input validation on all new endpoints.
- Password hashing (`bcrypt`) via existing auth module.
- JWT session tokens (Bearer).
- CORS allowlist enforcement on new endpoints.
- Immutable audit logs for sensitive operations (register/login/alert create).
- No LLM calls in new free endpoints (DB/Redis/precomputed only).

