import { createHash } from 'node:crypto';
import { parseBoolean as parseOptionalBoolean } from '../env-flags.js';

function normalizeIata(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeDate(value) {
  return String(value || '').trim().slice(0, 10);
}

function normalizeCabin(value) {
  return String(value || 'economy').trim().toLowerCase();
}

function toNullableNumber(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function toNullableInt(value) {
  const out = Number(value);
  if (!Number.isFinite(out)) return null;
  return Math.trunc(out);
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function validateQuoteShape(quote) {
  if (!/^[A-Z]{3}$/.test(quote.originIata) || !/^[A-Z]{3}$/.test(quote.destinationIata)) return 'invalid_iata';
  if (quote.originIata === quote.destinationIata) return 'same_origin_destination';
  if (!isDate(quote.departureDate)) return 'invalid_departure_date';
  if (!Number.isFinite(quote.totalPrice) || quote.totalPrice <= 0) return 'invalid_price';
  if (quote.totalPrice < 10 || quote.totalPrice > 20000) return 'outlier_price';
  if (!/^[A-Z]{3}$/.test(quote.currency)) return 'invalid_currency';
  if (!['one_way', 'round_trip'].includes(quote.tripType)) return 'invalid_trip_type';

  if (quote.tripType === 'round_trip') {
    if (!quote.returnDate || !isDate(quote.returnDate)) return 'round_trip_missing_return';
    const from = new Date(`${quote.departureDate}T00:00:00Z`);
    const to = new Date(`${quote.returnDate}T00:00:00Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return 'round_trip_invalid_dates';
  }

  if (quote.tripType === 'one_way' && quote.returnDate) return 'one_way_has_return';
  if (Number.isFinite(quote.stops) && quote.stops > 3) return 'too_many_stops';
  if (Number.isFinite(quote.durationMinutes) && (quote.durationMinutes < 30 || quote.durationMinutes > 48 * 60)) return 'unrealistic_duration';
  if (quote.adults < 1 || quote.adults > 9) return 'invalid_adults';

  return null;
}

function buildFingerprint(quote) {
  const stable = {
    originIata: quote.originIata,
    destinationIata: quote.destinationIata,
    departureDate: quote.departureDate,
    returnDate: quote.returnDate,
    tripType: quote.tripType,
    cabinClass: quote.cabinClass,
    adults: quote.adults,
    currency: quote.currency,
    totalPrice: Number(quote.totalPrice).toFixed(2),
    provider: quote.provider,
    providerOfferId: quote.providerOfferId || null,
    stops: quote.stops,
    durationMinutes: quote.durationMinutes,
    source: quote.source
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function normalizeProviderQuotes({
  offers,
  task,
  scanRunId = null
}) {
  const list = Array.isArray(offers) ? offers : [];
  const baseTask = task && typeof task === 'object' ? task : {};
  const quotes = [];
  const rejectedByReason = {};

  for (const offer of list) {
    const meta = offer?.metadata && typeof offer.metadata === 'object' ? offer.metadata : {};
    const tripType = String(offer?.tripType || (offer?.returnDate ? 'round_trip' : baseTask?.returnDate ? 'round_trip' : 'one_way')).trim().toLowerCase();
    const normalized = {
      originIata: normalizeIata(offer?.originIata || baseTask?.originIata),
      destinationIata: normalizeIata(offer?.destinationIata || baseTask?.destinationIata),
      departureDate: normalizeDate(offer?.departureDate || baseTask?.departureDate),
      returnDate: offer?.returnDate ? normalizeDate(offer.returnDate) : baseTask?.returnDate ? normalizeDate(baseTask.returnDate) : null,
      tripType,
      cabinClass: normalizeCabin(offer?.cabinClass || baseTask?.cabinClass),
      adults: Number.isFinite(Number(offer?.adults)) ? Math.max(1, Math.min(9, Math.floor(Number(offer.adults)))) : Math.max(1, Math.min(9, Math.floor(Number(baseTask?.adults || 1)))),
      currency: String(offer?.currency || 'EUR').trim().toUpperCase(),
      totalPrice: Number(offer?.totalPrice),
      provider: String(offer?.provider || 'provider').trim().toLowerCase(),
      providerOfferId: offer?.providerOfferId || meta.offerId || null,
      stops: toNullableInt(meta.stops ?? meta.totalStops ?? meta.outboundStops),
      durationMinutes: toNullableInt(meta.durationMinutes ?? meta.totalDurationMinutes),
      baggageIncluded: parseOptionalBoolean(meta.baggageIncluded ?? meta.baggage_included ?? meta.includedBaggage, null),
      isBookable: parseOptionalBoolean(offer?.isBookable ?? meta.isBookable, null) ?? true,
      observedAt: offer?.observedAt ? new Date(offer.observedAt).toISOString() : new Date().toISOString(),
      source: String(offer?.source || 'scan_worker').trim().toLowerCase(),
      metadata: {
        ...meta,
        scanTaskId: baseTask?.id || null,
        scanRunId
      }
    };

    const verdict = validateQuoteShape(normalized);
    if (verdict) {
      rejectedByReason[verdict] = Number(rejectedByReason[verdict] || 0) + 1;
      continue;
    }

    normalized.fingerprint = buildFingerprint(normalized);
    quotes.push(normalized);
  }

  return {
    quotes,
    rejectedCount: Object.values(rejectedByReason).reduce((sum, item) => sum + Number(item || 0), 0),
    rejectedByReason
  };
}
