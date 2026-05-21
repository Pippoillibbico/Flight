import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { OURAIRPORTS_IATA_SET } from '../../src/data/ourairports-iata.js';

const DATASETS = Object.freeze({
  airports: {
    url: 'https://davidmegginson.github.io/ourairports-data/airports.csv',
    useful: true
  },
  frequencies: {
    url: 'https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv',
    useful: false
  },
  comments: {
    url: 'https://davidmegginson.github.io/ourairports-data/airport-comments.csv',
    useful: false
  },
  runways: {
    url: 'https://davidmegginson.github.io/ourairports-data/runways.csv',
    useful: false
  },
  navaids: {
    url: 'https://davidmegginson.github.io/ourairports-data/navaids.csv',
    useful: false
  },
  countries: {
    url: 'https://davidmegginson.github.io/ourairports-data/countries.csv',
    useful: true
  },
  regions: {
    url: 'https://davidmegginson.github.io/ourairports-data/regions.csv',
    useful: true
  }
});

const DEFAULT_CATALOG_PATH = resolve(process.cwd(), 'data', 'ourairports', 'catalog.json');
const DOWNLOAD_TIMEOUT_MS = 45_000;
const MAX_DATASET_BYTES = 20 * 1024 * 1024;
const CACHE_RELOAD_INTERVAL_MS = 60_000;

let runtimeCatalog = null;
let runtimeCatalogLoadedAt = 0;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (char !== '\r') field += char;
  }
  row.push(field);
  rows.push(row);
  return rows.filter((entry) => entry.some((value) => String(value || '').length > 0));
}

function rowsToObjects(csvText) {
  const rows = parseCsv(csvText);
  const [headers = [], ...dataRows] = rows;
  return dataRows.map((row) => {
    const out = {};
    headers.forEach((header, index) => {
      out[header] = row[index] ?? '';
    });
    return out;
  });
}

function normalizeIata(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function normalizeText(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchDataset(name, definition, { fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(definition.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1',
        'user-agent': 'Flight/ourairports-refresh'
      }
    });
    if (!response.ok) throw new Error(`ourairports_${name}_http_${response.status}`);

    const contentLength = Number(response.headers?.get?.('content-length') || 0);
    if (contentLength > MAX_DATASET_BYTES) throw new Error(`ourairports_${name}_too_large`);

    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_DATASET_BYTES) throw new Error(`ourairports_${name}_too_large`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function buildUsefulCatalog(rawDatasets) {
  const countries = {};
  for (const country of rowsToObjects(rawDatasets.countries || '')) {
    const code = normalizeText(country.code, 8).toUpperCase();
    if (!code) continue;
    countries[code] = {
      code,
      name: normalizeText(country.name),
      continent: normalizeText(country.continent, 8).toUpperCase()
    };
  }

  const regions = {};
  for (const region of rowsToObjects(rawDatasets.regions || '')) {
    const code = normalizeText(region.code, 24).toUpperCase();
    if (!code) continue;
    regions[code] = {
      code,
      localCode: normalizeText(region.local_code, 24),
      name: normalizeText(region.name),
      countryCode: normalizeText(region.iso_country, 8).toUpperCase()
    };
  }

  const airportsByIata = {};
  for (const airport of rowsToObjects(rawDatasets.airports || '')) {
    const iata = normalizeIata(airport.iata_code);
    if (!iata) continue;
    if (normalizeText(airport.type, 32) === 'closed') continue;
    airportsByIata[iata] = {
      iata,
      ident: normalizeText(airport.ident, 24),
      type: normalizeText(airport.type, 32),
      name: normalizeText(airport.name),
      municipality: normalizeText(airport.municipality),
      countryCode: normalizeText(airport.iso_country, 8).toUpperCase(),
      regionCode: normalizeText(airport.iso_region, 24).toUpperCase(),
      latitude: normalizeNumber(airport.latitude_deg),
      longitude: normalizeNumber(airport.longitude_deg),
      elevationFt: normalizeNumber(airport.elevation_ft)
    };
  }

  const iataCodes = Object.keys(airportsByIata).sort();
  return {
    generatedAt: new Date().toISOString(),
    source: 'https://ourairports.com/data/',
    datasets: Object.fromEntries(
      Object.entries(rawDatasets).map(([name, csvText]) => [
        name,
        {
          rows: Math.max(0, parseCsv(csvText).length - 1),
          useful: Boolean(DATASETS[name]?.useful)
        }
      ])
    ),
    countries,
    regions,
    airportsByIata,
    iataCodes
  };
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmpPath, filePath);
}

export function getOurAirportsDatasetDefinitions() {
  return DATASETS;
}

export async function refreshOurAirportsCatalog({ catalogPath = DEFAULT_CATALOG_PATH, fetchImpl = fetch } = {}) {
  const rawDatasets = {};
  const startedAt = Date.now();
  const tempDir = resolve(process.cwd(), 'data', 'ourairports', '.tmp');
  await mkdir(tempDir, { recursive: true });

  try {
    for (const [name, definition] of Object.entries(DATASETS)) {
      rawDatasets[name] = await fetchDataset(name, definition, { fetchImpl });
    }
    const catalog = buildUsefulCatalog(rawDatasets);
    await writeJsonAtomic(catalogPath, catalog);
    runtimeCatalog = catalog;
    runtimeCatalogLoadedAt = Date.now();
    return {
      status: 'updated',
      source: catalog.source,
      catalogPath,
      durationMs: Date.now() - startedAt,
      iataCodes: catalog.iataCodes.length,
      datasets: catalog.datasets
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function loadOurAirportsCatalog({ catalogPath = DEFAULT_CATALOG_PATH, force = false } = {}) {
  if (!force && runtimeCatalog && Date.now() - runtimeCatalogLoadedAt < CACHE_RELOAD_INTERVAL_MS) return runtimeCatalog;
  if (!existsSync(catalogPath)) {
    runtimeCatalogLoadedAt = Date.now();
    return runtimeCatalog;
  }
  try {
    runtimeCatalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    runtimeCatalogLoadedAt = Date.now();
  } catch {
    runtimeCatalogLoadedAt = Date.now();
  }
  return runtimeCatalog;
}

export async function readOurAirportsCatalog({ catalogPath = DEFAULT_CATALOG_PATH } = {}) {
  if (!existsSync(catalogPath)) return null;
  return JSON.parse(await readFile(catalogPath, 'utf8'));
}

export function isKnownOurAirportsIata(value) {
  const code = normalizeIata(value);
  if (!code) return false;
  const catalog = loadOurAirportsCatalog();
  if (catalog?.airportsByIata?.[code]) return true;
  return OURAIRPORTS_IATA_SET.has(code);
}
