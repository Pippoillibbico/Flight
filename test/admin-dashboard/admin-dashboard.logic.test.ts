import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminFunnelView,
  mapFunnelEventToAdminTelemetry,
  mapUpgradeEventToAdminTelemetry,
  resolveAdminAccess
} from '../../src/features/admin-dashboard/index.ts';

test('resolveAdminAccess denies access when no allowlist is configured', () => {
  const result = resolveAdminAccess({
    userEmail: 'anyone@example.com',
    allowlistCsv: ''
  });

  assert.equal(result.isAdmin, false);
  assert.deepEqual(result.allowlist, []);
});

test('resolveAdminAccess grants access when email is in explicit allowlist', () => {
  const result = resolveAdminAccess({
    userEmail: 'admin@example.com',
    allowlistCsv: 'admin@example.com'
  });

  assert.equal(result.isAdmin, true);
  assert.equal(result.normalizedEmail, 'admin@example.com');
});

test('resolveAdminAccess respects explicit allowlist override', () => {
  const result = resolveAdminAccess({
    userEmail: 'owner@example.com',
    allowlistCsv: 'admin@example.com,another@example.com'
  });

  assert.equal(result.isAdmin, false);
  assert.deepEqual(result.allowlist, ['admin@example.com', 'another@example.com']);
});

test('buildAdminFunnelView normalizes steps and highlights biggest drop-off', () => {
  const report = {
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    overview: {
      totalUsers: 1,
      loginSessions: 1,
      activeUsers24h: 1,
      activeUsers7d: 1,
      trackedRouteActions: 1,
      trackedRoutesTotal: 1,
      itineraryOpens: 1,
      bookingClicks: 1,
      upgradeClicks: 0
    },
    funnel: {
      steps: [
        { key: 'login_completed', label: 'Login completed', count: 100, conversionPct: 100, dropOffPct: 0 },
        { key: 'track_route_clicked', label: 'Track route clicked', count: 40, conversionPct: 40, dropOffPct: 60 },
        { key: 'itinerary_opened', label: 'Itinerary opened', count: 35, conversionPct: 87.5, dropOffPct: 12.5 },
        { key: 'booking_clicked', label: 'Booking clicked', count: 20, conversionPct: 57.1, dropOffPct: 42.9 }
      ]
    },
    behavior: {
      topTrackedRoutes: [],
      topViewedItineraries: [],
      topBookingRoutes: [],
      topUpgradeSurfaces: []
    },
    monetization: {
      upgradeClicked: 0,
      planDistribution: [],
      proInterestCount: 0,
      eliteInterestCount: 0,
      triggerSurfaces: []
    },
    operations: {
      authFailures24h: 0,
      outboundRedirectFailures24h: 0,
      rateLimitEvents24h: 0,
      recentErrors: []
    },
    recentActivity: []
  };

  const view = buildAdminFunnelView(report);

  assert.equal(view.steps.length, 4);
  assert.equal(view.strongestDropOff?.key, 'track_route_clicked');
  assert.equal(view.strongestDropOff?.dropOffPct, 60);
});

test('mapFunnelEventToAdminTelemetry maps expected funnel payload fields', () => {
  const payload = mapFunnelEventToAdminTelemetry({
    eventType: 'result_interaction_clicked',
    at: '2026-01-01T00:00:00.000Z',
    eventId: 'fne_abcd1234',
    eventVersion: 1,
    schemaVersion: 2,
    sourceContext: 'web_app',
    action: 'track_route',
    surface: 'opportunity_feed',
    itineraryId: 'it-123',
    correlationId: 'corr-123',
    extra: {
      routeSlug: 'japan'
    }
  });

  assert.ok(payload);
  assert.equal(payload?.eventType, 'result_interaction_clicked');
  assert.equal(payload?.action, 'track_route');
  assert.equal(payload?.routeSlug, 'japan');
  assert.equal(payload?.sourceContext, 'web_app');
  assert.equal(payload?.schemaVersion, 2);
  assert.equal(payload?.eventVersion, 1);
  assert.equal(payload?.eventId, 'fne_abcd1234');
});

test('mapUpgradeEventToAdminTelemetry normalizes plan type safely', () => {
  const elitePayload = mapUpgradeEventToAdminTelemetry({
    eventType: 'upgrade_primary_cta_clicked',
    eventId: 'upe_abcd1234',
    sourceContext: 'web_app',
    source: 'opportunity_feed_prompt',
    planType: 'creator'
  });
  const unknownPayload = mapUpgradeEventToAdminTelemetry({
    eventType: 'upgrade_primary_cta_clicked',
    source: 'opportunity_feed_prompt',
    planType: 'enterprise'
  });

  assert.ok(elitePayload);
  assert.equal(elitePayload?.planType, 'elite');
  assert.equal(elitePayload?.eventId, 'upe_abcd1234');
  assert.equal(elitePayload?.sourceContext, 'web_app');
  assert.ok(unknownPayload);
  assert.equal(unknownPayload?.planType, undefined);
});
