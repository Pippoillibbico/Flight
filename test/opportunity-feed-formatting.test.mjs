import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPeriod, levelPriority, localizeOpportunityDescription, pickTopDeal } from '../src/components/opportunity-feed-helpers.js';
import { buildAiCopy, resolveObservationAirline } from '../server/lib/opportunity-store-helpers.js';
const labels = {
  departurePrefix: 'Partenza',
  flexibleDates: 'Date flessibili'
};

test('formatPeriod formats date-only values without leaking server timezone strings', () => {
  const item = { depart_date: '2027-08-15', return_date: '2027-09-22' };
  assert.equal(formatPeriod(item, 'it-IT', labels), 'ago - set');
  assert.doesNotMatch(formatPeriod(item, 'it-IT', labels), /GMT|Coordinated Universal Time|2027-08-15/);
});

test('formatPeriod uses a safe fallback instead of exposing malformed dates', () => {
  assert.equal(formatPeriod({ depart_date: 'not-a-date', return_date: 'also-bad' }, 'it-IT', labels), labels.flexibleDates);
  assert.equal(formatPeriod({ depart_date: 'not-a-date' }, 'it-IT', labels), labels.flexibleDates);
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

test('pickTopDeal prefers editorial relevance over a cheaper unfamiliar route', () => {
  const topDeal = pickTopDeal([
    {
      id: 'unfamiliar',
      opportunity_level: 'Exceptional price',
      discovery_relevance_score: 15,
      price: 120
    },
    {
      id: 'curated',
      opportunity_level: 'Great deal',
      discovery_relevance_score: 170,
      price: 180
    }
  ]);

  assert.equal(topDeal?.id, 'curated');
});

test('rare opportunities rank above exceptional prices', () => {
  assert.equal(levelPriority({ opportunity_level: 'Rare opportunity' }) > levelPriority({ opportunity_level: 'Exceptional price' }), true);
});

test('opportunity copy pluralizes multiple stops', () => {
  const copy = buildAiCopy({
    opportunity_level: 'Great deal',
    origin_airport: 'FCO',
    destination_city: 'Lisbona',
    destination_airport: 'LIS',
    price: 120,
    currency: 'EUR',
    depart_date: '2027-08-15',
    return_date: '2027-08-22',
    stops: 2,
    final_score: 80
  });
  assert.match(copy.aiDescription, /con 2 scali/);
  assert.doesNotMatch(copy.aiDescription, /con 2 scalo/);
});

test('airline metadata takes precedence over ingestion provider', () => {
  const observation = { provider: 'partner_feed_a' };
  assert.equal(resolveObservationAirline(observation, { airline: 'ITA Airways' }), 'ITA Airways');
  assert.equal(resolveObservationAirline(observation, {}), 'partner_feed_a');
});
