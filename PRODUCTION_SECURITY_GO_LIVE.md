# Production Security Go-Live Checklist

Last updated: 2026-04-04  
Scope: production configuration and operational release gates for the current codebase.

## 1. Executive Summary

- Current technical posture: hardening and remediation are implemented in auth/session, outbound, OAuth binding, telemetry ingestion, admin guards, backoffice, and startup checks.
- Already closed in code (technical):
  - hard-fail on weak/missing `OUTBOUND_CLICK_SECRET` in production (`server/index.js`)
  - hard-fail on `ALLOW_MOCK_BILLING_UPGRADES=true` in production (`server/index.js`)
  - admin-only guard on sensitive operational and reporting endpoints
  - OAuth state is bound to browser cookie context with single-use session consumption
  - outbound click ingestion is bound to server-issued redirect context
  - CSV export neutralizes formula-injection payloads (`server/lib/outbound-report.js`)
  - startup readiness + runtime config audits available (`/api/health/deploy-readiness`, `/api/health/security`)
- Residual risk is mostly deployment/configuration risk, not missing code controls.

## 2. Blocking Requirements For Production

All items below must be true before declaring `GO`:

- Secrets and tokens:
  - `JWT_SECRET` strong (>=32 chars, non-placeholder)
  - `OUTBOUND_CLICK_SECRET` strong (>=24 chars), non-placeholder, and different from `JWT_SECRET`
  - `AUDIT_LOG_HMAC_KEY` strong and non-placeholder
  - `INTERNAL_INGEST_TOKEN` strong and non-placeholder
- Infra and network:
  - `FRONTEND_ORIGIN` set to real production HTTPS origin
  - CORS allowlist configured (`CORS_ALLOWLIST` and/or `CORS_ORIGIN`) and includes `FRONTEND_ORIGIN`
  - `DATABASE_URL` and `REDIS_URL` configured and reachable from runtime
  - `TRUST_PROXY` explicitly set for production topology
- Auth/session and cookies:
  - production traffic is HTTPS end-to-end and forwarded proto is correct
  - auth cookies are observed as `HttpOnly`, `Secure`, `SameSite=Lax`
  - OAuth binding cookie is present and scoped to `/api/auth/oauth`
- Feature flags and legacy:
  - `ALLOW_MOCK_BILLING_UPGRADES=false`
  - `LEGACY_AUTH_ROUTES_ENABLED=false` (mandatory release policy, even if not hard-fail in startup)
  - `ALLOW_INSECURE_STARTUP_FOR_TESTS=false`
  - `ALLOW_INSECURE_STARTUP_IN_PRODUCTION=false`
- Backoffice hardening:
  - `BACKOFFICE_TRUST_PROXY` explicitly set and valid for deployment
  - use `BACKOFFICE_ADMIN_CREDENTIALS` (per-user credentials) in production
  - do not rely on shared admin password mode in production

## 3. Critical Env Vars (Production)

| Variable | Required In Prod | Security Impact | Forbidden Value / Setting | Behavior If Missing | Check Implemented |
|---|---|---|---|---|---|
| `JWT_SECRET` | Yes | token forgery risk | placeholder/weak/short | startup blocked by runtime config gate (unless insecure bypass flags) | Yes |
| `OUTBOUND_CLICK_SECRET` | Yes | outbound token forgery | missing/weak/placeholder/same as JWT | hard-fail startup (`process.exit(1)`) | Yes (hard-fail) |
| `ALLOW_MOCK_BILLING_UPGRADES` | Yes (`false`) | payment bypass | `true` in prod | hard-fail startup | Yes (hard-fail) |
| `AUDIT_LOG_HMAC_KEY` | Yes | tamper-evident audit integrity | missing/placeholder | startup blocked by runtime config gate (unless insecure bypass flags) | Yes |
| `INTERNAL_INGEST_TOKEN` | Yes | internal endpoint abuse | missing/placeholder | startup blocked by runtime config gate (unless insecure bypass flags) | Yes |
| `FRONTEND_ORIGIN` | Yes | CORS/origin trust break | invalid URL / non-HTTPS in prod | startup blocked by runtime/policy gate (unless insecure bypass flags) | Yes |
| `CORS_ALLOWLIST` / `CORS_ORIGIN` | Yes | cross-origin abuse | empty in prod / localhost in prod | startup blocked for empty allowlist (unless insecure bypass flags) | Yes |
| `DATABASE_URL` | Yes | data/auth unavailable, unstable behavior | empty/invalid | startup readiness fails; can block startup | Yes |
| `REDIS_URL` | Yes | rate-limit/session defense degradation | empty/invalid | startup readiness fails; can block startup | Yes |
| `TRUST_PROXY` | Yes (explicit) | wrong client IP/scheme trust | unset/mis-set for topology | warning/check failure; proxy-dependent controls can be unreliable | Partial (recommended check) |
| `LEGACY_AUTH_ROUTES_ENABLED` | Must be `false` | alternate auth surface exposure | `true` | legacy `/auth/*` remains reachable | No hard-fail (release gate required) |
| `ALLOW_INSECURE_STARTUP_FOR_TESTS` | Must be `false` | startup policy bypass | `true` + prod bypass flag | contributes to bypass activation | No hard-fail alone |
| `ALLOW_INSECURE_STARTUP_IN_PRODUCTION` | Must be `false` | startup policy bypass | `true` + tests bypass flag | if paired with previous, bypasses startup blocks | No hard-fail alone |
| `BACKOFFICE_JWT_SECRET` | Yes (backoffice prod) | admin session compromise | weak/placeholder | backoffice startup hard-fails | Yes (backoffice) |
| `BACKOFFICE_TRUST_PROXY` | Yes (backoffice prod) | rate-limit/IP trust weakness | empty/false in prod | backoffice startup hard-fails | Yes (backoffice) |
| `BACKOFFICE_ADMIN_CREDENTIALS` | Yes (recommended mandatory) | weak admin auth model | missing in prod with shared mode disabled | backoffice startup hard-fails | Yes (backoffice) |
| `BACKOFFICE_ALLOW_SHARED_PASSWORD_IN_PRODUCTION` | Must be `false` | single shared secret risk | `true` | shared-password fallback allowed | No hard-fail when strong secret present |
| `AUTH_RETURN_ACCESS_TOKEN` | Must stay `false` | token exposure in response body | `true` in prod | access token returned in JSON login/register flows | No hard-fail (release gate required) |

