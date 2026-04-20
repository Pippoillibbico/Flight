/**
 * Outbound booking link builder.
 *
 * Supports: tde_booking (internal), travelpayouts, kiwi, skyscanner.
 * Add provider credentials via env vars; providers without credentials fall back
 * to tde_booking so outbound links always work.
 *
 * Recommended activation order:
 *   1. travelpayouts — join https://travelpayouts.com/, set AFFILIATE_TRAVELPAYOUTS_MARKER
 *   2. kiwi          — requires Kiwi affiliate account (separate from Tequila search API)
 *   3. skyscanner    — requires Skyscanner Partners agreement
 */

import { parseFlag } from './env-flags.js';

const SUPPORTED_PARTNERS = ['tde_booking', 'travelpayouts', 'kiwi', 'skyscanner'];

const DEFAULT_PARTNER = SUPPORTED_PARTNERS.includes(String(process.env.AFFILIATE_DEFAULT_PARTNER || '').trim().toLowerCase())
  ? String(process.env.AFFILIATE_DEFAULT_PARTNER || '').trim().toLowerCase()
  : 'tde_booking';

const BOOKING_BASE_URL = String(process.env.BOOKING_BASE_URL || 'https://booking.travel-decision-engine.com/search').trim();
const SITE_NAME = String(process.env.AFFILIATE_SITE_NAME || 'flightsuite').trim();
const TRAVELPAYOUTS_MARKER = String(process.env.AFFILIATE_TRAVELPAYOUTS_MARKER || '').trim();
const TRAVELPAYOUTS_AFFILIATE_ENABLED = parseFlag(process.env.ENABLE_TRAVELPAYOUTS_AFFILIATE, true);
const KIWI_AFFILIATE_ID = String(process.env.AFFILIATE_KIWI_ID || '').trim();
const SKYSCANNER_AFFILIATE_ID = String(process.env.AFFILIATE_SKYSCANNER_ID || '').trim();

function safeIata(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3);
}

function safeDate(value) {
  const text = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function safeCabin(value) {
  const cabin = String(value || 'economy').trim().toLowerCase();
  if (cabin === 'premium' || cabin === 'business') return cabin;
  return 'economy';
}

function safeTravellers(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(9, parsed));
}

/**
 * Travelpayouts deep link (via Aviasales).
 *
 * Format: https://www.aviasales.com/search/{FROM}{YYYYMMDD}{TO}{YYYYMMDDRET}{PAX}?marker=...
 * One-way:   FROM + YYYYMMDD + TO + 1
 * Round trip: FROM + YYYYMMDD_dep + TO + YYYYMMDD_ret + 1
 *
 * No API key required — only a Travelpayouts marker (partner token).
 * Commission: ~1.8% CPA (Travelpayouts variable rate, not guaranteed).
 * Docs: https://support.travelpayouts.com/hc/en-us/articles/115001491512
 */
function buildTravelpayoutsLink({ origin, destinationIata, dateFrom, dateTo, travellers }) {
  const from = safeIata(origin);
  const to   = safeIata(destinationIata);
  const dep  = safeDate(dateFrom);
  if (!from || !to || !dep || !TRAVELPAYOUTS_MARKER || !TRAVELPAYOUTS_AFFILIATE_ENABLED) return null;

  // Aviasales date format: YYYYMMDD (no dashes)
  const depCompact = dep.replace(/-/g, '');
  const ret        = safeDate(dateTo);
  const retCompact = ret ? ret.replace(/-/g, '') : '';
  const pax        = String(safeTravellers(travellers));

  const path = retCompact
    ? `${from}${depCompact}${to}${retCompact}${pax}`
    : `${from}${depCompact}${to}${pax}`;

  const url = new URL(`https://www.aviasales.com/search/${path}`);
  url.searchParams.set('marker', TRAVELPAYOUTS_MARKER);
  url.searchParams.set('utm_source', SITE_NAME);
  url.searchParams.set('utm_medium', 'affiliate');
  url.searchParams.set('utm_campaign', 'deal_redirect');
  return url.toString();
}

/**
 * Kiwi.com deep link.
 * Format: https://www.kiwi.com/en/search/results/{FROM}/{TO}/{DEP}/{RET}?affilid=...
 */
function buildKiwiLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass }) {
  const from = safeIata(origin);
  const to = safeIata(destinationIata);
  const dep = safeDate(dateFrom);
  if (!from || !to || !dep) return null;

  const ret = safeDate(dateTo);
  const returnSegment = ret ? ret : 'no-return';
  const cabin = safeCabin(cabinClass) === 'business' ? 'BUSINESS' : safeCabin(cabinClass) === 'premium' ? 'PREMIUM' : 'ECONOMY';
  const pax = safeTravellers(travellers);

  const url = new URL(`https://www.kiwi.com/en/search/results/${from}/${to}/${dep}/${returnSegment}`);
  if (KIWI_AFFILIATE_ID) url.searchParams.set('affilid', KIWI_AFFILIATE_ID);
  url.searchParams.set('currency', 'EUR');
  url.searchParams.set('adults', String(pax));
  url.searchParams.set('cabinClass', cabin);
  url.searchParams.set('utm_source', SITE_NAME);
  url.searchParams.set('utm_medium', 'affiliate');
  url.searchParams.set('utm_campaign', 'deal_redirect');
  return url.toString();
}

/**
 * Skyscanner deep link.
 * Format: https://www.skyscanner.net/transport/flights/{FROM}/{TO}/{YYYYMMDD}/{YYYYMMDD}/?associateId=...
 */
