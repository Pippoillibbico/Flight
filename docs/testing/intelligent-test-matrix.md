# Intelligent Test Matrix

This project runs layered automation with regression memory.

## Quality Gates

1. `npm run lint`
2. `npm run lint:providers`
3. `npm test`
4. `npx playwright test`

All four gates must pass before merge.

## Test Layers

1. Unit and domain logic (`test/**/*.test.mjs`)
2. API/router integration (billing, system, alerts, search, opportunities)
3. End-to-end UX flows (`e2e/**/*.spec.js`)
4. Runtime guard (console/page/request/API 5xx detection inside every E2E)
5. Security and go-live scripts (`npm run test:security:gate`, `npm run test:go-live`)

## Critical Journeys Covered

1. Landing -> feed discovery
2. Progressive login (guest browse, auth only for gated features)
3. Opportunity detail navigation
4. Radar save/follow flow
5. AI Travel query and result details
6. Premium upgrade paths
7. Mobile layout overflow checks
8. Dark-mode auth visual integrity
9. Pipeline health endpoint smoke

## Regression Policy

1. Every real bug must produce/extend an automated test before closing.
2. New failures are recorded in `docs/testing/regression-memory.json`.
3. Fixed failures are marked as resolved, never deleted from history.
4. Flaky tests are treated as defects and must be stabilized.
