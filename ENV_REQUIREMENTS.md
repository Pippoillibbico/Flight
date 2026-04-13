# Environment Requirements (Production)

Last updated: 2026-04-03  
Source of truth: implemented checks in `server/lib/runtime-config.js` + runtime behavior in `server/index.js`, `server/lib/db.js`, `server/lib/legal-pages.js`.

## 1. Blocking Variables (must be valid in production)

| Variable | Required in Prod | Area | Notes |
|---|---|---|---|
| `JWT_SECRET` | Yes | Auth/Security | Min length and non-placeholder required. |
| `AUDIT_LOG_HMAC_KEY` | Yes | Security/Audit | Required for immutable audit integrity. |
| `INTERNAL_INGEST_TOKEN` | Yes | Internal API Security | Required for protected ingest flows. |
| `FRONTEND_ORIGIN` | Yes | CORS/Security | Must be valid URL. |
| `CORS_ORIGIN` or `CORS_ALLOWLIST` (or equivalent valid origin set) | Yes | CORS/Security | Prod startup blocks if allowlist is effectively empty. |
| `DATABASE_URL` | Yes | Data | Primary SQL DB URL required. |
| `REDIS_URL` | Yes | Rate limit/cache | Required by production runtime checks. |
| `BILLING_PROVIDER` | Yes | Billing | In production runtime checks require braintree lock path. |
| `BT_MERCHANT_ID` | Cond. Yes | Billing | Required when `BILLING_PROVIDER=braintree`. |
| `BT_PUBLIC_KEY` | Cond. Yes | Billing | Required when `BILLING_PROVIDER=braintree`. |
| `BT_PRIVATE_KEY` | Cond. Yes | Billing | Required when `BILLING_PROVIDER=braintree`. |
| `BT_ENVIRONMENT` | Cond. Yes | Billing | Must be `sandbox` or `production` when braintree is used. |
| `DUFFEL_API_KEY` | Cond. Yes | Provider | Required if `ENABLE_PROVIDER_DUFFEL=true`. |
| `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET` | Cond. Yes | Provider | Required if `ENABLE_PROVIDER_AMADEUS=true`. |

## 2. Strongly Recommended Variables

| Variable | Area | Why |
|---|---|---|
| `OUTBOUND_CLICK_SECRET` | Security | Must be distinct from `JWT_SECRET`; protects outbound link signatures. |
| `LOG_HASH_SALT` | Security/Privacy | Salt for pseudonymized identifiers in logs/audit trails. |
| `TRUST_PROXY` | Security/Infra | Should be explicitly set in production proxy topologies. |
| `AUTH_REQUIRE_TRUSTED_ORIGIN` | Auth Security | Enforces trusted Origin/Referer on non-GET auth routes. |
| `AUTH_RETURN_ACCESS_TOKEN` | Auth Security | Keep `false` in production to avoid exposing JWT in response payloads. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Auth/Email | Needed for password reset email reliability. |
| `STRIPE_WEBHOOK_SECRET` | Billing | Required when Stripe webhook path is active. |
| `DATA_RETENTION_AUTH_EVENTS_DAYS` | Privacy/Security | Retention control for auth/security events. |
| `DATA_RETENTION_CLIENT_TELEMETRY_DAYS` | Privacy/Analytics | Retention control for telemetry events. |
| `DATA_RETENTION_OUTBOUND_EVENTS_DAYS` | Privacy/Operations | Retention control for outbound operational events. |
| `DATA_RETENTION_AUTH_EVENTS_MAX` | Data Hygiene | Hard cap for auth event volume. |
| `DATA_RETENTION_CLIENT_TELEMETRY_MAX` | Data Hygiene | Hard cap for telemetry volume. |
| `DATA_RETENTION_OUTBOUND_EVENTS_MAX` | Data Hygiene | Hard cap for outbound events volume. |

## 3. Tracking / Telemetry Runtime Controls

