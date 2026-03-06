import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSeedImportOnce } from '../server/jobs/seed-import-worker.js';

test('seed import worker normalizes and dedupes csv rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'seed-import-worker-'));
  const filePath = join(dir, 'seed.csv');
  await writeFile(
    filePath,
    [
      'origin_iata,destination_iata,departure_date,return_date,currency,total_price,provider,cabin_class,trip_type,observed_at,source',
      'FCO,LIS,2027-05-01,2027-05-07,EUR,139.4,partner_feed,economy,round_trip,2026-02-01T10:00:00.000Z,csv_import',
      'FCO,LIS,2027-05-01,2027-05-07,EUR,139.4,partner_feed,economy,round_trip,2026-02-01T10:00:00.000Z,csv_import'
    ].join('\n'),
    'utf8'
  );

  const out = await runSeedImportOnce({ filePath, dryRun: false });
  assert.equal(out.processedCount, 2);
  assert.equal(out.insertedCount + out.dedupedCount + out.failedCount, out.processedCount);
  assert.equal(out.dedupedCount >= 1, true);

  const dry = await runSeedImportOnce({ filePath, dryRun: true });
  assert.equal(dry.processedCount, 2);

  await rm(dir, { recursive: true, force: true });
});
