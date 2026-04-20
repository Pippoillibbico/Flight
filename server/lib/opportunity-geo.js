import { ORIGINS, ROUTES } from '../data/local-flight-data.js';
import { normalizeText, slugify } from './opportunity-store-helpers.js';

const originMap = new Map(
  ORIGINS.map((item) => {
    const label = String(item.label || item.code || '').trim();
    const city = label.split('(')[0].trim() || item.code;
    return [String(item.code || '').toUpperCase(), { airport: String(item.code || '').toUpperCase(), city }];
  })
);

const routeMap = new Map(
  ROUTES.map((route) => [
    `${String(route.origin || '').toUpperCase()}-${String(route.destinationIata || '').toUpperCase()}`,
    route
  ])
);

const EAST_COAST_CITIES = new Set(['new york', 'newark', 'boston', 'washington', 'washington dc', 'philadelphia']);
const SEA_COUNTRIES = new Set(['thailand', 'malaysia', 'vietnam', 'indonesia', 'philippines', 'singapore', 'cambodia']);

export function resolveRoute(originAirport, destinationAirport) {
  return routeMap.get(`${String(originAirport || '').toUpperCase()}-${String(destinationAirport || '').toUpperCase()}`) || null;
}

export function resolveOrigin(originAirport) {
  const normalizedAirport = String(originAirport || '').toUpperCase();
  return originMap.get(normalizedAirport) || { airport: normalizedAirport, city: normalizedAirport };
}

export function resolveRouteMeta(originAirport, destinationAirport) {
  const route = resolveRoute(originAirport, destinationAirport);
  return {
    route,
    country: String(route?.country || '').trim(),
    region: String(route?.region || '').trim().toLowerCase()
  };
}

export function deriveClusterInfo(opportunity) {
  const city = String(opportunity?.destination_city || '').trim();
  const cityKey = normalizeText(city);
  const { country, region } = resolveRouteMeta(opportunity?.origin_airport, opportunity?.destination_airport);
  const countryKey = normalizeText(opportunity?.destination_country || country);
  const regionKey = normalizeText(opportunity?.destination_region || region);

  if (countryKey === 'japan') {
    return { slug: 'japan', cluster_name: 'Japan', region: 'asia' };
  }
  if (SEA_COUNTRIES.has(countryKey)) {
    return { slug: 'southeast-asia', cluster_name: 'Southeast Asia', region: 'asia' };
  }
  if (countryKey === 'united states' && EAST_COAST_CITIES.has(cityKey)) {
    return { slug: 'usa-east-coast', cluster_name: 'USA East Coast', region: 'america' };
  }
  if (country) {
    return {
      slug: slugify(country),
      cluster_name: country,
      region: regionKey || 'global'
    };
  }
  if (regionKey) {
    const regionName = regionKey === 'eu' ? 'Europe' : regionKey.charAt(0).toUpperCase() + regionKey.slice(1);
    return {
      slug: slugify(regionName),
      cluster_name: regionName,
      region: regionKey
    };
  }
  return {
    slug: slugify(city || 'global'),
    cluster_name: city || 'Global',
    region: 'global'
  };
}

