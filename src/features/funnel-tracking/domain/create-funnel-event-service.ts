import type {
  FunnelEventType,
  FunnelInteractionAction,
  FunnelInteractionSurface,
  FunnelSearchMode,
  FunnelTrackingEvent
} from '../types/index.ts';

type FunnelEventExtra = Record<string, string | number | boolean | null | undefined>;

type SearchLifecycleEventType =
  | 'search_submitted'
  | 'search_validation_blocked'
  | 'search_succeeded'
  | 'search_failed'
  | 'search_retry_clicked'
  | 'results_rendered';

interface FunnelTrackerLike {
  track: (event: FunnelTrackingEvent) => void;
}

interface BaseTrackingPayload {
  searchMode: string;
  surface?: string;
  correlationId?: unknown;
  itineraryId?: unknown;
  extra?: FunnelEventExtra;
}

interface SearchLifecyclePayload {
  searchMode: string;
  resultCount?: number;
  errorCode?: string;
  errorMessage?: string;
  extra?: FunnelEventExtra;
}

interface OutboundRedirectTrackingPayload extends BaseTrackingPayload {
  errorCode?: string;
  errorMessage?: string;
}

const FALLBACK_SURFACE: FunnelInteractionSurface = 'search_results';
const EXTRA_MAX_KEYS = 12;
const EXTRA_MAX_TEXT_LENGTH = 120;
const ERROR_MAX_TEXT_LENGTH = 180;
const IDENTIFIER_MAX_LENGTH = 120;
const SENSITIVE_EXTRA_KEY_TOKENS = ['email', 'token', 'password', 'secret', 'csrf', 'session', 'prompt', 'cookie', 'auth'];

function sanitizeText(value: unknown, maxLength: number): string {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[<>\u2028\u2029]/g, '')
    .trim();
  if (!normalized) return '';
  return normalized.slice(0, Math.max(1, Number(maxLength) || 80));
}

function normalizeKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function looksSensitiveKey(key: string): boolean {
  return SENSITIVE_EXTRA_KEY_TOKENS.some((token) => key.includes(token));
}

function sanitizeErrorCode(value: unknown): string | undefined {
  const normalized = sanitizeText(value, 64);
  if (!normalized) return undefined;
  const compact = normalized.replace(/[^a-zA-Z0-9_-]/g, '');
  return compact || undefined;
}

function sanitizeErrorMessage(value: unknown): string | undefined {
  const normalized = sanitizeText(value, ERROR_MAX_TEXT_LENGTH);
  if (!normalized) return undefined;
  return normalized.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
}

function sanitizeIdentifier(value: unknown): string | undefined {
  const normalized = sanitizeText(value, IDENTIFIER_MAX_LENGTH);
  return normalized || undefined;
}

function sanitizeExtra(extra: FunnelEventExtra | undefined): FunnelEventExtra | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  const output: FunnelEventExtra = {};
  let used = 0;
  for (const [rawKey, rawValue] of Object.entries(extra)) {
    if (used >= EXTRA_MAX_KEYS) break;
    const key = normalizeKey(rawKey);
    if (!key || looksSensitiveKey(key)) continue;

    if (typeof rawValue === 'string') {
      const value = sanitizeText(rawValue, EXTRA_MAX_TEXT_LENGTH);
      if (!value) continue;
      output[key] = value;
      used += 1;
      continue;
    }
    if (typeof rawValue === 'number') {
      if (!Number.isFinite(rawValue)) continue;
      output[key] = Math.abs(rawValue) > 1_000_000_000 ? Math.sign(rawValue) * 1_000_000_000 : rawValue;
      used += 1;
      continue;
    }
    if (typeof rawValue === 'boolean' || rawValue === null) {
      output[key] = rawValue;
      used += 1;
      continue;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

export function normalizeFunnelSearchMode(value: string): FunnelSearchMode {
  return String(value || '').trim().toLowerCase() === 'multi_city' ? 'multi_city' : 'single';
}

export function normalizeFunnelInteractionSurface(surface: string): FunnelInteractionSurface {
  const value = String(surface || '').trim().toLowerCase();
  if (value === 'results') return 'search_results';
  if (value === 'search_results') return 'search_results';
  if (value === 'top_picks') return 'top_picks';
  if (value === 'compare') return 'compare';
  if (value === 'watchlist') return 'watchlist';
  if (value === 'insights') return 'insights';
  if (value === 'opportunity_detail') return 'opportunity_detail';
  if (value === 'opportunity_feed') return 'opportunity_feed';
  return FALLBACK_SURFACE;
}

function normalizeItineraryId(value: unknown): string | undefined {
  return sanitizeIdentifier(value);
}

function normalizeCorrelationId(value: unknown): string | undefined {
  return sanitizeIdentifier(value);
}

function createEvent(
  eventType: FunnelEventType,
  payload: BaseTrackingPayload,
  patch: Partial<FunnelTrackingEvent> = {}
): FunnelTrackingEvent {
  return {
    eventType,
    searchMode: normalizeFunnelSearchMode(payload.searchMode),
    surface: payload.surface ? normalizeFunnelInteractionSurface(payload.surface) : undefined,
    correlationId: normalizeCorrelationId(payload.correlationId),
    itineraryId: normalizeItineraryId(payload.itineraryId),
    extra: sanitizeExtra(payload.extra),
    ...patch
  };
}

export function createFunnelEventService(tracker: FunnelTrackerLike) {
  return {
    trackSearchLifecycle(eventType: SearchLifecycleEventType, payload: SearchLifecyclePayload): void {
      tracker.track(
        createEvent(eventType, { searchMode: payload.searchMode, extra: payload.extra }, {
          resultCount: payload.resultCount,
          errorCode: sanitizeErrorCode(payload.errorCode),
          errorMessage: sanitizeErrorMessage(payload.errorMessage)
        })
      );
    },
    trackResultInteraction(payload: BaseTrackingPayload & { action: FunnelInteractionAction }): void {
      tracker.track(
        createEvent('result_interaction_clicked', payload, {
          action: payload.action
        })
      );
    },
    trackItineraryOpened(payload: BaseTrackingPayload): void {
      tracker.track(
        createEvent('itinerary_opened', payload, {
          action: 'open_detail'
        })
      );
    },
    trackBookingClicked(payload: BaseTrackingPayload): void {
      tracker.track(
        createEvent('booking_clicked', payload, {
          action: 'book_cta'
        })
      );
    },
    trackOutboundRedirectSucceeded(payload: BaseTrackingPayload): void {
      tracker.track(
        createEvent('outbound_redirect_succeeded', payload, {
          action: 'book_cta'
        })
      );
    },
    trackOutboundRedirectFailed(payload: OutboundRedirectTrackingPayload): void {
      tracker.track(
        createEvent('outbound_redirect_failed', payload, {
          action: 'book_cta',
          errorCode: sanitizeErrorCode(payload.errorCode),
          errorMessage: sanitizeErrorMessage(payload.errorMessage)
        })
      );
    },
    trackBookingHandoffFailed(payload: OutboundRedirectTrackingPayload): void {
      tracker.track(
        createEvent('booking_handoff_failed', payload, {
          action: 'book_cta',
          errorCode: sanitizeErrorCode(payload.errorCode),
          errorMessage: sanitizeErrorMessage(payload.errorMessage)
        })
      );
    }
  };
}
