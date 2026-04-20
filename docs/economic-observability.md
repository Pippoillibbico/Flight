# Economic Observability

## What is tracked

Economic events are emitted server-side through `logEconomicEvent` and persisted in `economics_events`.

Core fields:
- `provider_cost_eur` (Duffel estimated cost)
- `ai_cost_eur`
- `stripe_fee_eur`
- `revenue_eur` (final shown/sold price)
- `gross_margin_eur`, `net_margin_eur`
- `gross_margin_rate`, `net_margin_rate`
- `offer_count`, `bookable_count`, `excluded_count`
- `guard_action`, `guard_rules`

User identifiers are persisted as `user_id_hash` (never raw user id).

## Main event types

- `search_economics` (important search flows)
- `offer_priced`
- `offer_repriced`
- `offer_excluded`
- `offer_marked_non_monetizable`
- `checkout_created`
- `subscription_created`
- `payment_received`
- `payment_failed`

## Where to read data

1. Structured storage:
- SQL table: `economics_events`
- migration: `server/migrations/013_economics_events.sql`

2. Application logs:
- logger category: `economic`
- message pattern: `economic_event: <event_type>`

## Fast analysis examples

1. Offers with insufficient margin:
- filter `event_type IN ('offer_excluded','offer_marked_non_monetizable')`
- group by `origin,destination,guard_rules`

2. AI-heavy flows:
- filter `event_type='search_economics'`
- order by `ai_cost_eur DESC`

3. Free users consuming too much:
- filter `user_tier='free'`
- group by `user_id_hash`, sum `ai_cost_eur`, `provider_cost_eur`

4. Stripe monetization quality:
- compare `checkout_created` volume vs `payment_received`
- track `payment_failed` by plan/currency in `extra`
