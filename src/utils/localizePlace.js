import { OURAIRPORTS_IATA_SET } from '../data/ourairports-iata.js';
import { OURAIRPORTS_CITY_BY_IATA } from '../data/ourairports-city-map.js';
import { OURAIRPORTS_AIRPORT_LABEL_BY_IATA } from '../data/ourairports-place-map.js';

const SUPPORTED_LANGS = new Set(['en', 'it', 'de', 'fr', 'es', 'pt']);

const COUNTRY_TO_ISO2 = {
  spain: 'ES',
  greece: 'GR',
  portugal: 'PT',
  france: 'FR',
  'czech republic': 'CZ',
  japan: 'JP',
  germany: 'DE',
  thailand: 'TH',
  'united kingdom': 'GB',
  uk: 'GB',
  britain: 'GB',
  'great britain': 'GB',
  'united states': 'US',
  usa: 'US',
  'u.s.a.': 'US',
  america: 'US',
  canada: 'CA',
  'new zealand': 'NZ',
  italy: 'IT'
};

const ISO2_TO_CANONICAL = {
  ES: 'Spain',
  GR: 'Greece',
  PT: 'Portugal',
  FR: 'France',
  CZ: 'Czech Republic',
  JP: 'Japan',
  DE: 'Germany',
  TH: 'Thailand',
  GB: 'United Kingdom',
  US: 'United States',
  CA: 'Canada',
  NZ: 'New Zealand',
  IT: 'Italy'
};

const REGION_TRANSLATIONS = {
  it: {
    europe: 'Europa',
    asia: 'Asia',
    america: 'America',
    oceania: 'Oceania',
    global: 'Globale'
  },
  de: {
    europe: 'Europa',
    asia: 'Asien',
    america: 'Amerika',
    oceania: 'Ozeanien',
    global: 'Global'
  },
  fr: {
    europe: 'Europe',
    asia: 'Asie',
    america: 'Amerique',
    oceania: 'Oceanie',
    global: 'Global'
  },
  es: {
    europe: 'Europa',
    asia: 'Asia',
    america: 'America',
    oceania: 'Oceania',
    global: 'Global'
  },
  pt: {
    europe: 'Europa',
    asia: 'Asia',
    america: 'America',
    oceania: 'Oceania',
    global: 'Global'
  }
};

const SPECIAL_CLUSTER_LABELS = {
  japan: {
    it: 'Giappone',
    en: 'Japan',
    de: 'Japan',
    fr: 'Japon',
    es: 'Japon',
    pt: 'Japao'
  },
  'southeast-asia': {
    it: 'Sud-est asiatico',
    en: 'Southeast Asia',
    de: 'Sudostasien',
    fr: 'Asie du Sud-Est',
    es: 'Sudeste asiatico',
    pt: 'Sudeste Asiatico'
  },
  'usa-east-coast': {
    it: 'Costa Est USA',
    en: 'USA East Coast',
    de: 'US-Ostkuste',
    fr: 'Cote Est USA',
    es: 'Costa Este de EE. UU.',
    pt: 'Costa Leste dos EUA'
  },
  global: {
    it: 'Globale',
    en: 'Global',
    de: 'Global',
    fr: 'Global',
    es: 'Global',
    pt: 'Global'
  }
};

