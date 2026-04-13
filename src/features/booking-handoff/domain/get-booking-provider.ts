import type { BookingItineraryInput, BookingProviderConfig, BookingProviderType } from '../types/index.ts';
import { selectBookingProvider } from './provider-selection.ts';

export function getBookingProvider(
  providers: BookingProviderConfig[],
  itinerary: BookingItineraryInput,
  preferredProviderType?: BookingProviderType
): BookingProviderConfig {
  return selectBookingProvider(providers, itinerary, preferredProviderType);
}
