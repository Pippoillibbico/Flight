# Multi-city / Multitratta Acceptance Criteria

This checklist is the release gate for the Multi-city feature.

---

## A. Form structure and limits

### MC-AC-001
Given the Multi-city form is opened  
When the view renders  
Then exactly 2 segments are present by default.

### MC-AC-002
Given the user has 2 segments  
When they add segments  
Then the form allows adding up to 6 segments and no more.

### MC-AC-003
Given the user has 6 segments  
When they try to add another  
Then add action is blocked and no 7th segment is created.

### MC-AC-004
Given the user has more than 2 segments  
When they remove segments  
Then removal is allowed until 2 segments remain, and not below 2.

---

## B. Segment validation

### MC-AC-005
Given a segment has missing origin, destination, or date  
When validation runs  
Then the missing fields show inline errors.

### MC-AC-006
Given a segment has the same origin and destination  
When validation runs  
Then an inline error appears and submit remains disabled.

### MC-AC-007
Given segment `i` has a date earlier than segment `i-1`  
When validation runs  
Then reverse-date error is shown and submit remains disabled.

### MC-AC-008
Given all segments are valid  
When validation runs  
Then no inline errors are shown and submit can be enabled.

---

## C. Submit and payload

### MC-AC-009
Given segments are valid and submit is pressed  
When the API payload is created  
Then payload mode is `multi_city` and includes all segments.

### MC-AC-010
Given segments are valid and ordered in UI  
When payload is sent  
Then segment order in payload matches UI order exactly.

### MC-AC-011
Given the form is invalid  
When user tries to submit  
Then submit action is blocked.

### MC-AC-012
Given submit is in progress  
When request is pending  
Then submit remains disabled to prevent duplicate requests.

---

## D. API failure and retry

### MC-AC-013
Given an API request fails  
When error state is shown  
Then all segment values remain unchanged.

### MC-AC-014
Given an API request fails  
When error state is shown  
Then segment order remains unchanged.

### MC-AC-015
Given an API request fails with transient error  
When retry policy executes  
Then retries are attempted with bounded attempts and backoff.

### MC-AC-016
Given all retry attempts fail  
When final error is displayed  
Then user sees a retry action and can retry without re-entering data.

---

## E. Mobile compatibility

### MC-AC-017
Given mobile viewport  
When form is used end-to-end  
Then no horizontal overflow is introduced by segment rows.

### MC-AC-018
Given mobile viewport  
When validation errors are present  
Then errors remain readable and correctly associated with each field.

### MC-AC-019
Given mobile viewport  
When form is filled  
Then add/remove/submit controls remain visible and tappable.

---

## F. Testing quality gate

### MC-AC-020 (Unit tests)
Validation, payload mapping/order, retry policy, and state-preservation logic are covered by unit tests and pass.

### MC-AC-021 (Playwright happy path)
At least one stable Playwright scenario verifies successful Multi-city submit with valid segments.

### MC-AC-022 (Playwright negative path)
At least one Playwright scenario verifies invalid input prevents submit with inline errors.

### MC-AC-023 (Playwright API failure path)
Playwright verifies API failure preserves form state and retry path is usable.

### MC-AC-024 (Selector/timing robustness)
No new Playwright test uses fragile selectors or arbitrary `waitForTimeout` as synchronization.

---

## G. Release verdict

Feature is **accepted** only if all criteria `MC-AC-001` through `MC-AC-024` are satisfied.