const COUNTRY_FALLBACK_TRANSLATIONS = {
  it: {
    spain: 'Spagna',
    greece: 'Grecia',
    portugal: 'Portogallo',
    france: 'Francia',
    'czech republic': 'Repubblica Ceca',
    japan: 'Giappone',
    germany: 'Germania',
    thailand: 'Thailandia',
    'united kingdom': 'Regno Unito',
    'united states': 'Stati Uniti',
    canada: 'Canada',
    'new zealand': 'Nuova Zelanda',
    italy: 'Italia'
  },
  de: {
    spain: 'Spanien',
    greece: 'Griechenland',
    portugal: 'Portugal',
    france: 'Frankreich',
    'czech republic': 'Tschechien',
    japan: 'Japan',
    germany: 'Deutschland',
    thailand: 'Thailand',
    'united kingdom': 'Vereinigtes Konigreich',
    'united states': 'Vereinigte Staaten',
    canada: 'Kanada',
    'new zealand': 'Neuseeland',
    italy: 'Italien'
  },
  fr: {
    spain: 'Espagne',
    greece: 'Grece',
    portugal: 'Portugal',
    france: 'France',
    'czech republic': 'Republique tcheque',
    japan: 'Japon',
    germany: 'Allemagne',
    thailand: 'Thailande',
    'united kingdom': 'Royaume-Uni',
    'united states': 'Etats-Unis',
    canada: 'Canada',
    'new zealand': 'Nouvelle-Zelande',
    italy: 'Italie'
  },
  es: {
    spain: 'Espana',
    greece: 'Grecia',
    portugal: 'Portugal',
    france: 'Francia',
    'czech republic': 'Chequia',
    japan: 'Japon',
    germany: 'Alemania',
    thailand: 'Tailandia',
    'united kingdom': 'Reino Unido',
    'united states': 'Estados Unidos',
    canada: 'Canada',
    'new zealand': 'Nueva Zelanda',
    italy: 'Italia'
  },
  pt: {
    spain: 'Espanha',
    greece: 'Grecia',
    portugal: 'Portugal',
    france: 'Franca',
    'czech republic': 'Republica Tcheca',
    japan: 'Japao',
    germany: 'Alemanha',
    thailand: 'Tailandia',
    'united kingdom': 'Reino Unido',
    'united states': 'Estados Unidos',
    canada: 'Canada',
    'new zealand': 'Nova Zelandia',
    italy: 'Italia'
  }
};

const CITY_FALLBACK_TRANSLATIONS = {
  it: {
    ajaccio: 'Ajaccio',
    lisbon: 'Lisbona',
    barcelona: 'Barcellona',
    athens: 'Atene',
    berlin: 'Berlino',
    bilbao: 'Bilbao',
    edinburgh: 'Edimburgo',
    faro: 'Faro',
    fuerteventura: 'Fuerteventura',
    ibiza: 'Ibiza',
    innsbruck: 'Innsbruck',
    jersey: 'Jersey',
    karachi: 'Karachi',
    london: 'Londra',
    madrid: 'Madrid',
    milan: 'Milano',
    'new york': 'New York',
    nantes: 'Nantes',
    paris: 'Parigi',
    porto: 'Porto',
    rome: 'Roma',
    munich: 'Monaco di Baviera',
    cologne: 'Colonia',
    vienna: 'Vienna',
    warsaw: 'Varsavia',
    zurich: 'Zurigo'
  },
  de: {
    lisbon: 'Lissabon',
    athens: 'Athen',
    london: 'London'
  },
  fr: {
    lisbon: 'Lisbonne',
    athens: 'Athenes',
    london: 'Londres'
  },
  es: {
    lisbon: 'Lisboa'
  },
  pt: {
    lisbon: 'Lisboa'
  }
};

const AIRPORT_CITY_FALLBACKS = {
  ATH: 'Athens',
  BCN: 'Barcelona',
  BGY: 'Milan',
  CIA: 'Rome',
  FCO: 'Rome',
  LIN: 'Milan',
  LIS: 'Lisbon',
  MXP: 'Milan',
  ORY: 'Paris',
  ROM: 'Rome',
  CDG: 'Paris',
  STN: 'London',
  JFK: 'New York'
};

const AIRPORT_LABEL_FALLBACKS = {
  ATH: 'Athens Eleftherios Venizelos',
  BCN: 'Barcelona El Prat',
  FCO: 'Rome Fiumicino',
  LIS: 'Lisbon Humberto Delgado',
  MXP: 'Milan Malpensa',
  PMO: 'Palermo Falcone-Borsellino',
  STN: 'London Stansted'
};

