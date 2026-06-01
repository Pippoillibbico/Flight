# AI Flight Hacker / Smart Triangulation

Smart Triangulation turns a natural-language travel request into candidate self-transfer routes such as `ROM-BUD-BKK`. The backend keeps AI parsing, route generation, provider lookup, scoring, and explanation in separate modules under `server/features/triangulation`.

## Plan Behavior

- Free: cached/static preview only. Free never calls AI providers, flight providers, live scans, workers, alert polling, or any variable-cost service.
- Pro: live triangulation can use AI parsing and provider search when configured and within quota.
- Creator/Elite: same live search foundation as Pro, with room for advanced alerts, automation, and route monitoring.

The architectural rule is enforced through `server/lib/plan-capabilities.js` using `triangulation_live`. The comment in the service is intentional: `FREE plan must never trigger paid variable-cost capabilities.`

## Scoring

Results are scored from 0 to 100:

- price/savings: 40%
- connection risk: 25%
- duration: 15%
- baggage compatibility: 10%
- comfort/timing: 10%

Risk increases for short layovers, separate tickets, airport changes, and checked baggage. Personal-item travel with at least six hours between separate tickets lowers risk.

## Bridge Airports

Bridge metadata lives in `server/features/triangulation/bridge-airports.js`. Add new bridge airports there with:

- `iata`
- `city`
- `country`
- `region`
- `tags`
- `riskProfile`
- `goodFor`
- `minLayoverHoursSeparateTickets`

Do not hardcode bridge lists inside the route generator.

## Provider And AI Rules

AI may parse prompts or explain backend-calculated results for paid users only. AI must not invent prices, routes, availability, or provider facts.

Provider search is called only after the paid capability guard passes. If no live provider is configured, paid users receive a managed `live_unavailable` response rather than synthetic live prices.

Provider failures return a stable client-safe error code. Raw provider messages and stack traces stay server-side. Cached-preview API payloads remain locale-neutral; user-facing localization belongs in the frontend.

## Feature Flags

Recommended environment settings:

```env
TRIANGULATION_ENABLED=true
TRIANGULATION_LIVE_ENABLED=false
TRIANGULATION_MAX_BRIDGES=20
TRIANGULATION_MAX_COMBINATIONS=80
TRIANGULATION_MAX_DATES=10
TRIANGULATION_MAX_RESULTS=10
TRIANGULATION_MIN_LAYOVER_SEPARATE_TICKETS_HOURS=6
```

The safe default is live disabled unless explicitly enabled and providers are configured. Free remains cache/static only regardless of flags.

## Testing

Run:

```bash
npm test
```

Key tests are in `test/triangulation-feature.test.mjs`. They fail if a Free request invokes mocked AI or provider functions, and they verify scoring, risk rules, provider failure handling, and route-combination limits.

## Known Limits

The first version supports one live bridge stop for Pro and prepares the data model for two-stop Creator flows. It does not invent fallback live prices. When providers fail or are disabled, paid endpoints return managed unavailable/error payloads.

The legacy `/api/search/triangulation` stub remains available for compatibility. New clients should use `/api/triangulation/intake` and `/api/triangulation/search`; the stub can be deprecated in a future release.
