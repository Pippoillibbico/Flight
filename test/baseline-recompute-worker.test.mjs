import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestPriceObservation, getDataFoundationStatus } from '../server/lib/deal-engine-store.js';
import { runBaselineRecomputeOnce } from '../server/jobs/baseline-recompute-worker.js';

test('baseline recompute worker refreshes coverage stats', async () => {
  for (let i = 0; i < 30; i += 1) {
    await ingestPriceObservation({
      origin_iata: 'FCO',
      destination_iata: 'LIS',
      departure_date: `2027-06-${String((i % 27) + 1).padStart(2, '0')}`,
      return_date: `2027-06-${String((i % 27) + 3).padStart(2, '0')}`,
      currency: 'EUR',
      total_price: 140 + (i % 8) * 6,
      provider: 'partner_feed',
      cabin_class: 'economy',
      trip_type: 'round_trip',
      observed_at: `2026-02-${String((i % 27) + 1).padStart(2, '0')}T10:00:00.000Z`,
      source: 'seed_script'
    });
  }
  const result = await runBaselineRecomputeOnce();
  assert.equal(result.baseline.recomputed, true);
  assert.equal(Number(result.coverage.updatedRows) >= 1, true);

  const status = await getDataFoundationStatus();
  assert.equal(Number(status.totals.routeCoverageStats) >= 1, true);
});
