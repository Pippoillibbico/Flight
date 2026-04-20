/**
 * affiliate-link-engine.js
 *
 * High-level affiliate orchestrator.
 *
 * Responsibilities:
 *  - Provider selection (duffel_link when available → travelpayouts → kiwi → skyscanner → tde_booking)
 *  - A/B test slot for future multi-provider experiments
 *  - Commission estimation (rough, for UX display only — NOT guaranteed revenue)
 *  - Single public API: generateAffiliateLink(deal)
 *
 * This module wraps affiliate-links.js. It does NOT replace it.
 * The existing /api/outbound/* routes continue to use affiliate-links.js directly.
 *
 * Monetisation priority (near-term):
 *  1. Travelpayouts — join https://travelpayouts.com/, no commercial agreement needed.
 *     Set AFFILIATE_TRAVELPAYOUTS_MARKER to activate.
 *  2. Kiwi direct   — requires Kiwi affiliate account (separate from Tequila search API).
 *  3. Skyscanner    — requires Partners agreement.
 *  4. tde_booking   — internal fallback, always works, zero commission.
 */

import { buildAffiliateLink, getAffiliateConfig } from './affiliate-links.js';
import { selectOutboundProvider } from './outbound-provider-selector.js';

// ── Commission models (rough estimates for display — not contractual) ─────────
//
// Travelpayouts: CPA network, ~1.8% of ticket price (varies by sub-affiliate)
// Kiwi.com:      CPA model, ~1.5–3% of ticket price (direct affiliate)
// Skyscanner:    CPC model, ~€0.25–1.20 per qualifying click
// tde_booking:   Internal — no external commission
//
const COMMISSION_MODELS = Object.freeze({
  travelpayouts: { type: 'cpa_pct', rate: 0.018, minEur: 0.40, maxEur: 35 }, // ~1.8% CPA
  kiwi:          { type: 'cpa_pct', rate: 0.02,  minEur: 0.50, maxEur: 40 }, // ~2% CPA
  skyscanner:    { type: 'cpc_eur', rate: 0,      flatEur: 0.45 },            // ~€0.45 CPC
  tde_booking:   { type: 'none',    rate: 0,      flatEur: 0 }
});

/**
 * Returns rough estimated commission for a click, in EUR.
 * Used only for display / analytics — never treat as guaranteed revenue.
 *
 * @param {string} provider
 * @param {number} price  ticket price in EUR
 * @returns {number}
 */
export function estimateCommission(provider, price) {
  const model = COMMISSION_MODELS[provider] || COMMISSION_MODELS.tde_booking;
  if (model.type === 'cpa_pct') {
    const raw = Number(price || 0) * model.rate;
    return Math.round(Math.min(model.maxEur, Math.max(model.minEur, raw)) * 100) / 100;
  }
  if (model.type === 'cpc_eur') return model.flatEur;
  return 0;
}

/**
 * Selects the best affiliate provider for a deal.
 *
 * Priority (in order of ease-of-activation and commission viability):
 *   1. duffel_link   — if the deal carries a direct Duffel booking URL
 *   2. travelpayouts — if enabled and AFFILIATE_TRAVELPAYOUTS_MARKER is set
 *                      (no commercial agreement needed, broad inventory via Aviasales)
 *   3. kiwi          — if AFFILIATE_KIWI_ID is set (direct Kiwi affiliate, higher CPA)
 *   4. skyscanner    — if AFFILIATE_SKYSCANNER_ID is set
 *   5. tde_booking   — always available, internal fallback, zero commission
 *
 * Future: add A/B test bucket logic here (e.g. hash userId % 100 < splitPct).
 *
 * @param {{ price?: number, cabin_class?: string }} deal
 * @returns {{ provider: string, estimatedCommission: number }}
 */
export function selectBestProvider(deal) {
  const selection = selectOutboundProvider({
    deal,
    affiliateConfig: getAffiliateConfig()
  });
  return {
    provider: selection.provider,
    estimatedCommission: selection.estimatedCommission
  };
}

/**
 * Generates a complete affiliate link for a deal.
 *
 * @param {{
 *   origin: string,
 *   destination: string,
 *   departure_date: string,
 *   return_date?: string|null,
 *   price?: number,
 *   cabin_class?: string,
 *   travellers?: number
 * }} deal
 * @param {string} [forceProvider]  Override provider selection (for A/B tests)
 * @returns {{
 *   url: string,
 *   provider: string,
 *   estimated_commission: number
 * }}
 */
export function generateAffiliateLink(deal, forceProvider = null) {
  const selection = selectOutboundProvider({
    deal,
    forceProvider,
    affiliateConfig: getAffiliateConfig()
  });
  const { provider, directUrl, estimatedCommission } = selection;

  if (directUrl) {
    return { url: directUrl, provider, estimated_commission: estimatedCommission };
  }

  const { url, partner } = buildAffiliateLink({
    origin: deal.origin,
    destinationIata: deal.destination,
    dateFrom: deal.departure_date,
    dateTo: deal.return_date || null,
    travellers: deal.travellers || 1,
    cabinClass: deal.cabin_class || 'economy',
    partner: provider
  });

  return {
    url,
    provider: partner,
    estimated_commission: estimateCommission(partner, deal?.price || 0) ?? estimatedCommission
  };
}

/**
 * Generates a booking_url for embedding in deal API responses.
 * The URL points to /api/redirect/:dealId which handles click tracking + redirect.
 *
 * @param {string} dealId  Fingerprint or dealKey of the deal
 * @param {object} deal    Deal object with origin, destination, etc.
 * @returns {string}       Internal redirect URL
 */
export function buildBookingUrl(dealId, deal) {
  const params = new URLSearchParams();
  if (deal.origin) params.set('o', String(deal.origin).slice(0, 3).toUpperCase());
  if (deal.destination) params.set('d', String(deal.destination).slice(0, 3).toUpperCase());
  if (deal.departure_date) params.set('dep', String(deal.departure_date).slice(0, 10));
  if (deal.return_date) params.set('ret', String(deal.return_date).slice(0, 10));
  if (deal.price) params.set('prc', String(Math.round(Number(deal.price || 0) * 100) / 100));
  if (deal.cabin_class) params.set('cab', String(deal.cabin_class || 'economy'));
  if (deal.trip_type) params.set('tt', String(deal.trip_type || 'round_trip'));
  if (deal.deal_type) params.set('dt', String(deal.deal_type || ''));
  if (deal.deal_confidence != null) params.set('dc', String(Math.round(Number(deal.deal_confidence || 0))));
  return `/api/redirect/${encodeURIComponent(String(dealId))}?${params.toString()}`;
}
