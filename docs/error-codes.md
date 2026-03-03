# Error Codes

Backend API returns machine-readable errors in this shape:

```json
{
  "error": "machine_code",
  "request_id": "uuid",
  "reset_at": "iso8601-optional"
}
```

## Codes
- `limit_exceeded`: Rate limit, quota limit, or temporary lock reached.
- `request_forbidden`: Request blocked by policy (for example CORS/origin).
- `auth_required`: Missing authentication.
- `auth_invalid`: Invalid or expired authentication token/session.
- `token_revoked`: Token was revoked.
- `csrf_failed`: CSRF validation failed.
- `premium_required`: Premium-only feature requested by non-premium user.
- `user_not_found`: User does not exist.
- `request_failed`: Generic client/server failure fallback.
- `internal_error`: Unhandled server error.

## Frontend mapping (friendly UX)
- `limit_exceeded` -> `LIMIT_MESSAGE` + `LIMIT_SUBTEXT` (+ reset timestamp when available)
- `premium_required` -> “Questa funzione usa AI ed è disponibile solo in Premium.”
- `auth_required` / `auth_invalid` / `token_revoked` -> “Accedi per continuare.”
- all others -> `GENERIC_ERROR_TITLE` + `GENERIC_ERROR_SUBTEXT`

UI must never display raw HTTP status codes or backend technical messages.
