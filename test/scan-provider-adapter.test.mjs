import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createScanProviderAdapter } from '../server/lib/scan/provider-adapter.js';

function createMemoryCache() {
  const kv = new Map();
  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }
  function getEntry(key) {
    const hit = kv.get(key);
    if (!hit) return null;
    if (hit.expiresAt && hit.expiresAt <= nowSec()) {
      kv.delete(key);
      return null;
    }
    return hit;
  }
  return {
    async get(key) {
      return getEntry(key)?.value ?? null;
    },
    async setex(key, ttlSec, value) {
      kv.set(key, {
        value: String(value),
        expiresAt: nowSec() + Math.max(0, Number(ttlSec || 0))
      });
      return 'OK';
    },
    async incr(key) {
      const current = Number(getEntry(key)?.value || 0);
      const next = current + 1;
      const expiresAt = getEntry(key)?.expiresAt || null;
      kv.set(key, { value: String(next), expiresAt });
      return next;
    },
    async expire(_key, _ttlSec) {
      return 1;
    },
    async setnx(key, value, ttlSec) {
      if (getEntry(key)) return 0;
      kv.set(key, {
        value: String(value),
        expiresAt: nowSec() + Math.max(0, Number(ttlSec || 0))
      });
      return 1;
    },
    async del(key) {
      kv.delete(key);
      return 1;
    }
  };
}

test('provider adapter caches offers and avoids repeated provider call', async () => {
  let calls = 0;
  const providerRegistry = {
    async searchOffers() {
      calls += 1;
      return [
        {
          originIata: 'MXP',
          destinationIata: 'JFK',
          departureDate: '2026-08-10',
          returnDate: '2026-08-20',
          totalPrice: 420,
          currency: 'EUR',
          provider: 'mock',
          tripType: 'round_trip',
          cabinClass: 'economy',
          source: 'partner_feed',
          metadata: { totalStops: 1 }
        }
      ];
    }
  };

  const adapter = createScanProviderAdapter({
    cache: createMemoryCache(),
    providerRegistry,
    logger: { info: () => {}, warn: () => {} },
    maxRequestsPerMinute: 10,
    retries: 0
  });

  const first = await adapter.fetchOffers({
    originIata: 'MXP',
    destinationIata: 'JFK',
    departureDate: '2026-08-10',
    returnDate: '2026-08-20',
    adults: 1,
    cabinClass: 'economy'
  });

  const second = await adapter.fetchOffers({
    originIata: 'MXP',
    destinationIata: 'JFK',
    departureDate: '2026-08-10',
    returnDate: '2026-08-20',
    adults: 1,
    cabinClass: 'economy'
  });

  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.equal(calls, 1);
  assert.equal(first.offers.length, 1);
});

test('provider adapter enforces rate limit', async () => {
  const providerRegistry = {
    async searchOffers() {
      return [];
    }
  };

  const adapter = createScanProviderAdapter({
    cache: createMemoryCache(),
    providerRegistry,
    logger: { info: () => {}, warn: () => {} },
    maxRequestsPerMinute: 1,
    retries: 0,
    cacheTtlSec: 1
  });

  await adapter.fetchOffers({
    originIata: 'FCO',
    destinationIata: 'LHR',
    departureDate: '2026-09-10',
    returnDate: '2026-09-15',
    adults: 1,
    cabinClass: 'economy'
  });

  await assert.rejects(
    () =>
      adapter.fetchOffers({
        originIata: 'FCO',
        destinationIata: 'CDG',
        departureDate: '2026-09-10',
        returnDate: '2026-09-15',
        adults: 1,
        cabinClass: 'economy'
      }),
    /provider_rate_limit_exceeded/
  );
});