function normalizeLanguage(language) {
  const base = String(language || 'en')
    .trim()
    .toLowerCase()
    .split('-')[0];
  return SUPPORTED_LANGS.has(base) ? base : 'en';
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

const COUNTRY_ALIAS_TO_ISO2 = (() => {
  const out = new Map();
  for (const [name, iso2] of Object.entries(COUNTRY_TO_ISO2)) {
    out.set(normalizeText(name), String(iso2).toUpperCase());
  }
  for (const [lang, table] of Object.entries(COUNTRY_FALLBACK_TRANSLATIONS)) {
    if (!table || !SUPPORTED_LANGS.has(lang)) continue;
    for (const [canonical, localized] of Object.entries(table)) {
      const iso2 = COUNTRY_TO_ISO2[normalizeText(canonical)];
      if (!iso2) continue;
      out.set(normalizeText(localized), String(iso2).toUpperCase());
    }
  }
  return out;
})();

function localizeWithIntlRegion(iso2, language) {
  if (!iso2 || typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') return '';
  try {
    const formatter = new Intl.DisplayNames([language], { type: 'region' });
    const label = formatter.of(String(iso2 || '').toUpperCase());
    if (!label || label === String(iso2 || '').toUpperCase()) return '';
    return label;
  } catch {
    return '';
  }
}

export function localizeCountryName(name, language) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const lang = normalizeLanguage(language);
  if (lang === 'en') return raw;

  const key = normalizeText(raw);
  const iso2 = COUNTRY_TO_ISO2[key];
  const intlLabel = localizeWithIntlRegion(iso2, lang);
  if (intlLabel) return intlLabel;

  const fallback = COUNTRY_FALLBACK_TRANSLATIONS[lang]?.[key];
  if (fallback) return fallback;
  return raw;
}

export function localizeCountryByIso2(iso2, fallbackName, language) {
  const code = String(iso2 || '').trim().toUpperCase();
  const lang = normalizeLanguage(language);
  if (!code) return localizeCountryName(fallbackName, language);
  if (lang === 'en') return String(fallbackName || ISO2_TO_CANONICAL[code] || code).trim();
  const intlLabel = localizeWithIntlRegion(code, lang);
  if (intlLabel) return intlLabel;
  return localizeCountryName(fallbackName || ISO2_TO_CANONICAL[code] || code, language);
}

export function toCanonicalCountryName(name, language) {
  const raw = String(name || '').trim();
  if (!raw) return '';

  const key = normalizeText(raw);
  const fromAlias = COUNTRY_ALIAS_TO_ISO2.get(key);
  if (fromAlias && ISO2_TO_CANONICAL[fromAlias]) {
    return ISO2_TO_CANONICAL[fromAlias];
  }

  const lang = normalizeLanguage(language);
  if (lang !== 'en') {
    const localizedTable = COUNTRY_FALLBACK_TRANSLATIONS[lang] || {};
    for (const [canonical, localized] of Object.entries(localizedTable)) {
      if (normalizeText(localized) === key) {
        const iso2 = COUNTRY_TO_ISO2[normalizeText(canonical)];
        if (iso2 && ISO2_TO_CANONICAL[String(iso2).toUpperCase()]) {
          return ISO2_TO_CANONICAL[String(iso2).toUpperCase()];
        }
      }
    }
  }

  return raw;
}

function localizeRegionName(name, language) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const lang = normalizeLanguage(language);
  if (lang === 'en') return raw;
  const key = normalizeText(raw);
  return REGION_TRANSLATIONS[lang]?.[key] || raw;
}

export function localizeCityName(name, language) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const lang = normalizeLanguage(language);
  if (lang === 'en') return raw;
  const key = normalizeText(raw);
  return CITY_FALLBACK_TRANSLATIONS[lang]?.[key] || raw;
}

export function localizeClusterName(clusterOrName, language) {
  const lang = normalizeLanguage(language);
  const isObject = clusterOrName && typeof clusterOrName === 'object';
  const slug = isObject ? normalizeText(clusterOrName.slug) : '';
  const rawName = String(isObject ? clusterOrName.cluster_name : clusterOrName || '').trim();

  if (slug && SPECIAL_CLUSTER_LABELS[slug]) {
    return SPECIAL_CLUSTER_LABELS[slug][lang] || SPECIAL_CLUSTER_LABELS[slug].en || rawName || slug;
  }
  if (!rawName) return '';

  const regionLabel = localizeRegionName(rawName, lang);
  if (regionLabel !== rawName) return regionLabel;

  const cityLabel = localizeCityName(rawName, lang);
  if (cityLabel !== rawName) return cityLabel;

  const countryLabel = localizeCountryName(rawName, lang);
  if (countryLabel) return countryLabel;
  return rawName;
}

function normalizeAirportCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function normalizeCatalogCity(value) {
  return String(value || '').trim().split(',')[0].trim();
}

