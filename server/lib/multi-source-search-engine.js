/**
 * multi-source-search-engine.js
 *
 * Orchestrates parallel flight searches across all configured providers
 * (Duffel, Kiwi, Skyscanner), deduplicates overlapping offers, and returns
 * a unified ranked response with full provider attribution.
 *
 * Design principles:
 *  - Provider failures never propagate — each failure is isolated.
 *  - Deduplication uses a price-tolerance fingerprint to merge near-identical
 *    offers from different providers, preferring the cheapest source.
 *  - The search runs only when ENABLE_MULTI_SOURCE_SEARCH=true (default: false).
 *  - If no provider is available, returns an empty result rather than throwing.
 *
 * Public API:
 *   multiSourceSearch(params)  → { offers, groups, meta }
 *   getProviderStatus()        → array of per-provider status snapshots
 */

import { createProviderRegistry } from './providers/provider-registry.js';
import { generateAffiliateLink, buildBookingUrl, estimateCommission } from './affiliate-link-engine.js';
import { parseFlag } from './env-flags.js';
import { logger } from './logger.js';
import { createHash } from 'node:crypto';

// ── Feature flag ─────────────────────────────────────────────────────────────

export function isMultiSourceEnabled() {
  return parseFlag(process.env.ENABLE_MULTI_SOURCE_SEARCH, false);
}

// ── Singleton registry (re-used across requests) ──────────────────────────────

let _registry = null;

