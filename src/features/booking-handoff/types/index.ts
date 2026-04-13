export type BookingProviderType = 'affiliate' | 'white_label' | 'direct';

export type BookingSurface = 'top_picks' | 'results' | 'insights' | 'compare' | 'watchlist' | 'opportunity_detail';

export interface BookingProviderConfig {
  type: BookingProviderType;
  partner: string;
  enabled: boolean;
  priority: number;
  resolvePath?: string;
}

export interface BookingUtmContext {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export interface BookingItineraryInput {
  itineraryId?: string;
  origin: string;
  destinationIata: string;
  destination?: string;
  dateFrom: string;
  dateTo?: string;
  travellers: number;
  cabinClass: string;
  stopCount?: number;
  comfortScore?: number;
  connectionType?: string;
  travelTime?: string;
  bookingLink?: string;
}

export interface BookingHandoffContext {
  surface: BookingSurface;
  preferredProviderType?: BookingProviderType;
  utm?: BookingUtmContext;
  correlationId?: string;
}

export interface BookingClickedEvent {
  eventName: 'booking_clicked';
  correlationId: string;
  itineraryId?: string;
  providerType: BookingProviderType;
  partner: string;
  url: string;
  surface: BookingSurface;
  origin: string;
  destinationIata: string;
  destination: string;
  stopCount?: number;
  comfortScore?: number;
  connectionType?: string;
  travelTime?: string;
}

export interface BookingHandoffResult {
  correlationId: string;
  url: string;
  providerType: BookingProviderType;
  partner: string;
  event: BookingClickedEvent;
}

export interface BookingTrackerApiClient {
  outboundClick: (payload: Record<string, unknown>) => Promise<unknown>;
}
