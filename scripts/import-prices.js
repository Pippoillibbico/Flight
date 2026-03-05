import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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

function normalizeIata(value) {
  return String(value || '').trim().toUpperCase().slice(0, 3);
}

function normalizeMonth(value) {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return month;
}

function normalizeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function normalizeRow(headers, values) {
  const row = {};
  for (let i = 0; i < headers.length; i += 1) row[headers[i]] = values[i] ?? '';

  const origin = normalizeIata(row.origin || row.origin_iata);
  const destinationIata = normalizeIata(row.destinationIata || row.destination_iata);
  const month = normalizeMonth(row.month);
  const avgPrice = normalizeNumber(row.avgPrice || row.avg_price || row.price);
  const low = normalizeNumber(row.low);
  const high = normalizeNumber(row.high);

  if (!origin || !destinationIata || !month || avgPrice == null) return null;
  return {
    origin,
    destinationIata,
    month,
    avgPrice,
    low: low == null ? avgPrice : low,
    high: high == null ? avgPrice : high
  };
}

async function run() {
  const csvPathArg = process.argv[2];
  if (!csvPathArg) {
    console.error('Usage: node scripts/import-prices.js <csvPath>');
    process.exit(1);
  }

  const csvPath = resolve(process.cwd(), csvPathArg);
  const raw = await readFile(csvPath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (lines.length < 2) throw new Error('CSV must include a header and at least one data row.');

  const headers = parseCsvLine(lines[0]);
  if (!headers.includes('origin') && !headers.includes('origin_iata')) {
    throw new Error('CSV is missing required column: origin (or origin_iata).');
  }
  if (!headers.includes('destinationIata') && !headers.includes('destination_iata')) {
    throw new Error('CSV is missing required column: destinationIata (or destination_iata).');
  }
  if (!headers.includes('month')) {
    throw new Error('CSV is missing required column: month.');
  }
  if (!headers.includes('avgPrice') && !headers.includes('avg_price') && !headers.includes('price')) {
    throw new Error('CSV is missing one required column: avgPrice (or avg_price or price).');
  }

  const rows = [];
  const skipped = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const normalized = normalizeRow(headers, values);
    if (!normalized) {
      skipped.push(i + 1);
      continue;
    }
    rows.push(normalized);
  }

  rows.sort(
    (a, b) =>
      a.origin.localeCompare(b.origin) ||
      a.destinationIata.localeCompare(b.destinationIata) ||
      a.month - b.month
  );

  const outputPath = resolve(process.cwd(), 'server/data/price-observations.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceCsv: csvPath,
    rowCount: rows.length,
    observations: rows
  };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(
    `import-prices complete csv=${csvPath} rows=${rows.length} skipped=${skipped.length} output=${outputPath}`
  );
  if (skipped.length > 0) {
    console.log(`Skipped row numbers: ${skipped.join(', ')}`);
  }
}

run().catch((error) => {
  console.error('import-prices failed', error?.message || error);
  process.exit(1);
});
