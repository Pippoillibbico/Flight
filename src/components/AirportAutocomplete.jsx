import { useEffect, useMemo, useRef, useState } from 'react';
import { OURAIRPORTS_COMMERCIAL_IATA_SET } from '../data/ourairports-commercial-iata.js';
import { OURAIRPORTS_CITY_BY_IATA } from '../data/ourairports-city-map.js';
import { OURAIRPORTS_COUNTRY_BY_IATA } from '../data/ourairports-country-map.js';
import { OURAIRPORTS_AIRPORT_LABEL_BY_IATA } from '../data/ourairports-place-map.js';
import { formatAirportDisplayNameCompact, localizeCountryByIso2, resolveAirportCityName } from '../utils/localizePlace';

const LANGUAGE_COUNTRY_PRIORITY = {
  it: 'IT',
  en: 'GB',
  de: 'DE',
  fr: 'FR',
  es: 'ES',
  pt: 'PT'
};

const QUERY_COUNTRY_PRIORITY = {
  roma: 'IT',
  rome: 'IT'
};

const AIRPORT_CODE_PRIORITY = {
  FCO: 0,
  CIA: 1
};

const AIRPORT_OPTIONS = Object.entries(OURAIRPORTS_CITY_BY_IATA)
  .filter(([code]) => OURAIRPORTS_COMMERCIAL_IATA_SET.has(code))
  .map(([code, city]) => ({
    code,
    city: String(city || '').trim(),
    countryCode: String(OURAIRPORTS_COUNTRY_BY_IATA[code] || '').trim().toUpperCase(),
    airport: String(OURAIRPORTS_AIRPORT_LABEL_BY_IATA[code] || '').trim()
  }));

function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function queryCountryPriority(option, query) {
  const preferredCountry = QUERY_COUNTRY_PRIORITY[query] || '';
  return preferredCountry && option.countryCode === preferredCountry ? 0 : 1;
}

function languageCountryPriority(option, language) {
  const languageCode = String(language || '').toLowerCase().split('-')[0];
  const preferredCountry = LANGUAGE_COUNTRY_PRIORITY[languageCode] || '';
  return preferredCountry && option.countryCode === preferredCountry ? 0 : 1;
}

function airportCodePriority(option) {
  return AIRPORT_CODE_PRIORITY[option.code] ?? 99;
}

function optionScore(option, query, language) {
  const normalizedCode = option.code.toLowerCase();
  const normalizedCity = normalizeForSearch(option.city);
  const localizedCity = normalizeForSearch(resolveAirportCityName(option.code, language));
  const italianCity = normalizeForSearch(resolveAirportCityName(option.code, 'it'));
  const normalizedAirport = normalizeForSearch(option.airport);
  const localizedCountry = normalizeForSearch(localizeCountryByIso2(option.countryCode, option.countryCode, language));
  if (normalizedCode === query) return 0;
  if (normalizedCity === query || localizedCity === query || italianCity === query) return 1;
  if (localizedCity.startsWith(query) || italianCity.startsWith(query) || normalizedCity.startsWith(query)) return 2;
  if (normalizedCode.startsWith(query)) return 3;
  if (normalizedAirport.startsWith(query)) return 4;
  if (localizedCity.includes(query) || italianCity.includes(query) || normalizedCity.includes(query)) return 5;
  if (localizedCountry.startsWith(query)) return 6;
  return normalizedAirport.includes(query) || localizedCountry.includes(query) ? 7 : 99;
}

function extractKnownAirportCode(value) {
  const text = String(value || '').trim().toUpperCase();
  if (OURAIRPORTS_COMMERCIAL_IATA_SET.has(text)) return text;
  const parenthesizedCode = text.match(/\(([A-Z]{3})(?:,\s*[^)]*)?\)/)?.[1];
  if (parenthesizedCode && OURAIRPORTS_COMMERCIAL_IATA_SET.has(parenthesizedCode)) return parenthesizedCode;
  return '';
}

