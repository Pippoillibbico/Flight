import type { BookingHandoffContext, BookingItineraryInput, BookingProviderConfig } from '../types/index.ts';

function normalizeIata(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function normalizeDate(value: string): string {
  return String(value || '').trim();
}

function normalizePositiveInt(value: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

export function buildBookingLink(
  provider: BookingProviderConfig,
  itinerary: BookingItineraryInput,
  context: BookingHandoffContext
): string {
  const resolvePath = String(provider.resolvePath || '/api/outbound/resolve').trim() || '/api/outbound/resolve';

  if (provider.type === 'direct') {
    const directLink = String(itinerary.bookingLink || '').trim();
    if (!/^https?:\/\//i.test(directLink)) {
      throw new Error('Direct provider requires a valid absolute booking link.');
    }
    return directLink;
  }

  const origin = normalizeIata(itinerary.origin);
  const destinationIata = normalizeIata(itinerary.destinationIata);
  const dateFrom = normalizeDate(itinerary.dateFrom);
  const dateTo = normalizeDate(itinerary.dateTo || '');
  if (!/^[A-Z]{3}$/.test(origin)) throw new Error('Booking handoff requires a valid origin IATA code.');
  if (!/^[A-Z]{3}$/.test(destinationIata)) throw new Error('Booking handoff requires a valid destination IATA code.');
  if (!dateFrom) throw new Error('Booking handoff requires a departure date.');

  const params = new URLSearchParams();
  params.set('partner', provider.partner);
  params.set('surface', context.surface);
  if (itinerary.itineraryId) params.set('itineraryId', String(itinerary.itineraryId).trim());
  params.set('origin', origin);
  params.set('destinationIata', destinationIata);
  if (itinerary.destination) params.set('destination', String(itinerary.destination).trim());
  params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  params.set('travellers', String(normalizePositiveInt(itinerary.travellers, 1)));
  params.set('cabinClass', String(itinerary.cabinClass || 'economy').trim().toLowerCase());

  const stopCount = Number(itinerary.stopCount);
  if (Number.isFinite(stopCount)) params.set('stopCount', String(Math.max(0, Math.round(stopCount))));

  const comfortScore = Number(itinerary.comfortScore);
  if (Number.isFinite(comfortScore)) params.set('comfortScore', String(Math.max(1, Math.min(100, Math.round(comfortScore)))));

  if (itinerary.connectionType) params.set('connectionType', String(itinerary.connectionType).trim());
  if (itinerary.travelTime) params.set('travelTime', String(itinerary.travelTime).trim());
  if (context.utm?.utmSource) params.set('utmSource', String(context.utm.utmSource));
  if (context.utm?.utmMedium) params.set('utmMedium', String(context.utm.utmMedium));
  if (context.utm?.utmCampaign) params.set('utmCampaign', String(context.utm.utmCampaign));
  if (context.correlationId) params.set('correlationId', String(context.correlationId).trim());

  return `${resolvePath}?${params.toString()}`;
}
