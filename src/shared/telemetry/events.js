export const TELEMETRY_EVENTS = Object.freeze({
  SEARCH_SUBMITTED: 'search_submitted',
  RESULTS_RENDERED: 'results_rendered',
  OPPORTUNITY_OPENED: 'opportunity_opened',
  RADAR_ACTIVATED: 'radar_activated',
  UPGRADE_CLICKED: 'upgrade_clicked',
  CHECKOUT_STARTED: 'checkout_started',
  CHECKOUT_COMPLETED: 'checkout_completed',
  BOOKING_CLICKED: 'booking_clicked',
  OUTBOUND_REDIRECT_SUCCEEDED: 'outbound_redirect_succeeded',
  OUTBOUND_REDIRECT_FAILED: 'outbound_redirect_failed'
});

export const TELEMETRY_EVENT_LEGACY_ALIASES = Object.freeze({
  deal_opened: TELEMETRY_EVENTS.OPPORTUNITY_OPENED,
  itinerary_opened: TELEMETRY_EVENTS.OPPORTUNITY_OPENED,
  outbound_clicked: TELEMETRY_EVENTS.BOOKING_CLICKED,
  upgrade_started: TELEMETRY_EVENTS.CHECKOUT_STARTED,
  upgrade_completed: TELEMETRY_EVENTS.CHECKOUT_COMPLETED,
  upgrade_cta_clicked: TELEMETRY_EVENTS.UPGRADE_CLICKED,
  elite_cta_clicked: TELEMETRY_EVENTS.UPGRADE_CLICKED
});

export function resolveTelemetryEventType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (!normalized) return '';
  if (Object.values(TELEMETRY_EVENTS).includes(normalized)) return normalized;
  return TELEMETRY_EVENT_LEGACY_ALIASES[normalized] || normalized;
}

export function isKnownTelemetryEvent(type) {
  const resolved = resolveTelemetryEventType(type);
  return Object.values(TELEMETRY_EVENTS).includes(resolved);
}
