import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractJsonObject,
  parseDecisionAiPayload,
  parseIntentAiPayload,
  resolveOpportunityEnrichmentPayload
} from '../../server/lib/ai-output-guards.js';

test('extractJsonObject tolerates wrapped JSON content', () => {
  const parsed = extractJsonObject('prefix {"ok":true,"value":1} suffix');
  assert.deepEqual(parsed, { ok: true, value: 1 });
});

test('extractJsonObject rejects oversized model payloads', () => {
  const oversized = `${'x'.repeat(26_000)}{"ok":true}`;
  const parsed = extractJsonObject(oversized);
  assert.equal(parsed, null);
});

test('parseDecisionAiPayload enforces IATA format and sanitizes text', () => {
  const items = parseDecisionAiPayload({
    items: [
      {
        destinationIata: 'mxp',
        whyNow: '  <b>Strong value</b>  ',
        riskNote: ' \u0000Noisy'
      },
      {
        destinationIata: 'INVALID',
        whyNow: 'ignored',
        riskNote: 'ignored'
      }
    ]
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.destinationIata, 'MXP');
  assert.equal(items[0]?.whyNow, 'bStrong value/b');
  assert.equal(items[0]?.riskNote, 'Noisy');
});

test('parseIntentAiPayload keeps only allowed deterministic fields', () => {
  const parsed = parseIntentAiPayload({
    preferences: {
      origin: 'fco',
      budgetMax: 510,
      tripLengthDays: 11,
      mood: 'party',
      climatePreference: 'warm',
      pace: 'fast',
      avoidOvertourism: true,
      region: 'eu',
      packageCount: 4,
      injected: { nested: true }
    },
    summary: '  Best choices <script>alert(1)</script> '
  });

  assert.equal(parsed?.preferences.origin, 'FCO');
  assert.equal(parsed?.preferences.packageCount, 4);
  assert.equal(parsed?.preferences.injected, undefined);
  assert.equal(parsed?.summary, 'Best choices scriptalert(1)/script');
});

test('resolveOpportunityEnrichmentPayload falls back safely on malformed payload', () => {
  const fallback = {
    aiTitle: 'Fallback title',
    aiDescription: 'Fallback description',
    notificationText: 'Fallback notification',
    whyItMatters: 'Fallback reason'
  };

  const output = resolveOpportunityEnrichmentPayload({ ai_title: 42 }, fallback, 'Great deal');
  assert.equal(output.aiTitle, 'Fallback title');
  assert.equal(output.shortBadgeText, 'Great deal');
});
