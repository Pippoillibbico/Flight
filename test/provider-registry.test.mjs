import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRegistry } from '../server/lib/providers/provider-registry.js';
import { KiwiProvider } from '../server/lib/providers/kiwi-provider.js';

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

test('provider registry reflects kiwi-primary with duffel-secondary soft-launch profile flags', () => {
  const previous = {
    ENABLE_PROVIDER_DUFFEL: process.env.ENABLE_PROVIDER_DUFFEL,
    DUFFEL_API_KEY: process.env.DUFFEL_API_KEY,
    ENABLE_PROVIDER_KIWI: process.env.ENABLE_PROVIDER_KIWI,
    KIWI_API_KEY: process.env.KIWI_API_KEY,
    ENABLE_PROVIDER_SKYSCANNER: process.env.ENABLE_PROVIDER_SKYSCANNER,
    SKYSCANNER_API_KEY: process.env.SKYSCANNER_API_KEY
  };

  process.env.ENABLE_PROVIDER_DUFFEL = 'true';
  process.env.DUFFEL_API_KEY = 'duffel_test_key_profile';
  process.env.ENABLE_PROVIDER_KIWI = 'true';
  process.env.KIWI_API_KEY = 'kiwi_test_key_profile';
  process.env.ENABLE_PROVIDER_SKYSCANNER = 'false';
  process.env.SKYSCANNER_API_KEY = '';

  const registry = createProviderRegistry();
  const providers = registry.listProviders();

  const duffel = providers.find((item) => item.name === 'duffel');
  const kiwi = providers.find((item) => item.name === 'kiwi');
  const skyscanner = providers.find((item) => item.name === 'skyscanner');

  assert.equal(providers[0]?.name, 'kiwi');
  assert.equal(Boolean(kiwi?.enabled), true);
  assert.equal(Boolean(kiwi?.configured), true);
  assert.equal(Boolean(duffel?.enabled), true);
  assert.equal(Boolean(duffel?.configured), true);
  assert.equal(Boolean(skyscanner?.enabled), false);

  process.env.ENABLE_PROVIDER_DUFFEL = previous.ENABLE_PROVIDER_DUFFEL;
  process.env.DUFFEL_API_KEY = previous.DUFFEL_API_KEY;
  process.env.ENABLE_PROVIDER_KIWI = previous.ENABLE_PROVIDER_KIWI;
  process.env.KIWI_API_KEY = previous.KIWI_API_KEY;
  process.env.ENABLE_PROVIDER_SKYSCANNER = previous.ENABLE_PROVIDER_SKYSCANNER;
  process.env.SKYSCANNER_API_KEY = previous.SKYSCANNER_API_KEY;
});

test('kiwi provider uses constructor baseUrl instead of module-load env', async () => {
  const previousFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const provider = new KiwiProvider({
      enabled: true,
      apiKey: 'kiwi_test_key',
      baseUrl: 'https://kiwi.test.local/'
    });
    await provider.searchOffers({
      originIata: 'MXP',
      destinationIata: 'LIS',
      departureDate: '2027-05-01',
      returnDate: '2027-05-07',
      adults: 1,
      cabinClass: 'economy'
    });
    assert.equal(requestedUrls.length, 1);
    assert.equal(requestedUrls[0].startsWith('https://kiwi.test.local/v2/search?'), true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
