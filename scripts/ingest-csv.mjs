import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initSqlDb } from '../server/lib/sql-db.js';
import { ingestPriceObservation, initDealEngineStore } from '../server/lib/deal-engine-store.js';

function parseArgs(argv) {
  const args = { file: 'data/price-observations.template.csv' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if ((token === '--file' || token === '-f') && argv[i + 1]) {
      args.file = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

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
      } else {
        inQuotes = !inQuotes;
      }
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
  return out.map((v) => v.trim());
}

function toPayload(headers, row) {
  const payload = {};
  for (let i = 0; i < headers.length; i += 1) payload[headers[i]] = row[i] ?? '';
  return {
    origin_iata: payload.origin_iata,
    destination_iata: payload.destination_iata,
    departure_date: payload.departure_date,
    return_date: payload.return_date || undefined,
    currency: payload.currency || 'EUR',
    total_price: Number(payload.total_price),
    provider: payload.provider || 'csv',
    cabin_class: payload.cabin_class || 'economy',
    trip_type: payload.trip_type || (payload.return_date ? 'round_trip' : 'one_way'),
    observed_at: payload.observed_at || new Date().toISOString(),
    source: payload.source || 'csv_import'
  };
}

async function run() {
  const { file } = parseArgs(process.argv.slice(2));
  const targetPath = resolve(process.cwd(), file);
  const raw = await readFile(targetPath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (lines.length < 2) throw new Error('CSV must include header + at least one row.');

  const headers = parseCsvLine(lines[0]);
  const required = ['origin_iata', 'destination_iata', 'departure_date', 'total_price', 'provider'];
  for (const key of required) {
    if (!headers.includes(key)) throw new Error(`CSV is missing required column: ${key}`);
  }

  await initSqlDb();
  await initDealEngineStore();

  let inserted = 0;
  let deduped = 0;
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const payload = toPayload(headers, row);
    const result = await ingestPriceObservation(payload);
    if (result.inserted) inserted += 1;
    else deduped += 1;
  }

  console.log(`ingest:csv complete file=${targetPath} inserted=${inserted} deduped=${deduped} rows=${lines.length - 1}`);
}

run().catch((error) => {
  console.error('ingest:csv failed', error?.message || error);
  process.exit(1);
});
