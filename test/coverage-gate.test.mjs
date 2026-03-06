import test from 'node:test';
import assert from 'node:assert/strict';
import { getCoverageGate } from '../server/lib/coverage-gate.js';

test('coverage gate thresholds are stable', () => {
  assert.deepEqual(getCoverageGate(10), { allowed: false, visibility: 'hidden' });
  assert.deepEqual(getCoverageGate(25), { allowed: true, visibility: 'low_confidence' });
  assert.deepEqual(getCoverageGate(39), { allowed: true, visibility: 'low_confidence' });
  assert.deepEqual(getCoverageGate(40), { allowed: true, visibility: 'normal' });
});
