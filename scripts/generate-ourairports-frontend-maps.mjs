import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCommercialOurAirportsEntry, listCommercialOurAirportsIataFromCsv } from '../server/lib/ourairports-catalog.js';

const root = process.cwd();
const catalogPath = resolve(root, 'data/ourairports/catalog.json');
const cityMapPath = resolve(root, 'src/data/ourairports-city-map.js');
const placeMapPath = resolve(root, 'src/data/ourairports-place-map.js');
const countryMapPath = resolve(root, 'src/data/ourairports-country-map.js');
const commercialIataPath = resolve(root, 'src/data/ourairports-commercial-iata.js');
const airportsCsvPath = process.argv[2] ? resolve(process.argv[2]) : '';

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeCity(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.split(',')[0].trim().replace(/[\u2010-\u2015]/g, '-');
}

function simplifyAirportName(name, city) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const cleaned = raw
    .replace(/\s+International\s+Airport$/i, '')
    .replace(/\s+Airport$/i, '')
    .replace(/\s+Aerodrome$/i, '')
    .replace(/\s+Airfield$/i, '')
    .trim()
    .replace(/[\u2010-\u2015]/g, '-');
  if (!city) return cleaned || raw;
  const cityKey = city.toLowerCase();
  if (cleaned.toLowerCase().startsWith(cityKey)) return cleaned;
  return `${city} ${cleaned}`.trim();
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const airports = catalog.airportsByIata || {};
const cityEntries = {};
const placeEntries = {};
const countryEntries = {};
const catalogHasScheduledService = Object.values(airports).some(
  (entry) => entry && ('scheduledService' in entry || 'scheduled_service' in entry)
);
const commercialIataCodes = airportsCsvPath
  ? listCommercialOurAirportsIataFromCsv(readFileSync(airportsCsvPath, 'utf8'))
  : Object.entries(airports)
      .filter(([, entry]) => {
        if (catalogHasScheduledService) return isCommercialOurAirportsEntry(entry);
        const type = String(entry?.type || '').trim();
        return Boolean(normalizeCity(entry?.municipality) && (type === 'large_airport' || type === 'medium_airport'));
      })
      .map(([iata]) => normalizeCode(iata))
      .filter((iata) => /^[A-Z]{3}$/.test(iata))
      .sort();
const commercialIataCodeSet = new Set(commercialIataCodes);

function isUsefulAirportForFrontendDetails(entry) {
  const type = String(entry?.type || '').trim();
  const scheduled = String(entry?.scheduledService || entry?.scheduled_service || '').trim().toLowerCase();
  return type === 'large_airport' || type === 'medium_airport' || scheduled === 'yes';
}

for (const [iata, entry] of Object.entries(airports)) {
  const code = normalizeCode(iata);
  if (!/^[A-Z]{3}$/.test(code)) continue;
  const city = normalizeCity(entry?.municipality);
  const countryCode = normalizeCode(entry?.countryCode);
  const airport = simplifyAirportName(entry?.name, city);
  if (city) cityEntries[code] = city;
  if (commercialIataCodeSet.has(code) && /^[A-Z]{2}$/.test(countryCode)) countryEntries[code] = countryCode;
  if (isUsefulAirportForFrontendDetails(entry) && airport && airport !== city) {
    placeEntries[code] = airport;
  }
}

const orderedCityEntries = Object.fromEntries(Object.entries(cityEntries).sort(([a], [b]) => a.localeCompare(b)));
const orderedPlaceEntries = Object.fromEntries(Object.entries(placeEntries).sort(([a], [b]) => a.localeCompare(b)));
const orderedCountryEntries = Object.fromEntries(Object.entries(countryEntries).sort(([a], [b]) => a.localeCompare(b)));

writeFileSync(
  cityMapPath,
  `// Generated from data/ourairports/catalog.json. Run npm run generate:ourairports-frontend-maps after catalog refresh.\nexport const OURAIRPORTS_CITY_BY_IATA = ${JSON.stringify(orderedCityEntries, null, 2)};\n`,
  'utf8'
);

writeFileSync(
  placeMapPath,
  `// Generated from data/ourairports/catalog.json. Run npm run generate:ourairports-frontend-maps after catalog refresh.\nexport const OURAIRPORTS_AIRPORT_LABEL_BY_IATA = ${JSON.stringify(orderedPlaceEntries, null, 2)};\n`,
  'utf8'
);

writeFileSync(
  countryMapPath,
  `// Generated from data/ourairports/catalog.json. Run npm run generate:ourairports-frontend-maps after catalog refresh.\nexport const OURAIRPORTS_COUNTRY_BY_IATA = ${JSON.stringify(orderedCountryEntries, null, 2)};\n`,
  'utf8'
);

writeFileSync(
  commercialIataPath,
  `// Generated from OurAirports data (https://ourairports.com/data/).\nexport const OURAIRPORTS_COMMERCIAL_IATA_CODES = ${JSON.stringify(commercialIataCodes)};\n\nexport const OURAIRPORTS_COMMERCIAL_IATA_SET = new Set(OURAIRPORTS_COMMERCIAL_IATA_CODES);\n`,
  'utf8'
);