function getRegistry() {
  if (!_registry) {
    _registry = createProviderRegistry();
  }
  return _registry;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

// Two offers are "same" when route, cabin, trip type, and price are within
// PRICE_DEDUP_TOLERANCE_PCT of each other. We keep the cheapest.
const PRICE_DEDUP_TOLERANCE_PCT = Number(process.env.MULTI_SOURCE_DEDUP_TOLERANCE_PCT || 3) / 100;

/**
 * Compute a dedup bucket key for an offer.
 * Prices are quantised to the nearest 5 EUR to absorb minor provider-level
 * rounding differences on the same underlying fare.
 */
function dedupBucket(offer) {
  const origin  = String(offer.originIata      || '').toUpperCase();
  const dest    = String(offer.destinationIata || '').toUpperCase();
  const dep     = String(offer.departureDate   || '').slice(0, 10);
  const ret     = offer.returnDate || '';
  const cabin   = String(offer.cabinClass      || 'economy').toLowerCase();
  const tripT   = String(offer.tripType        || 'one_way').toLowerCase();
  const priceQ  = Math.round(Number(offer.totalPrice || 0) / 5) * 5;
  return `${origin}|${dest}|${dep}|${ret}|${cabin}|${tripT}|${priceQ}`;
}

/**
 * Deduplicate an array of normalised offers.
 * When two offers land in the same bucket, keep the one with the lower price;
 * break ties in favour of provider priority: duffel > kiwi > skyscanner.
 */
const PROVIDER_PRIORITY = { duffel: 0, kiwi: 1, skyscanner: 2 };

function deduplicateOffers(offers) {
  const byBucket = new Map();

  for (const offer of offers) {
    const key = dedupBucket(offer);
    const existing = byBucket.get(key);
    if (!existing) {
      byBucket.set(key, offer);
      continue;
    }
    const offerPrice    = Number(offer.totalPrice || 0);
    const existingPrice = Number(existing.totalPrice || 0);
    // Prefer cheaper; break ties by provider priority
    const priceWins = offerPrice < existingPrice * (1 - PRICE_DEDUP_TOLERANCE_PCT);
    const sameTier  = Math.abs(offerPrice - existingPrice) < existingPrice * PRICE_DEDUP_TOLERANCE_PCT;
    const priorityWins = sameTier &&
      (PROVIDER_PRIORITY[offer.provider] ?? 99) < (PROVIDER_PRIORITY[existing.provider] ?? 99);
    if (priceWins || priorityWins) {
      byBucket.set(key, offer);
    }
  }

  return Array.from(byBucket.values());
}

// ── Route grouping ─────────────────────────────────────────────────────────────

/**
 * Groups offers by route and returns one canonical record per route with
 * the best (cheapest) offer and a list of all alternative providers.
 */
function groupByRoute(offers) {
  const routeMap = new Map();

  for (const offer of offers) {
    const key = [
      offer.originIata,
      offer.destinationIata,
      offer.departureDate,
      offer.returnDate || '',
      offer.tripType || 'one_way',
      offer.cabinClass || 'economy'
    ].join('|');
    if (!routeMap.has(key)) {
      routeMap.set(key, {
        originIata:      offer.originIata,
        destinationIata: offer.destinationIata,
        departureDate:   offer.departureDate,
        returnDate:      offer.returnDate || null,
        cabinClass:      offer.cabinClass,
        tripType:        offer.tripType,
        bestPrice:       offer.totalPrice,
        bestProvider:    offer.provider,
        currency:        offer.currency,
        alternatives:    []
      });
    }
    const group = routeMap.get(key);
    if (Number(offer.totalPrice) < Number(group.bestPrice)) {
      group.alternatives.push({
        provider:   group.bestProvider,
        price:      group.bestPrice,
        currency:   group.currency
      });
      group.bestPrice    = offer.totalPrice;
      group.bestProvider = offer.provider;
      group.currency     = offer.currency;
    } else {
      group.alternatives.push({
        provider: offer.provider,
        price:    offer.totalPrice,
        currency: offer.currency
      });
    }
  }

  return Array.from(routeMap.values()).sort((a, b) => Number(a.bestPrice) - Number(b.bestPrice));
}

// ── Offer enrichment ──────────────────────────────────────────────────────────

/**
 * Builds a deal fingerprint for click-tracking (16-char hex, matches
 * the format used by /api/engine/deals).
 */
function buildDealId(offer) {
  return createHash('sha1')
    .update(`${offer.originIata}${offer.destinationIata}${offer.departureDate}${offer.totalPrice}${offer.provider}`)
    .digest('hex')
    .slice(0, 16);
}

function enrichOffer(offer) {
  const dealId = buildDealId(offer);
  const affiliateData = generateAffiliateLink({
    origin:         offer.originIata,
    destination:    offer.destinationIata,
    departure_date: offer.departureDate,
    return_date:    offer.returnDate || null,
    price:          offer.totalPrice,
    cabin_class:    offer.cabinClass,
    trip_type:      offer.tripType,
    travellers:     1
  });

  return {
    deal_id:              dealId,
    origin:               offer.originIata,
    destination:          offer.destinationIata,
    departure_date:       offer.departureDate,
    return_date:          offer.returnDate || null,
    cabin_class:          offer.cabinClass,
    trip_type:            offer.tripType,
    price:                Number(offer.totalPrice),
    currency:             offer.currency,
    provider:             offer.provider,
    estimated_commission: affiliateData.estimated_commission,
    affiliate_provider:   affiliateData.provider,
    booking_url:          buildBookingUrl(dealId, {
      origin:         offer.originIata,
      destination:    offer.destinationIata,
      departure_date: offer.departureDate,
      return_date:    offer.returnDate || null,
      price:          offer.totalPrice,
      cabin_class:    offer.cabinClass,
      trip_type:      offer.tripType
    }),
    metadata:             offer.metadata || {}
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Runs a multi-source search across all configured and enabled providers.
 *
 * @param {{
 *   originIata: string,
 *   destinationIata: string,
 *   departureDate: string,
 *   returnDate?: string|null,
 *   adults?: number,
 *   cabinClass?: string,
 *   maxOffers?: number
 * }} params
 *
 * @returns {Promise<{
 *   offers: Array,
 *   groups: Array,
 *   meta: object
 * }>}
 */
export async function multiSourceSearch(params) {
  const startMs = Date.now();
  const registry = getRegistry();

  let rawOffers = [];
  let error = null;
  let providerSnapshot = registry.runtimeStats();

  try {
    rawOffers = await registry.searchOffers({
      originIata:      String(params.originIata      || '').toUpperCase(),
      destinationIata: String(params.destinationIata || '').toUpperCase(),
      departureDate:   String(params.departureDate   || '').slice(0, 10),
      returnDate:      params.returnDate ? String(params.returnDate).slice(0, 10) : null,
      adults:          Number(params.adults || 1),
      cabinClass:      String(params.cabinClass || 'economy').toLowerCase()
    });
    // Refresh snapshot after search to capture updated circuit state
    providerSnapshot = registry.runtimeStats();
  } catch (err) {
    error = String(err?.message || 'multi_source_search_failed');
    logger.warn({ err: error, params }, 'multi_source_search_error');
    providerSnapshot = registry.runtimeStats();
  }

  const maxOffers = Math.min(50, Math.max(1, Number(params.maxOffers || 20)));

  const deduped  = deduplicateOffers(rawOffers);
  const sorted   = deduped.sort((a, b) => Number(a.totalPrice) - Number(b.totalPrice)).slice(0, maxOffers);
  const enriched = sorted.map(enrichOffer);
  const groups   = groupByRoute(sorted);

  const providerCounts = rawOffers.reduce((acc, o) => {
    acc[o.provider] = (acc[o.provider] || 0) + 1;
    return acc;
  }, {});

  return {
    offers: enriched,
    groups,
    meta: {
      generated_at:     new Date().toISOString(),
      elapsed_ms:       Date.now() - startMs,
      raw_offer_count:  rawOffers.length,
      deduped_count:    deduped.length,
      returned_count:   enriched.length,
      by_provider:      providerCounts,
      providers:        providerSnapshot,
      error:            error || null
    }
  };
}

/**
 * Returns a live snapshot of all registered providers and their circuit state.
 *
 * @returns {Array<{
 *   name: string,
 *   enabled: boolean,
 *   configured: boolean,
 *   circuitOpen: boolean,
 *   failures: number,
 *   successes: number,
 *   totalSearches: number
 * }>}
 */
export function getProviderStatus() {
  return getRegistry().runtimeStats();
}
