# Multi-city / Multitratta Specification

## 1. Objective
Introduce a Multi-city (Multitratta) search flow that lets users define a trip with multiple segments while maintaining strict validation, reliable error handling, and mobile usability.

---

## 2. Scope

### In scope
- 2-6 segments per request.
- Segment fields: origin, destination, date.
- Inline validation and disabled submit when invalid.
- API payload with preserved segment order.
- Retry on transient API failures.
- State preservation after API errors.

### Out of scope
- Fare-family optimization logic.
- Segment auto-reordering.
- Multi-passenger cabin mixing per segment.

---

## 3. Domain model (TypeScript)

```ts
export type IataCode = string; // normalized uppercase 3 chars
export type IsoDate = string;  // YYYY-MM-DD

export interface MultiCitySegment {
  origin: IataCode;
  destination: IataCode;
  date: IsoDate;
}

export interface MultiCityFormState {
  segments: MultiCitySegment[]; // length 2..6
}

export interface SegmentFieldErrors {
  origin?: string;
  destination?: string;
  date?: string;
}

export interface MultiCityValidationResult {
  valid: boolean;
  segmentErrors: SegmentFieldErrors[]; // same length as segments
  formErrors: string[];
}

export interface MultiCitySearchPayload {
  mode: 'multi_city';
  segments: MultiCitySegment[]; // exact UI order, unchanged
}
```

No `any` is allowed in Multi-city types, form handlers, validators, mappers, or API clients.

---

## 4. UX behavior

## 4.1 Segments
- Initial state shows 2 segments.
- User can add segments up to 6.
- User can remove segments down to 2.
- Segment index is stable and visible enough for user orientation.

## 4.2 Validation and submit
- Validation runs on change and before submit.
- Field-level inline errors are rendered near each invalid input.
- Submit is disabled when:
  - validation fails, or
  - request is in-flight.

## 4.3 Error handling
- On API failure:
  - keep all segment values,
  - keep segment order,
  - keep inline errors,
  - show non-blocking request error with retry action.

---

## 5. Validation rules (mandatory)

For each segment:
1. `origin` required and valid IATA format.
2. `destination` required and valid IATA format.
3. `date` required and valid date format.
4. `origin !== destination`.

Cross-segment rule:
5. Segment dates must be non-decreasing by index  
   (`segments[i].date >= segments[i-1].date` for all `i > 0`).

Any violation returns structured errors:
- segment field errors (inline),
- optional form-level error summary.

---

## 6. API contract

Request:

```json
{
  "mode": "multi_city",
  "segments": [
    { "origin": "MXP", "destination": "LIS", "date": "2026-05-10" },
    { "origin": "LIS", "destination": "MAD", "date": "2026-05-14" }
  ]
}
```

Rules:
- `segments` order must match UI order exactly.
- Do not sort by date or airport before sending.
- Payload builder belongs to business/api layer, not UI component.

---

## 7. Retry strategy

Required behavior on transient failures:
- Retry with bounded attempts.
- Backoff between attempts.
- Last failure surfaces user-visible error and retry CTA.

Reference policy:
- attempts: max 3 (1 initial + 2 retries),
- backoff: 300ms, 900ms (or equivalent deterministic strategy).

Policy must be implemented in business/api layer and unit-tested.

---

## 8. Mobile compatibility requirements

- Works at common mobile widths without horizontal scrolling.
- Segment rows stack cleanly.
- Error text remains readable and associated with the correct field.
- Add/remove/submit controls remain reachable and tappable.

---

## 9. Testing requirements

## 9.1 Unit tests (logic)
Cover:
- validation rules,
- segment boundary (2 and 6),
- payload order preservation,
- retry policy decisions and backoff progression,
- state preservation contract on API failures.

## 9.2 Playwright tests (flows)
Cover:
- valid 2-segment submit,
- valid 6-segment submit,
- invalid same origin/destination,
- invalid reverse date,
- API failure + retry with preserved form state.

### Selector and timing standards
- Use stable selectors (`getByRole`, `getByLabel`, `data-testid` where justified).
- No fragile CSS chains or index-dependent selectors.
- No arbitrary `waitForTimeout` for synchronization.

---

## 10. Non-functional constraints

- Keep separation between UI, validation, and business logic.
- Preserve current app behavior outside Multi-city scope.
- Avoid introducing shared-state side effects outside feature boundaries.


