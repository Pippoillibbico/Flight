import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addMultiCitySegment,
  buildMultiCitySearchPayload,
  createDefaultMultiCitySegments,
  removeMultiCitySegment,
  updateMultiCitySegmentField,
  validateMultiCityForm
} from '../../src/features/multi-city/index.ts';
import { executeWithRetry } from '../../src/features/multi-city/domain/retry-policy.ts';

test('validation rejects missing fields and same origin/destination', () => {
  const result = validateMultiCityForm({
    segments: [
      { id: 'segment-1', origin: 'mxp', destination: 'mxp', date: '' },
      { id: 'segment-2', origin: '', destination: 'lis', date: '2026-06-10' }
    ]
  });
  assert.equal(result.valid, false);
  assert.equal(result.segmentErrors[0]?.destination, 'Origin and destination cannot be the same.');
  assert.equal(result.segmentErrors[0]?.date, 'Date is required.');
  assert.equal(result.segmentErrors[1]?.origin, 'Origin is required.');
});

test('validation rejects reverse chronology', () => {
  const result = validateMultiCityForm({
    segments: [
      { id: 'segment-1', origin: 'MXP', destination: 'LIS', date: '2026-06-15' },
      { id: 'segment-2', origin: 'LIS', destination: 'MAD', date: '2026-06-14' }
    ]
  });
  assert.equal(result.valid, false);
  assert.equal(result.segmentErrors[1]?.date, 'Segment date cannot be earlier than previous segment.');
});

test('validation re-checks dependent segment dates when previous segment changes', () => {
  const base = [
    { id: 'segment-1', origin: 'MXP', destination: 'LIS', date: '2026-06-10' },
    { id: 'segment-2', origin: 'LIS', destination: 'MAD', date: '2026-06-14' }
  ];
  const initiallyValid = validateMultiCityForm({ segments: base });
  assert.equal(initiallyValid.valid, true);

  const changed = updateMultiCitySegmentField(base, 0, 'date', '2026-06-20');
  const afterChange = validateMultiCityForm({ segments: changed });
  assert.equal(afterChange.valid, false);
  assert.equal(afterChange.segmentErrors[1]?.date, 'Segment date cannot be earlier than previous segment.');
});

test('validation rejects impossible calendar dates', () => {
  const result = validateMultiCityForm({
    segments: [
      { id: 'segment-1', origin: 'MXP', destination: 'LIS', date: '2026-02-30' },
      { id: 'segment-2', origin: 'LIS', destination: 'MAD', date: '2026-03-04' }
    ]
  });
  assert.equal(result.valid, false);
  assert.equal(result.segmentErrors[0]?.date, 'Date must be a valid YYYY-MM-DD value.');
});

test('payload preserves exact segment order for API', () => {
  const sourceSegments = [
    { id: 'segment-1', origin: 'mxp', destination: 'lis', date: '2026-06-10' },
    { id: 'segment-2', origin: 'lis', destination: 'mad', date: '2026-06-14' },
    { id: 'segment-3', origin: 'mad', destination: 'fco', date: '2026-06-18' }
  ];
  const beforeSnapshot = JSON.stringify(sourceSegments);
  const payload = buildMultiCitySearchPayload(
    sourceSegments,
    {
      region: 'all',
      connectionType: 'all',
      travelTime: 'all',
      travellers: 1,
      cabinClass: 'economy',
      cheapOnly: true
    }
  );

  assert.equal(payload.mode, 'multi_city');
  assert.deepEqual(payload.segments, [
    { origin: 'MXP', destination: 'LIS', date: '2026-06-10' },
    { origin: 'LIS', destination: 'MAD', date: '2026-06-14' },
    { origin: 'MAD', destination: 'FCO', date: '2026-06-18' }
  ]);
  assert.equal(payload.origin, 'MXP');
  assert.equal(payload.destinationQuery, 'FCO');
  assert.equal(payload.dateFrom, '2026-06-10');
  assert.equal(payload.dateTo, '2026-06-18');
  assert.equal(JSON.stringify(sourceSegments), beforeSnapshot);
});

test('segment add/remove respects 2..6 bounds', () => {
  let segments = createDefaultMultiCitySegments('2026-06-10', '2026-06-14');
  assert.equal(segments.length, 2);

  for (let index = 0; index < 6; index += 1) {
    segments = addMultiCitySegment(segments);
  }
  assert.equal(segments.length, 6);

  segments = addMultiCitySegment(segments);
  assert.equal(segments.length, 6);

  for (let index = 0; index < 10; index += 1) {
    segments = removeMultiCitySegment(segments, segments.length - 1);
  }
  assert.equal(segments.length, 2);
});

test('segment add after mid removal keeps unique ids (no key collision)', () => {
  let segments = createDefaultMultiCitySegments('2026-06-10', '2026-06-14');
  segments = addMultiCitySegment(segments);
  segments = addMultiCitySegment(segments);
  assert.equal(segments.length, 4);

  const removedMid = removeMultiCitySegment(segments, 1);
  assert.equal(removedMid.length, 3);

  const afterAdd = addMultiCitySegment(removedMid);
  const ids = afterAdd.map((segment) => segment.id);
  const uniqueIds = new Set(ids);
  assert.equal(afterAdd.length, 4);
  assert.equal(uniqueIds.size, 4);
});

test('removeMultiCitySegment preserves relative order of remaining segments', () => {
  const segments = [
    { id: 'segment-1', origin: 'MXP', destination: 'LIS', date: '2026-06-10' },
    { id: 'segment-2', origin: 'LIS', destination: 'MAD', date: '2026-06-12' },
    { id: 'segment-3', origin: 'MAD', destination: 'ATH', date: '2026-06-14' },
    { id: 'segment-4', origin: 'ATH', destination: 'DXB', date: '2026-06-16' }
  ];

  const result = removeMultiCitySegment(segments, 1);
  assert.deepEqual(
    result.map((segment) => segment.id),
    ['segment-1', 'segment-3', 'segment-4']
  );
  assert.equal(result[1]?.origin, 'MAD');
  assert.equal(result[1]?.destination, 'ATH');
});

test('updateMultiCitySegmentField only updates the targeted segment and field', () => {
  const source = [
    { id: 'segment-1', origin: 'mxp', destination: 'lis', date: '2026-06-10' },
    { id: 'segment-2', origin: 'lis', destination: 'mad', date: '2026-06-12' }
  ];

  const updated = updateMultiCitySegmentField(source, 1, 'destination', 'ath');
  assert.equal(updated[0]?.origin, 'mxp');
  assert.equal(updated[0]?.destination, 'lis');
  assert.equal(updated[1]?.destination, 'ATH');
  assert.equal(updated[1]?.origin, 'lis');
  assert.equal(updated[1]?.date, '2026-06-12');
});

test('retry policy retries bounded attempts with deterministic backoff', async () => {
  let calls = 0;
  const waits: number[] = [];

  await assert.rejects(
    executeWithRetry(
      async () => {
        calls += 1;
        const error = new Error('rate limited') as Error & { status?: number };
        error.status = 429;
        throw error;
      },
      { maxAttempts: 3, initialDelayMs: 300 },
      async (ms) => {
        waits.push(ms);
      }
    ),
    /rate limited/
  );

  assert.equal(calls, 3);
  assert.deepEqual(waits, [300, 900]);
});

test('retry policy does not retry non-retryable errors', async () => {
  let calls = 0;

  await assert.rejects(
    executeWithRetry(async () => {
      calls += 1;
      const error = new Error('bad request') as Error & { status?: number };
      error.status = 400;
      throw error;
    }),
    /bad request/
  );

  assert.equal(calls, 1);
});
