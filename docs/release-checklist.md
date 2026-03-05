# Release Checklist

## Request ID + tracing
- Call any endpoint and verify `X-Request-Id` response header is present.
- Trigger an error and verify JSON includes `request_id`.

## Friendly error UX
- Trigger rate limit/quota and verify backend returns `error: "limit_exceeded"`.
- Verify frontend shows friendly text, not `429` and not technical backend text.
- Trigger forbidden origin and verify backend returns `request_forbidden`.
- Verify frontend shows friendly generic message (no `403`, no CORS technical text).
- Trigger auth error and verify frontend shows sign-in friendly copy.

## Login lock
- Fail login repeatedly until lock.
- Verify backend returns `limit_exceeded` with `reset_at`.
- Verify frontend message remains friendly and non-technical.

## Premium gating / AI
- With free user, call AI-enabled decision flow (`aiProvider != none`).
- Verify backend returns `premium_required`.
- Verify frontend shows premium-only friendly message.
- Verify free user flow with `aiProvider=none` continues correctly.

## Free plan no AI cost
- Confirm free endpoints do not call external LLM APIs.
- Confirm free flow is served from deterministic/precomputed logic (Postgres/Redis/local cache).

## Security
- Helmet headers enabled.
- `x-powered-by` disabled.
- Cookies are `httpOnly`, `secure` in production, `sameSite=lax`.
- No stack traces leaked in production error responses.
- Run `npm run test:security` and `npm run test:go-live`.
- Verify webhook replay/idempotency behavior in billing logs.
