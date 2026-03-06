import { ingestPriceObservation } from './deal-engine-store.js';
import { logger } from './logger.js';

export async function captureUserPriceObservation({
  originIata,
  destinationIata,
  departureDate,
  returnDate = null,
  currency = 'EUR',
  totalPrice,
  provider = 'user_observation',
  cabinClass = 'economy',
  tripType = null,
  source = 'user_search',
  metadata = null
}) {
  try {
    const payload = {
      origin_iata: String(originIata || '').trim().toUpperCase(),
      destination_iata: String(destinationIata || '').trim().toUpperCase(),
      departure_date: String(departureDate || '').slice(0, 10),
      return_date: returnDate ? String(returnDate).slice(0, 10) : null,
      currency: String(currency || 'EUR').trim().toUpperCase(),
      total_price: Number(totalPrice),
      provider: String(provider || 'user_observation').trim(),
      cabin_class: String(cabinClass || 'economy').trim().toLowerCase(),
      trip_type: String(tripType || (returnDate ? 'round_trip' : 'one_way')).trim().toLowerCase(),
      source: String(source || 'user_search').trim().toLowerCase(),
      observed_at: new Date().toISOString(),
      metadata: metadata && typeof metadata === 'object' ? metadata : {}
    };
    return await ingestPriceObservation(payload);
  } catch (error) {
    logger.warn({ err: error?.message || String(error), originIata, destinationIata }, 'capture_user_price_observation_failed');
    return { inserted: false, skipped: true };
  }
}
