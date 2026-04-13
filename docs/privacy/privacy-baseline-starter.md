# Privacy Baseline Starter (Technical)

Date: 2026-03-30
Status: Technical privacy-readiness baseline only. This is not legal advice or formal GDPR certification.

## 1) Data Inventory (Current Implementation)

### Frontend local persistence (browser localStorage)
- `flight_tracked_routes_v1`
  - Module: `src/features/personal-hub/storage.js`
  - Purpose: tracked route slugs for personal radar UX
  - Data type: array of normalized route slugs
- `flight_saved_itineraries_v1`
  - Module: `src/features/personal-hub/storage.js`
  - Purpose: recently viewed/saved itineraries in personal hub
  - Data type: limited itinerary summary items (`key`, `itineraryId`, `routeLabel`, `price`, `currency`, `label`, `savedAt`)
- `flight_radar_session_active_v1`
  - Modules: `src/App.jsx`, `src/features/personal-hub/storage.js`
  - Purpose: local radar session activation flag
  - Data type: string flag (`"1"`)
- `flight_user_plan_v1`
  - Module: `src/features/monetization/domain/plan-storage.ts`
  - Purpose: local plan preference fallback (`free|pro|elite`)
- `flight_upgrade_interest_records`
  - Module: `src/features/upgrade-flow/domain/persist-upgrade-interest.ts`
  - Purpose: local upgrade-intent records
  - Data type: plan/source/timestamp + pseudonymous user reference (`usr_*`)
  - Retention guard: local records older than 90 days are discarded during normalization
- `remembered_email`
  - Modules: `src/App.jsx`, `src/features/personal-hub/storage.js`
  - Purpose: login convenience when remember-me is enabled
  - Data type: `{ email, savedAt }` with validation and max-age
- `flight_language`
  - Module: `src/App.jsx`
  - Purpose: UI language preference
- `flight_post_auth_action`, `flight_post_auth_mode`, `flight_post_auth_view`, `flight_post_auth_section`
  - Module: `src/App.jsx`
  - Purpose: post-auth UX continuity only

### Backend persisted data (high-level)
- User/session/auth artifacts in DB/JSON store (`users`, refresh sessions, auth events)
- Search history/events (`searches`, SQL search events)
- Outbound redirect telemetry (`outboundClicks`, `outboundRedirects`)
- Opportunity/radar/follow datasets (`opportunity_user_follows`, opportunity feed records)

## 2) Telemetry / Event Categories

### Frontend custom events
- `flight_funnel_event` (funnel tracking)
  - Module: `src/features/funnel-tracking/*`
  - Privacy controls: extra payload key filtering, text sanitization, email redaction in error message
- `flight_upgrade_event` (upgrade intent)
  - Module: `src/features/upgrade-flow/domain/create-upgrade-intent-tracker.ts`
  - Privacy controls: source normalization/sanitization; email-like source values are dropped
- `booking_clicked` (booking handoff event dispatch)
  - Module: `src/features/booking-handoff/api/track-booking-click.ts`
  - Privacy controls: browser-dispatched URL is minimized to path-only (query removed)

### Backend logs
- Request and quota/security logs via `pino`
  - Modules: `server/lib/logger.js`, `server/middleware/quotaGuard.js`, `server/middleware/error-handler.js`, `server/routes/auth-session.js`, `server/index.js`
  - Privacy controls: URL query redaction, referer sanitization, bounded header logging

## 3) AI Data Boundary Notes

Current state:
- Client-side AI gateway exists (`src/features/ai-gateway/*`) with mock adapter enabled by default.
- Server AI enrichment/intake paths exist (`server/index.js`, `server/lib/opportunity-store.js`) and validate structured output.

Boundary guardrails applied:
- Itinerary-generation gateway input is minimized before adapter routing (`minimize-ai-input.ts`).
- Free-text `prompt` is not forwarded to itinerary-generation adapter input.
- Only explicit structured fields needed for deterministic ranking/generation are forwarded.

Future risk note:
- If real provider adapters are enabled, prompts and identifiers require explicit purpose review + DPIA assessment.

## 4) Retention & Deletion Readiness

Implemented readiness:
- Local “clear local travel data” utility and UI action remove travel-related local state from device.
- Local export helper `exportLocalTravelData()` provides a minimized snapshot for future DSAR-ready UX.
- Oversized/corrupted localStorage values fail closed in parsers.
- Remembered email uses max-age and validation.
- Upgrade-interest persistence is minimized (no email-derived reference persisted) and stale records are dropped.

Known backend retention to formalize later:
- Some backend arrays/tables are bounded in code (e.g., slice caps), but retention schedule is not yet centrally documented/policy-driven.
- Formal retention matrix (per dataset) should be defined server-side for production rollout.

## 5) Open Gaps (Needs Legal/Backend/Infra Work)

- Lawful basis, consent model, and privacy notice text require legal review.
- Full DSAR workflows (export/delete/rectification) are not complete end-to-end for all backend datasets.
- Server-side data retention policies need explicit, enforceable configuration by dataset.
- If AI provider usage becomes production, perform DPIA-oriented review and contract/data-transfer checks.
- Cookie/session governance and cross-device sync privacy controls need product/legal alignment.

## 6) Local-Only vs Higher-Risk Future Flows

Local-only today:
- Tracked routes, saved itineraries, plan fallback, upgrade-interest records, radar session flag, and UI continuity keys.
- These values are browser-local and can be cleared with the local data reset action.

Higher-risk when backend/account sync is expanded:
- Cross-device synchronization of saved itineraries/tracked routes.
- Upload of user free-text prompts or rich telemetry context to third-party processors.
- Linking behavioral telemetry directly to persistent account identity without minimization policy.

## 7) Scope Clarification

This baseline reduces practical privacy risk through minimization, sanitization, and local-data controls.
It does not claim full GDPR compliance or legal certification.
