export type FunnelSearchMode = 'single' | 'multi_city';
export type FunnelSourceContext = 'web_app' | 'admin_backoffice' | 'api_client';

export type FunnelInteractionAction =
  | 'book_cta'
  | 'save_watchlist'
  | 'create_alert'
  | 'track_route'
  | 'toggle_compare'
  | 'open_detail'
  | 'load_insights';

export type FunnelInteractionSurface =
  | 'search_results'
  | 'top_picks'
  | 'compare'
  | 'watchlist'
  | 'insights'
  | 'opportunity_detail'
  | 'opportunity_feed';

export type FunnelEventType =
  | 'search_submitted'
  | 'search_validation_blocked'
  | 'search_succeeded'
  | 'search_failed'
  | 'search_retry_clicked'
  | 'results_rendered'
  | 'itinerary_opened'
  | 'booking_clicked'
  | 'outbound_redirect_succeeded'
  | 'outbound_redirect_failed'
  | 'result_interaction_clicked'
  | 'booking_handoff_failed';

export interface FunnelTrackingEvent {
  eventType: FunnelEventType;
  at?: string;
  eventId?: string;
  eventVersion?: number;
  schemaVersion?: number;
  sourceContext?: FunnelSourceContext;
  searchMode?: FunnelSearchMode;
  correlationId?: string;
  resultCount?: number;
  action?: FunnelInteractionAction;
  surface?: FunnelInteractionSurface;
  itineraryId?: string;
  errorCode?: string;
  errorMessage?: string;
  extra?: Record<string, string | number | boolean | null | undefined>;
}
