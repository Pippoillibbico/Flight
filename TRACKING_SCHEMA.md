# Tracking Schema (Implemented)

Last updated: 2026-04-03  
Scope: real implemented tracking flow across frontend + backend + admin dashboard.

## 1. Event Sources

## 1.1 Funnel tracking (frontend)
- Dispatcher event name: `flight_funnel_event`
- Producer modules:
  - `src/features/funnel-tracking/domain/create-funnel-event-service.ts`
  - `src/features/funnel-tracking/domain/create-funnel-tracker.ts`

## 1.2 Upgrade tracking (frontend)
- Dispatcher event name: `flight_upgrade_event`
- Producer module:
  - `src/features/upgrade-flow/domain/create-upgrade-intent-tracker.ts`

## 1.3 Admin telemetry ingestion (backend)
- Endpoint: `POST /api/admin/telemetry`
- Receiver module: `server/index.js`
- Dashboard aggregation: `server/lib/admin-backoffice-report.js`

## 2. Common Envelope

Standardized fields now used and accepted:
- `eventId` (`^[a-z0-9_-]{8,80}$`)
- `eventVersion` (integer >= 1)
- `schemaVersion` (integer >= 1)
- `sourceContext` (`web_app` | `admin_backoffice` | `api_client`)
- `at` (ISO timestamp; server clamps excessive skew)

Additional common fields by event:
- `eventType`
- `searchMode`
- `action`
- `surface`
- `itineraryId`
- `correlationId`
- `routeSlug`
- `planType`
- `resultCount`
- `errorCode`
- `errorMessage`
- `extra` (sanitized, bounded keys/length, sensitive-key filtered)

## 3. Taxonomy (Real Types)

## 3.1 Funnel event types
- `search_submitted`
- `search_validation_blocked`
- `search_succeeded`
- `search_failed`
- `search_retry_clicked`
- `results_rendered`
- `itinerary_opened`
- `booking_clicked`
- `outbound_redirect_succeeded`
- `outbound_redirect_failed`
- `result_interaction_clicked`
- `booking_handoff_failed`

## 3.2 Upgrade event types
- `upgrade_cta_clicked`
- `upgrade_modal_opened`
- `upgrade_primary_cta_clicked`
- `elite_cta_clicked`
- `elite_modal_opened`

## 3.3 Admin telemetry accepted event types
- `result_interaction_clicked`
- `itinerary_opened`
- `booking_clicked`
- `upgrade_cta_clicked`
- `elite_cta_clicked`
- `upgrade_modal_opened`
- `elite_modal_opened`
- `upgrade_primary_cta_clicked`
- `radar_activated`

## 4. Consent and Category Rules

- Analytics consent required for:
  - funnel tracker emission
  - upgrade tracker emission
  - admin telemetry submission from app listeners
- Functional consent required for:
  - local persistence (language, saved itineraries, tracked routes, plan cache, upgrade interest, etc.)
- Necessary-only mode:
  - keeps only strictly required storage keys
  - clears non-consented functional/analytics local keys

## 5. Dedupe Logic

## 5.1 Client-side funnel dedupe
- Window-based in-memory dedupe (`dedupeWindowMs`, default ~1200ms)
- Fingerprint includes event type + core fields + serialized `extra`

## 5.2 Client-side upgrade dedupe
- Window-based in-memory dedupe (~1200ms)
- Fingerprint includes event type + plan type + source

## 5.3 Server-side admin telemetry dedupe
- Primary: identical `eventId` for same user
- Secondary fingerprint: event identity fields + near-time window (`TELEMETRY_DEDUPE_WINDOW_MS`)

## 6. Backend Validation and Hardening

`/api/admin/telemetry` enforces:
- auth + CSRF
- rate limit
- strict schema
- payload byte limit
- timestamp skew control
- sanitized persisted fields
- machine-safe errors (`invalid_payload`, `payload_too_large`, etc.)

## 7. Dashboard Consumption

Dashboard (`buildAdminBackofficeReport`) computes:
- Funnel: `login_completed -> track_route_clicked -> itinerary_opened -> booking_clicked`
- Behavior:
  - top tracked routes
  - top viewed itineraries
  - top booking routes
  - top upgrade sources
- Monetization:
  - upgrade clicks
  - plan distribution
  - pro/elite primary intent counts
- Operations:
  - auth failures
  - outbound redirect failures
  - rate limit event indicators

## 8. Business-Critical Events

Highest business impact for KPI/funnel reliability:
1. `result_interaction_clicked` with `action=track_route`
2. `itinerary_opened`
3. `booking_clicked`
4. `upgrade_primary_cta_clicked`
5. `radar_activated`

These directly influence funnel conversion, activation quality, and monetization visibility.
