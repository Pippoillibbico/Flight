import assert from 'node:assert/strict';
import test from 'node:test';

import { createFunnelTracker } from '../../src/features/funnel-tracking/index.ts';

test('funnel tracker dispatches normalized event with timestamp', () => {
  const dispatched: Array<{ eventName: string; detail: Record<string, unknown> }> = [];
  const tracker = createFunnelTracker({
    dispatcher: {
      dispatchEvent(eventName, detail) {
        dispatched.push({ eventName, detail: detail as unknown as Record<string, unknown> });
      }
    }
  });

  tracker.track({
    eventType: 'search_submitted',
    searchMode: 'multi_city',
    extra: { multiCitySegments: 3 }
  });

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.eventName, 'flight_funnel_event');
  assert.equal(dispatched[0]?.detail.eventType, 'search_submitted');
  assert.equal(dispatched[0]?.detail.searchMode, 'multi_city');
  assert.equal((dispatched[0]?.detail.extra as { multiCitySegments?: number })?.multiCitySegments, 3);
  assert.ok(typeof dispatched[0]?.detail.at === 'string' && String(dispatched[0]?.detail.at).length > 0);
  assert.equal(dispatched[0]?.detail.sourceContext, 'web_app');
  assert.equal(dispatched[0]?.detail.schemaVersion, 2);
  assert.equal(dispatched[0]?.detail.eventVersion, 1);
  assert.equal(typeof dispatched[0]?.detail.eventId, 'string');
  assert.equal(/^[a-z0-9_-]{8,80}$/i.test(String(dispatched[0]?.detail.eventId || '')), true);
});

test('funnel tracker swallows dispatcher errors by design', () => {
  const tracker = createFunnelTracker({
    dispatcher: {
      dispatchEvent() {
        throw new Error('dispatcher failed');
      }
    }
  });

  assert.doesNotThrow(() =>
    tracker.track({
      eventType: 'search_failed',
      searchMode: 'single',
      errorCode: '500'
    })
  );
});

test('funnel tracker emits to additional sinks and swallows async sink failures', () => {
  const emitted: Array<{ eventType?: string; searchMode?: string }> = [];
  const tracker = createFunnelTracker({
    dispatcher: null,
    sinks: [
      {
        emit(event) {
          emitted.push({ eventType: event.eventType, searchMode: event.searchMode });
        }
      },
      {
        emit() {
          return Promise.reject(new Error('async sink failed'));
        }
      }
    ]
  });

  assert.doesNotThrow(() =>
    tracker.track({
      eventType: 'results_rendered',
      searchMode: 'single',
      resultCount: 2
    })
  );

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.eventType, 'results_rendered');
  assert.equal(emitted[0]?.searchMode, 'single');
});

test('funnel tracker deduplicates identical events in a short window', () => {
  const emitted: Array<{ eventType?: string; action?: string; surface?: string }> = [];
  const tracker = createFunnelTracker({
    dispatcher: null,
    dedupeWindowMs: 2_000,
    sinks: [
      {
        emit(event) {
          emitted.push({
            eventType: event.eventType,
            action: event.action,
            surface: event.surface
          });
        }
      }
    ]
  });

  tracker.track({
    eventType: 'result_interaction_clicked',
    searchMode: 'single',
    action: 'track_route',
    surface: 'search_results'
  });
  tracker.track({
    eventType: 'result_interaction_clicked',
    searchMode: 'single',
    action: 'track_route',
    surface: 'search_results'
  });

  assert.equal(emitted.length, 1);
});
