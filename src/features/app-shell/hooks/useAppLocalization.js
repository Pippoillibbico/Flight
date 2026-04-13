import { useEffect, useState } from 'react';
import { DEFAULT_LANGUAGE, DEFAULT_LANGUAGE_PACK, LANGS, loadLanguagePack } from '../../../i18n';
import { localizeCountryByIso2, toCanonicalCountryName } from '../../../utils/localizePlace';
import { isConsentGiven } from '../../../utils/cookieConsent';
import { readLocalStorageItem, removeLocalStorageItem, writeLocalStorageItem } from '../../../utils/browserStorage';
import { LANGUAGE_STORAGE_KEY } from '../../../utils/storageKeys';

const REGION_LABELS_I18N = {
  en: { all: 'All Regions', eu: 'Europe', asia: 'Asia', america: 'America', oceania: 'Oceania' },
  it: { all: 'Tutte le aree', eu: 'Europa', asia: 'Asia', america: 'America', oceania: 'Oceania' },
  de: { all: 'Alle Regionen', eu: 'Europa', asia: 'Asien', america: 'Amerika', oceania: 'Ozeanien' },
  fr: { all: 'Toutes les régions', eu: 'Europe', asia: 'Asie', america: 'Amérique', oceania: 'Océanie' },
  es: { all: 'Todas las regiones', eu: 'Europa', asia: 'Asia', america: 'América', oceania: 'Oceanía' },
  pt: { all: 'Todas as regiões', eu: 'Europa', asia: 'Ásia', america: 'América', oceania: 'Oceania' }
};

const CONNECTION_LABELS_I18N = {
  en: { all: 'Any', direct: 'Direct only', with_stops: 'With stops' },
  it: { all: 'Qualsiasi', direct: 'Solo diretti', with_stops: 'Con scali' },
  de: { all: 'Beliebig', direct: 'Nur Direktflüge', with_stops: 'Mit Zwischenstopp' },
  fr: { all: 'Peu importe', direct: 'Directs uniquement', with_stops: 'Avec escales' },
  es: { all: 'Cualquiera', direct: 'Solo directos', with_stops: 'Con escalas' },
  pt: { all: 'Qualquer', direct: 'Somente diretos', with_stops: 'Com escalas' }
};

const TRAVEL_TIME_LABELS_I18N = {
  en: { all: 'Any time', day: 'Day flights', night: 'Night flights' },
  it: { all: 'Qualsiasi orario', day: 'Voli diurni', night: 'Voli notturni' },
  de: { all: 'Beliebige Zeit', day: 'Tagesflüge', night: 'Nachtflüge' },
  fr: { all: 'N\'importe quelle heure', day: 'Vols de jour', night: 'Vols de nuit' },
  es: { all: 'Cualquier hora', day: 'Vuelos diurnos', night: 'Vuelos nocturnos' },
  pt: { all: 'Qualquer horário', day: 'Voos diurnos', night: 'Voos noturnos' }
};

function isGarbledI18nText(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || !text.includes('?')) return false;
  const qCount = (text.match(/\?/g) || []).length;
  const letterCount = (text.match(/[A-Za-z\u00C0-\u024F\u0400-\u04FF]/g) || []).length;
  return qCount >= 2 && letterCount === 0;
}

export function useAppLocalization() {
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [i18nPack, setI18nPack] = useState(DEFAULT_LANGUAGE_PACK);

  useEffect(() => {
    if (!LANGS.includes(language)) {
      setLanguage(DEFAULT_LANGUAGE);
    }
  }, [language]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isConsentGiven('functional')) {
      removeLocalStorageItem(LANGUAGE_STORAGE_KEY);
      return;
    }
    if (LANGS.includes(language)) writeLocalStorageItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    let active = true;
    loadLanguagePack(language)
      .then((pack) => {
        if (active && pack) setI18nPack(pack);
      })
      .catch(() => {
        if (active) setI18nPack(DEFAULT_LANGUAGE_PACK);
      });

    return () => {
      active = false;
    };
  }, [language]);

  const t = (key) => {
    const override = i18nPack.extra?.[key];
    if (override) return override;
    const localized = i18nPack.messages?.[key];
    if (isGarbledI18nText(localized)) return DEFAULT_LANGUAGE_PACK.messages?.[key] || key;
    return localized || DEFAULT_LANGUAGE_PACK.messages?.[key] || key;
  };

  const tt = (key) => i18nPack.tooltips?.[key] || DEFAULT_LANGUAGE_PACK.tooltips?.[key] || key;
  const regionLabel = (code) => REGION_LABELS_I18N[language]?.[code] || REGION_LABELS_I18N.en[code] || code;
  const connectionLabel = (code) => CONNECTION_LABELS_I18N[language]?.[code] || CONNECTION_LABELS_I18N.en[code] || code;
  const travelTimeLabel = (code) => TRAVEL_TIME_LABELS_I18N[language]?.[code] || TRAVEL_TIME_LABELS_I18N.en[code] || code;
  const canonicalCountryFilter = (value) => toCanonicalCountryName(String(value || '').trim(), language).trim();
  const canonicalDestinationQuery = (value) => toCanonicalCountryName(String(value || '').trim(), language).trim();
  const localizeDestinationSuggestionLabel = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const pairMatch = raw.match(/^(.*)\(([^()]+)\)$/);
    if (!pairMatch) return raw;
    const city = String(pairMatch[1] || '').trim();
    const country = String(pairMatch[2] || '').trim();
    const localizedCountry = localizeCountryByIso2('', country, language);
    return localizedCountry ? `${city} (${localizedCountry})` : raw;
  };
  const normalizeSuggestionToken = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const resolveSuggestionCityToken = (item) => {
    const type = String(item?.type || '').trim().toLowerCase();
    if (type === 'country') return '';
    const rawLabel = String(item?.label || '').trim();
    const rawValue = String(item?.value || '').trim();
    if (type === 'iata') {
      const match = rawLabel.match(/^[A-Za-z]{3}\s*\(([^()]+)\)$/);
      if (match) return normalizeSuggestionToken(match[1]);
    }
    const cityFromLabel = rawLabel.split('(')[0]?.trim();
    return normalizeSuggestionToken(cityFromLabel || rawValue);
  };

  return {
    language,
    setLanguage,
    i18nPack,
    t,
    tt,
    regionLabel,
    connectionLabel,
    travelTimeLabel,
    canonicalCountryFilter,
    canonicalDestinationQuery,
    localizeDestinationSuggestionLabel,
    normalizeSuggestionToken,
    resolveSuggestionCityToken
  };
}
