# ENV Production Template (Security-Critical)

Last updated: 2026-04-04  
Use this file as deployment handoff input for production environment configuration.

## 1. Security-Blocking Variables (must be valid before release)

| Variable | Required In Prod | Forbidden / Weak Value | If Missing / Invalid | Security-Blocking | Safe Example |
|---|---|---|---|---|---|
| `NODE_ENV` | Yes | `development` | production guards not applied correctly | Yes | `NODE_ENV=production` |
| `JWT_SECRET` | Yes | placeholders (`replace-with`, `changeme`, `secret`), <32 chars | startup readiness fails (blocking runtime check) | Yes | `JWT_SECRET=7f4f...<64 random chars>...a19c` |
| `OUTBOUND_CLICK_SECRET` | Yes | missing, <24 chars, placeholder, same as `JWT_SECRET` | hard-fail startup in production | Yes | `OUTBOUND_CLICK_SECRET=4d2e...<48 random chars>...b8fa` |
| `ALLOW_MOCK_BILLING_UPGRADES` | Yes (`false`) | `true` | hard-fail startup in production | Yes | `ALLOW_MOCK_BILLING_UPGRADES=false` |
| `AUDIT_LOG_HMAC_KEY` | Yes | missing/placeholder | startup readiness fails (blocking runtime check) | Yes | `AUDIT_LOG_HMAC_KEY=6c91...<48 random chars>...e023` |
| `INTERNAL_INGEST_TOKEN` | Yes | missing/placeholder | startup readiness fails (blocking runtime check) | Yes | `INTERNAL_INGEST_TOKEN=9e51...<48 random chars>...0a7f` |
| `FRONTEND_ORIGIN` | Yes | empty, non-URL, non-HTTPS (prod) | startup policy/runtime check fails | Yes | `FRONTEND_ORIGIN=https://app.example.com` |
| `CORS_ALLOWLIST` or `CORS_ORIGIN` | Yes | empty in production | startup blocked (unless insecure bypass flags) | Yes | `CORS_ALLOWLIST=https://app.example.com,https://admin.example.com` |
| `DATABASE_URL` | Yes | empty/invalid | startup readiness infra/runtime blocking | Yes | `DATABASE_URL=postgresql://flight_app:***@db-prod:5432/flight` |
| `REDIS_URL` | Yes | empty/invalid | startup readiness infra/runtime blocking | Yes | `REDIS_URL=rediss://:***@redis-prod:6379/0` |
| `BILLING_PROVIDER` | Yes | unsupported value | runtime blocking check fails | Yes | `BILLING_PROVIDER=braintree` |
| `BT_MERCHANT_ID` | Yes when braintree | empty/placeholder | runtime blocking check fails | Yes (conditional) | `BT_MERCHANT_ID=merchant_live_xxx` |
| `BT_PUBLIC_KEY` | Yes when braintree | empty/placeholder | runtime blocking check fails | Yes (conditional) | `BT_PUBLIC_KEY=public_live_xxx` |
| `BT_PRIVATE_KEY` | Yes when braintree | empty/placeholder | runtime blocking check fails | Yes (conditional) | `BT_PRIVATE_KEY=private_live_xxx` |
| `BT_ENVIRONMENT` | Yes when braintree | not `sandbox`/`production` | runtime blocking check fails | Yes (conditional) | `BT_ENVIRONMENT=production` |

## 2. High-Risk Variables (must be enforced by release gate)

| Variable | Required In Prod | Forbidden / Weak Value | If Misconfigured | Security-Blocking In Code | Safe Example |
|---|---|---|---|---|---|
| `LEGACY_AUTH_ROUTES_ENABLED` | Yes (`false`) | `true` | legacy `/auth/*` surface remains active | No (release gate required) | `LEGACY_AUTH_ROUTES_ENABLED=false` |
| `ALLOW_INSECURE_STARTUP_FOR_TESTS` | Yes (`false`) | `true` | contributes to startup bypass activation | No (release gate required) | `ALLOW_INSECURE_STARTUP_FOR_TESTS=false` |
| `ALLOW_INSECURE_STARTUP_IN_PRODUCTION` | Yes (`false`) | `true` | if paired with previous, bypasses startup blocks | No (release gate required) | `ALLOW_INSECURE_STARTUP_IN_PRODUCTION=false` |
| `TRUST_PROXY` | Yes (explicit) | empty/wrong chain | proxy/IP/scheme trust can be wrong | Recommended check only | `TRUST_PROXY=1` |
| `AUTH_RETURN_ACCESS_TOKEN` | Yes (`false`) | `true` | JWT returned in API response body | No (release gate required) | `AUTH_RETURN_ACCESS_TOKEN=false` |
| `AUTH_REQUIRE_TRUSTED_ORIGIN` | Yes (`true`) | `false` | weaker CSRF origin posture for cookie auth | No hard-fail | `AUTH_REQUIRE_TRUSTED_ORIGIN=true` |
| `AUTH_REGISTRATION_ENABLED` | Policy dependent | accidental `true`/`false` mismatch | wrong registration exposure | No hard-fail | `AUTH_REGISTRATION_ENABLED=true` |
| `ADMIN_ALLOWLIST_EMAILS` | Yes | empty/wrong users | admin access broken or mis-scoped | No hard-fail in main API | `ADMIN_ALLOWLIST_EMAILS=secadmin@example.com,cto@example.com` |

