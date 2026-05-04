import test from 'node:test';
import assert from 'node:assert/strict';

import { OutboundRepo } from '../server/repositories/outbound-repo.js';

test('OutboundRepo sanitizes destination URL before persistence', async () => {
  const calls = [];
  const repo = new OutboundRepo({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    }
  });

  await repo.insertClick({
    userId: 'u1',
    provider: 'tde_booking',
    itineraryId: 'it_1',
    destinationUrl: 'https://partner.example.com/checkout?email=user@example.com&origin=FCO#fragment',
    correlationId: 'corr_1',
    redirectStatus: 'pending'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[3], 'https://partner.example.com/checkout');
});

