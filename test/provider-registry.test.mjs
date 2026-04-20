import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRegistry } from '../server/lib/providers/provider-registry.js';

test('provider registry skips missing credentials safely', async () => {
  const previous = {
    ENABLE_PROVIDER_DUFFEL: process.env.ENABLE_PROVIDER_DUFFEL,
    DUFFEL_API_KEY: process.env.DUFFEL_API_KEY
  };

  process.env.ENABLE_PROVIDER_DUFFEL = 'true';
  process.env.DUFFEL_API_KEY = '';

  const registry = createProviderRegistry();
  const providers = registry.listProviders();
  assert.equal(providers.some((p) => p.name === 'duffel' && p.enabled && !p.configured), true);
  const offers = await registry.searchOffers({
    originIata: 'FCO',
    destinationIata: 'LIS',
    departureDate: '2027-05-01',
    returnDate: '2027-05-07',
    adults: 1,
    cabinClass: 'economy'
  });
  assert.deepEqual(offers, []);

  process.env.ENABLE_PROVIDER_DUFFEL = previous.ENABLE_PROVIDER_DUFFEL;
  process.env.DUFFEL_API_KEY = previous.DUFFEL_API_KEY;
});

test('provider registry reflects duffel-only soft-launch profile flags', () => {
  const previous = {
    ENABLE_PROVIDER_DUFFEL: process.env.ENABLE_PROVIDER_DUFFEL,
    DUFFEL_API_KEY: process.env.DUFFEL_API_KEY,
    ENABLE_PROVIDER_KIWI: process.env.ENABLE_PROVIDER_KIWI,
    KIWI_TEQUILA_API_KEY: process.env.KIWI_TEQUILA_API_KEY,
    ENABLE_PROVIDER_SKYSCANNER: process.env.ENABLE_PROVIDER_SKYSCANNER,
    SKYSCANNER_API_KEY: process.env.SKYSCANNER_API_KEY
  };

  process.env.ENABLE_PROVIDER_DUFFEL = 'true';
  process.env.DUFFEL_API_KEY = 'duffel_test_key_profile';
  process.env.ENABLE_PROVIDER_KIWI = 'false';
  process.env.KIWI_TEQUILA_API_KEY = '';
  process.env.ENABLE_PROVIDER_SKYSCANNER = 'false';
  process.env.SKYSCANNER_API_KEY = '';

  const registry = createProviderRegistry();
  const providers = registry.listProviders();

  const duffel = providers.find((item) => item.name === 'duffel');
  const kiwi = providers.find((item) => item.name === 'kiwi');
  const skyscanner = providers.find((item) => item.name === 'skyscanner');

  assert.equal(Boolean(duffel?.enabled), true);
  assert.equal(Boolean(duffel?.configured), true);
  assert.equal(Boolean(kiwi?.enabled), false);
  assert.equal(Boolean(skyscanner?.enabled), false);

  process.env.ENABLE_PROVIDER_DUFFEL = previous.ENABLE_PROVIDER_DUFFEL;
  process.env.DUFFEL_API_KEY = previous.DUFFEL_API_KEY;
  process.env.ENABLE_PROVIDER_KIWI = previous.ENABLE_PROVIDER_KIWI;
  process.env.KIWI_TEQUILA_API_KEY = previous.KIWI_TEQUILA_API_KEY;
  process.env.ENABLE_PROVIDER_SKYSCANNER = previous.ENABLE_PROVIDER_SKYSCANNER;
  process.env.SKYSCANNER_API_KEY = previous.SKYSCANNER_API_KEY;
});
