import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRegistry } from '../server/lib/providers/provider-registry.js';

test('provider registry opens circuit after repeated failures', async () => {
  const prevThreshold = process.env.PROVIDER_CIRCUIT_FAILURE_THRESHOLD;
  const prevOpenMs = process.env.PROVIDER_CIRCUIT_OPEN_MS;
  process.env.PROVIDER_CIRCUIT_FAILURE_THRESHOLD = '2';
  process.env.PROVIDER_CIRCUIT_OPEN_MS = '60000';

  const unstableProvider = {
    name: 'unstable',
    isEnabled: () => true,
    isConfigured: () => true,
    async searchOffers() {
      throw new Error('simulated_provider_failure');
    }
  };

  const registry = createProviderRegistry({ providers: [unstableProvider] });
  const params = {
    originIata: 'FCO',
    destinationIata: 'LIS',
    departureDate: '2027-05-01',
    returnDate: '2027-05-07',
    adults: 1,
    cabinClass: 'economy'
  };

  await assert.rejects(() => registry.searchOffers(params), /provider_search_all_failed/);
  await assert.rejects(() => registry.searchOffers(params), /provider_search_all_failed/);
  const afterFailures = registry.runtimeStats();
  assert.equal(afterFailures[0].circuitOpen, true);
  assert.equal(afterFailures[0].failures >= 2, true);

  const beforeThird = afterFailures[0].totalSearches;
  await assert.rejects(() => registry.searchOffers(params), /provider_circuit_open_all/);
  const afterThird = registry.runtimeStats();
  assert.equal(afterThird[0].totalSearches, beforeThird);

  process.env.PROVIDER_CIRCUIT_FAILURE_THRESHOLD = prevThreshold;
  process.env.PROVIDER_CIRCUIT_OPEN_MS = prevOpenMs;
});

test('provider registry times out hanging providers and opens circuit', async () => {
  const prevThreshold = process.env.PROVIDER_CIRCUIT_FAILURE_THRESHOLD;
  const prevOpenMs = process.env.PROVIDER_CIRCUIT_OPEN_MS;
  const prevSearchTimeoutMs = process.env.PROVIDER_SEARCH_TIMEOUT_MS;
  process.env.PROVIDER_CIRCUIT_FAILURE_THRESHOLD = '1';
  process.env.PROVIDER_CIRCUIT_OPEN_MS = '60000';
  process.env.PROVIDER_SEARCH_TIMEOUT_MS = '50';

  const hangingProvider = {
    name: 'hanging',
    isEnabled: () => true,
    isConfigured: () => true,
    async searchOffers() {
      return new Promise(() => {});
    }
  };

  const registry = createProviderRegistry({ providers: [hangingProvider] });
  const params = {
    originIata: 'FCO',
    destinationIata: 'LIS',
    departureDate: '2027-05-01',
    returnDate: '2027-05-07',
    adults: 1,
    cabinClass: 'economy'
  };

  const startedAt = Date.now();
  await assert.rejects(() => registry.searchOffers(params), /provider_search_all_failed/);
  const elapsedMs = Date.now() - startedAt;
  assert.equal(elapsedMs < 2000, true);

  const stats = registry.runtimeStats();
  assert.equal(stats[0].circuitOpen, true);
  assert.equal(stats[0].failures >= 1, true);

  process.env.PROVIDER_CIRCUIT_FAILURE_THRESHOLD = prevThreshold;
  process.env.PROVIDER_CIRCUIT_OPEN_MS = prevOpenMs;
  process.env.PROVIDER_SEARCH_TIMEOUT_MS = prevSearchTimeoutMs;
});
