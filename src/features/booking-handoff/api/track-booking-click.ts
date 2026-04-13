import type { BookingClickedEvent, BookingTrackerApiClient } from '../types/index.ts';

interface BookingClickedDispatcher {
  dispatchEvent: (eventName: string, detail: BookingClickedEvent) => void;
}

function defaultDispatcher(): BookingClickedDispatcher | null {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return null;
  return {
    dispatchEvent(eventName, detail) {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
  };
}

function isTrackableByApi(event: BookingClickedEvent): boolean {
  return Boolean(event.partner && event.url && /^\/api\/outbound\/resolve\?/i.test(String(event.url)));
}

function sanitizeText(value: unknown, maxLength: number): string {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.slice(0, Math.max(1, Number(maxLength) || 80));
}

function sanitizeDispatchUrl(url: string): string {
  const raw = sanitizeText(url, 512);
  if (!raw) return '';
  const queryIndex = raw.indexOf('?');
  return sanitizeText(queryIndex >= 0 ? raw.slice(0, queryIndex) : raw, 180);
}

function sanitizeEventForDispatch(event: BookingClickedEvent): BookingClickedEvent {
  const safeOrigin = sanitizeText(event.origin, 3).toUpperCase();
  const safeDestinationIata = sanitizeText(event.destinationIata, 3).toUpperCase();
  const safeDestination = sanitizeText(event.destination, 80);
  const safeCorrelationId = sanitizeText(event.correlationId, 120);
  const safeItineraryId = sanitizeText(event.itineraryId, 120);
  return {
    ...event,
    correlationId: safeCorrelationId || event.correlationId,
    itineraryId: safeItineraryId || event.itineraryId,
    origin: safeOrigin || event.origin,
    destinationIata: safeDestinationIata || event.destinationIata,
    destination: safeDestination || event.destination,
    url: sanitizeDispatchUrl(event.url)
  };
}

export function createBookingClickedTracker({
  apiClient,
  dispatcher = defaultDispatcher()
}: {
  apiClient?: BookingTrackerApiClient;
  dispatcher?: BookingClickedDispatcher | null;
} = {}) {
  return {
    async track(event: BookingClickedEvent): Promise<void> {
      try {
        dispatcher?.dispatchEvent('booking_clicked', sanitizeEventForDispatch(event));
      } catch {
        // no-op by design
      }

      if (!apiClient || !isTrackableByApi(event)) return;

      await apiClient.outboundClick({
        eventName: event.eventName,
        url: event.url,
        correlationId: event.correlationId,
        itineraryId: event.itineraryId
      });
    }
  };
}
