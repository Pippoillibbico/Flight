/**
 * Unit tests for server/lib/pricing-engine.js
 *
 * Run with: node --experimental-vm-modules node_modules/.bin/jest test/pricing-engine.test.mjs
 * or: npx vitest test/pricing-engine.test.mjs
 * or: node --test test/pricing-engine.test.mjs  (Node 18+ built-in test runner)
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

// We need to re-import the module fresh for env-var tests
async function importEngine() {
  const mod = await import('../server/lib/pricing-engine.js');
  return mod;
}

describe('computeFlightDisplayPrice', () => {
  let computeFlightDisplayPrice;
  let sanitizeOfferForClient;
  let applyPricingToOffer;
  let PRICING_CONSTANTS;

  before(async () => {
    // Ensure default env vars
    delete process.env.PRICING_ENABLED;
    delete process.env.PRICING_BASE_MARGIN_RATE;
    delete process.env.PRICING_MIN_ABSOLUTE_MARGIN_EUR;
    delete process.env.PRICING_MAX_ABSOLUTE_MARGIN_EUR;

    // Node ESM module cache can't be reset easily — import once with defaults
    const mod = await importEngine();
    computeFlightDisplayPrice = mod.computeFlightDisplayPrice;
    sanitizeOfferForClient = mod.sanitizeOfferForClient;
    applyPricingToOffer = mod.applyPricingToOffer;
    PRICING_CONSTANTS = mod.PRICING_CONSTANTS;
  });

  it('returns a displayPrice strictly greater than providerCost for a valid price', () => {
    const result = computeFlightDisplayPrice(100, 'EUR');
    assert.ok(result.displayPrice > 100, 'displayPrice must be greater than provider cost');
    assert.equal(result.providerCost, 100);
    assert.equal(result.currency, 'EUR');
    assert.equal(result.pricingEnabled, true);
  });

  it('marginApplied equals displayPrice minus providerCost', () => {
    const result = computeFlightDisplayPrice(200, 'EUR');
    const computed = Math.round((result.displayPrice - result.providerCost) * 100) / 100;
    assert.equal(result.marginApplied, computed);
  });

  it('applies at least the minimum absolute margin floor', () => {
    // Very cheap flight — floor should kick in
    const result = computeFlightDisplayPrice(1, 'EUR');
    assert.ok(
      result.marginApplied >= PRICING_CONSTANTS.MIN_ABSOLUTE_MARGIN_EUR,
      `margin ${result.marginApplied} should be >= floor ${PRICING_CONSTANTS.MIN_ABSOLUTE_MARGIN_EUR}`
    );
    assert.equal(result.breakdown.minFloorApplied, true);
  });

  it('respects MAX_ABSOLUTE_MARGIN_EUR cap for very expensive flights', () => {
    // Very expensive flight — cap should kick in
    const result = computeFlightDisplayPrice(10000, 'EUR');
    assert.ok(
      result.marginApplied <= PRICING_CONSTANTS.MAX_ABSOLUTE_MARGIN_EUR,
      `margin ${result.marginApplied} should be <= cap ${PRICING_CONSTANTS.MAX_ABSOLUTE_MARGIN_EUR}`
    );
    assert.equal(result.breakdown.maxCapApplied, true);
  });

  it('returns raw cost unchanged for invalid (zero) price', () => {
    const result = computeFlightDisplayPrice(0, 'EUR');
    assert.equal(result.displayPrice, 0);
    assert.equal(result.marginApplied, 0);
    assert.equal(result.pricingEnabled, false);
  });

  it('returns raw cost unchanged for negative price', () => {
    const result = computeFlightDisplayPrice(-50, 'EUR');
    assert.equal(result.displayPrice, -50);
    assert.equal(result.pricingEnabled, false);
  });

  it('normalises currency to uppercase', () => {
    const result = computeFlightDisplayPrice(100, 'eur');
    assert.equal(result.currency, 'EUR');
  });

  it('defaults currency to EUR when not provided', () => {
    const result = computeFlightDisplayPrice(100);
    assert.equal(result.currency, 'EUR');
  });

  it('adds premium-user dynamic surcharge on top of base margin', () => {
    const free = computeFlightDisplayPrice(100, 'EUR', { userTier: 'free' });
    const pro = computeFlightDisplayPrice(100, 'EUR', { userTier: 'pro' });
    assert.ok(
      pro.displayPrice > free.displayPrice,
      'pro tier should have a higher display price than free'
    );
  });

  it('applies mobile device adjustment when deviceType=mobile', () => {
    const desktop = computeFlightDisplayPrice(220, 'EUR', { deviceType: 'desktop' });
    const mobile = computeFlightDisplayPrice(220, 'EUR', { deviceType: 'mobile' });
    assert.ok(mobile.displayPrice <= desktop.displayPrice);
  });

  it('applies returning-user adjustment when isReturningUser=true', () => {
    const firstTime = computeFlightDisplayPrice(220, 'EUR', { isReturningUser: false });
    const returning = computeFlightDisplayPrice(220, 'EUR', { isReturningUser: true });
    assert.ok(returning.displayPrice <= firstTime.displayPrice);
  });

  it('adds last-minute surcharge when isLastMinute=true', () => {
    const normal = computeFlightDisplayPrice(100, 'EUR', { isLastMinute: false });
    const lastMin = computeFlightDisplayPrice(100, 'EUR', { isLastMinute: true });
    assert.ok(lastMin.displayPrice > normal.displayPrice);
  });

  it('auto-detects last-minute from departureDate within threshold', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const result = computeFlightDisplayPrice(100, 'EUR', { departureDate: tomorrow });
    assert.equal(result.breakdown.dynamicRateAdder > 0, true, 'should have positive dynamic adder for near departure');
  });

  it('does not auto-detect last-minute for distant departure', () => {
    const farFuture = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const resultFar = computeFlightDisplayPrice(100, 'EUR', { departureDate: farFuture });
    const resultNoDate = computeFlightDisplayPrice(100, 'EUR', {});
    // No last-minute adder; dynamic rates should be equal
    assert.equal(resultFar.breakdown.dynamicRateAdder, resultNoDate.breakdown.dynamicRateAdder);
  });

  it('applies a discount for smartDeal context', () => {
    const normal = computeFlightDisplayPrice(100, 'EUR', {});
    const deal = computeFlightDisplayPrice(100, 'EUR', { isSmartDeal: true });
    assert.ok(deal.displayPrice <= normal.displayPrice);
  });

  it('applies low-price uplift to protect fixed costs', () => {
    const low = computeFlightDisplayPrice(40, 'EUR');
    const medium = computeFlightDisplayPrice(200, 'EUR');
    assert.ok(low.marginRate > medium.marginRate);
  });

  it('high-price route keeps margin bounded by cap', () => {
    const expensive = computeFlightDisplayPrice(1500, 'EUR');
    assert.ok(expensive.marginApplied <= PRICING_CONSTANTS.MAX_ABSOLUTE_MARGIN_EUR);
  });

  it('rounds displayPrice to 2 decimal places', () => {
    const result = computeFlightDisplayPrice(133.33, 'EUR');
    const decimals = String(result.displayPrice).split('.')[1] || '';
    assert.ok(decimals.length <= 2, `expected max 2 decimal places, got "${result.displayPrice}"`);
  });
});

describe('applyPricingToOffer', () => {
  let applyPricingToOffer;
  let sanitizeOfferForClient;

  before(async () => {
    const mod = await importEngine();
    applyPricingToOffer = mod.applyPricingToOffer;
    sanitizeOfferForClient = mod.sanitizeOfferForClient;
  });

  it('replaces totalPrice with the marked-up displayPrice', () => {
    const offer = { totalPrice: 150, currency: 'EUR', provider: 'duffel', destinationIata: 'BCN' };
    const result = applyPricingToOffer(offer);
    assert.ok(result.totalPrice > 150, 'totalPrice should be marked up');
    assert.equal(result._providerCost, 150);
  });

  it('preserves all original offer fields', () => {
    const offer = { totalPrice: 200, currency: 'USD', provider: 'duffel', destinationIata: 'JFK', foo: 'bar' };
    const result = applyPricingToOffer(offer);
    assert.equal(result.foo, 'bar');
    assert.equal(result.destinationIata, 'JFK');
    assert.equal(result.provider, 'duffel');
  });

  it('attaches internal audit fields', () => {
    const offer = { totalPrice: 100, currency: 'EUR' };
    const result = applyPricingToOffer(offer);
    assert.ok('_providerCost' in result);
    assert.ok('_marginApplied' in result);
    assert.ok('_pricingEnabled' in result);
  });
});

describe('sanitizeOfferForClient', () => {
  let sanitizeOfferForClient;

  before(async () => {
    const mod = await importEngine();
    sanitizeOfferForClient = mod.sanitizeOfferForClient;
  });

  it('removes internal pricing audit fields', () => {
    const pricedOffer = {
      totalPrice: 160,
      currency: 'EUR',
      provider: 'duffel',
      _providerCost: 140,
      _marginApplied: 20,
      _marginRate: 0.142,
      _pricingEnabled: true
    };
    const safe = sanitizeOfferForClient(pricedOffer);
    assert.ok(!('_providerCost' in safe), '_providerCost must be stripped');
    assert.ok(!('_marginApplied' in safe), '_marginApplied must be stripped');
    assert.ok(!('_marginRate' in safe), '_marginRate must be stripped');
    assert.ok(!('_pricingEnabled' in safe), '_pricingEnabled must be stripped');
    assert.equal(safe.totalPrice, 160);
    assert.equal(safe.provider, 'duffel');
  });

  it('handles null/undefined gracefully', () => {
    assert.equal(sanitizeOfferForClient(null), null);
    assert.equal(sanitizeOfferForClient(undefined), undefined);
  });
});