test('provider adapter enforces priority-specific rate limits', async () => {
  const originalHigh = process.env.FLIGHT_SCAN_PROVIDER_RPM_HIGH;
  const originalMedium = process.env.FLIGHT_SCAN_PROVIDER_RPM_MEDIUM;
  const originalLow = process.env.FLIGHT_SCAN_PROVIDER_RPM_LOW;
  process.env.FLIGHT_SCAN_PROVIDER_RPM_HIGH = '5';
  process.env.FLIGHT_SCAN_PROVIDER_RPM_MEDIUM = '5';
  process.env.FLIGHT_SCAN_PROVIDER_RPM_LOW = '1';

  try {
    const providerRegistry = {
      async searchOffers() {
        return [];
      }
    };

    const adapter = createScanProviderAdapter({
      cache: createMemoryCache(),
      providerRegistry,
      logger: { info: () => {}, warn: () => {} },
      maxRequestsPerMinute: 50,
      retries: 0,
      cacheTtlSec: 1
    });

    await adapter.fetchOffers({
      originIata: 'MXP',
      destinationIata: 'LHR',
      departureDate: '2026-09-12',
      returnDate: '2026-09-19',
      adults: 1,
      cabinClass: 'economy',
      metadata: { priority: 'low' }
    });

    await assert.rejects(
      () =>
        adapter.fetchOffers({
          originIata: 'MXP',
          destinationIata: 'CDG',
          departureDate: '2026-09-13',
          returnDate: '2026-09-20',
          adults: 1,
          cabinClass: 'economy',
          metadata: { priority: 'low' }
        }),
      /provider_rate_limit_priority_exceeded/
    );
  } finally {
    if (typeof originalHigh === 'undefined') delete process.env.FLIGHT_SCAN_PROVIDER_RPM_HIGH;
    else process.env.FLIGHT_SCAN_PROVIDER_RPM_HIGH = originalHigh;
    if (typeof originalMedium === 'undefined') delete process.env.FLIGHT_SCAN_PROVIDER_RPM_MEDIUM;
    else process.env.FLIGHT_SCAN_PROVIDER_RPM_MEDIUM = originalMedium;
    if (typeof originalLow === 'undefined') delete process.env.FLIGHT_SCAN_PROVIDER_RPM_LOW;
    else process.env.FLIGHT_SCAN_PROVIDER_RPM_LOW = originalLow;
  }
});

test('provider adapter serves stale cache when provider keeps failing', async () => {
  const originalStaleTtl = process.env.FLIGHT_SCAN_PROVIDER_STALE_TTL_SEC;
  process.env.FLIGHT_SCAN_PROVIDER_STALE_TTL_SEC = '600';

  const cache = createMemoryCache();
  const request = {
    originIata: 'FCO',
    destinationIata: 'NRT',
    departureDate: '2026-11-10',
    returnDate: '2026-11-20',
    adults: 1,
    cabinClass: 'economy'
  };

  const warmAdapter = createScanProviderAdapter({
    cache,
    providerRegistry: {
      async searchOffers() {
        return [
          {
            originIata: 'FCO',
            destinationIata: 'NRT',
            departureDate: '2026-11-10',
            returnDate: '2026-11-20',
            totalPrice: 510,
            currency: 'EUR',
            provider: 'mock',
            tripType: 'round_trip',
            cabinClass: 'economy',
            source: 'partner_feed',
            metadata: { totalStops: 1 }
          }
        ];
      }
    },
    logger: { info: () => {}, warn: () => {} },
    retries: 0,
    cacheTtlSec: 1
  });
  await warmAdapter.fetchOffers(request);
  const requestHash = createHash('sha1')
    .update(
      JSON.stringify({
        originIata: 'FCO',
        destinationIata: 'NRT',
        departureDate: '2026-11-10',
        returnDate: '2026-11-20',
        adults: 1,
        cabinClass: 'economy'
      })
    )
    .digest('hex');
  const activeKey = `flight_scan:provider:offers:${requestHash}`;
  await cache.del(activeKey);

  const failingAdapter = createScanProviderAdapter({
    cache,
    providerRegistry: {
      async searchOffers() {
        throw new Error('provider_offline');
      }
    },
    logger: { info: () => {}, warn: () => {} },
    retries: 0,
    cacheTtlSec: 1
  });

  try {
    const result = await failingAdapter.fetchOffers(request);
    assert.equal(result.fromCache, true);
    assert.equal(result.stale, true);
    assert.equal(Array.isArray(result.offers), true);
    assert.equal(result.offers.length, 1);
  } finally {
    if (typeof originalStaleTtl === 'undefined') delete process.env.FLIGHT_SCAN_PROVIDER_STALE_TTL_SEC;
    else process.env.FLIGHT_SCAN_PROVIDER_STALE_TTL_SEC = originalStaleTtl;
  }
});

