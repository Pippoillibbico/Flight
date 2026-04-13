import type { UpgradeTrackingEvent, UpgradeTrackingEventType, UpgradePlanType } from '../types/index.ts';
import { sanitizeUpgradeSource } from './sanitize-upgrade-source.ts';
import { isConsentGiven } from '../../../utils/cookieConsent.js';

interface UpgradeTrackingDispatcher {
  dispatchEvent: (eventName: string, detail: UpgradeTrackingEvent) => void;
}

const defaultDispatcher: UpgradeTrackingDispatcher = {
  dispatchEvent(eventName, detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
};

const DEFAULT_SOURCE_CONTEXT = 'web_app' as const;
const DEFAULT_SCHEMA_VERSION = 2;
const DEFAULT_EVENT_VERSION = 1;
const DEFAULT_DEDUPE_WINDOW_MS = 1_200;
const MAX_DEDUPE_CACHE_ITEMS = 200;

function buildTrackingEvent(eventType: UpgradeTrackingEventType, planType: UpgradePlanType, source?: string): UpgradeTrackingEvent {
  return {
    eventType,
    planType,
    source: sanitizeUpgradeSource(source),
    at: new Date().toISOString()
  };
}

function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return true;
  return isConsentGiven('analytics');
}

export function createUpgradeIntentTracker(dispatcher: UpgradeTrackingDispatcher = defaultDispatcher) {
  const recent = new Map<string, number>();
  let sequence = 0;

  function nextEventId(): string {
    sequence = (sequence + 1) % 1_000_000;
    return `upe_${Date.now().toString(36)}_${sequence.toString(36).padStart(3, '0')}`;
  }

  function shouldDropDuplicate(event: UpgradeTrackingEvent): boolean {
    const now = Date.now();
    const key = [event.eventType, event.planType, event.source || ''].join('|');
    const previous = recent.get(key);
    recent.set(key, now);
    for (const [candidateKey, timestamp] of recent.entries()) {
      if (now - timestamp > DEFAULT_DEDUPE_WINDOW_MS) recent.delete(candidateKey);
    }
    if (recent.size > MAX_DEDUPE_CACHE_ITEMS) {
      const firstKey = recent.keys().next().value;
      if (firstKey) recent.delete(firstKey);
    }
    return typeof previous === 'number' && now - previous <= DEFAULT_DEDUPE_WINDOW_MS;
  }

  return {
    track(eventType: UpgradeTrackingEventType, planType: UpgradePlanType, source?: string): void {
      if (!hasAnalyticsConsent()) return;
      try {
        const event = {
          ...buildTrackingEvent(eventType, planType, source),
          sourceContext: DEFAULT_SOURCE_CONTEXT,
          schemaVersion: DEFAULT_SCHEMA_VERSION,
          eventVersion: DEFAULT_EVENT_VERSION,
          eventId: nextEventId()
        };
        if (shouldDropDuplicate(event)) return;
        dispatcher.dispatchEvent('flight_upgrade_event', event);
      } catch {
        // Tracking must never block UI interactions.
      }
    }
  };
}
