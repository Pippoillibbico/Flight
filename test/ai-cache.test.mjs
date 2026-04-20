import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiCache, getAiCacheMetrics, resetAiCacheMetrics } from '../server/lib/ai-cache.js';

test('ai-cache dedupes semantic-equivalent prompts', async () => {
  resetAiCacheMetrics();
  const cache = createAiCache({ cacheClient: null, defaultTtlSeconds: 120 });
  let providerCalls = 0;

  const first = await cache.withCache(
    'intent_parse',
    { prompt: '  Rome   in June  ', packageCount: 3 },
    async () => {
      providerCalls += 1;
      return {
        value: { summary: 'ok' },
        usage: { prompt_tokens: 120, completion_tokens: 35 },
        model: 'gpt-4o-mini'
      };
    },
    { provider: 'chatgpt', route: 'decision.intake', semantic: true }
  );

  const second = await cache.withCache(
    'intent_parse',
    { packageCount: 3, prompt: 'rome in june' },
    async () => {
      providerCalls += 1;
      return { value: { summary: 'not expected' } };
    },
    { provider: 'chatgpt', route: 'decision.intake', semantic: true }
  );

  assert.equal(providerCalls, 1);
  assert.deepEqual(first, { summary: 'ok' });
  assert.deepEqual(second, { summary: 'ok' });

  const metrics = getAiCacheMetrics();
  assert.equal(metrics.misses, 1);
  assert.equal(metrics.hits, 1);
});

test('ai-cache dedupes in-flight concurrent misses', async () => {
  resetAiCacheMetrics();
  const cache = createAiCache({ cacheClient: null, defaultTtlSeconds: 60 });
  let providerCalls = 0;

  const [a, b] = await Promise.all([
    cache.withCache(
      'decision_enrich',
      { route: 'decision.just_go', prompt: 'foo' },
      async () => {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { value: ['x'], usage: { input_tokens: 40, output_tokens: 20 }, model: 'claude-3-5-sonnet-20241022' };
      },
      { provider: 'claude', route: 'decision.just_go', semantic: true }
    ),
    cache.withCache(
      'decision_enrich',
      { route: 'decision.just_go', prompt: 'foo' },
      async () => {
        providerCalls += 1;
        return { value: ['y'] };
      },
      { provider: 'claude', route: 'decision.just_go', semantic: true }
    )
  ]);

  assert.equal(providerCalls, 1);
  assert.deepEqual(a, ['x']);
  assert.deepEqual(b, ['x']);
  assert.equal(getAiCacheMetrics().inflightDeduped >= 1, true);
});

test('ai-cache supports cache-only mode (no live provider call on miss)', async () => {
  resetAiCacheMetrics();
  const cache = createAiCache({ cacheClient: null, defaultTtlSeconds: 60 });
  let providerCalls = 0;

  const value = await cache.withCache(
    'intent_parse',
    { prompt: 'cache only request' },
    async () => {
      providerCalls += 1;
      return { value: { summary: 'should not happen' } };
    },
    {
      provider: 'chatgpt',
      route: 'decision.intake',
      semantic: true,
      allowLiveCall: false
    }
  );

  assert.equal(providerCalls, 0);
  assert.equal(value, null);
  assert.equal(getAiCacheMetrics().cacheBypasses, 1);
});

test('ai-cache tracks estimated cost and cache savings', async () => {
  resetAiCacheMetrics();
  const cache = createAiCache({ cacheClient: null, defaultTtlSeconds: 120 });

  await cache.withCache(
    'intent_parse',
    { prompt: 'where should i go in july', packageCount: 3 },
    async () => ({
      value: { summary: 'done' },
      usage: { prompt_tokens: 300, completion_tokens: 100 },
      model: 'gpt-4o-mini'
    }),
    { provider: 'chatgpt', route: 'decision.intake', semantic: true }
  );

  await cache.withCache(
    'intent_parse',
    { packageCount: 3, prompt: 'Where should I go in July  ' },
    async () => ({ value: { summary: 'not expected' } }),
    { provider: 'chatgpt', route: 'decision.intake', semantic: true }
  );

  const metrics = getAiCacheMetrics();
  assert.equal(metrics.estimatedLiveCostEur > 0, true);
  assert.equal(metrics.estimatedSavedCostEur > 0, true);
  assert.equal(Number(metrics.callsByProvider.chatgpt || 0) >= 1, true);
  assert.equal(Number(metrics.callsByModel['gpt-4o-mini'] || 0) >= 1, true);
});

