import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBookingUrl } from '../server/lib/affiliate-link-engine.js';

test('buildBookingUrl always returns internal redirect path', () => {
  const url = buildBookingUrl('deal_fco_tyo_001', {
    origin: 'FCO',
    destination: 'TYO',
    departure_date: '2027-07-14',
    return_date: '2027-07-22',
    price: 289,
    trip_type: 'round_trip',
    cabin_class: 'economy',
    deal_type: 'error_fare',
    deal_confidence: 88
  });

  assert.equal(url.startsWith('/api/redirect/deal_fco_tyo_001?'), true);
  const parsed = new URL(`https://example.com${url}`);
  assert.equal(parsed.pathname, '/api/redirect/deal_fco_tyo_001');
  assert.equal(parsed.searchParams.get('o'), 'FCO');
  assert.equal(parsed.searchParams.get('d'), 'TYO');
});
