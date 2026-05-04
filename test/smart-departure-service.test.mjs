import test from 'node:test';
import assert from 'node:assert/strict';
import { getSmartDeparture, STRATEGIC_AIRPORTS } from '../server/lib/smart-departure-service.js';

test('smart departure returns disabled payload on invalid input', async () => {
  const payload = await getSmartDeparture({
    origin: '',
    destination: 'TYO',
    departureDate: '2026-11-10',
    basePrice: 780
  });
  assert.equal(payload.enabled, false);
  assert.equal(payload.primaryOffer, null);
  assert.deepEqual(payload.alternatives, []);
});

test('smart departure free/anonymous gating returns max 1 for anonymous', async () => {
  const payload = await getSmartDeparture({
    origin: 'FCO',
    destination: 'TYO',
    departureDate: '2026-11-10',
    returnDate: '2026-11-18',
    basePrice: 780,
    user: null
  });
  assert.equal(payload.enabled, true);
  assert.equal(payload.primaryOffer.originIata, 'FCO');
  assert.equal(payload.alternatives.length <= 1, true);
});

test('smart departure free gating returns max 2 for free users', async () => {
  const payload = await getSmartDeparture({
    origin: 'FCO',
    destination: 'TYO',
    departureDate: '2026-11-10',
    returnDate: '2026-11-18',
    basePrice: 780,
    user: { planType: 'free' }
  });
  assert.equal(payload.enabled, true);
  assert.equal(payload.alternatives.length <= 2, true);
});

test('smart departure paid gating returns max 3 for pro/creator', async () => {
  const pro = await getSmartDeparture({
    origin: 'FCO',
    destination: 'TYO',
    departureDate: '2026-11-10',
    returnDate: '2026-11-18',
    basePrice: 780,
    user: { planType: 'pro' }
  });
  const creator = await getSmartDeparture({
    origin: 'FCO',
    destination: 'TYO',
    departureDate: '2026-11-10',
    returnDate: '2026-11-18',
    basePrice: 780,
    user: { planType: 'creator' }
  });
  assert.equal(pro.alternatives.length <= 3, true);
  assert.equal(creator.alternatives.length <= 3, true);
});

test('smart departure keeps only meaningful alternatives and sorts by saving desc', async () => {
  const payload = await getSmartDeparture({
    origin: 'FCO',
    destination: 'TYO',
    departureDate: '2026-11-10',
    returnDate: '2026-11-18',
    basePrice: 1200,
    user: { planType: 'creator' },
    liveSearchFn: async ({ origin }) => {
      const matrix = {
        MXP: { price: 980, qualityScore: 70 }, // 220
        BGY: { price: 1005, qualityScore: 80 }, // 195
        VIE: { price: 1188, qualityScore: 90 }, // 12 -> filtered by <20
        BUD: { price: 1090, qualityScore: 95 }, // 110
        BCN: { price: 870, qualityScore: 60 } // 330
      };
      return matrix[origin] || null;
    }
  });

  assert.equal(payload.enabled, true);
  assert.equal(payload.alternatives.length > 0, true);
  assert.equal(payload.alternatives.length <= 3, true);

  for (const alt of payload.alternatives) {
    assert.equal(STRATEGIC_AIRPORTS.includes(alt.originIata), true);
    assert.equal(alt.savingAbs >= 20, true);
    assert.equal(alt.savingAbs >= 60 || alt.savingPct >= 12, true);
  }

  for (let i = 1; i < payload.alternatives.length; i += 1) {
    assert.equal(payload.alternatives[i - 1].savingAbs >= payload.alternatives[i].savingAbs, true);
  }

  assert.equal(payload.bestAlternative?.originIata, payload.alternatives[0]?.originIata);
  assert.equal(typeof payload.summaryMessage, 'string');
  assert.equal(payload.summaryMessage.length > 0, true);
});
