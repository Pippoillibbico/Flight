import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TELEMETRY_EVENTS,
  isKnownTelemetryEvent,
  resolveTelemetryEventType
} from '../../src/shared/telemetry/events.js';

test('isKnownTelemetryEvent accepts canonical telemetry events', () => {
  assert.equal(isKnownTelemetryEvent(TELEMETRY_EVENTS.SEARCH_SUBMITTED), true);
  assert.equal(isKnownTelemetryEvent(TELEMETRY_EVENTS.RESULTS_RENDERED), true);
  assert.equal(isKnownTelemetryEvent(TELEMETRY_EVENTS.BOOKING_CLICKED), true);
});

test('legacy telemetry aliases resolve to canonical event names', () => {
  assert.equal(resolveTelemetryEventType('deal_opened'), TELEMETRY_EVENTS.OPPORTUNITY_OPENED);
  assert.equal(resolveTelemetryEventType('outbound_clicked'), TELEMETRY_EVENTS.BOOKING_CLICKED);
  assert.equal(isKnownTelemetryEvent('upgrade_completed'), true);
});

test('unknown telemetry events are rejected', () => {
  assert.equal(isKnownTelemetryEvent('unknown_custom_event'), false);
});
