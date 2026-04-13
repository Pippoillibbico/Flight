# Codebase Canonical Helpers

Last updated: 2026-04-04

## Server

- Env boolean parsing:
  - file: `server/lib/env-flags.js`
  - use `parseFlag` / `parseBoolean` instead of local ad-hoc implementations
- Cookie header parsing:
  - file: `server/lib/http-cookies.js`
  - use `parseCookieHeader` instead of custom `split(';')` parsers

## Frontend

- Safe browser storage access:
  - file: `src/utils/browserStorage.js`
  - use `readLocalStorageItem` / `writeLocalStorageItem` / `removeLocalStorageItem`
  - keeps storage failures non-fatal and removes repeated try/catch noise

## Notes

- These helpers are maintainability primitives and must not bypass:
  - consent gating (`src/utils/cookieConsent.js`)
  - auth/session security controls
  - telemetry trust model and envelope rules