function preferKnownCityAirportLabel(label, city) {
  const raw = String(label || '').trim();
  const cityLabel = String(city || '').trim();
  if (!raw || !cityLabel) return raw;
  const lowerRaw = raw.toLowerCase();
  const lowerCity = cityLabel.toLowerCase();
  const cityIndex = lowerRaw.indexOf(lowerCity);
  if (cityIndex > 0) return raw.slice(cityIndex).trim();
  return raw;
}

function routeFallbackLabel(kind, language) {
  const lang = normalizeLanguage(language);
  const fallbackByLang = {
    it: { origin: 'Partenza flessibile', destination: 'Destinazione flessibile', area: 'Area destinazione' },
    en: { origin: 'Flexible origin', destination: 'Flexible destination', area: 'Destination area' },
    de: { origin: 'Flexibler Start', destination: 'Flexibles Ziel', area: 'Zielgebiet' },
    fr: { origin: 'Depart flexible', destination: 'Destination flexible', area: 'Zone de destination' },
    es: { origin: 'Origen flexible', destination: 'Destino flexible', area: 'Zona de destino' },
    pt: { origin: 'Origem flexivel', destination: 'Destino flexivel', area: 'Area de destino' }
  };
  return fallbackByLang[lang]?.[kind] || fallbackByLang.en[kind] || fallbackByLang.en.area;
}

export function getAirportCatalogEntry(value) {
  const airport = normalizeAirportCode(value);
  return airport && OURAIRPORTS_IATA_SET.has(airport) ? { code: airport } : null;
}

export function isKnownIataAirportCode(value) {
  return Boolean(getAirportCatalogEntry(value));
}

export function resolveAirportCityName(value, language) {
  const airport = normalizeAirportCode(value);
  if (!airport) return localizeCityName(value, language);
  const cityName = AIRPORT_CITY_FALLBACKS[airport] || normalizeCatalogCity(OURAIRPORTS_CITY_BY_IATA[airport]) || '';
  return cityName ? localizeCityName(cityName, language) : airport;
}

export function resolveAirportCityNameForOffer(value, language, fallback = '') {
  const airport = normalizeAirportCode(value);
  if (!airport) return localizeCityName(value || fallback, language);
  const cityName = AIRPORT_CITY_FALLBACKS[airport] || normalizeCatalogCity(OURAIRPORTS_CITY_BY_IATA[airport]) || '';
  if (cityName) return localizeCityName(cityName, language);
  const fallbackLabel = String(fallback || '').trim();
  if (fallbackLabel && !normalizeAirportCode(fallbackLabel)) return localizeCityName(fallbackLabel, language);
  return '';
}

export function formatAirportDisplayName(value, language, fallback = '') {
  const airport = normalizeAirportCode(value);
  if (!airport) {
    const label = String(fallback || value || '').trim();
    return label ? localizeCityName(label, language) : '';
  }
  const city = AIRPORT_CITY_FALLBACKS[airport] || normalizeCatalogCity(OURAIRPORTS_CITY_BY_IATA[airport]) || '';
  const airportName = AIRPORT_LABEL_FALLBACKS[airport] || preferKnownCityAirportLabel(OURAIRPORTS_AIRPORT_LABEL_BY_IATA[airport], city);
  const fallbackLabel = String(fallback || '').trim();
  const readableName = airportName || (fallbackLabel && !normalizeAirportCode(fallbackLabel) ? fallbackLabel : city);
  if (!readableName) return '';
  return `${localizeCityName(readableName, language)} (${airport})`;
}

export function formatAirportDisplayNameCompact(value, language, fallback = '') {
  const airport = normalizeAirportCode(value);
  if (!airport) {
    const label = String(fallback || value || '').trim();
    return label && !normalizeAirportCode(label) ? localizeCityName(label, language) : '';
  }
  const city = AIRPORT_CITY_FALLBACKS[airport] || normalizeCatalogCity(OURAIRPORTS_CITY_BY_IATA[airport]) || '';
  const airportName = AIRPORT_LABEL_FALLBACKS[airport] || preferKnownCityAirportLabel(OURAIRPORTS_AIRPORT_LABEL_BY_IATA[airport], city);
  const fallbackLabel = String(fallback || '').trim();
  const readableName = airportName || (fallbackLabel && !normalizeAirportCode(fallbackLabel) ? fallbackLabel : city);
  return readableName ? localizeCityName(readableName, language) : '';
}

