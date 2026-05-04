import test from 'node:test';
import assert from 'node:assert/strict';

// @ts-ignore legacy JS module in server runtime
import { normalizePlanType } from '../../server/lib/plans/normalize-plan-type.js';
// @ts-ignore legacy JS module in server runtime
import { checkoutPayloadSchema, changePlanPayloadSchema } from '../../server/lib/billing/stripe-billing-schemas.js';
// @ts-ignore legacy JS module in server runtime
import { buildAdminBackofficeReport } from '../../server/lib/admin-backoffice-report.js';

test('normalizePlanType maps elite to creator', () => {
  assert.equal(normalizePlanType('elite'), 'creator');
  assert.equal(normalizePlanType('creator'), 'creator');
  assert.equal(normalizePlanType('pro'), 'pro');
  assert.equal(normalizePlanType('unknown'), 'free');
});

test('stripe billing schemas accept elite as legacy input and normalize to creator', () => {
  const checkout = checkoutPayloadSchema.parse({ planType: 'elite' });
  const changePlan = changePlanPayloadSchema.parse({ planType: 'elite' });

  assert.equal(checkout.planType, 'creator');
  assert.equal(changePlan.planType, 'creator');
});

test('admin backoffice report aggregates creator interest and keeps elite alias field', () => {
  const report = buildAdminBackofficeReport({
    db: {
      users: [{ id: 'u1', planType: 'elite' }, { id: 'u2', planType: 'creator' }],
      authEvents: [],
      outboundClicks: [],
      clientTelemetryEvents: [
        { id: 't1', at: new Date().toISOString(), eventType: 'upgrade_primary_cta_clicked', planType: 'elite' },
        { id: 't2', at: new Date().toISOString(), eventType: 'upgrade_primary_cta_clicked', planType: 'creator' }
      ]
    }
  });

  assert.equal(report.monetization.creatorInterestCount, 2);
  assert.equal(report.monetization.eliteInterestCount, 2);
  const planDistribution = report.monetization.planDistribution as Array<{ key: string; count: number }>;
  const creatorPlan = planDistribution.find((item) => item.key === 'creator');
  assert.ok(creatorPlan);
  assert.equal(creatorPlan?.count, 2);
});
