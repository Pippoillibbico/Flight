import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAdminBackofficeReport } from '../server/lib/admin-backoffice-report.js';

test('buildAdminBackofficeReport maps cost monitoring payload into admin report', () => {
  const report = buildAdminBackofficeReport({
    db: {
      users: [],
      authEvents: [],
      outboundClicks: [],
      clientTelemetryEvents: []
    },
    followSignals: { total: 0, topRoutes: [] },
    now: Date.now(),
    windowDays: 30,
    costMonitoring: {
      callsPerUser: { search: 2.5, provider: 1.1, ai: 0.4 },
      costPerUser: { provider: 0.32, ai: 0.08, total: 0.4 },
      provider: { budgetUsedPercent: 82, budgetExceededEvents: 3 },
      ai: { budgetUsedPercent: 71, budgetExceededEvents: 2 },
      search: { total: 120, throttled429: 12, activeUsers: 40 },
      monetization: { feedViews: 200, redirectClicks: 30, ctrPercent: 15 },
      costs: { providerCostEur: 22.7, aiCostEur: 4.3 },
      alerts: [{ level: 'warning', code: 'provider_budget_80', message: 'Provider budget over 80%' }],
      suggestions: ['Increase cache hit ratio for high-volume routes.']
    }
  });

  assert.ok(report.monitoring);
  assert.equal(report.monitoring.usersActiveEstimated, 40);
  assert.equal(report.monitoring.feedViews, 200);
  assert.equal(report.monitoring.redirectClicks, 30);
  assert.equal(report.monitoring.ctrPercent, 15);
  assert.equal(report.monitoring.providerCostTotalEur, 22.7);
  assert.equal(report.monitoring.aiCostTotalEur, 4.3);
  assert.equal(report.monitoring.providerBudgetExceededEvents, 3);
  assert.equal(report.monitoring.aiBudgetExceededEvents, 2);
  assert.equal(report.monitoring.search429Count, 12);
  assert.equal(report.monitoring.search429Pct, 9.1);
  assert.equal(report.monitoring.alerts.length, 1);
  assert.equal(report.monitoring.suggestions.length, 1);
});

