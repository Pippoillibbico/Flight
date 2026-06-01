# UX and i18n Regression Map

## Purpose

This map identifies the user-facing surfaces that require visual and language checks before release. It complements functional tests without replacing manual product review.

## Automated Visual Audit

Run:

```bash
npx playwright test e2e/visual-regression-audit.spec.js --project=chromium
```

The diagnostic suite captures screenshots under `test-results/visual-audit/` for:

- Italian and English
- desktop viewport: `1440x900`
- mobile viewport: `390x844`

The suite also fails on document-level horizontal overflow and unexpected browser console errors.

### Secondary-language visual matrix

Run:

```bash
npx playwright test e2e/visual-i18n-secondary-languages.spec.js --project=chromium --workers=1
```

The secondary-language suite captures screenshots under `test-results/visual-i18n-secondary-languages/` for:

- German, French, Spanish, and Portuguese
- desktop viewport: `1440x900`
- mobile viewport: `390x844`
- landing, authentication, app-shell feed, Radar, AI Travel with cached triangulation preview, and upgrade modal

The suite fails on horizontal overflow, clipped visible CTA text, raw i18n keys, visible mojibake, and unexpected runtime errors.

## Sensitive Surfaces

| Surface | Desktop | Mobile | IT | EN | Automated checks |
| --- | --- | --- | --- | --- | --- |
| Landing page and cookie consent | yes | yes | yes | yes | screenshot, overflow, console |
| Authentication modal | yes | yes | yes | yes | screenshot, overflow, console |
| App shell header and primary navigation | yes | yes | yes | yes | screenshot, overflow, console |
| Trial banner and opportunity feed | yes | yes | yes | yes | screenshot, overflow, console |
| Radar and live-deals panel | yes | yes | yes | yes | screenshot, overflow, console |
| AI Travel and triangulation panel | yes | yes | yes | yes | screenshot, overflow, console |
| Premium plan cards | yes | yes | yes | yes | screenshot, overflow, console |
| Upgrade modal | yes | yes | yes | yes | focused modal screenshot, overflow, console |

## Regression Guards

- `e2e/visual-regression-audit.spec.js`: visual diagnostic capture across key surfaces.
- `e2e/visual-i18n-secondary-languages.spec.js`: DE/FR/ES/PT visual matrix for long-copy and localized-flow regressions.
- `e2e/ui-ux-i18n-audit.spec.js`: language switching, responsive navigation, CTA and overflow checks.
- `e2e/upgrade-flow.spec.js`: upgrade flow behavior.
- `e2e/progressive-access.spec.js`: guest browsing, radar access gate, and login handoff.
- `e2e/auth-flow-complete.spec.js`: guest entry, email login, registration, and stable app navigation.
- `e2e/app-flows.spec.js`: Free feed/radar limits, cached triangulation preview in IT/EN, plan-limit messaging, and locally intercepted Stripe checkout.
- `test/ui-i18n-regression-guards.test.mjs`: language-pack coverage, fallback-copy and mojibake guards.

## Main User Flow

### Anonymous user

1. Opens the landing page and sees the product value proposition.
2. Enters the public opportunity feed without forced login.
3. Can inspect the limited public feed and an opportunity detail.
4. Encounters an account gate when opening protected Radar features.
5. Uses the gate CTA to open the registration/login surface.

### Free user

1. Signs in and enters the app shell.
2. Sees public cached opportunities and explicit Free limits.
3. Sees a localized PRO/ELITE prompt in the feed and Radar surfaces.
4. Opens AI Travel and is offered an upgrade instead of triggering live AI.
5. Uses AI Flight Hacker in cached-preview mode only.
6. Receives localized preview notes, risk labels, and a clear upgrade prompt.

### PRO and ELITE upgrade

1. Opens the upgrade modal from a contextual CTA.
2. Reviews localized Free/PRO/ELITE comparison rows.
3. Starts checkout through a locally intercepted Stripe URL in E2E tests.
4. Does not call Stripe-hosted checkout during automated tests.

### Opportunity feed and Radar

1. Guest users see a limited public feed and a soft account gate.
2. Free authenticated users see plan-limit prompts without hidden live-cost actions.
3. Radar remains account-gated for guests and upgrade-gated for Free users.
4. Opportunity detail and follow actions remain reachable from the feed.

## Review Checklist

Before release, inspect the generated screenshots and verify:

- no text clipping, overlap, or horizontal scrolling;
- one clear primary CTA per section;
- consistent button sizing and hierarchy;
- readable mobile stacking for cards and forms;
- Italian screens contain Italian copy and English screens contain English copy;
- cached, live, and premium states are described honestly;
- cookie consent and upgrade overlays remain readable without hiding their actions.
- Free AI Travel opens an upgrade path and does not execute live AI.
- Free AI Flight Hacker renders cached previews only, with localized notes and risk labels.
- guest Radar access opens the account gate and does not silently fail.
- checkout tests stop at the locally intercepted Stripe page.
- German, French, Spanish, and Portuguese screens keep app-shell hero copy, cached-preview labels, and upgrade summaries localized.
- long CTA labels wrap or size safely on mobile without clipping.

## Patterns to Avoid

- Hardcoded user-facing strings when an i18n key exists.
- English component defaults leaking into non-English screens.
- Broad visual selectors that can click a similarly named control in another section.
- Forced clicks for tab navigation in visual diagnostics when a real DOM click is sufficient.
- Pixel-perfect snapshot assertions for dynamic data sections.
- Broad API mocks that hide routing or payload regressions.
- Force-clicking controls covered by overlays when a direct DOM click is sufficient for a diagnostic flow.
- Rendering server-provided preview prose directly when the UI already owns localized explanatory copy.
- Reusing English app-shell strings in secondary-language packs when localized copy is visible.
- Using `?` as a visual separator when a neutral separator such as `·` is intended.

## Residual Manual Checks

- Long mobile opportunity feeds remain usable, but screenshot review is still required because dynamic content length varies.
- Stripe-hosted checkout is outside this visual audit.
- Real provider responses can vary in copy length and should be spot-checked when provider-backed staging data is enabled.
- Secondary-language screenshots cover deterministic mocked data. Provider-backed staging content can still introduce longer labels and requires a release spot-check.
- Return-from-Stripe success handling requires an environment with a configured Stripe test checkout and is outside the locally intercepted E2E handoff.
- Staging provider and Stripe test callback prerequisites are tracked in `docs/audit/staging-smoke-test-report.md`.
