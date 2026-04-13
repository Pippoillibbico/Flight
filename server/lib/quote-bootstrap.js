import { createHash } from 'node:crypto';
import { logger as rootLogger } from './logger.js';
import { listPublishedOpportunities } from './opportunity-store.js';
import { createQuoteStorage } from './scan/quote-storage.js';

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function toIsoOrNow(value) {
  const text = String(value || '').trim();
  if (!text) return new Date().toISOString();
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function normalizeIata(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeTripType(value, returnDate) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'one_way') return 'one_way';
  if (text === 'round_trip') return 'round_trip';
  return returnDate ? 'round_trip' : 'one_way';
}

function normalizeProvider(value) {
  const out = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return out || 'opportunity_seed';
}

function buildFingerprint(parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function mapOpportunityToQuote(row) {
  const originIata = normalizeIata(row?.origin_airport);
  const destinationIata = normalizeIata(row?.destination_airport);
  const departureDate = String(row?.depart_date || '').trim().slice(0, 10);
  const returnDate = row?.return_date ? String(row.return_date).trim().slice(0, 10) : null;
  const totalPrice = toNumber(row?.price, NaN);
  const currency = String(row?.currency || 'EUR').trim().toUpperCase() || 'EUR';
  const observedAt = toIsoOrNow(row?.published_at || row?.updated_at || row?.created_at);
  const tripType = normalizeTripType(row?.trip_type, returnDate);

  if (!/^[A-Z]{3}$/.test(originIata) || !/^[A-Z]{3}$/.test(destinationIata)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) return null;
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) return null;
  if (tripType === 'round_trip' && (!returnDate || !/^\d{4}-\d{2}-\d{2}$/.test(returnDate))) return null;
  if (tripType === 'one_way' && returnDate) return null;

  const rawStops = row?.stops;
  const rawDuration = row?.travel_duration_minutes;
  const stopsValue = rawStops == null || String(rawStops).trim() === '' ? NaN : Number(rawStops);
  const durationValue = rawDuration == null || String(rawDuration).trim() === '' ? NaN : Number(rawDuration);
  const stops = Number.isFinite(stopsValue) && stopsValue >= 0 ? Math.floor(stopsValue) : null;
  const durationMinutes = Number.isFinite(durationValue) && durationValue > 0 ? Math.floor(durationValue) : null;
  const baggageRaw = row?.baggage_included;
  const baggageIncluded = baggageRaw == null ? null : Boolean(baggageRaw);
  const bookable = String(row?.booking_url || '').trim().toLowerCase().startsWith('http');

  const provider = normalizeProvider(row?.airline);
  const fingerprint = buildFingerprint([
    String(row?.id || ''),
    originIata,
    destinationIata,
    departureDate,
    returnDate || '',
    currency,
    Number(totalPrice).toFixed(2),
    stops == null ? 'na' : String(stops),
    durationMinutes == null ? 'na' : String(durationMinutes),
    observedAt
  ]);

  return {
    originIata,
    destinationIata,
    departureDate,
    returnDate,
    tripType,
    cabinClass: 'economy',
    adults: 1,
    currency,
    totalPrice,
    provider,
    providerOfferId: row?.id ? String(row.id) : null,
    stops,
    durationMinutes,
    baggageIncluded,
    isBookable: bookable,
    observedAt,
    source: 'opportunity_bootstrap',
    fingerprint,
    metadata: {
      bootstrap: true,
      opportunityId: row?.id ? String(row.id) : null,
      opportunityLevel: row?.opportunity_level || null,
      finalScore: row?.final_score == null ? null : toNumber(row.final_score, null),
      bookingUrl: row?.booking_url || null
    }
  };
}

export async function bootstrapFlightQuotesFromPublishedOpportunities({
  limit = Number(process.env.CORE_QUOTES_BOOTSTRAP_LIMIT || 500),
  listPublishedOpportunitiesFn = listPublishedOpportunities,
  quoteStorage = createQuoteStorage(),
  logger = rootLogger
} = {}) {
  const safeLimit = Math.max(50, Math.min(5000, Number(limit) || 500));
  const rows = await listPublishedOpportunitiesFn({ limit: safeLimit });
  const quotes = (Array.isArray(rows) ? rows : []).map(mapOpportunityToQuote).filter(Boolean);

  if (quotes.length === 0) {
    return {
      attempted: true,
      source: 'travel_opportunities',
      requestedLimit: safeLimit,
      opportunitiesFetched: Array.isArray(rows) ? rows.length : 0,
      mappedQuotes: 0,
      processedCount: 0,
      insertedCount: 0,
      dedupedCount: 0,
      failedCount: 0,
      skipped: true,
      reason: 'no_bootstrap_candidates'
    };
  }

  const stored = await quoteStorage.saveQuotes(quotes, { scanRunId: 'quote_bootstrap_from_opportunities' });
  const result = {
    attempted: true,
    source: 'travel_opportunities',
    requestedLimit: safeLimit,
    opportunitiesFetched: Array.isArray(rows) ? rows.length : 0,
    mappedQuotes: quotes.length,
    processedCount: Number(stored.processedCount || 0),
    insertedCount: Number(stored.insertedCount || 0),
    dedupedCount: Number(stored.dedupedCount || 0),
    failedCount: Number(stored.failedCount || 0),
    mode: stored.mode || null,
    skipped: false,
    reason: null
  };

  logger.info(result, 'flight_quotes_bootstrapped_from_published_opportunities');
  return result;
}
