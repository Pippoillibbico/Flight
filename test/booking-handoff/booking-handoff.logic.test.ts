import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBookingLink,
  createBookingClickedTracker,
  createDefaultBookingProviders,
  createBookingHandoffLayer,
  getBookingProvider,
  selectBookingProvider
} from '../../src/features/booking-handoff/index.ts';

test('provider selection honors preferred provider when enabled', () => {
  const provider = selectBookingProvider(
    [
      { type: 'affiliate', partner: 'tde_booking', enabled: true, priority: 20, resolvePath: '/api/outbound/resolve' },
      { type: 'white_label', partner: 'wl_booking', enabled: true, priority: 10, resolvePath: '/api/outbound/resolve' },
      { type: 'direct', partner: 'direct_booking', enabled: false, priority: 30 }
    ],
    {
      origin: 'MXP',
      destinationIata: 'LIS',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-14',
      travellers: 1,
      cabinClass: 'economy'
    },
    'affiliate'
  );

  assert.equal(provider.type, 'affiliate');
  assert.equal(provider.partner, 'tde_booking');
});

test('provider selection can target white_label provider when enabled', () => {
  const provider = selectBookingProvider(
    [
      { type: 'affiliate', partner: 'tde_booking', enabled: true, priority: 10, resolvePath: '/api/outbound/resolve' },
      { type: 'white_label', partner: 'wl_booking', enabled: true, priority: 20, resolvePath: '/api/outbound/resolve' },
      { type: 'direct', partner: 'direct_booking', enabled: false, priority: 30 }
    ],
    {
      origin: 'MXP',
      destinationIata: 'LIS',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-14',
      travellers: 1,
      cabinClass: 'economy'
    },
    'white_label'
  );

  assert.equal(provider.type, 'white_label');
  assert.equal(provider.partner, 'wl_booking');
});

test('provider selection chooses direct when booking link exists and direct is enabled', () => {
  const provider = selectBookingProvider(
    [
      { type: 'affiliate', partner: 'tde_booking', enabled: true, priority: 10, resolvePath: '/api/outbound/resolve' },
      { type: 'direct', partner: 'direct_booking', enabled: true, priority: 20 }
    ],
    {
      origin: 'MXP',
      destinationIata: 'LIS',
      bookingLink: 'https://partner.example.com/checkout?id=abc',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-14',
      travellers: 1,
      cabinClass: 'economy'
    }
  );

  assert.equal(provider.type, 'direct');
});

test('default provider abstraction keeps affiliate active by default', () => {
  const provider = getBookingProvider(
    createDefaultBookingProviders(),
    {
      origin: 'MXP',
      destinationIata: 'LIS',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-14',
      travellers: 1,
      cabinClass: 'economy'
    }
  );

  assert.equal(provider.type, 'affiliate');
  assert.equal(provider.partner, 'tde_booking');
});

test('provider selection falls back to active affiliate when preferred provider is disabled', () => {
  const provider = getBookingProvider(
    createDefaultBookingProviders(),
    {
      origin: 'MXP',
      destinationIata: 'LIS',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-14',
      travellers: 1,
      cabinClass: 'economy'
    },
    'white_label'
  );

  assert.equal(provider.type, 'affiliate');
});

test('booking handoff builds deterministic affiliate link and payload', () => {
  const handoffLayer = createBookingHandoffLayer([
    { type: 'affiliate', partner: 'tde_booking', enabled: true, priority: 10, resolvePath: '/api/outbound/resolve' },
    { type: 'white_label', partner: 'wl_booking', enabled: false, priority: 20, resolvePath: '/api/outbound/resolve' },
    { type: 'direct', partner: 'direct_booking', enabled: false, priority: 30 }
  ]);

  const handoff = handoffLayer.generateBookingHandoff(
    {
      itineraryId: 'flight-abc-1',
      origin: 'mxp',
      destinationIata: 'lis',
      destination: 'Lisbon',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-14',
      travellers: 2,
      cabinClass: 'economy',
      stopCount: 1,
      comfortScore: 78,
      connectionType: 'all',
      travelTime: 'day'
    },
    {
      surface: 'results',
      utm: { utmSource: 'newsletter', utmMedium: 'email', utmCampaign: 'summer' }
    }
  );

  assert.equal(handoff.providerType, 'affiliate');
  assert.equal(handoff.partner, 'tde_booking');
  assert.match(handoff.url, /^\/api\/outbound\/resolve\?/);
  assert.match(handoff.url, /partner=tde_booking/);
  assert.match(handoff.url, /origin=MXP/);
  assert.match(handoff.url, /destinationIata=LIS/);
  assert.match(handoff.url, /surface=results/);
  assert.match(handoff.url, /itineraryId=flight-abc-1/);
  assert.match(handoff.url, /correlationId=/);
  assert.match(handoff.correlationId, /^corr_/);
  assert.equal(handoff.event.eventName, 'booking_clicked');
  assert.equal(handoff.event.correlationId, handoff.correlationId);
  assert.equal(handoff.event.itineraryId, 'flight-abc-1');
  assert.equal(handoff.event.providerType, 'affiliate');
  assert.equal(handoff.event.origin, 'MXP');
  assert.equal(handoff.event.destinationIata, 'LIS');
});