| Variable | Default | Purpose |
|---|---|---|
| `BODY_JSON_LIMIT` | `256kb` | Global JSON parser limit. |
| `API_MAX_BODY_BYTES` | `65536` | Generic API body hard cap (bytes). |
| `AUTH_MAX_BODY_BYTES` | `12288` | Body hard cap for `/api/auth/*`. |
| `OUTBOUND_MAX_BODY_BYTES` | `16384` | Body hard cap for `/api/outbound/*`. |
| `OUTBOUND_MAX_QUERY_CHARS` | `1600` | Query-length cap for `/api/outbound/resolve`. |
| `PAYLOAD_MAX_DEPTH` | `8` | Reject deeply nested payloads. |
| `PAYLOAD_MAX_NODES` | `600` | Reject excessively complex payload trees. |
| `PAYLOAD_MAX_ARRAY_LENGTH` | `250` | Reject oversized arrays in JSON payloads. |
| `PAYLOAD_MAX_OBJECT_KEYS` | `250` | Reject oversized object key sets. |
| `PAYLOAD_MAX_STRING_LENGTH` | `8192` | Reject oversized strings in payload values. |
| `PAYLOAD_MAX_KEY_LENGTH` | `96` | Reject suspiciously long JSON keys. |
| `ADMIN_TELEMETRY_MAX_BODY_BYTES` | `8192` | Hard cap for admin telemetry body size. |
| `ADMIN_TELEMETRY_ALLOWED_SKEW_MS` | `86400000` (24h) | Allowed clock skew for client `at` timestamps. |
| `TELEMETRY_DEDUPE_WINDOW_MS` | `2500` | Server dedupe window for telemetry near-duplicates. |
| `ADMIN_TELEMETRY_BURST_WINDOW_MS` | `10000` | Burst anti-spam window for same telemetry fingerprint. |
| `ADMIN_TELEMETRY_BURST_MAX` | `4` | Max repeated fingerprint events allowed in burst window. |
| `RL_TELEMETRY_PER_MINUTE` | `80` | Rate limit for `/api/admin/telemetry`. |
| `RL_TELEMETRY_PER_SECOND` | `10` | Burst limiter for `/api/admin/telemetry`. |
| `RL_OUTBOUND_PER_MINUTE` | `120` | Rate limit for `/api/outbound/*`. |
| `RL_OUTBOUND_PER_SECOND` | `10` | Burst limiter for `/api/outbound/*`. |

## 4. Legal/Policy Rendering Variables

| Variable | Required for go-live quality | Purpose |
|---|---|---|
| `LEGAL_EFFECTIVE_DATE` | Recommended | Policy effective date control. |
| `LEGAL_COMPANY_NAME` | Yes (for publication) | Controller identity in policies. |
| `LEGAL_COMPANY_ADDRESS` | Yes (for publication) | Registered office in policies. |
| `LEGAL_PRIVACY_EMAIL` | Yes (for publication) | Privacy contact. |
| `LEGAL_DPO_EMAIL` | Recommended/conditional | DPO contact (if applicable). |
| `APP_NAME` | Recommended | Legal page/app naming consistency. |
| `FRONTEND_URL` | Yes | Legal page links/back navigation target. |

## 5. Values That Must Not Stay as Defaults in Production

1. `OUTBOUND_CLICK_SECRET=dev_outbound_secret` (or missing/weak value).
2. Any placeholder-like secrets (`replace-with`, `changeme`, `todo`, etc.).
3. Legal placeholders in company/contact fields (`TODO: ...`).
4. Production without explicit CORS origin coverage.
5. `FRONTEND_URL` left to localhost.

## 6. Current External Configuration Gaps To Track

- Legal identity and policy legal placeholders still require external input (see `LEGAL_INPUT_REQUIRED.md`).
- Runtime config should be re-checked in target environment with production secrets and origins before release.

## 7. Suggested Pre-Deploy Validation

1. Run runtime config audit endpoint/check in production-like env.
2. Verify all blocking checks pass.
3. Resolve all recommended failures that affect security/privacy/retention.