function buildSkyscannerLink({ origin, destinationIata, dateFrom, dateTo, travellers }) {
  const from = safeIata(origin);
  const to = safeIata(destinationIata);
  const dep = safeDate(dateFrom);
  if (!from || !to || !dep) return null;

  // Skyscanner uses YYYYMMDD format
  const depSky = dep.replace(/-/g, '');
  const ret = safeDate(dateTo);
  const retSky = ret ? ret.replace(/-/g, '') : depSky;
  const pax = safeTravellers(travellers);

  const url = new URL(`https://www.skyscanner.net/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/${depSky}/${retSky}/`);
  url.searchParams.set('adults', String(pax));
  url.searchParams.set('currency', 'EUR');
  url.searchParams.set('locale', 'en-EU');
  if (SKYSCANNER_AFFILIATE_ID) url.searchParams.set('associateId', SKYSCANNER_AFFILIATE_ID);
  url.searchParams.set('utm_source', SITE_NAME);
  url.searchParams.set('utm_medium', 'affiliate');
  url.searchParams.set('utm_campaign', 'deal_redirect');
  return url.toString();
}

function buildTdeBookingLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass }) {
  const url = new URL(BOOKING_BASE_URL);
  const safeOrigin = safeIata(origin);
  const safeDestination = safeIata(destinationIata);
  const safeDateFrom = safeDate(dateFrom);
  const safeDateTo = safeDate(dateTo);
  if (safeOrigin) url.searchParams.set('origin', safeOrigin);
  if (safeDestination) url.searchParams.set('destinationIata', safeDestination);
  if (safeDateFrom) url.searchParams.set('dateFrom', safeDateFrom);
  if (safeDateTo) url.searchParams.set('dateTo', safeDateTo);
  url.searchParams.set('travellers', String(safeTravellers(travellers)));
  url.searchParams.set('cabinClass', safeCabin(cabinClass));
  url.searchParams.set('partner', 'tde_booking');
  url.searchParams.set('utm_source', SITE_NAME);
  url.searchParams.set('utm_medium', 'affiliate');
  url.searchParams.set('utm_campaign', 'flight_opportunity');
  return url.toString();
}

/**
 * Build an outbound booking URL.
 *
 * @param {object} params
 * @param {'tde_booking'|string} [params.partner]
 * @returns {{ url: string, partner: string }}
 */
export function buildAffiliateLink({
  origin,
  destinationIata,
  dateFrom,
  dateTo = null,
  travellers = 1,
  cabinClass = 'economy',
  partner = null
}) {
  const selectedPartner = SUPPORTED_PARTNERS.includes(String(partner || '').trim().toLowerCase())
    ? String(partner).trim().toLowerCase()
    : DEFAULT_PARTNER;

  let url = null;
  let effectivePartner = selectedPartner;
  if (selectedPartner === 'travelpayouts') {
    url = buildTravelpayoutsLink({ origin, destinationIata, dateFrom, dateTo, travellers });
  } else if (selectedPartner === 'kiwi') {
    url = buildKiwiLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass });
  } else if (selectedPartner === 'skyscanner') {
    url = buildSkyscannerLink({ origin, destinationIata, dateFrom, dateTo, travellers });
  }
  // Fall back to tde_booking if provider build failed or not configured
  if (!url) {
    url = buildTdeBookingLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass });
    effectivePartner = 'tde_booking';
  }
  return { url, partner: effectivePartner };
}

/**
 * Compatibility helper for existing endpoints.
 *
 * @param {object} params
 * @returns {Array<{ partner: string, url: string, hasAffiliateId: boolean }>}
 */
export function buildAllAffiliateLinks({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass }) {
  const results = [];
  const partners = ['tde_booking'];
  if (TRAVELPAYOUTS_MARKER && TRAVELPAYOUTS_AFFILIATE_ENABLED) partners.unshift('travelpayouts');
  if (KIWI_AFFILIATE_ID) partners.push('kiwi');
  if (SKYSCANNER_AFFILIATE_ID) partners.push('skyscanner');

  for (const p of partners) {
    const { url, partner } = buildAffiliateLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass, partner: p });
    results.push({ partner, url, hasAffiliateId: p === 'kiwi' ? Boolean(KIWI_AFFILIATE_ID) : p === 'skyscanner' ? Boolean(SKYSCANNER_AFFILIATE_ID) : false });
  }
  return results;
}

/**
 * Runtime visibility for admin diagnostics.
 */
export function getAffiliateConfig() {
  const configured = ['tde_booking'];
  if (TRAVELPAYOUTS_MARKER && TRAVELPAYOUTS_AFFILIATE_ENABLED) configured.push('travelpayouts');
  if (KIWI_AFFILIATE_ID) configured.push('kiwi');
  if (SKYSCANNER_AFFILIATE_ID) configured.push('skyscanner');
  return {
    defaultPartner: DEFAULT_PARTNER,
    configuredPartners: configured,
    siteName: SITE_NAME,
    bookingBaseUrl: BOOKING_BASE_URL,
    travelpayoutsEnabled: TRAVELPAYOUTS_AFFILIATE_ENABLED,
    travelpayoutsConfigured: Boolean(TRAVELPAYOUTS_MARKER && TRAVELPAYOUTS_AFFILIATE_ENABLED),
    kiwiConfigured: Boolean(KIWI_AFFILIATE_ID),
    skyscannerConfigured: Boolean(SKYSCANNER_AFFILIATE_ID)
  };
}
