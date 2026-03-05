# Changelog

## 2026-03-05 - Go-Live Closure

### Added
- End-to-end auth flow regression suite:
  - `e2e/auth-flow-complete.spec.js`
  - covers guest->login redirect intent, set-alert from landing, coherent back navigation.
- Final UI regression suite:
  - `e2e/ui-final-regression.spec.js`
  - desktop/mobile, dark/light, i18n checks.
- Security compliance script:
  - `scripts/security-compliance.mjs`
  - validates CSP/CORS/CSRF paths + light pen-test + env/secrets checks.
- SLO reporting and alerting baseline:
  - `scripts/slo-report.mjs`
  - outputs `data/logs/slo-dashboard.json`.
- Final release evidence docs:
  - `docs/END_TO_END_CERTIFICATION.md`
  - `docs/UI_QA_FINAL.md`
  - `docs/AUTH_SECURITY_CLOSURE.md`
  - `docs/GO_LIVE_READY_SIGNOFF.md`

### Changed
- `server/lib/logger.js`
  - automatic log rotation and retention cleanup (size + age policy).
- `server/routes/system.js`
  - robust `audit_chain` check handling fresh env with `entries=0`.
- `src/App.jsx`, `src/components/AuthSection.jsx`, `src/styles.css`
  - auth/landing UX fixes and dark-mode readability stabilization.
- `package.json`
  - added scripts:
    - `slo:report`
    - `slo:enforce`
    - `test:security:compliance`
    - `app:start`

### Security/Compliance
- Verified:
  - Helmet + CSP in production mode.
  - CORS allowlist and credentials-safe headers.
  - CSRF + origin enforcement for cookie-auth state changes.
  - Refresh endpoint origin+csrf enforcement.
  - Friendly non-leaking error responses.

### Ops
- DB runtime files removed from tracked Git index.
- `.gitignore` hardened for db/ndjson/log artifacts.
