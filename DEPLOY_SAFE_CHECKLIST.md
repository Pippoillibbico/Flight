# Deploy-Safe Checklist

Last updated: 2026-04-03  
Use this list as final go/no-go gate for production release.

## 1. Build and Static Gates

- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] No unresolved merge conflicts in modified files.

## 2. Test Gates

- [ ] Tracking logic tests pass:
  - `node --experimental-strip-types --test test/funnel-tracking/funnel-tracking.logic.test.ts`
  - `node --experimental-strip-types --test test/funnel-tracking/funnel-event-service.test.ts`
  - `node --experimental-strip-types --test test/upgrade-flow/upgrade-flow.logic.test.ts`
  - `node --experimental-strip-types --test test/admin-dashboard/admin-dashboard.logic.test.ts`
- [ ] Consent/storage tests pass:
  - `node --test test/security/cookie-consent-policy.test.mjs`
  - `node --test test/security/storage-safety.test.mjs`
- [ ] Retention/runtime tests pass:
  - `node --test test/db-resilience.test.mjs`
  - `node --test test/runtime-config-audit.test.mjs`
- [ ] Security smoke passes:
  - `npm run test:security`

## 3. Dependency / Security Gates

- [ ] `npm audit --omit=dev` has no blocking vulnerabilities.
- [ ] Secrets are present and non-placeholder:
  - `JWT_SECRET`
  - `AUDIT_LOG_HMAC_KEY`
  - `INTERNAL_INGEST_TOKEN`
  - `OUTBOUND_CLICK_SECRET` (must not be default dev value)

## 4. Runtime Config Gates

- [ ] CORS origin coverage is explicit and valid for production:
  - `FRONTEND_ORIGIN`
  - `CORS_ORIGIN` and/or `CORS_ALLOWLIST`
- [ ] `DATABASE_URL` and `REDIS_URL` set correctly.
- [ ] `TRUST_PROXY` explicitly set for production topology.
- [ ] Telemetry guard envs reviewed:
  - `BODY_JSON_LIMIT`
  - `ADMIN_TELEMETRY_MAX_BODY_BYTES`
  - `ADMIN_TELEMETRY_ALLOWED_SKEW_MS`
  - `TELEMETRY_DEDUPE_WINDOW_MS`
  - `RL_TELEMETRY_PER_MINUTE`
- [ ] Retention envs set and documented:
  - `DATA_RETENTION_AUTH_EVENTS_DAYS`, `DATA_RETENTION_AUTH_EVENTS_MAX`
  - `DATA_RETENTION_CLIENT_TELEMETRY_DAYS`, `DATA_RETENTION_CLIENT_TELEMETRY_MAX`
  - `DATA_RETENTION_OUTBOUND_EVENTS_DAYS`, `DATA_RETENTION_OUTBOUND_EVENTS_MAX`

## 5. Cookie / Consent Behavior Gates

- [ ] First visit shows consent banner.
- [ ] `Necessary only` clears optional local storage keys.
- [ ] `Functional only` enables functional storage but keeps analytics blocked.
- [ ] `Accept all` enables analytics and functional behavior.
- [ ] Cookie settings can be reopened via `cookie-settings-reopen`.
- [ ] Revoking preferences triggers cleanup of disallowed keys.

## 6. Tracking / Dashboard Gates

- [ ] Events include envelope fields (`eventId`, `eventVersion`, `schemaVersion`, `sourceContext`).
- [ ] Duplicate rapid-fire events are deduped (client + server).
- [ ] Dashboard key funnel events are visible and coherent:
  - track route
  - itinerary open
  - booking click
  - upgrade primary CTA
  - radar activation

## 7. Policy and Compliance Gates (Technical Alignment)

- [ ] `/privacy-policy`, `/cookie-policy`, `/terms` render correctly.
- [ ] Policy text matches implemented storage/tracking categories.
- [ ] Retention values in policy reflect configured technical defaults/overrides.
- [ ] Legal placeholders are tracked and accepted as external dependencies.

## 8. External Blockers (must be acknowledged before public launch)

- [ ] All entries in `LEGAL_INPUT_REQUIRED.md` are either resolved or explicitly approved as known pre-launch exceptions by decision owner.
