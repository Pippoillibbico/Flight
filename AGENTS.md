# AGENTS.md

## Purpose
This document defines mandatory engineering rules for contributors and coding agents working in this repository, with explicit requirements for the **Multi-city / Multitratta** feature.

These rules are strict. If any rule conflicts with convenience, convenience loses.

---

## 1) Architecture Rules (React + TypeScript)

### 1.1 Layer separation is mandatory
For Multi-city, keep logic in three explicit layers:

1. `UI layer`  
- React components only.
- Renders fields, errors, loading, and actions.
- No business rules beyond simple UI concerns (focus, toggles, visibility).

2. `Validation layer`  
- Pure validation functions/schemas (Zod or equivalent).
- Converts raw form input into typed domain input.
- Returns structured field-level and form-level errors.

3. `Business logic layer`  
- Pure functions for domain rules (segment order, payload mapping, retry policy decisions).
- No JSX, no DOM access.
- Side-effect free except dedicated API client/orchestrator modules.

### 1.2 File organization expectations
For Multi-city code, follow this shape:
- `src/features/multi-city/ui/*`
- `src/features/multi-city/validation/*`
- `src/features/multi-city/domain/*`
- `src/features/multi-city/api/*`
- `src/features/multi-city/types/*`

If existing project structure requires adaptation, preserve the same conceptual split.

### 1.3 Strict typing rules
- TypeScript required for new Multi-city modules.
- `no any` (direct or inferred).  
- Prefer explicit domain types/interfaces for:
  - segment
  - form state
  - validation result
  - API request/response
  - retry state
- Use `unknown` only at boundaries, then narrow immediately.
- No implicit `any` in callbacks, mappers, reducers, or event handlers.

---

## 2) Multi-city Domain Rules

### 2.1 Segment constraints
- Multi-city supports **2 to 6 segments**.
- Each segment requires:
  - `origin` (IATA)
  - `destination` (IATA)
  - `date` (ISO date input from UI)

### 2.2 Validation invariants
- Origin and destination must be present.
- Date must be present and parseable.
- Origin and destination cannot be equal within the same segment.
- Segment dates must be non-decreasing by index (no reverse dates).
- Segment order in UI is authoritative and must be preserved in the API payload.

### 2.3 UX constraints
- Inline field errors must be shown per segment.
- Submit button must be disabled while invalid.
- Submit button must be disabled while request is in-flight.

---

## 3) Form + API Behavior

### 3.1 State preservation on API errors
On API failure:
- Keep all user-entered segment values unchanged.
- Keep segment order unchanged.
- Keep validation state and inline errors visible.
- Show a clear retry action without forcing user re-entry.

### 3.2 Payload contract
- Payload must preserve exact segment order.
- Payload must include all valid segments in index order.
- No hidden sorting or reordering before submit.

### 3.3 Retry requirements
- Retry required on transient API failures.
- Use bounded retry (e.g., max attempts configured in domain constants).
- Use backoff (linear or exponential, deterministic in tests).
- No infinite retries.

---

## 4) Mobile and Responsive Rules

- Multi-city UI must be fully usable on:
  - mobile (small viewport),
  - tablet,
  - desktop.
- No horizontal overflow caused by segment rows.
- Add/remove segment controls and submit must remain visible and tappable.
- Input, date picker, and error text must not overlap or clip at small breakpoints.

---

## 5) Testing Rules

### 5.1 Unit tests (logic first)
Add/maintain unit tests for:
- validation invariants,
- payload mapping and order preservation,
- retry decision/backoff behavior,
- error-state persistence on failed requests.

Unit tests must target pure logic modules, not full UI rendering where avoidable.

### 5.2 Playwright tests (user flows)
Cover real user flows:
- build valid 2-segment itinerary and submit,
- expand to 6 segments and submit,
- invalid segment blocks submit with inline errors,
- reverse-date validation blocks submit,
- API failure preserves state and allows retry.

### 5.3 Selector and timing policy (strict)
- No fragile selectors:
  - do not rely on CSS chains, visual text fragments likely to change, or nth-child.
- Prefer robust selectors:
  - `getByRole`, `getByLabel`, stable `data-testid` where needed.
- No arbitrary sleeps:
  - do not use fixed `waitForTimeout` as synchronization strategy.
- Wait on explicit signals:
  - network response, visible state, URL change, enabled/disabled state.

---

## 6) Quality Gate (Definition of Done)

A Multi-city change is acceptable only if:
- architecture separation is respected,
- strict typing has zero `any`,
- validation rules are fully enforced,
- state is preserved after API errors,
- mobile compatibility is verified,
- unit + Playwright coverage is updated,
- tests avoid fragile selectors and arbitrary timeouts.

If one gate fails, the feature is **not ready**.

