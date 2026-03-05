import { ORIGINS, ROUTES } from './local-flight-data.js';

const destinationByIata = new Map();
for (const route of ROUTES) {
  if (destinationByIata.has(route.destinationIata)) continue;
  destinationByIata.set(route.destinationIata, {
    city: route.destinationName,
    iata: route.destinationIata,
    region: route.region,
    area: route.decisionMetadata?.area || route.region,
    country: route.country,
    keywords: route.keywords || [],
    climate: route.decisionMetadata?.climateProfile || 'mixed'
  });
}

const DESTINATIONS = Array.from(destinationByIata.values()).sort((a, b) => a.city.localeCompare(b.city));

export { ORIGINS, DESTINATIONS };
