import type { BookingItineraryInput, BookingProviderConfig, BookingProviderType } from '../types/index.ts';

function sortProviders(providers: BookingProviderConfig[]): BookingProviderConfig[] {
  return [...providers].sort((a, b) => a.priority - b.priority || a.type.localeCompare(b.type));
}

export function selectBookingProvider(
  providers: BookingProviderConfig[],
  itinerary: BookingItineraryInput,
  preferredProviderType?: BookingProviderType
): BookingProviderConfig {
  const enabled = sortProviders((Array.isArray(providers) ? providers : []).filter((item) => item.enabled));
  if (!enabled.length) throw new Error('No booking provider is enabled.');

  if (preferredProviderType) {
    const preferred = enabled.find((item) => item.type === preferredProviderType);
    if (preferred) return preferred;
  }

  const hasDirectLink = /^https?:\/\//i.test(String(itinerary.bookingLink || '').trim());
  if (hasDirectLink) {
    const direct = enabled.find((item) => item.type === 'direct');
    if (direct) return direct;
  }

  const fallback = enabled[0];
  if (!fallback) throw new Error('No booking provider is enabled.');
  return fallback;
}
