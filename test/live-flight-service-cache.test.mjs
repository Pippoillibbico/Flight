import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLiveFlightService } from '../server/lib/live-flight-service.js';

class TestCache {
  constructor() {
    this.map = new Map();
    this.setexCalls = [];
  }

  async get(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  async setex(key, ttl, value) {
    this.map.set(key, String(value));
    this.setexCalls.push({ key, ttl: Number(ttl), value: String(value) });
    return 'OK';
  }

  async incr(key) {
    const next = Number(this.map.get(key) || 0) + 1;
    this.map.set(key, String(next));
    return next;
  }

  async incrby(key, amount) {
    const delta = Math.max(0, Math.trunc(Number(amount) || 0));
    const next = Number(this.map.get(key) || 0) + delta;
    this.map.set(key, String(next));
    return next;
  }

  async expire() {
    return 1;
  }

  async del(key) {
    const existed = this.map.has(key);
    this.map.delete(key);
    return existed ? 1 : 0;
  }
}

class FailingCache {
  async get() {
    throw new Error('cache get failed');
  }

  async setex() {
    throw new Error('cache set failed');
  }

  async del() {
    throw new Error('cache del failed');
  }

  async incr() {
    return 1;
  }

  async incrby(_key, amount) {
    return Number(amount || 0);
  }

