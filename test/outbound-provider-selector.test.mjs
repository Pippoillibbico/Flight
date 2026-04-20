import test from 'node:test';
import assert from 'node:assert/strict';

import { selectOutboundProvider } from '../server/lib/outbound-provider-selector.js';

test('outbound selector prefers Duffel deep link when available', () => {
  const selected = selectOutboundProvider({
    deal: {
      price: 349.99,
      metadata: {
        duffel_booking_url: 'https://duffel.com/offers/test-offer-id'
      }
    },
    affiliateConfig: {
      travelpayoutsConfigured: true,
      kiwiConfigured: true,
      skyscannerConfigured: true
    }
  });

  assert.equal(selected.provider, 'duffel_link');
  assert.equal(selected.directUrl, 'https://duffel.com/offers/test-offer-id');
  assert.equal(selected.estimatedCommission, 0);
});

test('outbound selector falls back to travelpayouts when no Duffel link exists', () => {
  const selected = selectOutboundProvider({
    deal: { price: 500 },
    affiliateConfig: {
      travelpayoutsConfigured: true,
      kiwiConfigured: true,
      skyscannerConfigured: true
    }
  });

  assert.equal(selected.provider, 'travelpayouts');
  assert.equal(selected.directUrl, null);
  assert.equal(selected.estimatedCommission > 0, true);
});

test('outbound selector keeps Kiwi and Skyscanner optional and never mandatory', () => {
  const selected = selectOutboundProvider({
    deal: { price: 120 },
    affiliateConfig: {
      travelpayoutsConfigured: false,
      kiwiConfigured: false,
      skyscannerConfigured: false
    }
  });

  assert.equal(selected.provider, 'tde_booking');
  assert.equal(selected.directUrl, null);
  assert.equal(selected.estimatedCommission, 0);
});

