# Provider Pipeline Mapping

This document records the soft-launch provider mapping. It does not change the
deal scoring engine.

## Kiwi Tequila

Source endpoint: `GET /v2/search`.

| API field | Internal offer | `price_observations` | `flight_quotes` |
| --- | --- | --- | --- |
| `flyFrom` | `originIata` | `origin_iata` | `originIata` |
| `flyTo` | `destinationIata` | `destination_iata` | `destinationIata` |
| `local_departure` / `dTime` | `departureDate` | `departure_date` | `departureDate` |
| request return date | `returnDate` | `return_date` | `returnDate` |
| `price` | `totalPrice` | `total_price` | `totalPrice` |
| `currency` | `currency` | `currency` | `currency` |
| `booking_token` | `metadata.kiwiBookingToken` | `metadata` | `providerOfferId` fallback |
| `deep_link` | `metadata.kiwiDeepLink` | `metadata` | `providerOfferId` fallback |
| `route[].airline` | `metadata.airlines` | `metadata` | `metadata` |
| `duration.total` / `fly_duration` | `metadata.durationMinutes` | `metadata` | `durationMinutes` |

## Duffel

Source endpoint: `POST /air/offer_requests?return_offers=true`.

| API field | Internal offer | `price_observations` | `flight_quotes` |
| --- | --- | --- | --- |
| request slice origin | `originIata` | `origin_iata` | `originIata` |
| request slice destination | `destinationIata` | `destination_iata` | `destinationIata` |
| request slice departure date | `departureDate` | `departure_date` | `departureDate` |
| second slice departure date | `returnDate` | `return_date` | `returnDate` |
| `total_amount` | `totalPrice` | `total_price` | `totalPrice` |
| `total_currency` / `base_currency` | `currency` | `currency` | `currency` |
| `id` | `metadata.offerId` | `metadata` | `providerOfferId` |
| offer request `id` | `metadata.offerRequestId` | `metadata` | `metadata` |
| `slices[].segments.length` | `metadata.totalStops` | `metadata` | `stops` |
| `slices[].duration` | `metadata.totalDurationMinutes` | `metadata` | `durationMinutes` |

## Pipeline

1. Provider adapters normalize raw API responses to internal provider offers.
2. `provider_collection_worker` stores every offer in `price_observations`.
3. The same worker stores every offer in `flight_quotes`.
4. `baseline_recompute_worker` derives `route_baselines` from `price_observations`.
5. `route_price_stats_worker` derives `route_price_stats` from `flight_quotes`.
6. Deal detection consumes the existing `flight_quotes` and `route_price_stats`
   tables without scoring changes.
