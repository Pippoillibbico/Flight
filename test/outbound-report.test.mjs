import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOutboundReport, outboundReportToCsv } from '../server/lib/outbound-report.js';

function atNowMinusDays(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

test('outbound report separates click, redirect success and redirect failure metrics', () => {
  const db = {
    outboundClicks: [
      {
        at: atNowMinusDays(1),
        eventName: 'booking_clicked',
        correlationId: 'corr-one',
        partner: 'tde_booking',
        origin: 'MXP',
        destinationIata: 'LIS',
        utmCampaign: 'spring',
        utmSource: 'newsletter',
        utmMedium: 'email'
      },
      {
        at: atNowMinusDays(1),
        eventName: 'outbound_redirect_succeeded',
        correlationId: 'corr-one',
        partner: 'tde_booking',
        origin: 'MXP',
        destinationIata: 'LIS'
      },
      {
        at: atNowMinusDays(1),
        eventName: 'outbound_redirect_failed',
        correlationId: 'corr-two',
        partner: 'tde_booking',
        origin: 'MXP',
        destinationIata: 'LIS',
        failureReason: 'invalid_click_token'
      }
    ],
    searches: [{ at: atNowMinusDays(1), payload: { connectionType: 'all', travelTime: 'all', maxStops: 1 } }]
  };

  const report = buildOutboundReport(db, 30);
  assert.equal(report.summary.searchCount, 1);
  assert.equal(report.summary.outboundClicks, 1);
  assert.equal(report.summary.redirectSuccesses, 1);
  assert.equal(report.summary.redirectFailures, 1);
  assert.equal(report.summary.clicksWithCorrelationId, 1);
  assert.equal(report.summary.redirectOutcomesWithCorrelationId, 2);
  assert.equal(report.summary.correlatedRedirectOutcomes, 1);
  assert.equal(report.summary.redirectCorrelationRatePct, 50);
  assert.equal(report.summary.clickThroughRatePct, 100);
  assert.equal(report.redirectFailureReasons[0]?.reason, 'invalid_click_token');
  assert.equal(report.redirectFailureReasons[0]?.count, 1);
});

test('outbound report remains compatible with legacy redirect event names', () => {
  const report = buildOutboundReport(
    {
      outboundClicks: [
        { at: atNowMinusDays(1), eventName: 'booking_resolved_redirect' },
        { at: atNowMinusDays(1), eventName: 'booking_redirect_failed' }
      ],
      searches: []
    },
    30
  );

  assert.equal(report.summary.redirectSuccesses, 1);
  assert.equal(report.summary.redirectFailures, 1);
});

test('outbound CSV contains redirect fields in summary', () => {
  const report = buildOutboundReport(
    {
      outboundClicks: [{ at: atNowMinusDays(1), eventName: 'booking_clicked', partner: 'tde_booking', origin: 'MXP', destinationIata: 'LIS' }],
      searches: []
    },
    30
  );
  const csv = outboundReportToCsv(report);

  assert.match(csv, /summary,redirectSuccesses,/);
  assert.match(csv, /summary,redirectFailures,/);
  assert.match(csv, /summary,correlatedRedirectOutcomes,/);
  assert.match(csv, /redirect_failure_reason,count/);
});

test('outbound CSV neutralizes spreadsheet formula injection payloads', () => {
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      windowDays: 30,
      searchCount: 1,
      outboundClicks: 1,
      clickThroughRatePct: 100,
      uniqueRoutesClicked: 1,
      redirectSuccesses: 1,
      redirectFailures: 0,
      clicksWithCorrelationId: 1,
      redirectOutcomesWithCorrelationId: 1,
      correlatedRedirectOutcomes: 1,
      redirectCorrelationRatePct: 100
    },
    byPartner: [{ partner: '=HYPERLINK("http://attacker")', clicks: 1 }],
    topRoutes: [{ route: '+SUM(A1:A2)', clicks: 1 }],
    topDecisionPatterns: [{ pattern: '-2+3', used: 1 }],
    topCampaigns: [{ campaign: '@evil', clicks: 1 }],
    topSources: [{ sourceMedium: 'newsletter / email', clicks: 1 }],
    redirectFailureReasons: []
  };

  const csv = outboundReportToCsv(report);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'\+SUM/);
  assert.match(csv, /'-2\+3/);
  assert.match(csv, /'@evil/);
});
