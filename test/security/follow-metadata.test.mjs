import assert from 'node:assert/strict';
import test from 'node:test';

import { followMetadataSchema, sanitizeFollowMetadata } from '../../server/lib/follow-metadata.js';

test('sanitizeFollowMetadata drops nested and unsupported values', () => {
  const sanitized = sanitizeFollowMetadata({
    topic: '  Radar  ',
    score: 42.12345,
    enabled: true,
    nested: { bad: true },
    tags: ['hot', 'new', { nope: true }],
    bigint: 9_999_999_999
  });

  assert.equal(sanitized.topic, 'Radar');
  assert.equal(sanitized.score, 42.123);
  assert.equal(sanitized.enabled, true);
  assert.equal('nested' in sanitized, false);
  assert.deepEqual(sanitized.tags, ['hot', 'new']);
  assert.equal('bigint' in sanitized, false);
});

test('followMetadataSchema rejects oversized payloads', () => {
  const huge = {};
  for (let index = 0; index < 30; index += 1) {
    huge[`k${index}`] = `value-${index}`;
  }

  const parsed = followMetadataSchema.safeParse(huge);
  assert.equal(parsed.success, false);
});

test('followMetadataSchema accepts safe primitive metadata', () => {
  const parsed = followMetadataSchema.safeParse({
    source: 'cluster',
    score: 88,
    labels: ['hot', 'new'],
    active: true,
    nullable: null
  });

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data, {
    source: 'cluster',
    score: 88,
    labels: ['hot', 'new'],
    active: true,
    nullable: null
  });
});
