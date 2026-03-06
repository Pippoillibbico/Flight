import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRegistry } from '../server/lib/providers/provider-registry.js';

test('provider registry skips missing credentials safely', async () => {
  const previous = {
    ENABLE_PROVIDER_DUFFEL: process.env.ENABLE_PROVIDER_DUFFEL,
    ENABLE_PROVIDER_AMADEUS: process.env.ENABLE_PROVIDER_AMADEUS,
    DUFFEL_API_KEY: process.env.DUFFEL_API_KEY,
    AMADEUS_CLIENT_ID: process.env.AMADEUS_CLIENT_ID,
    AMADEUS_CLIENT_SECRET: process.env.AMADEUS_CLIENT_SECRET
  };

  process.env.ENABLE_PROVIDER_DUFFEL = 'true';
  process.env.ENABLE_PROVIDER_AMADEUS = 'true';
  process.env.DUFFEL_API_KEY = '';
  process.env.AMADEUS_CLIENT_ID = '';
  process.env.AMADEUS_CLIENT_SECRET = '';

  const registry = createProviderRegistry();
  const providers = registry.listProviders();
  assert.equal(providers.some((p) => p.name === 'duffel' && p.enabled && !p.configured), true);
  assert.equal(providers.some((p) => p.name === 'amadeus' && p.enabled && !p.configured), true);
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
  process.env.ENABLE_PROVIDER_AMADEUS = previous.ENABLE_PROVIDER_AMADEUS;
  process.env.DUFFEL_API_KEY = previous.DUFFEL_API_KEY;
  process.env.AMADEUS_CLIENT_ID = previous.AMADEUS_CLIENT_ID;
  process.env.AMADEUS_CLIENT_SECRET = previous.AMADEUS_CLIENT_SECRET;
});
