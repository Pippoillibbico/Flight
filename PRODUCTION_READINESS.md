# Production Readiness Handoff (Technical)

Last updated: 2026-04-03  
Scope: final handoff based on implemented code changes only (no new audit cycle).

## 1. Technical Closures Completed

### 1.1 Architecture / maintainability
- Centralized browser storage keys introduced in `src/utils/storageKeys.js` and reused across:
  - consent policy (`src/utils/cookieConsent.js`)
  - app post-auth persistence (`src/App.jsx`)
  - personal hub storage (`src/features/personal-hub/storage.js`)
  - radar session hook (`src/features/app-shell/hooks/useRadarSessionController.js`)
  - plan storage (`src/features/monetization/domain/plan-storage.ts`)
  - upgrade interest persistence (`src/features/upgrade-flow/domain/persist-upgrade-interest.ts`)
- Reduced drift risk between runtime behavior and legal documentation for storage categories.

### 1.2 Security hardening
- Server request hardening already active and retained:
  - `helmet` with CSP + `hsts` + `referrerPolicy` + `crossOriginResourcePolicy`
  - strict JSON parsing with body limit (`BODY_JSON_LIMIT`, default `256kb`)
  - centralized machine-safe error responses (`sendMachineError`)
  - CSRF guard on cookie-authenticated state-changing routes
  - production startup guard for empty CORS allowlist
- Admin telemetry endpoint hardening completed in `/api/admin/telemetry`:
  - strict schema validation (`zod.strict()`)
  - payload byte limit (`ADMIN_TELEMETRY_MAX_BODY_BYTES`)
  - client timestamp skew clamp (`ADMIN_TELEMETRY_ALLOWED_SKEW_MS`)
  - rate limiting (`RL_TELEMETRY_PER_MINUTE`)
  - dedupe by `eventId` and fallback fingerprint within `TELEMETRY_DEDUPE_WINDOW_MS`
  - no email persistence in telemetry events (`email: null` server-side)

### 1.3 Tracking / dashboard reliability
- Event envelope standardized (client-side and accepted server-side):
  - `eventId`, `eventVersion`, `schemaVersion`, `sourceContext`, `at`
- Funnel tracker (`create-funnel-tracker`) now:
  - applies analytics consent gate
  - normalizes envelope metadata
  - deduplicates near-duplicates in a short window
- Upgrade tracker (`create-upgrade-intent-tracker`) now:
  - applies analytics consent gate
  - emits envelope metadata
  - deduplicates repeated clicks in short window
- Admin telemetry mapper (`map-dashboard-telemetry`) now:
  - sanitizes all mapped text fields
  - normalizes source context and version fields
- Dashboard aggregation remains coherent with collected events (`server/lib/admin-backoffice-report.js`).

### 1.4 Cookie / privacy flow
- Consent model implemented and active:
  - `Accept all`
  - `Functional only`
  - `Necessary only`
  - custom preferences panel
  - reopen preferences control (`cookie-settings-reopen`)
- Consent enforcement active:
  - non-consented functional/analytics storage keys are removed/blocked
  - analytics tracking is gated at call sites and trackers
- Legal pages aligned with implemented behavior:
  - retention env-driven values surfaced in policy text
  - TODO legal points converted to structured placeholders.

### 1.5 Data retention (technical enforcement)
- DB normalization now prunes aged/high-volume operational collections:
  - `authEvents`
  - `clientTelemetryEvents`
  - `outboundClicks`
  - `outboundRedirects`
- Configurable via env:
  - `DATA_RETENTION_AUTH_EVENTS_DAYS`, `DATA_RETENTION_AUTH_EVENTS_MAX`
  - `DATA_RETENTION_CLIENT_TELEMETRY_DAYS`, `DATA_RETENTION_CLIENT_TELEMETRY_MAX`
  - `DATA_RETENTION_OUTBOUND_EVENTS_DAYS`, `DATA_RETENTION_OUTBOUND_EVENTS_MAX`

## 2. Current Status by Area

### Architecture status
- **Good** for the implemented scope: key constants and consent/tracking patterns are centralized and reusable.

### Security status
- **Good/medium residual risk**: robust hardening is in place, but production safety still depends on correct env values and legal/business settings.

### Tracking/dashboard status
- **Good**: event schema, consent gating, and dedupe are significantly stronger and more deterministic.

### Cookie/privacy status
- **Good/medium residual risk**: behavior is technically aligned; legal sign-off inputs remain external.

## 3. Residual Risks (Real, Non-Closed by Code)

1. Legal/controller identity and processor registry not finalized (`LEGAL_INPUT_REQUIRED[...]` placeholders still present).
2. International transfer legal mechanism not finalized (SCC/adequacy mapping not provided).
3. Governing law / liability / billing rights clauses still require legal drafting.
4. Runtime security posture depends on production env quality (secrets/origins/retention values).

## 4. Final Pre-Release Checklist (Technical)

Use `DEPLOY_SAFE_CHECKLIST.md` as operational runbook before go-live.

Minimum gates:
- typecheck pass
- build pass
- security smoke pass
- targeted tests pass (tracking, consent, retention/runtime)
- runtime config audit clean on blocking checks
- legal placeholders explicitly acknowledged and tracked

## 5. Non-Claim

This handoff **does not declare legal compliance certification**.  
It confirms technical implementation status and explicitly isolates remaining external legal/business decisions.