export function formatRouteAirportDisplayName(item, language) {
  const originCode = item?.origin_airport || item?.origin_iata || item?.origin;
  const destinationCode = item?.destination_airport || item?.destination_iata || item?.destination;
  const origin = formatAirportDisplayName(originCode, language, item?.origin_airport_name || item?.origin_name);
  const destination = formatAirportDisplayName(destinationCode, language, item?.destination_airport_name || item?.destination_name);
  return [origin, destination].filter(Boolean).join(' -> ');
}

export function formatRouteAirportDisplayNameCompact(item, language) {
  const originCode = item?.origin_airport || item?.origin_iata || item?.origin;
  const destinationCode = item?.destination_airport || item?.destination_iata || item?.destination;
  const origin = formatAirportDisplayNameCompact(originCode, language, item?.origin_airport_name || item?.origin_name);
  const destination = formatAirportDisplayNameCompact(destinationCode, language, item?.destination_airport_name || item?.destination_name);
  return [origin, destination].filter(Boolean).join(' -> ');
}

export function resolvePlaceDisplayName(place, language) {
  if (!place || typeof place !== 'object') return resolveAirportCityName(place, language);
  const cityName = String(place.city || place.city_name || '').trim();
  if (cityName) return localizeCityName(cityName, language);
  return resolveAirportCityName(place.airport || place.airport_code || place.fallback, language);
}

function safeOfferCityLabel(city, language) {
  const raw = String(city || '').trim();
  if (!raw || normalizeAirportCode(raw)) return '';
  return localizeCityName(raw, language);
}

function resolveOfferRouteCities(item, language) {
  const origin = safeOfferCityLabel(item?.origin_city, language)
    ? safeOfferCityLabel(item?.origin_city, language)
    : resolveAirportCityNameForOffer(item?.origin_airport || item?.origin, language, item?.origin);
  const destination = safeOfferCityLabel(item?.destination_city, language)
    ? safeOfferCityLabel(item?.destination_city, language)
    : resolveAirportCityNameForOffer(item?.destination_airport || item?.destination, language, item?.destination);
  return { origin, destination };
}

export function hasReadableOfferRouteDisplayName(item, language) {
  const { origin, destination } = resolveOfferRouteCities(item, language);
  return Boolean(origin && destination);
}

export function formatRouteDisplayName(item, language) {
  const { origin, destination } = resolveOfferRouteCities(item, language);
  if (origin && destination) return `${origin} -> ${destination}`;
  if (destination) return destination;
  if (origin) return origin;
  return routeFallbackLabel('area', language);
}

function getClusterRepresentativeAirport(cluster) {
  if (!cluster || typeof cluster !== 'object') return '';
  return (
    normalizeAirportCode(cluster.representative_airport) ||
    normalizeAirportCode(cluster.destination_airport) ||
    normalizeAirportCode(cluster.top_destination_airport) ||
    normalizeAirportCode(cluster.airport_code) ||
    normalizeAirportCode(cluster.slug)
  );
}

export function localizeClusterDisplayName(clusterOrName, language) {
  const localizedName = localizeClusterName(clusterOrName, language);
  if (!localizedName) return '';
  if (!clusterOrName || typeof clusterOrName !== 'object') return localizedName;

  const airport = getClusterRepresentativeAirport(clusterOrName);
  if (!airport) return localizedName;

  const airportCity = resolveAirportCityName(airport, language);
  const nameLooksLikeCode = normalizeAirportCode(localizedName);
  if (airportCity && airportCity !== airport && (nameLooksLikeCode || normalizeText(localizedName) === normalizeText(clusterOrName.slug))) {
    return airportCity;
  }

  const normalizedName = String(localizedName).trim();
  if (normalizedName.toUpperCase() === airport) return '';
  return normalizedName.replace(new RegExp(`\\s*\\(${airport}\\)\\s*$`, 'i'), '').trim();
}

export function localizeFollowEntityDisplayName(entity, language) {
  const type = normalizeText(entity?.entity_type);
  const rawDisplay = String(entity?.display_name || '').trim();
  const rawSlug = String(entity?.slug || '').trim();

  if (type === 'country') {
    return localizeCountryName(rawDisplay || rawSlug, language);
  }
  if (type === 'destination_cluster') {
    return localizeClusterName({ slug: rawSlug, cluster_name: rawDisplay || rawSlug }, language);
  }
  return rawDisplay || rawSlug;
}