function AirportAutocomplete({
  value,
  onChange,
  language = 'it',
  placeholder,
  emptyLabel = 'No airports found',
  ariaLabel,
  testId,
  disabled = false
}) {
  const selectedCode = String(value || '').trim().toUpperCase();
  const [draft, setDraft] = useState(() => selectedCode);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const clearingSelectedAirportRef = useRef(false);

  function optionLabel(code) {
    const city = resolveAirportCityName(code, language);
    const airport = formatAirportDisplayNameCompact(code, language);
    const country = localizeCountryByIso2(OURAIRPORTS_COUNTRY_BY_IATA[code], OURAIRPORTS_COUNTRY_BY_IATA[code], language);
    const codeSuffix = country ? `${code}, ${country}` : code;
    return airport && normalizeForSearch(airport) !== normalizeForSearch(city)
      ? `${city} - ${airport} (${codeSuffix})`
      : `${city} (${codeSuffix})`;
  }

  useEffect(() => {
    if (!open) setDraft(selectedCode ? optionLabel(selectedCode) : '');
  }, [language, open, selectedCode]);

  const suggestions = useMemo(() => {
    const query = normalizeForSearch(draft);
    if (query.length < 2) return [];
    return AIRPORT_OPTIONS
      .map((option) => ({ ...option, score: optionScore(option, query, language) }))
      .filter((option) => option.score < 99)
      .sort((left, right) =>
        left.score - right.score ||
        queryCountryPriority(left, query) - queryCountryPriority(right, query) ||
        languageCountryPriority(left, language) - languageCountryPriority(right, language) ||
        airportCodePriority(left) - airportCodePriority(right) ||
        left.city.localeCompare(right.city) ||
        left.code.localeCompare(right.code)
      )
      .slice(0, 8);
  }, [draft, language]);
  const draftKnownAirportCode = extractKnownAirportCode(draft);
  const hasSearchQuery = draft.trim().length >= 2;
  const showEmptyState = hasSearchQuery && suggestions.length === 0 && !draftKnownAirportCode && !clearingSelectedAirportRef.current;
  const showSuggestionsMenu = open && hasSearchQuery && (suggestions.length > 0 || showEmptyState);

  function selectAirport(code) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    onChange(normalizedCode);
    setDraft(optionLabel(normalizedCode));
    setOpen(false);
    setActiveIndex(0);
    clearingSelectedAirportRef.current = false;
  }

  function updateDraft(nextDraft) {
    const normalizedNextDraft = String(nextDraft || '');
    const selectedLabel = selectedCode ? optionLabel(selectedCode) : '';
    if (selectedCode && normalizedNextDraft.length < selectedLabel.length && selectedLabel.startsWith(normalizedNextDraft)) {
      clearingSelectedAirportRef.current = true;
    } else if (!normalizedNextDraft.trim() || normalizedNextDraft.length > draft.length) {
      clearingSelectedAirportRef.current = false;
    }
    setDraft(nextDraft);
    setOpen(true);
    setActiveIndex(0);
    const normalizedCode = String(nextDraft || '').trim().toUpperCase();
    onChange(/^[A-Z]{3}$/.test(normalizedCode) ? normalizedCode : '');
  }

  return (
    <div className={`airport-autocomplete${showSuggestionsMenu ? ' open' : ''}`}>
      <input
        data-testid={testId}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showSuggestionsMenu && suggestions.length > 0}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        role="combobox"
        value={draft}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setDraft(selectedCode ? optionLabel(selectedCode) : '');
        }}
        onChange={(event) => updateDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && suggestions.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => (current + 1) % suggestions.length);
          }
          if (event.key === 'ArrowUp' && suggestions.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
          }
          if (event.key === 'Enter' && open && suggestions[activeIndex]) {
            event.preventDefault();
            selectAirport(suggestions[activeIndex].code);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      {showSuggestionsMenu ? (
        <div className="airport-suggest-menu" role="listbox">
          {suggestions.length > 0 ? (
            suggestions.map((option, index) => (
              <button
                key={option.code}
                type="button"
                className={`airport-suggest-item${index === activeIndex ? ' active' : ''}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectAirport(option.code)}
              >
                <strong>{resolveAirportCityName(option.code, language)}</strong>
                <span>
                  {formatAirportDisplayNameCompact(option.code, language)}
                  {option.countryCode ? ` - ${localizeCountryByIso2(option.countryCode, option.countryCode, language)}` : ''}
                  {' - '}
                  {option.code}
                </span>
              </button>
            ))
          ) : showEmptyState ? (
            <span className="airport-suggest-empty">{emptyLabel}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default AirportAutocomplete;