  async expire() {
    return 1;
  }
}

function createProviderRegistryStub(handler) {
  return {
    async searchOffers(params) {
      return handler(params);
    }
  };
}

function addDaysIso(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe('live-flight-service intelligent caching', () => {
  it('blocks extra live provider calls when budget is exceeded and keeps partial feed', async () => {
    const prevMinuteBudget = process.env.SEARCH_PROVIDER_GLOBAL_PER_MINUTE_BUDGET;
    const prevFailOpen = process.env.SEARCH_PROVIDER_BUDGET_FAIL_OPEN;
    process.env.SEARCH_PROVIDER_GLOBAL_PER_MINUTE_BUDGET = '1';
    process.env.SEARCH_PROVIDER_BUDGET_FAIL_OPEN = 'false';

    try {
      const cache = new TestCache();
      let calls = 0;

      const providerRegistry = createProviderRegistryStub(async (params) => {
        calls += 1;
        return [
          {
            originIata: params.originIata,
            destinationIata: params.destinationIata,
            departureDate: params.departureDate,
            returnDate: params.returnDate,
            currency: 'EUR',
            totalPrice: params.destinationIata === 'BCN' ? 120 : 260,
            provider: 'duffel',
            tripType: params.returnDate ? 'round_trip' : 'one_way'
          }
        ];
      });

      const service = createLiveFlightService({ providerRegistry, cacheClient: cache });
      const result = await service.searchLiveFlights({
        originIata: 'MXP',
        destinations: ['BCN', 'JFK'],
        departureDate: addDaysIso(45),
        returnDate: null,
        adults: 1,
        cabinClass: 'economy',
        userId: 'u_budget_1'
      });

      assert.equal(calls, 1, 'only one live provider call should pass with per-minute budget=1');
      assert.equal(result.meta.budgetBlocked >= 1, true);
      assert.equal(Object.keys(result.offersByDest).length, 1);
    } finally {
      if (prevMinuteBudget === undefined) delete process.env.SEARCH_PROVIDER_GLOBAL_PER_MINUTE_BUDGET;
      else process.env.SEARCH_PROVIDER_GLOBAL_PER_MINUTE_BUDGET = prevMinuteBudget;
      if (prevFailOpen === undefined) delete process.env.SEARCH_PROVIDER_BUDGET_FAIL_OPEN;
      else process.env.SEARCH_PROVIDER_BUDGET_FAIL_OPEN = prevFailOpen;
    }
  });

  it('reuses bundle cache for repeated search requests', async () => {
    const cache = new TestCache();
    let calls = 0;

    const providerRegistry = createProviderRegistryStub(async (params) => {
      calls += 1;
      return [
        {
          originIata: params.originIata,
          destinationIata: params.destinationIata,
          departureDate: params.departureDate,
          returnDate: params.returnDate,
          currency: 'EUR',
          totalPrice: params.destinationIata === 'BCN' ? 120 : 260,
          provider: 'duffel',
          tripType: params.returnDate ? 'round_trip' : 'one_way'
        }
      ];
    });

    const service = createLiveFlightService({ providerRegistry, cacheClient: cache });
    const params = {
      originIata: 'mxp',
      destinations: ['bcn', 'jfk'],
      departureDate: addDaysIso(45),
      returnDate: null,
      adults: 1,
      cabinClass: 'economy'
    };

    const first = await service.searchLiveFlights(params);
    const second = await service.searchLiveFlights(params);

    assert.equal(calls, 2);
    assert.equal(first.meta.bundleCacheHit, false);
    assert.equal(second.meta.bundleCacheHit, true);
    assert.equal(Object.keys(second.offersByDest).length, 2);
  });

  it('uses deterministic keys for quasi-identical inputs', async () => {
    const cache = new TestCache();
    let calls = 0;

    const providerRegistry = createProviderRegistryStub(async (params) => {
      calls += 1;
      return [
        {
          originIata: params.originIata,
          destinationIata: params.destinationIata,
          departureDate: params.departureDate,
          returnDate: params.returnDate,
          currency: 'EUR',
          totalPrice: 180,
          provider: 'duffel',
          tripType: params.returnDate ? 'round_trip' : 'one_way'
        }
      ];
    });

    const service = createLiveFlightService({ providerRegistry, cacheClient: cache });

    await service.searchLiveFlights({
      originIata: ' mxp ',
      destinations: ['jfk', 'BCN', 'jfk'],
      departureDate: addDaysIso(50),
      returnDate: '',
      adults: '1',
      cabinClass: 'premium_economy'
    });

    const second = await service.searchLiveFlights({
      originIata: 'MXP',
      destinations: ['BCN', 'JFK'],
      departureDate: addDaysIso(50),
      returnDate: null,
      adults: 1.2,
      cabinClass: 'premium'
    });

    assert.equal(calls, 2, 'provider should be called once per destination on first request only');
    assert.equal(second.meta.bundleCacheHit, true);
  });

  it('deduplicates concurrent identical requests in-flight', async () => {
    const cache = new TestCache();
    let calls = 0;

    const providerRegistry = createProviderRegistryStub(async (params) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return [
        {
          originIata: params.originIata,
          destinationIata: params.destinationIata,
          departureDate: params.departureDate,
          returnDate: params.returnDate,
          currency: 'EUR',
          totalPrice: 140,
          provider: 'duffel',
          tripType: 'one_way'
        }
      ];
    });

    const service = createLiveFlightService({ providerRegistry, cacheClient: cache });
    const params = {
      originIata: 'FCO',
      destinations: ['MAD'],
      departureDate: addDaysIso(30),
      returnDate: null,
      adults: 1,
      cabinClass: 'economy'
    };

    const [a, b] = await Promise.all([
      service.searchLiveFlights(params),
      service.searchLiveFlights(params)
    ]);

    assert.equal(calls, 1, 'concurrent duplicate requests must share the same provider call');
    assert.equal(Boolean(a.meta.dedupedByInFlight || b.meta.dedupedByInFlight), true);
  });

  it('falls back safely when cache layer fails', async () => {
    const cache = new FailingCache();
    let calls = 0;

    const providerRegistry = createProviderRegistryStub(async (params) => {
      calls += 1;
      return [
        {
          originIata: params.originIata,
          destinationIata: params.destinationIata,
          departureDate: params.departureDate,
          returnDate: params.returnDate,
          currency: 'EUR',
          totalPrice: 199,
          provider: 'duffel',
          tripType: 'one_way'
        }
      ];
    });

    const service = createLiveFlightService({ providerRegistry, cacheClient: cache });

    const result = await service.searchLiveFlights({
      originIata: 'VCE',
      destinations: ['LHR'],
      departureDate: addDaysIso(21),
      returnDate: null,
      adults: 1,
      cabinClass: 'economy'
    });

    assert.equal(calls, 1);
    assert.equal(Object.keys(result.offersByDest).length, 1);
  });

  it('caches negative results to avoid repeated empty provider calls', async () => {
    const cache = new TestCache();
    let calls = 0;

    const providerRegistry = createProviderRegistryStub(async () => {
      calls += 1;
      return [];
    });

    const service = createLiveFlightService({ providerRegistry, cacheClient: cache });
    const params = {
      originIata: 'BLQ',
      destinations: ['SIN'],
      departureDate: addDaysIso(18),
      returnDate: null,
      adults: 1,
      cabinClass: 'economy'
    };

    const first = await service.searchLiveFlights(params);
    const second = await service.searchLiveFlights(params);

    assert.equal(calls, 1);
    assert.equal(first.meta.bundleCacheHit, false);
    assert.equal(second.meta.bundleCacheHit, true);
    assert.equal(Object.keys(second.offersByDest).length, 0);
  });

  it('supports explicit cache invalidation for one search payload', async () => {
    const cache = new TestCache();
    let calls = 0;

    const providerRegistry = createProviderRegistryStub(async (params) => {
      calls += 1;
      return [
        {
          originIata: params.originIata,
          destinationIata: params.destinationIata,
          departureDate: params.departureDate,
          returnDate: params.returnDate,
          currency: 'EUR',
          totalPrice: 149,
          provider: 'duffel',
          tripType: 'one_way'
        }
      ];
    });

    const service = createLiveFlightService({ providerRegistry, cacheClient: cache });
    const params = {
      originIata: 'MXP',
      destinations: ['BCN'],
      departureDate: addDaysIso(40),
      returnDate: null,
      adults: 1,
      cabinClass: 'economy'
    };

    await service.searchLiveFlights(params);
    await service.searchLiveFlights(params);
    assert.equal(calls, 1);

    const invalidation = await service.invalidateLiveSearchCache(params);
    assert.ok(invalidation.deleted >= 1);

    await service.searchLiveFlights(params);
    assert.equal(calls, 2);
  });

  it('extends ttl for hot routes after repeated demand', async () => {
    const cache = new TestCache();

    const providerRegistry = createProviderRegistryStub(async (params) => [
      {
        originIata: params.originIata,
        destinationIata: params.destinationIata,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        currency: 'EUR',
        totalPrice: 173,
        provider: 'duffel',
        tripType: 'one_way'
      }
    ]);

    const service = createLiveFlightService({ providerRegistry, cacheClient: cache });

    const params = {
      originIata: 'FCO',
      destinations: ['JFK'],
      departureDate: addDaysIso(90),
      returnDate: null,
      adults: 1,
      cabinClass: 'economy'
    };

    let firstDestTtl = null;
    let lastDestTtl = null;

    for (let i = 0; i < 8; i += 1) {
      await service.searchLiveFlights(params);
      const destWrite = [...cache.setexCalls]
        .reverse()
        .find((row) => row.key.startsWith('live:offers:v2:FCO:JFK:'));
      if (destWrite) {
        if (firstDestTtl === null) firstDestTtl = destWrite.ttl;
        lastDestTtl = destWrite.ttl;
      }
      await service.invalidateLiveSearchCache(params);
    }

    assert.ok(firstDestTtl !== null && lastDestTtl !== null);
    assert.ok(lastDestTtl >= firstDestTtl, 'hot route ttl should not shrink after repeated demand');

    const metrics = service.getCacheMetrics();
    assert.ok(metrics.searchRequests >= 8);
  });
});
