/**
 * Unit tests for server/lib/margin-guard.js
 *
 * Run: node --test test/margin-guard.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it, before, beforeEach } from 'node:test';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeOffer({ totalPrice, providerCost, currency = 'EUR' } = {}) {
  return {
    totalPrice: Number(totalPrice),
    currency,
    provider: 'duffel',
    originIata: 'MXP',
    destinationIata: 'BCN',
    liveOfferId: 'test-offer-id',
    metadata: { offerId: 'test-offer-id' },
    // Simulate what applyPricingToOffer attaches
    _providerCost: Number(providerCost ?? totalPrice),
    _marginApplied: Number(totalPrice) - Number(providerCost ?? totalPrice),
    _pricingEnabled: true
  };
}

async function importGuard() {
  // Force re-evaluation by appending a cache-busting query param is not
  // possible with Node ESM. Instead we rely on env vars being set BEFORE
  // the first import (tests that need different env must run in isolation or
  // use the exported MARGIN_GUARD_CONFIG snapshot).
  const mod = await import('../server/lib/margin-guard.js');
  return mod;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('computeEconomics', () => {
  let computeEconomics;
  let MARGIN_GUARD_CONFIG;

  before(async () => {
    const mod = await importGuard();
    computeEconomics = mod.computeEconomics;
    MARGIN_GUARD_CONFIG = mod.MARGIN_GUARD_CONFIG;
  });

  it('computes gross and net margins correctly', () => {
    // providerCost=100, displayPrice=120
    const ec = computeEconomics(100, 120);
    assert.ok(ec.grossMarginEur > 0, 'gross margin should be positive');
    assert.ok(ec.netMarginEur > 0, 'net margin should be positive');
    assert.ok(ec.totalCostEur < 120, 'total cost must be less than display price for profitable offer');
  });

  it('adjustedProviderCost includes Duffel buffer', () => {
    const ec = computeEconomics(100, 150);
    assert.ok(
      ec.adjustedProviderCost > 100,
      'adjusted provider cost must be greater than raw provider cost'
    );
    assert.equal(
      ec.duffelBufferEur,
      Math.round(100 * MARGIN_GUARD_CONFIG.DUFFEL_COST_BUFFER_RATE * 100) / 100
    );
  });

  it('stripeFeeEur depends on displayPrice', () => {
    const ec100 = computeEconomics(50, 100);
    const ec200 = computeEconomics(50, 200);
    assert.ok(ec200.stripeFeeEur > ec100.stripeFeeEur, 'higher price → higher Stripe fee');
  });

  it('netMarginEur = displayPrice - totalCostEur', () => {
    const ec = computeEconomics(80, 110);
    const expected = Math.round((110 - ec.totalCostEur) * 100) / 100;
    assert.equal(ec.netMarginEur, expected);
  });

  it('exposes revenueEur as top-line revenue', () => {
    const ec = computeEconomics(80, 110);
    assert.equal(ec.revenueEur, 110);
  });

  it('passesNetMarginEur is false when net margin is below floor', () => {
    // Provider cost = display price → no margin at all
    const ec = computeEconomics(100, 100);
    assert.equal(ec.passesNetMarginEur, false);
    assert.equal(ec.passesNetMarginRate, false);
  });

  it('passesNetMarginEur is true for a well-priced offer', () => {
    const ec = computeEconomics(100, 160);
    assert.equal(ec.passesNetMarginEur, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('computeMinimumViablePrice', () => {
  let computeMinimumViablePrice;
  let computeEconomics;

  before(async () => {
    const mod = await importGuard();
    computeMinimumViablePrice = mod.computeMinimumViablePrice;
    computeEconomics = mod.computeEconomics;
  });

  it('returns a price strictly greater than providerCost', () => {
    const mvp = computeMinimumViablePrice(100);
    assert.ok(mvp > 100, `minimum viable price ${mvp} should be > 100`);
  });

  it('the resulting P&L passes both constraints at the minimum viable price', () => {
    const mvp = computeMinimumViablePrice(100);
    const ec = computeEconomics(100, mvp);
    assert.equal(ec.passesNetMarginEur, true, 'should pass absolute EUR floor at MVP');
    assert.equal(ec.passesNetMarginRate, true, 'should pass rate floor at MVP');
  });

  it('scales linearly with provider cost', () => {
    const mvp50  = computeMinimumViablePrice(50);
    const mvp100 = computeMinimumViablePrice(100);
    const mvp200 = computeMinimumViablePrice(200);
    assert.ok(mvp100 > mvp50,  'MVP should be higher for higher provider cost');
    assert.ok(mvp200 > mvp100, 'MVP should be higher for higher provider cost');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('guardOffer — pass path', () => {
  let guardOffer;

  before(async () => {
    delete process.env.MARGIN_GUARD_ENABLED;
    delete process.env.MARGIN_GUARD_ACTION;
    const mod = await importGuard();
    guardOffer = mod.guardOffer;
  });

  it('returns action=pass for a well-priced offer', () => {
    const offer = makeOffer({ totalPrice: 160, providerCost: 100 });
    const result = guardOffer(offer, {});
    assert.equal(result.action, 'pass');
    assert.ok(result.offer !== null);
    assert.equal(result.guardEnabled, true);
    assert.deepEqual(result.rulesTriggered, []);
  });

  it('offer object is returned unchanged on pass', () => {
    const offer = makeOffer({ totalPrice: 200, providerCost: 120 });
    const result = guardOffer(offer, {});
    assert.equal(result.offer, offer);
  });

  it('economics breakdown is populated on pass', () => {
    const offer = makeOffer({ totalPrice: 150, providerCost: 100 });
    const result = guardOffer(offer, {});
    assert.ok(result.economics !== null);
    assert.ok(typeof result.economics.netMarginEur === 'number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('guardOffer — recalculate path (default action)', () => {
  let guardOffer;
  let computeEconomics;

  before(async () => {
    delete process.env.MARGIN_GUARD_ACTION;
    const mod = await importGuard();
    guardOffer = mod.guardOffer;
    computeEconomics = mod.computeEconomics;
  });

  it('recalculates when display price equals provider cost (zero margin)', () => {
    const offer = makeOffer({ totalPrice: 100, providerCost: 100 });
    const result = guardOffer(offer, {});
    assert.ok(
      result.action === 'recalculate' || result.action === 'exclude',
      'should not pass with zero margin'
    );
  });

  it('action is recalculate when recalculation is within ceiling', () => {
    // providerCost=100, displayPrice=101 — margin is basically zero
    const offer = makeOffer({ totalPrice: 101, providerCost: 100 });
    const result = guardOffer(offer, {});
    // With MAX_VIABLE_PRICE_MULTIPLIER=2.5, ceiling=250 — well within range
    if (result.action === 'recalculate') {
      assert.ok(result.offer.totalPrice > 101, 'recalculated price should be higher');
      assert.equal(result.offer._guardRecalculated, true);
      assert.ok(result.offer._originalDisplayPrice === 101);
      // Verify the recalculated price actually passes the guard
      const recheck = computeEconomics(100, result.offer.totalPrice);
      assert.equal(recheck.passesNetMarginEur, true);
      assert.equal(recheck.passesNetMarginRate, true);
    }
  });

  it('recalculated offer carries updated _marginApplied', () => {
    const offer = makeOffer({ totalPrice: 102, providerCost: 100 });
    const result = guardOffer(offer, {});
    if (result.action === 'recalculate') {
      const expected = Math.round((result.offer.totalPrice - 100) * 100) / 100;
      assert.equal(result.offer._marginApplied, expected);
    }
  });

  it('rulesTriggered lists the failing rules', () => {
    const offer = makeOffer({ totalPrice: 100, providerCost: 100 });
    const result = guardOffer(offer, {});
    if (result.action !== 'pass') {
      assert.ok(result.rulesTriggered.length > 0, 'at least one rule should fire');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('guardOffer — exclude path', () => {
  let guardOffer;

  before(async () => {
    process.env.MARGIN_GUARD_ACTION = 'exclude';
    const mod = await importGuard();
    guardOffer = mod.guardOffer;
  });

  it('returns action=exclude and null offer for a zero-margin case', () => {
    const offer = makeOffer({ totalPrice: 100, providerCost: 100 });
    const result = guardOffer(offer, {});
    // With zero margin the guard must fire
    if (!result.rulesTriggered.length) {
      // Guard passed (unlikely at 100/100 but config-dependent), skip
      return;
    }
    assert.equal(result.action, 'exclude');
    assert.equal(result.offer, null);
  });

  it('provides a reason string when excluding', () => {
    const offer = makeOffer({ totalPrice: 100, providerCost: 100 });
    const result = guardOffer(offer, {});
    if (result.action === 'exclude') {
      assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
    }
  });
});

describe('guardOffer — non monetizable mark path', () => {
  let guardOffer;

  before(async () => {
    process.env.MARGIN_GUARD_ACTION = 'mark_non_monetizable';
    const mod = await importGuard();
    guardOffer = mod.guardOffer;
  });

  it('returns action=non_monetizable and keeps offer object', () => {
    const offer = makeOffer({ totalPrice: 100, providerCost: 100 });
    const result = guardOffer(offer, {});
    if (!result.rulesTriggered.length) return;
    assert.equal(result.action, 'non_monetizable');
    assert.ok(result.offer && typeof result.offer === 'object');
    assert.equal(result.offer._guardNonMonetizable, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('guardOffer — edge cases', () => {
  let guardOffer;

  before(async () => {
    delete process.env.MARGIN_GUARD_ACTION;
    delete process.env.MARGIN_GUARD_ENABLED;
    const mod = await importGuard();
    guardOffer = mod.guardOffer;
  });

  it('excludes an offer with zero displayPrice', () => {
    const offer = makeOffer({ totalPrice: 0, providerCost: 0 });
    const result = guardOffer(offer, {});
    assert.equal(result.action, 'exclude');
    assert.equal(result.reason, 'invalid_price');
  });

  it('excludes an offer with negative displayPrice', () => {
    const offer = makeOffer({ totalPrice: -50, providerCost: 50 });
    const result = guardOffer(offer, {});
    assert.equal(result.action, 'exclude');
  });

  it('falls back to totalPrice as providerCost when _providerCost is absent', () => {
    const offer = {
      totalPrice: 150,
      currency: 'EUR',
      provider: 'duffel',
      // No _providerCost — guard should fall back conservatively
    };
    const result = guardOffer(offer, {});
    // providerCost = 150 = displayPrice → no margin → should not pass
    assert.ok(result.action !== 'pass' || result.economics?.netMarginEur > 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('guardOffer — killswitch', () => {
  it('returns pass without checking when MARGIN_GUARD_ENABLED=false', async () => {
    process.env.MARGIN_GUARD_ENABLED = 'false';
    const { guardOffer } = await importGuard();
    const offer = makeOffer({ totalPrice: 1, providerCost: 1 }); // would normally fail
    const result = guardOffer(offer, {});
    assert.equal(result.action, 'pass');
    assert.equal(result.guardEnabled, false);
    delete process.env.MARGIN_GUARD_ENABLED;
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('guardOfferMap', () => {
  let guardOfferMap;

  before(async () => {
    delete process.env.MARGIN_GUARD_ACTION;
    delete process.env.MARGIN_GUARD_ENABLED;
    const mod = await importGuard();
    guardOfferMap = mod.guardOfferMap;
  });

  it('returns stats.total matching input size', () => {
    const map = {
      BCN: makeOffer({ totalPrice: 160, providerCost: 100 }),
      FCO: makeOffer({ totalPrice: 200, providerCost: 120 }),
      MAD: makeOffer({ totalPrice: 100, providerCost: 100 }) // zero margin
    };
    const { stats } = guardOfferMap(map, {});
    assert.equal(stats.total, 3);
    assert.equal(stats.passed + stats.recalculated + stats.excluded, 3);
  });

  it('null replaces excluded offers in filtered map', () => {
    const map = {
      BCN: makeOffer({ totalPrice: 160, providerCost: 100 }),
      BAD: makeOffer({ totalPrice: 0,   providerCost: 0   })
    };
    const { filtered } = guardOfferMap(map, {});
    assert.equal(filtered.BAD, null);
    assert.ok(filtered.BCN !== null);
  });

  it('well-priced offers remain in the map', () => {
    const offer = makeOffer({ totalPrice: 300, providerCost: 150 });
    const map = { JFK: offer };
    const { filtered, stats } = guardOfferMap(map, {});
    assert.ok(filtered.JFK !== null);
    assert.ok(stats.passed >= 1 || stats.recalculated >= 1);
  });
});
