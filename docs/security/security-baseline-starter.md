# Security Baseline Starter (Technical)

Date: 2026-03-30
Status: Practical hardening baseline, not an absolute security guarantee.

## Current baseline highlights

- API hardening:
  - JSON body size limit is enforced by `express.json({ limit })`.
  - Rate limiting is applied to auth, demo, and API routes (Redis-backed when available).
  - Query/path logging is redacted before persistence in middleware and request logs.
- Input validation:
  - Route payload/query validation is schema-driven (`zod`) across search/opportunities/auth flows.
  - Follow metadata sanitization enforces key/value bounds and serialized-size limits.
  - AI output guard modules sanitize and whitelist structured model outputs.
- Output validation:
  - AI gateway structured output validation enforces strict bounded schemas before use.
  - Malformed provider output is rejected with controlled errors.
- Storage safety:
  - Local persistence readers fail closed on corrupted or oversized blobs.
  - Remembered email persistence has validation and max-age.
- Secret-handling readiness:
  - Runtime config audit checks core blocking secrets.
  - Recommended check now flags weak/reused outbound click HMAC secret.

## Remaining work (future backend/infra)

- End-to-end secret rotation workflows and vault-backed secret management.
- WAF/edge abuse controls and global IP reputation controls.
- Centralized retention and tamper-evident security event export pipeline.
- Continuous SAST/DAST and dependency vulnerability gating in CI.
- Formal threat model and penetration testing cycle.