test('booking handoff correlation id is deterministic and increments by sequence', () => {
  const handoffLayer = createBookingHandoffLayer(
    [{ type: 'affiliate', partner: 'tde_booking', enabled: true, priority: 10, resolvePath: '/api/outbound/resolve' }],
    { now: () => 1718012345000 }
  );

  const first = handoffLayer.generateBookingHandoff(
    {
      itineraryId: 'flight-abc-1',
      origin: 'MXP',
      destinationIata: 'LIS',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-14',
      travellers: 1,
      cabinClass: 'economy'
    },
    { surface: 'results' }
  );
  const second = handoffLayer.generateBookingHandoff(
    {
      itineraryId: 'flight-abc-1',
      origin: 'MXP',
      destinationIata: 'LIS',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-14',
      travellers: 1,
      cabinClass: 'economy'
    },
    { surface: 'results' }
  );

  assert.equal(first.correlationId, 'corr_lx8s6xew_1_results_flight-abc-1');
  assert.equal(second.correlationId, 'corr_lx8s6xew_2_results_flight-abc-1');
  assert.notEqual(first.correlationId, second.correlationId);
});

test('buildBookingLink throws when required departure date is missing', () => {
  assert.throws(
    () =>
      buildBookingLink(
        { type: 'affiliate', partner: 'tde_booking', enabled: true, priority: 10, resolvePath: '/api/outbound/resolve' },
        {
          origin: 'MXP',
          destinationIata: 'LIS',
          dateFrom: '',
          dateTo: '2026-06-14',
          travellers: 1,
          cabinClass: 'economy'
        },
        { surface: 'results' }
      ),
    /departure date/
  );
});

test('buildBookingLink allows one-way itineraries without return date', () => {
  const url = buildBookingLink(
    { type: 'affiliate', partner: 'tde_booking', enabled: true, priority: 10, resolvePath: '/api/outbound/resolve' },
    {
      origin: 'MXP',
      destinationIata: 'LIS',
      dateFrom: '2026-06-10',
      dateTo: '',
      travellers: 1,
      cabinClass: 'economy'
    },
    { surface: 'results' }
  );

  assert.match(url, /dateFrom=2026-06-10/);
  assert.doesNotMatch(url, /dateTo=/);
});

test('buildBookingLink for direct provider uses absolute direct URL', () => {
  const url = buildBookingLink(
    { type: 'direct', partner: 'direct_booking', enabled: true, priority: 10 },
    {
      origin: 'MXP',
      destinationIata: 'LIS',
      bookingLink: 'https://partner.example.com/deeplink/123',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-14',
      travellers: 1,
      cabinClass: 'economy'
    },
    { surface: 'results' }
  );
  assert.equal(url, 'https://partner.example.com/deeplink/123');
});

test('booking tracker dispatches event and forwards outbound payload', async () => {
  const dispatchedEvents: Record<string, unknown>[] = [];
  const outboundPayloads: Record<string, unknown>[] = [];
  const tracker = createBookingClickedTracker({
    dispatcher: {
      dispatchEvent: (_eventName, detail) => {
        dispatchedEvents.push(detail as unknown as Record<string, unknown>);
      }
    },
    apiClient: {
      async outboundClick(payload) {
        outboundPayloads.push(payload);
        return { ok: true };
      }
    }
  });

  await tracker.track({
    eventName: 'booking_clicked',
    correlationId: 'corr_lx8s6xew_1_results_flight-abc-1',
    itineraryId: 'flight-abc-1',
    providerType: 'affiliate',
    partner: 'tde_booking',
    url: '/api/outbound/resolve?partner=tde_booking&surface=results&origin=MXP&destinationIata=LIS',
    surface: 'results',
    origin: 'MXP',
    destinationIata: 'LIS',
    destination: 'Lisbon'
  });

  assert.equal(dispatchedEvents.length, 1);
  assert.equal(outboundPayloads.length, 1);
  assert.equal(outboundPayloads[0]?.eventName, 'booking_clicked');
  assert.equal(outboundPayloads[0]?.correlationId, 'corr_lx8s6xew_1_results_flight-abc-1');
  assert.equal(outboundPayloads[0]?.itineraryId, 'flight-abc-1');
  assert.equal(dispatchedEvents[0]?.url, '/api/outbound/resolve');
  assert.equal(String(outboundPayloads[0]?.url || '').includes('partner=tde_booking'), true);
});

test('booking tracker does not forward direct provider URLs to outbound API', async () => {
  const outboundPayloads: Record<string, unknown>[] = [];
  const tracker = createBookingClickedTracker({
    dispatcher: {
      dispatchEvent: () => {}
    },
    apiClient: {
      async outboundClick(payload) {
        outboundPayloads.push(payload);
        return { ok: true };
      }
    }
  });

  await tracker.track({
    eventName: 'booking_clicked',
    correlationId: 'corr_lx8s6xew_1_results_direct-1',
    itineraryId: 'direct-1',
    providerType: 'direct',
    partner: 'direct_booking',
    url: 'https://partner.example.com/deeplink/123',
    surface: 'results',
    origin: 'MXP',
    destinationIata: 'LIS',
    destination: 'Lisbon'
  });

  assert.equal(outboundPayloads.length, 0);
});
