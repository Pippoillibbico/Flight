# Runtime Profiles

Jetly / Flight Suite keeps the existing SaaS core. Runtime profiles only decide which infrastructure and paid-cost features are allowed to be active.

## soft-zero-cost

Use for soft launch, product validation, and cached-only Free flows.

Required intent:

- `RUNTIME_PROFILE=soft-zero-cost`
- `LAUNCH_MODE=soft`
- `CACHE_BACKEND=memory` or `redis`
- `REDIS_REQUIRED_MODE=soft_optional`
- `ALLOW_IN_MEMORY_CACHE_IN_SOFT_LAUNCH=true` only for single-instance deployments

Rules:

- Free AI is off: `FREE_AI_ENABLED=false`, `AI_ALLOW_FREE_USERS=false`.
- Free live provider calls are off.
- Free deep scan, per-user jobs, instant alerts, and browser push are off/gated.
- Redis may be missing only when the app is single-instance and budget guards fail closed.
- Email may run dry-run.
- Stripe live checkout may remain gated.
- Duffel/Kiwi live providers must be off or paid-only.
- AI and provider budget guards must not fail open.

Expected `/readyz`/capabilities shape:

```json
{
  "runtimeProfile": "soft-zero-cost",
  "cacheBackend": "memory",
  "redisStatus": "optional_missing_safe",
  "freeCostStatus": "zero_cost_confirmed",
  "aiStatus": "paid_only",
  "providerStatus": "gated"
}
```

## paid-live

Use when activating paid AI, paid live providers, and first real paid workflows.

Required intent:

- `RUNTIME_PROFILE=paid-live`
- `CACHE_BACKEND=redis` when live scans, provider collection, or scan workers are enabled
- `AI_ALLOWED_PLAN_TYPES=pro,creator` or equivalent paid-only list
- `AI_BUDGET_FAIL_OPEN=false`
- `SEARCH_PROVIDER_BUDGET_FAIL_OPEN=false`

Rules:

- AI is paid-only.
- Provider live search is paid-only.
- Redis is required when live scans/jobs are enabled.
- Stripe live credentials are required if checkout is active.
- SMTP is required only when real email alert delivery is active.
- Rate limits and budget guards are mandatory.

## production-full

Use for complete public production.

Required intent:

- `RUNTIME_PROFILE=production-full`
- `CACHE_BACKEND=redis`
- `REDIS_REQUIRED_MODE=production_full`
- `DATABASE_URL` configured
- `REDIS_URL` configured

Rules:

- Redis and Postgres are required.
- Memory cache is not allowed for critical multi-instance behavior.
- Stripe webhook is required when paid billing is active.
- Provider readiness is required when public copy claims live inventory.
- SMTP is required when real email delivery is active.
- Push is active only when VAPID or push webhook configuration is ready.
- Mock billing and dry-run behavior are not allowed for features declared live.

## Cache Policy

Supported values:

```env
CACHE_BACKEND=redis|memory|postgres
REDIS_REQUIRED_MODE=production_full|soft_optional
ALLOW_IN_MEMORY_CACHE_IN_SOFT_LAUNCH=true|false
```

Current implementation:

- `redis`: production-ready cache, counters, locks, queue, budget guard backend.
- `memory`: safe only in `soft-zero-cost`, single-instance, Free zero-cost mode.
- `postgres`: reserved policy value; not active until a Postgres cache/counter adapter is implemented.

Memory cache is blocked when:

- `RUNTIME_PROFILE=production-full`
- live providers, scan workers, or provider collection are enabled
- deployment is multi-instance
- AI/provider budget guards fail open
- Free AI/provider/job flags are unsafe

## Release Guidance

Use these checks before changing profile:

```bash
npm run lint
npm run build
npm test
npm run test:security
npm run compliance:check
npm run release:prod:gate
```

For external staging:

```bash
PROD_BASE_URL=https://<domain> npm run test:prod:external
```
