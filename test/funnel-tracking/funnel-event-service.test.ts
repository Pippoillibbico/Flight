import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFunnelEventService,
  normalizeFunnelInteractionSurface,
  normalizeFunnelSearchMode
} from '../../src/features/funnel-tracking/index.ts';
import type { FunnelTrackingEvent } from '../../src/features/funnel-tracking/index.ts';

test('normalize helpers map UI aliases to canonical tracking values', () => {
  assert.equal(normalizeFunnelSearchMode('multi_city'), 'multi_city');
  assert.equal(normalizeFunnelSearchMode('single'), 'single');
  assert.equal(normalizeFunnelSearchMode('unknown-mode'), 'single');

  assert.equal(normalizeFunnelInteractionSurface('results'), 'search_results');
  assert.equal(normalizeFunnelInteractionSurface('search_results'), 'search_results');
  assert.equal(normalizeFunnelInteractionSurface('opportunity_detail'), 'opportunity_detail');
  assert.equal(normalizeFunnelInteractionSurface('invalid-surface'), 'search_results');
});

test('funnel event service emits booking and redirect events with canonical payload', () => {
  const emitted: FunnelTrackingEvent[] = [];
  const service = createFunnelEventService({
    track(event) {
      emitted.push(event);
    }
  });

  service.trackBookingClicked({
    searchMode: 'single',
    surface: 'results',
    correlationId: 'corr-abc',
    itineraryId: 'flight-1',
    extra: { partner: 'tde_booking' }
  });
  service.trackOutboundRedirectSucceeded({
    searchMode: 'single',
    surface: 'results',
    correlationId: 'corr-abc',
    itineraryId: 'flight-1'
  });
  service.trackOutboundRedirectFailed({
    searchMode: 'single',
    surface: 'results',
    correlationId: 'corr-abc',
    itineraryId: 'flight-1',
    errorCode: 'popup_blocked',
    errorMessage: 'Popup blocked by browser.'
  });

  assert.equal(emitted.length, 3);
  assert.equal(emitted[0]?.eventType, 'booking_clicked');
  assert.equal(emitted[0]?.action, 'book_cta');
  assert.equal(emitted[0]?.surface, 'search_results');
  assert.equal(emitted[0]?.correlationId, 'corr-abc');
  assert.equal(emitted[0]?.itineraryId, 'flight-1');
  assert.equal(emitted[0]?.extra?.partner, 'tde_booking');

  assert.equal(emitted[1]?.eventType, 'outbound_redirect_succeeded');
  assert.equal(emitted[1]?.correlationId, 'corr-abc');
  assert.equal(emitted[2]?.eventType, 'outbound_redirect_failed');
  assert.equal(emitted[2]?.correlationId, 'corr-abc');
  assert.equal(emitted[2]?.errorCode, 'popup_blocked');
});

test('funnel event service emits itinerary open and result interaction events', () => {
  const emitted: FunnelTrackingEvent[] = [];
  const service = createFunnelEventService({
    track(event) {
      emitted.push(event);
    }
  });

  service.trackResultInteraction({
    searchMode: 'multi_city',
    action: 'open_detail',
    surface: 'opportunity_feed',
    itineraryId: 'opp-1'
  });
  service.trackItineraryOpened({
    searchMode: 'multi_city',
    surface: 'opportunity_feed',
    itineraryId: 'opp-1'
  });
  service.trackSearchLifecycle('results_rendered', {
    searchMode: 'multi_city',
    resultCount: 4
  });

  assert.equal(emitted.length, 3);
  assert.equal(emitted[0]?.eventType, 'result_interaction_clicked');
  assert.equal(emitted[0]?.surface, 'opportunity_feed');
  assert.equal(emitted[1]?.eventType, 'itinerary_opened');
  assert.equal(emitted[2]?.eventType, 'results_rendered');
  assert.equal(emitted[2]?.resultCount, 4);
});

test('funnel event service redacts sensitive extra fields and sanitizes error payloads', () => {
  const emitted: FunnelTrackingEvent[] = [];
  const service = createFunnelEventService({
    track(event) {
      emitted.push(event);
    }
  });

  service.trackOutboundRedirectFailed({
    searchMode: 'single',
    surface: 'results',
    errorCode: 'popup blocked!',
    errorMessage: 'Contact me at user@example.com for details',
    extra: {
      partner: 'tde_booking',
      prompt: 'raw free-text prompt should not be tracked',
      email: 'user@example.com',
      stage: 'handoff_generation'
    }
  });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.errorCode, 'popupblocked');
  assert.equal(emitted[0]?.errorMessage?.includes('[REDACTED_EMAIL]'), true);
  assert.equal(emitted[0]?.extra?.partner, 'tde_booking');
  assert.equal(emitted[0]?.extra?.stage, 'handoff_generation');
  assert.equal(emitted[0]?.extra?.prompt, undefined);
  assert.equal(emitted[0]?.extra?.email, undefined);
});
