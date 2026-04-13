/**
 * Affiliate booking link builder.
 *
 * Supports multiple partner programs. Each partner generates a deep-link URL
 * that contains:
 *  - Flight parameters (origin, destination, dates, passengers)
 *  - Affiliate tracking ID (configured via environment variables)
 *  - UTM parameters for click attribution
 *
 * Partners and their typical commission rates (estimate, varies by route):
 *  - Kiwi.com (Tequila):     ~2–4% of booking value
 *  - Skyscanner:              ~2–3% (varies by market)
 *  - Travelpayouts/Aviasales: ~1.5–2.5%
 *  - Booking.com:             ~4–5% on hotels, ~1–2% on flights
 *
 * Environment variables expected (add to .env):
 *   AFFILIATE_DEFAULT_PARTNER   = kiwi | skyscanner | travelpayouts | booking (default: kiwi)
 *   AFFILIATE_KIWI_ID           = your Kiwi.com affiliate ID (from tequila.kiwi.com)
 *   AFFILIATE_SKYSCANNER_ID     = your Skyscanner partner ID
 *   AFFILIATE_TRAVELPAYOUTS_ID  = your Travelpayouts marker ID
 *   AFFILIATE_BOOKING_AID       = your Booking.com affiliate ID
 *   AFFILIATE_SITE_NAME         = your site name for UTM (default: flightsuite)
 */

const SUPPORTED_PARTNERS = ['kiwi', 'skyscanner', 'travelpayouts', 'booking'];

const DEFAULT_PARTNER = String(process.env.AFFILIATE_DEFAULT_PARTNER || 'kiwi')
  .trim()
  .toLowerCase();

const AFFILIATE_IDS = {
  kiwi: String(process.env.AFFILIATE_KIWI_ID || '').trim(),
  skyscanner: String(process.env.AFFILIATE_SKYSCANNER_ID || '').trim(),
  travelpayouts: String(process.env.AFFILIATE_TRAVELPAYOUTS_ID || '').trim(),
  booking: String(process.env.AFFILIATE_BOOKING_AID || '').trim()
};

const SITE_NAME = String(process.env.AFFILIATE_SITE_NAME || 'flightsuite').trim();

/**
 * Format a date as YYYYMMDD (Skyscanner / Kiwi format).
 * @param {string} isoDate - ISO 8601 date string (YYYY-MM-DD)
 */
function toCompactDate(isoDate) {
  if (!isoDate) return '';
  return String(isoDate).replace(/-/g, '').slice(0, 8);
}

/**
 * Format a date as DD/MM/YYYY (Travelpayouts format).
 * @param {string} isoDate
 */
function toDmyDate(isoDate) {
  if (!isoDate) return '';
  const [yyyy, mm, dd] = String(isoDate).split('-');
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Map cabin class to Skyscanner cabin values.
 */
function toSkyscannerCabin(cabinClass) {
  const map = { economy: 'economy', premium: 'premiumeconomy', business: 'business' };
  return map[String(cabinClass).toLowerCase()] || 'economy';
}

/**
 * Build a Kiwi.com deep link with affiliate tracking.
 * Affiliate program: https://tequila.kiwi.com/
 *
 * @param {object} params
 */
function buildKiwiLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass }) {
  const affilidParam = AFFILIATE_IDS.kiwi ? `&affilid=${AFFILIATE_IDS.kiwi}` : '';
  const returnParam = dateTo ? `/${toCompactDate(dateTo)}` : '';
  const cabin = String(cabinClass || 'economy').toLowerCase();
  const url = new URL(
    `https://www.kiwi.com/en/search/results/${encodeURIComponent(origin)}/${encodeURIComponent(destinationIata)}/${toCompactDate(dateFrom)}${returnParam}`
  );
  url.searchParams.set('adults', String(Number(travellers) || 1));
  url.searchParams.set('cabinClass', cabin);
  url.searchParams.set('currency', 'EUR');
  if (AFFILIATE_IDS.kiwi) url.searchParams.set('affilid', AFFILIATE_IDS.kiwi);
  url.searchParams.set('utm_source', SITE_NAME);
  url.searchParams.set('utm_medium', 'affiliate');
  url.searchParams.set('utm_campaign', 'flight_opportunity');
  return url.toString();
}

/**
 * Build a Skyscanner deep link with affiliate tracking.
 * Affiliate program: https://www.partners.skyscanner.net/
 *
 * @param {object} params
 */
function buildSkyscannerLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass }) {
  const outbound = toCompactDate(dateFrom);
  const inbound = dateTo ? toCompactDate(dateTo) : '';
  const pathSegments = [origin.toLowerCase(), destinationIata.toLowerCase(), outbound];
  if (inbound) pathSegments.push(inbound);
  const url = new URL(`https://www.skyscanner.it/transport/flights/${pathSegments.join('/')}/`);
  url.searchParams.set('adults', String(Number(travellers) || 1));
  url.searchParams.set('cabinclass', toSkyscannerCabin(cabinClass));
  url.searchParams.set('currency', 'EUR');
  url.searchParams.set('market', 'IT');
  url.searchParams.set('locale', 'it-IT');
  if (AFFILIATE_IDS.skyscanner) url.searchParams.set('associateid', AFFILIATE_IDS.skyscanner);
  url.searchParams.set('utm_source', SITE_NAME);
  url.searchParams.set('utm_medium', 'affiliate');
  url.searchParams.set('utm_campaign', 'flight_opportunity');
  return url.toString();
}

/**
 * Build a Travelpayouts / Aviasales deep link.
 * Affiliate program: https://www.travelpayouts.com/
 *
 * @param {object} params
 */
function buildTravelpayoutsLink({ origin, destinationIata, dateFrom, dateTo, travellers }) {
  const depart = toDmyDate(dateFrom);
  const returnDate = dateTo ? toDmyDate(dateTo) : '';
  const url = new URL('https://tp.media/click');
  if (AFFILIATE_IDS.travelpayouts) url.searchParams.set('marker', AFFILIATE_IDS.travelpayouts);
  url.searchParams.set('p', '4304'); // Aviasales white-label product ID
  url.searchParams.set('from', origin.toUpperCase());
  url.searchParams.set('to', destinationIata.toUpperCase());
  url.searchParams.set('depart_date', depart);
  if (returnDate) url.searchParams.set('return_date', returnDate);
  url.searchParams.set('adults', String(Number(travellers) || 1));
  url.searchParams.set('currency', 'eur');
  url.searchParams.set('utm_source', SITE_NAME);
  url.searchParams.set('utm_medium', 'affiliate');
  return url.toString();
}

/**
 * Build a Booking.com flights deep link.
 * Affiliate program: https://www.booking.com/affiliate-program/
 *
 * @param {object} params
 */
function buildBookingComLink({ origin, destinationIata, dateFrom, dateTo, travellers }) {
  const url = new URL(`https://www.booking.com/flights/${origin.toLowerCase()}/${destinationIata.toLowerCase()}.html`);
  if (AFFILIATE_IDS.booking) url.searchParams.set('aid', AFFILIATE_IDS.booking);
  url.searchParams.set('from_code', origin.toUpperCase());
  url.searchParams.set('to_code', destinationIata.toUpperCase());
  url.searchParams.set('depart_date', dateFrom);
  if (dateTo) url.searchParams.set('ret_date', dateTo);
  url.searchParams.set('adults', String(Number(travellers) || 1));
  url.searchParams.set('currency', 'EUR');
  url.searchParams.set('utm_source', SITE_NAME);
  url.searchParams.set('utm_medium', 'affiliate');
  url.searchParams.set('utm_campaign', 'flight_opportunity');
  return url.toString();
}

/**
 * Build an affiliate booking link for the given partner.
 *
 * @param {object} params
 * @param {'kiwi'|'skyscanner'|'travelpayouts'|'booking'|string} [params.partner]
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
  const selectedPartner = SUPPORTED_PARTNERS.includes(partner)
    ? partner
    : SUPPORTED_PARTNERS.includes(DEFAULT_PARTNER)
    ? DEFAULT_PARTNER
    : 'kiwi';

  let url;
  switch (selectedPartner) {
    case 'skyscanner':
      url = buildSkyscannerLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass });
      break;
    case 'travelpayouts':
      url = buildTravelpayoutsLink({ origin, destinationIata, dateFrom, dateTo, travellers });
      break;
    case 'booking':
      url = buildBookingComLink({ origin, destinationIata, dateFrom, dateTo, travellers });
      break;
    default:
      url = buildKiwiLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass });
  }

  return { url, partner: selectedPartner };
}

/**
 * Build links for ALL supported partners (useful for showing comparison CTAs).
 *
 * @param {object} params
 * @returns {Array<{ partner: string, url: string, hasAffiliateId: boolean }>}
 */
export function buildAllAffiliateLinks({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass }) {
  return SUPPORTED_PARTNERS.map((partner) => {
    const { url } = buildAffiliateLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass, partner });
    return { partner, url, hasAffiliateId: Boolean(AFFILIATE_IDS[partner]) };
  });
}

/**
 * Returns the configured partner for health-check / admin visibility.
 */
export function getAffiliateConfig() {
  return {
    defaultPartner: DEFAULT_PARTNER,
    configuredPartners: SUPPORTED_PARTNERS.filter((p) => Boolean(AFFILIATE_IDS[p])),
    siteName: SITE_NAME
  };
}