test('provider adapter fails fast with provider_request_inflight when lock is already held', async () => {
  const originalInFlightWaitMs = process.env.FLIGHT_SCAN_PROVIDER_INFLIGHT_WAIT_MS;
  process.env.FLIGHT_SCAN_PROVIDER_INFLIGHT_WAIT_MS = '0';

  let providerCalls = 0;
  let rateCounterCalls = 0;
  const cache = {
    async get() {
      return null;
    },
    async setnx() {
      return 0;
    },
    async incr() {
      rateCounterCalls += 1;
      return 1;
    },
    async expire() {
      return 1;
    },
    async setex() {
      return 'OK';
    },
    async del() {
      return 1;
    }
  };

  const adapter = createScanProviderAdapter({
    cache,
    providerRegistry: {
      async searchOffers() {
        providerCalls += 1;
        return [];
      }
    },
    logger: { info: () => {}, warn: () => {} },
    retries: 0,
    maxRequestsPerMinute: 10
  });

  try {
    await assert.rejects(
      () =>
        adapter.fetchOffers({
          originIata: 'FCO',
          destinationIata: 'MAD',
          departureDate: '2026-10-10',
          returnDate: '2026-10-15',
          adults: 1,
          cabinClass: 'economy'
        }),
      /provider_request_inflight/
    );
    assert.equal(providerCalls, 0);
    assert.equal(rateCounterCalls, 0);
  } finally {
    if (typeof originalInFlightWaitMs === 'undefined') delete process.env.FLIGHT_SCAN_PROVIDER_INFLIGHT_WAIT_MS;
    else process.env.FLIGHT_SCAN_PROVIDER_INFLIGHT_WAIT_MS = originalInFlightWaitMs;
  }
});

test('provider adapter uses shorter active cache ttl when provider returns empty offers', async () => {
  const prevEmptyTtl = process.env.FLIGHT_SCAN_PROVIDER_EMPTY_CACHE_TTL_SEC;
  process.env.FLIGHT_SCAN_PROVIDER_EMPTY_CACHE_TTL_SEC = '30';

  const setexCalls = [];
  const cache = {
    async get() {
      return null;
    },
    async setex(key, ttlSec, value) {
      setexCalls.push({ key: String(key), ttlSec: Number(ttlSec), value: String(value) });
      return 'OK';
    },
    async incr() {
      return 1;
    },
    async expire() {
      return 1;
    },
    async setnx() {
      return 1;
    },
    async del() {
      return 1;
    }
  };

  const adapter = createScanProviderAdapter({
    cache,
    providerRegistry: {
      async searchOffers() {
        return [];
      }
    },
    logger: { info: () => {}, warn: () => {} },
    retries: 0,
    cacheTtlSec: 300
  });

  try {
    const result = await adapter.fetchOffers({
      originIata: 'FCO',
      destinationIata: 'AMS',
      departureDate: '2026-12-01',
      returnDate: '2026-12-07',
      adults: 1,
      cabinClass: 'economy'
    });
    assert.equal(result.fromCache, false);
    const activeCall = setexCalls.find((item) => item.key.includes(':offers:') && !item.key.endsWith(':stale'));
    const staleCall = setexCalls.find((item) => item.key.endsWith(':stale'));
    assert.equal(Boolean(activeCall), true);
    assert.equal(Boolean(staleCall), true);
    assert.equal(activeCall.ttlSec, 30);
    assert.equal(staleCall.ttlSec >= 60, true);
  } finally {
    if (typeof prevEmptyTtl === 'undefined') delete process.env.FLIGHT_SCAN_PROVIDER_EMPTY_CACHE_TTL_SEC;
    else process.env.FLIGHT_SCAN_PROVIDER_EMPTY_CACHE_TTL_SEC = prevEmptyTtl;
  }
});
