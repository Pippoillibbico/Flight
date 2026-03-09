# Travel Opportunity Platform - Scope Status

Date: 2026-03-09

## Completed in scope
- Automatic opportunity pipeline orchestrator.
- Opportunity scoring, publication gating, dedupe grouping.
- Shortlist-only AI enrichment with optional provider integration.
- Radar preference persistence and follow-to-alert bridge.
- Product navigation sections: Home, Explore, Radar, AI Travel, Premium.
- Pipeline observability endpoints and worker status.
- Cron automation for pipeline and radar precompute.

## Reused existing architecture
- Provider registry (`server/lib/providers/*`).
- Ingestion + normalization (`price-ingestion-worker`, `deal-engine-store`, `price-history-store`).
- Existing auth/csrf/quota middleware.
- Existing cron scheduler in `server/index.js`.
- Existing alerts/notifications model.

## Out-of-scope or pending
- Real provider credentials and production partner contracts.
- Full BI dashboard UI for pipeline metrics (API-level status is present).
- Full multilingual conversion copy review for every language pack key.

## Known non-scope dirty files
Repository contains pre-existing modifications not part of this delivery.
Use `git diff --name-only` and selective commit to isolate release scope.
