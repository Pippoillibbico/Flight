import type { AdminTelemetryEventPayload, AdminTelemetryEventType } from '../types/index.ts';

const TELEMETRY_EVENT_TYPES: AdminTelemetryEventType[] = [
  'result_interaction_clicked',
  'itinerary_opened',
  'booking_clicked',
  'upgrade_cta_clicked',
  'elite_cta_clicked',
  'upgrade_modal_opened',
  'elite_modal_opened',
  'upgrade_primary_cta_clicked',
  'radar_activated'
];

function normalizeText(value: unknown, maxLength: number): string {
  const text = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>\u2028\u2029]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.slice(0, maxLength);
}

function normalizeEventType(value: unknown): AdminTelemetryEventType | null {
  const text = normalizeText(value, 80).toLowerCase() as AdminTelemetryEventType;
  return TELEMETRY_EVENT_TYPES.includes(text) ? text : null;
}

function normalizePlanType(value: unknown): 'free' | 'pro' | 'elite' | undefined {
  const text = normalizeText(value, 16).toLowerCase();
  if (text === 'elite' || text === 'creator') return 'elite';
  if (text === 'pro') return 'pro';
  if (text === 'free') return 'free';
  return undefined;
}

function normalizeVersion(value: unknown, fallbackValue: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function normalizeEventId(value: unknown): string | undefined {
  const text = normalizeText(value, 80).toLowerCase();
  if (!text) return undefined;
  if (!/^[a-z0-9_-]{8,80}$/.test(text)) return undefined;
  return text;
}

function normalizeSourceContext(value: unknown): 'web_app' | 'admin_backoffice' | 'api_client' {
  const text = normalizeText(value, 40).toLowerCase();
  if (text === 'admin_backoffice') return 'admin_backoffice';
  if (text === 'api_client') return 'api_client';
  return 'web_app';
}

export function mapFunnelEventToAdminTelemetry(detail: unknown): AdminTelemetryEventPayload | null {
  const eventType = normalizeEventType((detail as { eventType?: unknown })?.eventType);
  if (!eventType) return null;
  return {
    eventType,
    at: normalizeText((detail as { at?: unknown })?.at, 64) || undefined,
    eventId: normalizeEventId((detail as { eventId?: unknown })?.eventId),
    eventVersion: normalizeVersion((detail as { eventVersion?: unknown })?.eventVersion, 1),
    schemaVersion: normalizeVersion((detail as { schemaVersion?: unknown })?.schemaVersion, 2),
    sourceContext: normalizeSourceContext((detail as { sourceContext?: unknown })?.sourceContext),
    action: normalizeText((detail as { action?: unknown })?.action, 80) || undefined,
    surface: normalizeText((detail as { surface?: unknown })?.surface, 80) || undefined,
    itineraryId: normalizeText((detail as { itineraryId?: unknown })?.itineraryId, 120) || undefined,
    correlationId: normalizeText((detail as { correlationId?: unknown })?.correlationId, 180) || undefined,
    routeSlug: normalizeText((detail as { extra?: { routeSlug?: unknown } })?.extra?.routeSlug, 120) || undefined
  };
}

export function mapUpgradeEventToAdminTelemetry(detail: unknown): AdminTelemetryEventPayload | null {
  const eventType = normalizeEventType((detail as { eventType?: unknown })?.eventType);
  if (!eventType) return null;
  return {
    eventType,
    at: normalizeText((detail as { at?: unknown })?.at, 64) || undefined,
    eventId: normalizeEventId((detail as { eventId?: unknown })?.eventId),
    eventVersion: normalizeVersion((detail as { eventVersion?: unknown })?.eventVersion, 1),
    schemaVersion: normalizeVersion((detail as { schemaVersion?: unknown })?.schemaVersion, 2),
    sourceContext: normalizeSourceContext((detail as { sourceContext?: unknown })?.sourceContext),
    source: normalizeText((detail as { source?: unknown })?.source, 120) || undefined,
    planType: normalizePlanType((detail as { planType?: unknown })?.planType)
  };
}
