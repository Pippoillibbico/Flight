import 'dotenv/config';
import { addDays, formatISO } from 'date-fns';
import { initSqlDb } from '../server/lib/sql-db.js';
import { ingestPriceObservation, initDealEngineStore } from '../server/lib/deal-engine-store.js';
import { runNightlyRouteBaselineJob } from '../server/jobs/route-baselines.js';

const ROUTES = [
  { origin: 'MXP', destination: 'LIS', base: 140 },
  { origin: 'MXP', destination: 'BCN', base: 110 },
  { origin: 'FCO', destination: 'ATH', base: 130 },
  { origin: 'FCO', destination: 'BER', base: 120 }
];

function randomAround(base, spread = 0.28) {
  const factor = 1 + (Math.random() * 2 - 1) * spread;
  return Math.max(40, Math.round(base * factor * 100) / 100);
}

async function run() {
  await initSqlDb();
  await initDealEngineStore();

  let inserted = 0;
  let deduped = 0;
  const now = new Date();

  for (const route of ROUTES) {
    for (let d = 7; d <= 150; d += 7) {
      const departure = addDays(now, d);
      const returnDate = addDays(departure, 3 + (d % 8));
      const observedAt = addDays(departure, -Math.max(1, Math.floor(d / 12)));
      const result = await ingestPriceObservation({
        origin_iata: route.origin,
        destination_iata: route.destination,
        departure_date: formatISO(departure, { representation: 'date' }),
        return_date: formatISO(returnDate, { representation: 'date' }),
        total_price: randomAround(route.base + d * 0.45),
        currency: 'EUR',
        provider: 'seed_demo_partner',
        cabin_class: 'economy',
        trip_type: 'round_trip',
        observed_at: observedAt.toISOString(),
        source: 'seed_script'
      });
      if (result.inserted) inserted += 1;
      else deduped += 1;
    }
  }

  const baseline = await runNightlyRouteBaselineJob({ reason: 'seed_script' });
  console.log(`seed-price-observations: inserted=${inserted} deduped=${deduped} baselineRows=${baseline.baselineRows}`);
}

run().catch((error) => {
  console.error('seed-price-observations failed', error?.message || error);
  process.exit(1);
});
