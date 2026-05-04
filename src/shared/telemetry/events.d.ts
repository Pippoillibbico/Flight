export declare const TELEMETRY_EVENTS: Readonly<{
  SEARCH_SUBMITTED: 'search_submitted';
  RESULTS_RENDERED: 'results_rendered';
  OPPORTUNITY_OPENED: 'opportunity_opened';
  RADAR_ACTIVATED: 'radar_activated';
  UPGRADE_CLICKED: 'upgrade_clicked';
  CHECKOUT_STARTED: 'checkout_started';
  CHECKOUT_COMPLETED: 'checkout_completed';
  BOOKING_CLICKED: 'booking_clicked';
  OUTBOUND_REDIRECT_SUCCEEDED: 'outbound_redirect_succeeded';
  OUTBOUND_REDIRECT_FAILED: 'outbound_redirect_failed';
}>;

export declare const TELEMETRY_EVENT_LEGACY_ALIASES: Readonly<Record<string, string>>;

export declare function resolveTelemetryEventType(type: unknown): string;

export declare function isKnownTelemetryEvent(type: unknown): boolean;
