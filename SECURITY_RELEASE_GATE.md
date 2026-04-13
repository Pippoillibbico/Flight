# Security Release Gate (Production)

Last updated: 2026-04-04  
Decision scope: operational go-live gate for current implementation.

## Release Matrix

| Area | Current Status | GO Prerequisites | External Config Dependency | Final Decision |
|---|---|---|---|---|
| Auth/session | Cookie auth + CSRF + origin checks + lock/rate limits are active | strong `JWT_SECRET`; `AUTH_REQUIRE_TRUSTED_ORIGIN=true`; `AUTH_RETURN_ACCESS_TOKEN=false`; HTTPS + proxy configured correctly | High | PASS WITH CONDITIONS |
| Backoffice | Strong startup checks exist (JWT secret, trust proxy, credentials), admin allowlist enforced | set `BACKOFFICE_JWT_SECRET`, `BACKOFFICE_TRUST_PROXY`, `BACKOFFICE_ADMIN_CREDENTIALS`; keep shared-password mode disabled | High | PASS WITH CONDITIONS |
| Outbound click/report | click ingestion requires server-bound redirect context; reports are admin-only; CSV formula neutralization active | set strong `OUTBOUND_CLICK_SECRET`; keep outbound host allowlist strict; verify non-admin denial in prod | Medium | PASS WITH CONDITIONS |
| Billing | mock upgrade hard-fail exists in prod; billing provider runtime checks exist | `ALLOW_MOCK_BILLING_UPGRADES=false`; valid braintree env set when braintree enabled | Medium | PASS WITH CONDITIONS |
| Legacy auth | legacy routes are env-gated and default-off in prod, but not startup hard-fail | enforce `LEGACY_AUTH_ROUTES_ENABLED=false` in release gate | Medium | PASS WITH CONDITIONS |
| OAuth | state + nonce + browser binding + single-use session consumption are active | correct OAuth client ids/secrets and redirect URIs; cookie domain/proxy/TLS correctness | Medium | PASS WITH CONDITIONS |
| Cookie/privacy | secure cookie options and security headers active in production | verify real browser cookies are `HttpOnly/Secure/SameSite`; confirm TLS and HSTS behavior end-to-end | Medium | PASS WITH CONDITIONS |
| Telemetry/admin endpoints | admin telemetry has schema validation, size limits, burst controls, dedupe, server-enriched trust fields | tune rate-limit envs and keep defaults in safe bounds; verify admin-only access controls post-deploy | Medium | PASS WITH CONDITIONS |
| Runtime config / startup checks | runtime audit + startup readiness + infra checks exist; several hard-fails active | keep startup bypass flags disabled; all blocking env checks must pass | High | PASS WITH CONDITIONS |

## Overall Verdict

`PASS WITH CONDITIONS` (equivalent to `GO con rischio controllato`).

## What Is Needed To Move From `GO con rischio` To `GO`

All below must be true in the target production environment:

1. No startup bypass:
   - `ALLOW_INSECURE_STARTUP_FOR_TESTS=false`
   - `ALLOW_INSECURE_STARTUP_IN_PRODUCTION=false`
2. No legacy/mock exposure:
   - `LEGACY_AUTH_ROUTES_ENABLED=false`
   - `ALLOW_MOCK_BILLING_UPGRADES=false`
3. All blocking secrets and infra vars valid:
   - `JWT_SECRET`, `OUTBOUND_CLICK_SECRET`, `AUDIT_LOG_HMAC_KEY`, `INTERNAL_INGEST_TOKEN`
   - `DATABASE_URL`, `REDIS_URL`, `FRONTEND_ORIGIN`, CORS allowlist
4. Proxy and cookie posture verified with real traffic:
   - `TRUST_PROXY` + `BACKOFFICE_TRUST_PROXY` correct
   - auth/backoffice cookies observed as secure in browser
5. Backoffice hardened mode:
   - per-user credentials enabled (`BACKOFFICE_ADMIN_CREDENTIALS`)
   - shared password mode not used in production

## Residual Operational/Config Blocks (Only)

- production env completeness and secret quality
- strict disabling of bypass/legacy/mock flags
- proxy/TLS correctness validation in real deployment path
- final post-deploy access-control verification on sensitive/admin endpoints
