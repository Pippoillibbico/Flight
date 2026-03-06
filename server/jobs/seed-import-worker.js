import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createIngestionJob, ingestPriceObservation, updateIngestionJob } from '../lib/deal-engine-store.js';
import { logger } from '../lib/logger.js';

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((x) => x.trim());
}

function normalizeRow(headers, line) {
  const cols = parseCsvLine(line);
  const row = {};
  for (let i = 0; i < headers.length; i += 1) row[headers[i]] = cols[i] ?? '';
  return {
    origin_iata: row.origin_iata || row.origin || '',
    destination_iata: row.destination_iata || row.destination || '',
    departure_date: row.departure_date || row.date || '',
    return_date: row.return_date || null,
    currency: row.currency || 'EUR',
    total_price: Number(row.total_price || row.price || 0),
    provider: row.provider || 'seed_dataset',
    cabin_class: row.cabin_class || 'economy',
    trip_type: row.trip_type || (row.return_date ? 'round_trip' : 'one_way'),
    observed_at: row.observed_at || new Date().toISOString(),
    source: row.source || 'csv_import',
    metadata: {
      importFile: row.import_file || null
    }
  };
}

export async function runSeedImportOnce({ filePath, dryRun = false }) {
  const job = await createIngestionJob({
    jobType: 'seed_import',
    source: 'csv_import',
    status: 'running',
    metadata: { filePath, dryRun: Boolean(dryRun) }
  });
  const startedAt = new Date().toISOString();
  await updateIngestionJob({ jobId: job.id, startedAt, status: 'running' });

  let processedCount = 0;
  let insertedCount = 0;
  let dedupedCount = 0;
  let failedCount = 0;

  try {
    const raw = await readFile(filePath, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    if (lines.length < 2) {
      await updateIngestionJob({
        jobId: job.id,
        finishedAt: new Date().toISOString(),
        status: 'partial',
        processedCount,
        insertedCount,
        dedupedCount,
        failedCount,
        errorSummary: 'CSV contains no data rows.'
      });
      return { processedCount, insertedCount, dedupedCount, failedCount };
    }

    const headers = parseCsvLine(lines[0]);
    for (const line of lines.slice(1)) {
      processedCount += 1;
      const payload = normalizeRow(headers, line);
      payload.metadata = {
        ...(payload.metadata || {}),
        importFile: basename(filePath)
      };
      if (dryRun) continue;
      try {
        const out = await ingestPriceObservation(payload);
        if (out.inserted) insertedCount += 1;
        else dedupedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    const status = failedCount > 0 ? (insertedCount > 0 ? 'partial' : 'failed') : 'success';
    await updateIngestionJob({
      jobId: job.id,
      finishedAt: new Date().toISOString(),
      status,
      processedCount,
      insertedCount,
      dedupedCount,
      failedCount
    });
    logger.info(
      { source: 'seed_import', processedCount, insertedCount, dedupedCount, failedCount, dryRun: Boolean(dryRun) },
      'seed_import_worker_completed'
    );
    return { processedCount, insertedCount, dedupedCount, failedCount };
  } catch (error) {
    await updateIngestionJob({
      jobId: job.id,
      finishedAt: new Date().toISOString(),
      status: 'failed',
      processedCount,
      insertedCount,
      dedupedCount,
      failedCount: failedCount + 1,
      errorSummary: error?.message || String(error)
    });
    logger.error({ err: error, filePath }, 'seed_import_worker_failed');
    return { processedCount, insertedCount, dedupedCount, failedCount: failedCount + 1 };
  }
}
