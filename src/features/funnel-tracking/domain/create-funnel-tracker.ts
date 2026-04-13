import type { FunnelTrackingEvent } from '../types/index.ts';
import { isConsentGiven } from '../../../utils/cookieConsent.js';

interface FunnelEventDispatcher {
  dispatchEvent: (eventName: string, detail: FunnelTrackingEvent) => void;
}

export interface FunnelEventSink {
  emit: (event: FunnelTrackingEvent) => void | Promise<void>;
}

function defaultDispatcher(): FunnelEventDispatcher | null {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return null;
  return {
    dispatchEvent(eventName, detail) {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
  };
}

const DEFAULT_SOURCE_CONTEXT = 'web_app';
const DEFAULT_SCHEMA_VERSION = 2;
const DEFAULT_EVENT_VERSION = 1;
const DEFAULT_DEDUPE_WINDOW_MS = 1_200;
const MAX_DEDUPE_CACHE_ITEMS = 500;

function sanitizePositiveInteger(value: unknown, fallbackValue: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function sanitizeEventId(value: unknown): string | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (!/^[a-z0-9_-]{8,80}$/.test(normalized)) return undefined;
  return normalized;
}

function normalizeEvent(
  event: FunnelTrackingEvent,
  nextEventId: () => string
): FunnelTrackingEvent {
  return {
    ...event,
    at: event.at || new Date().toISOString(),
    eventId: sanitizeEventId(event.eventId) || nextEventId(),
    eventVersion: sanitizePositiveInteger(event.eventVersion, DEFAULT_EVENT_VERSION),
    schemaVersion: sanitizePositiveInteger(event.schemaVersion, DEFAULT_SCHEMA_VERSION),
    sourceContext: event.sourceContext || DEFAULT_SOURCE_CONTEXT
  };
}

function toDispatcherSink(dispatcher: FunnelEventDispatcher | null): FunnelEventSink | null {
  if (!dispatcher) return null;
  return {
    emit(event) {
      dispatcher.dispatchEvent('flight_funnel_event', event);
    }
  };
}

function safeSinks(sinks: FunnelEventSink[]): FunnelEventSink[] {
  return (Array.isArray(sinks) ? sinks : []).filter((sink) => typeof sink?.emit === 'function');
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<unknown>).then === 'function';
}

function emitSafely(sink: FunnelEventSink, event: FunnelTrackingEvent): void {
  try {
    const maybePromise = sink.emit(event);
    if (isPromiseLike(maybePromise)) {
      void maybePromise.catch(() => {
        // no-op by design
      });
    }
  } catch {
    // no-op by design
  }
}

function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return true;
  return isConsentGiven('analytics');
}

function buildDedupeFingerprint(event: FunnelTrackingEvent): string {
  let extraSerialized = '';
  if (event.extra && typeof event.extra === 'object') {
    try {
      extraSerialized = JSON.stringify(event.extra) || '';
    } catch {
      extraSerialized = '';
    }
  }
  return [
    event.eventType,
    event.searchMode || '',
    event.action || '',
    event.surface || '',
    event.itineraryId || '',
    event.correlationId || '',
    event.errorCode || '',
    String(event.resultCount ?? ''),
    event.sourceContext || '',
    extraSerialized || ''
  ].join('|');
}

export function createFunnelTracker({
  dispatcher = defaultDispatcher(),
  sinks = [],
  dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS
}: {
  dispatcher?: FunnelEventDispatcher | null;
  sinks?: FunnelEventSink[];
  dedupeWindowMs?: number;
} = {}) {
  const dispatcherSink = toDispatcherSink(dispatcher);
  const resolvedSinks = safeSinks([
    ...safeSinks(sinks),
    ...(dispatcherSink ? [dispatcherSink] : [])
  ]);
  const dedupeCache = new Map<string, number>();
  const safeDedupeWindowMs = Math.max(0, Number(dedupeWindowMs) || 0);
  let sequence = 0;

  function nextEventId(): string {
    sequence = (sequence + 1) % 1_000_000;
    return `fne_${Date.now().toString(36)}_${sequence.toString(36).padStart(3, '0')}`;
  }

  function shouldDropDuplicate(event: FunnelTrackingEvent): boolean {
    if (safeDedupeWindowMs <= 0) return false;
    const now = Date.now();
    const fingerprint = buildDedupeFingerprint(event);
    const lastTs = dedupeCache.get(fingerprint);
    dedupeCache.set(fingerprint, now);

    if (dedupeCache.size > MAX_DEDUPE_CACHE_ITEMS) {
      for (const [key, timestamp] of dedupeCache.entries()) {
        if (now - timestamp > safeDedupeWindowMs) dedupeCache.delete(key);
      }
      if (dedupeCache.size > MAX_DEDUPE_CACHE_ITEMS) {
        const firstKey = dedupeCache.keys().next().value;
        if (firstKey) dedupeCache.delete(firstKey);
      }
    }

    return typeof lastTs === 'number' && now - lastTs <= safeDedupeWindowMs;
  }

  return {
    track(event: FunnelTrackingEvent): void {
      if (!hasAnalyticsConsent()) return;
      const normalized = normalizeEvent(event, nextEventId);
      if (shouldDropDuplicate(normalized)) return;
      for (const sink of resolvedSinks) emitSafely(sink, normalized);
    }
  };
}
