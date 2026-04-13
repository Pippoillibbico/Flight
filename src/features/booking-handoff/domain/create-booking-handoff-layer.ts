import { buildBookingLink } from './build-booking-link.ts';
import { getBookingProvider } from './get-booking-provider.ts';
import { createDefaultBookingProviders } from '../providers/default-booking-providers.ts';
import type {
  BookingClickedEvent,
  BookingHandoffContext,
  BookingHandoffResult,
  BookingItineraryInput,
  BookingProviderConfig
} from '../types/index.ts';

function normalizeString(value: string | undefined): string {
  return String(value || '').trim();
}

export interface BookingCorrelationIdSeed {
  itinerary: BookingItineraryInput;
  context: BookingHandoffContext;
  issuedAtMs: number;
  sequence: number;
}

export type BookingCorrelationIdFactory = (seed: BookingCorrelationIdSeed) => string;

export interface BookingHandoffLayerOptions {
  now?: () => number;
  correlationIdFactory?: BookingCorrelationIdFactory;
}

function toSlug(value: string | undefined, fallback: string, maxLength = 24): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
  return normalized || fallback;
}

export function createDeterministicBookingCorrelationId(seed: BookingCorrelationIdSeed): string {
  const issuedAtMs = Math.max(0, Math.floor(Number(seed.issuedAtMs) || 0));
  const sequence = Math.max(1, Math.floor(Number(seed.sequence) || 1));
  const itineraryBase = normalizeString(seed.itinerary.itineraryId)
    || `${normalizeString(seed.itinerary.origin)}-${normalizeString(seed.itinerary.destinationIata)}`;
  const itinerarySegment = toSlug(itineraryBase, 'trip', 28);
  const surfaceSegment = toSlug(seed.context.surface, 'surface', 18);
  return `corr_${issuedAtMs.toString(36)}_${sequence.toString(36)}_${surfaceSegment}_${itinerarySegment}`;
}

function normalizeCorrelationId(value: string | undefined): string | null {
  const normalized = String(value || '').trim();
  return normalized ? normalized : null;
}

function buildBookingClickedEvent(
  itinerary: BookingItineraryInput,
  context: BookingHandoffContext,
  result: { providerType: BookingHandoffResult['providerType']; partner: string; url: string; correlationId: string }
): BookingClickedEvent {
  return {
    eventName: 'booking_clicked',
    correlationId: result.correlationId,
    itineraryId: normalizeString(itinerary.itineraryId) || undefined,
    providerType: result.providerType,
    partner: result.partner,
    url: result.url,
    surface: context.surface,
    origin: normalizeString(itinerary.origin).toUpperCase(),
    destinationIata: normalizeString(itinerary.destinationIata).toUpperCase(),
    destination: normalizeString(itinerary.destination || itinerary.destinationIata).trim(),
    stopCount: Number.isFinite(Number(itinerary.stopCount)) ? Math.max(0, Math.round(Number(itinerary.stopCount))) : undefined,
    comfortScore: Number.isFinite(Number(itinerary.comfortScore))
      ? Math.max(1, Math.min(100, Math.round(Number(itinerary.comfortScore))))
      : undefined,
    connectionType: normalizeString(itinerary.connectionType) || undefined,
    travelTime: normalizeString(itinerary.travelTime) || undefined
  };
}

export function createBookingHandoffLayer(
  providers: BookingProviderConfig[] = createDefaultBookingProviders(),
  options: BookingHandoffLayerOptions = {}
) {
  const configuredProviders = Array.isArray(providers) ? [...providers] : [];
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const correlationIdFactory = typeof options.correlationIdFactory === 'function'
    ? options.correlationIdFactory
    : createDeterministicBookingCorrelationId;
  let sequence = 0;

  return {
    generateBookingHandoff(itinerary: BookingItineraryInput, context: BookingHandoffContext): BookingHandoffResult {
      const provider = getBookingProvider(configuredProviders, itinerary, context.preferredProviderType);
      sequence += 1;
      const correlationId = normalizeCorrelationId(context.correlationId)
        || normalizeCorrelationId(
          correlationIdFactory({
            itinerary,
            context,
            issuedAtMs: now(),
            sequence
          })
        )
        || createDeterministicBookingCorrelationId({
          itinerary,
          context,
          issuedAtMs: now(),
          sequence
        });
      const handoffContext: BookingHandoffContext = {
        ...context,
        correlationId
      };
      const url = buildBookingLink(provider, itinerary, handoffContext);
      const event = buildBookingClickedEvent(itinerary, context, {
        providerType: provider.type,
        partner: provider.partner,
        url,
        correlationId
      });
      return {
        correlationId,
        url,
        providerType: provider.type,
        partner: provider.partner,
        event
      };
    }
  };
}
