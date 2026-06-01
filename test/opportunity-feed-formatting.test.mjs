import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPeriod, localizeOpportunityDescription } from '../src/components/opportunity-feed-helpers.js';
const labels = {
  departurePrefix: 'Partenza',
  flexibleDates: 'Date flessibili'
};

test('formatPeriod formats date-only values without leaking server timezone strings', () => {
  const item = { depart_date: '2027-08-15', return_date: '2027-09-22' };
  assert.equal(formatPeriod(item, 'it-IT', labels), 'ago - set');
  assert.doesNotMatch(formatPeriod(item, 'it-IT', labels), /GMT|Coordinated Universal Time|2027-08-15/);
});

test('localizeOpportunityDescription rewrites generated server-date copy for Italian users', () => {
  const item = {
    stops: 0,
    depart_date: '2027-08-15',
    return_date: '2027-09-22',
    ai_description:
      'Questa opportunità combina prezzo competitivo, rotta diretta e finestra viaggio Sun Aug 15 2027 00:00:00 GMT+0000 (Coordinated Universal Time) - Wed Sep 22 2027 00:00:00 GMT+0000 (Coordinated Universal Time).'
  };

  const description = localizeOpportunityDescription(item, 'it', labels);
  assert.match(description, /ago - set/);
  assert.doesNotMatch(description, /GMT|Coordinated Universal Time|Sun Aug|Wed Sep/);
});
