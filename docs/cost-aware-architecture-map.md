# Cost-Aware Architecture Map

Refactor scope: lightweight, backward-compatible boundaries for cost-aware/business-ready flows.

## Layered map

1. Providers
- Facade: `server/lib/providers/index.js`
- Modules:
  - `server/lib/providers/provider-registry.js` (Duffel orchestration)
  - `server/lib/flight-provider.js` (outbound/partner provider registry)

2. Pricing
- Facade: `server/lib/pricing/index.js`
- Modules:
  - `server/lib/pricing-engine.js` (dynamic pricing)
  - `server/lib/margin-guard.js` (economic safety net)

3. Billing
- Facade: `server/lib/billing/index.js`
- Modules:
  - `server/lib/billing/*` (Stripe checkout, subscriptions, webhook sync)

4. AI services
- Facade: `server/lib/ai/index.js`
- Modules:
  - `server/lib/ai-intent-service.js`
  - `server/lib/ai-cache.js`
  - `server/lib/ai-cost-guard.js`
  - `server/lib/ai-output-guards.js`

5. Caching
- Facade: `server/lib/cache/index.js`
- Modules:
  - `server/lib/free-cache.js` (Redis/memory hybrid cache)

6. Feature gating
- Facade: `server/lib/gating/index.js`
- Modules:
  - `server/lib/plan-access.js`
  - `server/lib/require-forecast-access.js`

7. Metrics / logging / observability
- Facade: `server/lib/observability/index.js`
- Modules:
  - `server/lib/logger.js`
  - `server/lib/economic-logger.js`
  - `server/lib/provider-cost-guard.js` (metrics)

## Entry points aligned to facades

- `server/index.js` now imports providers/cache/AI/gating/observability via layer facades.
- `server/routes/search.js` now imports pricing and economic logging via facades.
- `server/routes/billing.js` now imports billing classes/schemas through billing facade.

## Why this helps

- Lower coupling: business flows depend on stable layer boundaries, not deep module paths.
- Easier evolution: replace internals (provider, pricing, AI, billing) without touching route orchestration.
- Safer scale-up: clearer ownership by domain and simpler review surface for cost-sensitive code.
- Backward compatibility: legacy modules unchanged; facades are additive.

## Technical debt still present

1. `server/index.js` remains very large and could be split by bounded context bootstrap.
2. Some routes still import leaf modules directly (not yet fully migrated to facades).
3. Runtime dependency injection is partial (constructors exist, but composition root is centralized in `index.js`).
4. Economic analytics read APIs/dashboard are still minimal; table is populated but BI views can be improved.

## Suggested next incremental improvements

1. Extract composition modules: `bootstrap/providers.js`, `bootstrap/billing.js`, `bootstrap/ai.js`.
2. Add read-model endpoints for `economics_events` (admin-only) with pre-aggregations.
3. Migrate remaining route imports to facades gradually (no big-bang move).