## 3. Backoffice-Specific Security Variables

| Variable | Required In Prod | Forbidden / Weak Value | If Missing / Invalid | Security-Blocking | Safe Example |
|---|---|---|---|---|---|
| `BACKOFFICE_JWT_SECRET` | Yes | weak/placeholder/<32 chars | backoffice startup hard-fail | Yes | `BACKOFFICE_JWT_SECRET=0a7d...<64 random chars>...22bc` |
| `BACKOFFICE_TRUST_PROXY` | Yes | empty/`false` in prod | backoffice startup hard-fail | Yes | `BACKOFFICE_TRUST_PROXY=1` |
| `BACKOFFICE_ADMIN_CREDENTIALS` | Yes (recommended mandatory) | empty in prod | startup hard-fail unless shared mode explicitly allowed | Yes | `BACKOFFICE_ADMIN_CREDENTIALS=secadmin@example.com=<long-random-password>` |
| `BACKOFFICE_ALLOW_SHARED_PASSWORD_IN_PRODUCTION` | Yes (`false`) | `true` | allows weaker shared-password auth model | No hard-fail if strong password | `BACKOFFICE_ALLOW_SHARED_PASSWORD_IN_PRODUCTION=false` |
| `ADMIN_BACKOFFICE_PASSWORD` | Only if shared mode | weak/placeholder/<16 chars | hard-fail when shared mode allowed and password weak | Conditional | `ADMIN_BACKOFFICE_PASSWORD=<very-long-random-value>` |

## 4. Telemetry / Abuse Control Variables

| Variable | Required In Prod | Bad Value | Effect | Safe Example |
|---|---|---|---|---|
| `RL_TELEMETRY_PER_SECOND` | Yes | too high / 0 | telemetry spam easier | `RL_TELEMETRY_PER_SECOND=10` |
| `ADMIN_TELEMETRY_BURST_WINDOW_MS` | Yes | too high/low without test | dedupe/burst tuning broken | `ADMIN_TELEMETRY_BURST_WINDOW_MS=10000` |
| `ADMIN_TELEMETRY_BURST_MAX` | Yes | too high | burst abuse easier | `ADMIN_TELEMETRY_BURST_MAX=4` |
| `ADMIN_TELEMETRY_MAX_BODY_BYTES` | Yes | too high | payload abuse risk | `ADMIN_TELEMETRY_MAX_BODY_BYTES=8192` |
| `OUTBOUND_MAX_QUERY_CHARS` | Yes | too high | tracking payload abuse risk | `OUTBOUND_MAX_QUERY_CHARS=1600` |
| `OUTBOUND_MAX_BODY_BYTES` | Yes | too high | outbound ingestion abuse risk | `OUTBOUND_MAX_BODY_BYTES=16384` |

## 5. Safe Baseline Example (`.env.production`)

```dotenv
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://app.example.com
FRONTEND_ORIGIN=https://app.example.com

JWT_SECRET=<64-char-random-secret>
OUTBOUND_CLICK_SECRET=<48-char-random-secret-different-from-jwt>
AUDIT_LOG_HMAC_KEY=<48-char-random-secret>
INTERNAL_INGEST_TOKEN=<48-char-random-token>

DATABASE_URL=postgresql://flight_app:<redacted>@db-prod:5432/flight
REDIS_URL=rediss://:<redacted>@redis-prod:6379/0

CORS_ALLOWLIST=https://app.example.com,https://admin.example.com
CORS_ORIGIN=https://app.example.com
TRUST_PROXY=1

ALLOW_MOCK_BILLING_UPGRADES=false
LEGACY_AUTH_ROUTES_ENABLED=false
ALLOW_INSECURE_STARTUP_FOR_TESTS=false
ALLOW_INSECURE_STARTUP_IN_PRODUCTION=false
AUTH_REQUIRE_TRUSTED_ORIGIN=true
AUTH_RETURN_ACCESS_TOKEN=false

ADMIN_ALLOWLIST_EMAILS=secadmin@example.com,cto@example.com
BACKOFFICE_JWT_SECRET=<64-char-random-secret>
BACKOFFICE_TRUST_PROXY=1
BACKOFFICE_ADMIN_CREDENTIALS=secadmin@example.com=<long-random-password>
BACKOFFICE_ALLOW_SHARED_PASSWORD_IN_PRODUCTION=false

BILLING_PROVIDER=braintree
BT_ENVIRONMENT=production
BT_MERCHANT_ID=<merchant-id>
BT_PUBLIC_KEY=<public-key>
BT_PRIVATE_KEY=<private-key>
```

## 6. What Not To Do

- do not reuse `JWT_SECRET` as `OUTBOUND_CLICK_SECRET`
- do not enable startup bypass flags in production
- do not keep localhost origins in production CORS
- do not enable legacy auth routes in production
- do not return access tokens in login/register response payloads in production
- do not run backoffice with shared password mode unless explicitly accepted as temporary exception