## 4. Dangerous Flags / Forbidden Settings

The following must trigger either startup hard-fail (already in code) or release block (operational gate):

### A) Already hard-fail in code

- `NODE_ENV=production` + weak/missing `OUTBOUND_CLICK_SECRET`
- `NODE_ENV=production` + `ALLOW_MOCK_BILLING_UPGRADES=true`
- backoffice in production + invalid `BACKOFFICE_TRUST_PROXY`
- backoffice in production + weak/missing `BACKOFFICE_JWT_SECRET` (or `JWT_SECRET`)
- backoffice in production + missing `BACKOFFICE_ADMIN_CREDENTIALS` while shared mode is not explicitly allowed

### B) Must be blocked by release gate (even if startup may not hard-fail)

- `LEGACY_AUTH_ROUTES_ENABLED=true`
- `ALLOW_INSECURE_STARTUP_FOR_TESTS=true`
- `ALLOW_INSECURE_STARTUP_IN_PRODUCTION=true`
- `AUTH_RETURN_ACCESS_TOKEN=true` in production
- `BACKOFFICE_ALLOW_SHARED_PASSWORD_IN_PRODUCTION=true`
- production CORS list containing localhost origins

## 5. Startup Checks

### Existing startup checks in code

- Runtime config audit (`server/lib/runtime-config.js`) with blocking/recommended checks
- Startup readiness policy audit (`server/lib/startup-readiness.js`)
- Production infra reachability gate (`DATABASE_URL`, `REDIS_URL`) with timeout checks
- Explicit fatal checks for mock billing flag and outbound click secret
- Production empty-CORS fatal check

### Useful additional gates (not currently hard-fail, enforce in release process)

- block release when `LEGACY_AUTH_ROUTES_ENABLED=true`
- block release when `AUTH_RETURN_ACCESS_TOKEN=true`
- block release when startup bypass flags are enabled
- block release when shared backoffice password mode is enabled in production

## 6. Pre-Deploy Checklist

Run this before every production release:

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run test`
- [ ] `npm run test:security`
- [ ] `npm run test:security:compliance:strict`
- [ ] Verify release env has all blocking vars configured and strong
- [ ] Confirm both startup bypass flags are `false`
- [ ] Confirm `LEGACY_AUTH_ROUTES_ENABLED=false`
- [ ] Confirm `ALLOW_MOCK_BILLING_UPGRADES=false`
- [ ] Confirm `AUTH_RETURN_ACCESS_TOKEN=false`
- [ ] Confirm `TRUST_PROXY` and `BACKOFFICE_TRUST_PROXY` match actual proxy chain
- [ ] Confirm CORS allowlist contains only real production origins
- [ ] Confirm TLS termination and forwarded proto behavior
- [ ] Confirm backoffice can start only with allowlisted users and per-user credentials
- [ ] Confirm admin-only endpoints reject standard users
- [ ] Confirm outbound report endpoints reject standard users

## 7. Post-Deploy Verification

Immediately after deployment:

- [ ] `GET /healthz` returns `200`
- [ ] `GET /readyz` returns `200`
- [ ] Admin check: `GET /api/health/deploy-readiness` returns `ok=true`
- [ ] Admin check: `GET /api/health/security` shows no blocking failures
- [ ] Register/login flows behave as configured (`registration_disabled` honored if disabled)
- [ ] OAuth flows fail on missing/invalid state binding and succeed on valid flow
- [ ] `/api/outbound/click` rejects non server-bound payloads
- [ ] `/api/outbound/report` and `/api/outbound/report.csv` deny non-admin users
- [ ] Browser check confirms auth cookies are `HttpOnly`, `Secure`, `SameSite`
- [ ] Response headers include CSP/HSTS/X-Content-Type-Options/X-Frame-Options in production
- [ ] Backoffice login and `/api/report` work only for allowlisted admin users

## 8. Incident Rollback Triggers

Rollback (or immediate traffic block) on any of these:

- startup logs include:
  - `startup_blocked_missing_required_runtime_config`
  - `startup_blocked_primary_infra_unavailable`
  - `startup_blocked_insecure_mock_billing_flag`
  - `startup_blocked_missing_required_runtime_config` (outbound secret branch)
- non-admin can access operational/admin endpoints
- non-admin can access outbound report endpoints
- legacy `/auth/register` or `/auth/login` reachable in production when not explicitly approved
- mock billing behavior active in production
- insecure startup bypass flags detected in active runtime env
- auth cookies missing `Secure` in production traffic
- OAuth callback accepted without correct browser binding
