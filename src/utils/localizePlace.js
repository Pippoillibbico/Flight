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
    lisbon: 'Lisbona',
    barcelona: 'Barcellona',
    athens: 'Atene',
    berlin: 'Berlino',
    london: 'Londra',
    paris: 'Parigi',
    munich: 'Monaco di Baviera',
    cologne: 'Colonia',
    vienna: 'Vienna'
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

  const normalizedName = String(localizedName).trim();
  if (normalizedName.toUpperCase() === airport) return normalizedName;
  if (normalizedName.includes(`(${airport})`)) return normalizedName;
  return `${normalizedName} (${airport})`;
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
