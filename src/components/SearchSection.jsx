import { z } from 'zod';
import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { validateProps } from '../utils/validateProps';
import AirportAutocomplete from './AirportAutocomplete';

const FunctionPropSchema = z.custom((value) => typeof value === 'function', {
  message: 'Expected function prop.'
});

function openNativeDatePicker(event) {
  const input = event.currentTarget;
  if (input.disabled || typeof input.showPicker !== 'function') return;
  try {
    input.showPicker();
  } catch {
    // Some browsers already open the picker for the same click.
  }
}

const MULTI_CITY_ERROR_KEYS = {
  'Itinerary must include between 2 and 6 segments.': 'multiCityErrorSegmentCount',
  'Origin is required.': 'multiCityErrorOriginRequired',
  'Origin must be a 3-letter IATA code.': 'multiCityErrorOriginInvalid',
  'Destination is required.': 'multiCityErrorDestinationRequired',
  'Destination must be a 3-letter IATA code.': 'multiCityErrorDestinationInvalid',
  'Date is required.': 'multiCityErrorDateRequired',
  'Date must be a valid YYYY-MM-DD value.': 'multiCityErrorDateInvalid',
  'Origin and destination cannot be the same.': 'multiCityErrorSameAirport',
  'Segment date cannot be earlier than previous segment.': 'multiCityErrorChronology'
};

const SearchSectionPropsSchema = z
  .object({
    uiMode: z.enum(['simple', 'advanced']),
    intakePrompt: z.string(),
    intakeLoading: z.boolean(),
    intakeInfo: z.string(),
    searchLoading: z.boolean(),
    searchError: z.string(),
    searchMode: z.enum(['single', 'multi_city']),
    setSearchMode: FunctionPropSchema,
    multiCitySegments: z.array(
      z.object({
        id: z.string(),
        origin: z.string(),
        destination: z.string(),
        date: z.string()
      })
    ),
    multiCityValidation: z.object({
      valid: z.boolean(),
      segmentErrors: z.array(
        z.object({
          origin: z.string().optional(),
          destination: z.string().optional(),
          date: z.string().optional()
        })
      ),
      formErrors: z.array(z.string())
    }),
    setMultiCitySegmentValue: FunctionPropSchema,
    appendMultiCitySegment: FunctionPropSchema,
    deleteMultiCitySegment: FunctionPropSchema,
    retryMultiCitySearch: FunctionPropSchema,
    multiCityRetryVisible: z.boolean(),
    quickIntakePrompts: z.array(z.string()),
    intakeMessages: z.array(z.object({ id: z.string(), role: z.string(), text: z.string() })),
    searchForm: z
      .object({
        origin: z.string(),
        region: z.string(),
        destinationQuery: z.string(),
        country: z.string(),
        dateFrom: z.string(),
        dateTo: z.string(),
        periodPreset: z.string(),
        connectionType: z.string(),
        travelTime: z.string(),
        mood: z.string(),
        climatePreference: z.string(),
        pace: z.string(),
        packageCount: z.number(),
        aiProvider: z.string()
      })
      .passthrough(),
    searchResult: z.object({ flights: z.array(z.object({}).passthrough()), meta: z.unknown() }).passthrough(),
    config: z.object({ origins: z.array(z.any()), regions: z.array(z.any()), cabins: z.array(z.any()), connectionTypes: z.array(z.any()), travelTimes: z.array(z.any()) }).passthrough(),
    limitReachedBanner: z.any().optional()
  })
  .passthrough();

function SearchSection(props) {
  const {
    t,
    tt,
    offerSummary,
    InfoTip,
    connectionLabel,
    isAdvancedMode,
    user,
    regionLabel,
    travelTimeLabel,
    MOOD_OPTIONS,
    CLIMATE_PREF_OPTIONS,
    defaultSearch,
    language
  } = useAppContext();
  const {
    uiMode,
    setUiMode,
    submitSearch,
    intakePrompt,
    setIntakePrompt,
    analyzeIntentPrompt,
    searchMode,
    setSearchMode,
    multiCitySegments,
    multiCityValidation,
    setMultiCitySegmentValue,
    appendMultiCitySegment,
    deleteMultiCitySegment,
    retryMultiCitySearch,
    multiCityRetryVisible,
    quickIntakePrompts,
    runQuickIntakePrompt,
    intakeLoading,
    intakeMessages,
    intakeInfo,
    searchForm,
    setSearchForm,
    config,
    showDestinationSuggestions,
    setShowDestinationSuggestions,
    destinationSuggestions,
    applyPeriodPreset,
    showCountrySuggestions,
    setShowCountrySuggestions,
    countrySuggestions,
    searchLoading,
    createDurationAlert,
    upgradeToPremium,
    canUseProFeatures = false,
    canUseEliteFeatures = false,
    searchError,
    searchResult,
    autoFixSearchFilters,
    limitReachedBanner = null,
    prefetchAdvancedAnalyticsChunk
  } = validateProps(SearchSectionPropsSchema, props, 'SearchSection');
  const isMultiCityMode = searchMode === 'multi_city';
  const canAddMultiCity = multiCitySegments.length < 6;
  const canRemoveMultiCity = multiCitySegments.length > 2;
  const isInvalidMultiCity = isMultiCityMode && !multiCityValidation.valid;
  const isSubmitDisabled = searchLoading || isInvalidMultiCity;
  const incompleteMultiCitySegments = multiCityValidation.segmentErrors.filter((entry) => Object.values(entry).some(Boolean)).length;
  const [multiCityRevealErrors, setMultiCityRevealErrors] = useState(false);
  // Advanced-mode disclosure panels: open by default, but user can collapse and the choice sticks.
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(true);
  const [advancedToolsOpen, setAdvancedToolsOpen] = useState(true);
  // Advanced filters: count how many are narrowing the search (differ from defaults), so the
  // user always knows filters are applied — even in simple mode where they're hidden.
  const langIsEnglish = String(language || 'it').toLowerCase().startsWith('en');
  const activeFiltersLabel = langIsEnglish ? 'active' : 'attivi';
  const resetAdvancedLabel = langIsEnglish ? 'Reset advanced filters' : 'Azzera filtri avanzati';
  const activeAdvancedFilters = (() => {
    const f = searchForm || {};
    let count = 0;
    if (String(f.connectionType ?? 'all') !== 'all') count += 1;
    if (String(f.travelTime ?? 'all') !== 'all') count += 1;
    if (String(f.periodPreset ?? 'custom') !== 'custom') count += 1;
    if (String(f.region ?? 'all') !== 'all') count += 1;
    if (String(f.country ?? '').trim() !== '') count += 1;
    if (String(f.cabinClass ?? 'economy') !== 'economy') count += 1;
    if (Number(f.maxBudget) > 0) count += 1;
    const stops = String(f.maxStops ?? '').trim();
    if (stops !== '' && stops !== '2') count += 1;
    if (Number(f.minComfortScore) > 0) count += 1;
    return count;
  })();
  const resetAdvancedFilters = () => {
    setSearchForm((previous) => ({
      ...previous,
      connectionType: 'all',
      travelTime: 'all',
      periodPreset: 'custom',
      region: 'all',
      country: '',
      cabinClass: 'economy',
      maxBudget: '',
      maxStops: '2',
      minComfortScore: '',
      mood: 'relax',
      climatePreference: 'indifferent',
      pace: 'normal',
      packageCount: 3,
      aiProvider: 'none'
    }));
  };
  const quickStartTitle = t('searchQuickStartTitle') || 'Fast path to your first useful result';
  const quickStartCopy =
    t('searchQuickStartCopy') || '1) Pick origin and dates 2) Run search 3) Track or book the best opportunity.';
  const aiAssistantSummary = t('searchAiAssistantSummary') || 'Optional: describe your trip in one sentence';
  const aiAssistantSummaryNote = t('searchAiAssistantSummaryNote') || 'We can auto-fill filters from your intent.';
  const searchTrustNote =
    t('searchTrustNote') || 'Prices can change quickly. Always verify the final fare before purchase.';

  function translateMultiCityError(message) {
    const key = MULTI_CITY_ERROR_KEYS[message];
    return key ? t(key) || message : message;
  }

  function visibleMultiCityError(message) {
    if (!message) return '';
    return multiCityRevealErrors ? translateMultiCityError(message) : '';
  }

  function updateMultiCityField(index, field, value) {
    setMultiCitySegmentValue(index, field, value);
  }

  function handleSearchSubmit(event) {
    if (isInvalidMultiCity) {
      event.preventDefault();
      setMultiCityRevealErrors(true);
      return;
    }
    if (isMultiCityMode) setMultiCityRevealErrors(true);
    submitSearch(event);
  }

  function revealMultiCityErrors() {
    if (isInvalidMultiCity && !searchLoading) setMultiCityRevealErrors(true);
  }

  function activateSearchMode(mode) {
    setMultiCityRevealErrors(false);
    setSearchMode(mode);
  }

  function removeMultiCitySegment(index) {
    deleteMultiCitySegment(index);
  }

  function retryMultiCity() {
    setMultiCityRevealErrors(true);
    retryMultiCitySearch();
  }

  return (
<section className="panel search-panel">
          <div className="panel-head">
            <h2>{t('search')}</h2>
            <div className="search-head-tools">
              {offerSummary ? <span className="summary">{offerSummary}</span> : null}
            </div>
          </div>
          <p className="muted">{t('explorePageSubtitle')}</p>
          <div className="search-mode-choice">
            <div className="mode-switch" role="group" aria-label={t('mode')}>
              <button type="button" className={uiMode === 'simple' ? 'tab active' : 'tab'} onClick={() => setUiMode('simple')}>
                <span>{t('simpleMode')}</span>
                <small>{t('simpleModeHint')}</small>
              </button>
              <button
                type="button"
                className={uiMode === 'advanced' ? 'tab active' : 'tab'}
                onMouseEnter={() => prefetchAdvancedAnalyticsChunk?.()}
                onFocus={() => prefetchAdvancedAnalyticsChunk?.()}
                onClick={() => setUiMode('advanced')}
              >
                <span>{t('advancedMode')}</span>
                <small>{t('advancedModeHint')}</small>
              </button>
              <InfoTip text={tt('mode_help')} />
            </div>
          </div>
          <div className={`search-mode-explainer ${isAdvancedMode ? 'advanced' : 'simple'}`} data-testid="search-mode-explainer">
            <strong>{isAdvancedMode ? t('advancedModeExplainerTitle') : t('simpleModeExplainerTitle')}</strong>
            <p>{isAdvancedMode ? t('advancedModeExplainerCopy') : t('simpleModeExplainerCopy')}</p>
          </div>
          {!isAdvancedMode && activeAdvancedFilters > 0 ? (
            <div
              className="search-active-filters-hint"
              data-testid="advanced-filters-active-hint"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', margin: '0.5rem 0', padding: '0.5rem 0.75rem', borderRadius: '8px', background: 'rgba(255,193,7,0.12)', border: '1px solid rgba(255,193,7,0.35)', fontSize: '0.85rem' }}
            >
              <span>
                {langIsEnglish
                  ? `${activeAdvancedFilters} advanced filter${activeAdvancedFilters > 1 ? 's' : ''} still active and hidden in simple mode.`
                  : `${activeAdvancedFilters} ${activeAdvancedFilters > 1 ? 'filtri avanzati attivi' : 'filtro avanzato attivo'}, nascosti in modalità semplice.`}
              </span>
              <button type="button" className="ghost" onClick={resetAdvancedFilters} data-testid="reset-advanced-filters-simple">
                {resetAdvancedLabel}
              </button>
            </div>
          ) : null}
          <div className="search-quick-start" data-testid="search-quick-start">
            <p className="search-quick-start-title">{quickStartTitle}</p>
            <p className="search-quick-start-copy">{quickStartCopy}</p>
          </div>

          <form className="search-grid" onSubmit={handleSearchSubmit}>
            <div className="trip-mode-toggle" role="group" aria-label={t('tripModeLabel') || 'Search mode'}>
              <button
                type="button"
                data-testid="single-trip-toggle"
                className={`${isMultiCityMode ? 'tab' : 'tab active'} search-mode-toggle-btn`}
                onClick={() => activateSearchMode('single')}
              >
                {t('singleTripLabel') || 'Single trip'}
              </button>
              <button
                type="button"
                data-testid="multi-city-toggle"
                className={`${isMultiCityMode ? 'tab active' : 'tab'} search-mode-toggle-btn`}
                onClick={() => activateSearchMode('multi_city')}
              >
                {t('multiCityLabel') || 'Multi-city'}
              </button>
            </div>

            {isMultiCityMode ? (
              <div className="multi-city-block" data-testid="multi-city-panel">
                <div className="multi-city-head">
                  <div>
                    <strong>{t('multiCityLabel') || 'Multi-city'}</strong>
                    <span className="multi-city-count">{multiCitySegments.length}/6</span>
                  </div>
                  <span className="muted">{t('multiCityHint') || 'Add each flight in travel order. The next departure is filled in for you.'}</span>
                  <span className="multi-city-airport-hint">{t('airportAutocompleteHint') || 'Type a city and choose the airport from the suggestions.'}</span>
                  <span className={`multi-city-completion${multiCityValidation.valid ? ' complete' : ''}`}>
                    {multiCityValidation.valid
                      ? t('multiCityReady')
                      : (t('multiCityIncompleteSegments') || '{count} flights to complete').replace('{count}', incompleteMultiCitySegments)}
                  </span>
                </div>
                <div className="multi-city-list">
                  {multiCitySegments.map((segment, index) => {
                    const segmentError = multiCityValidation.segmentErrors[index] || {};
                    const originError = visibleMultiCityError(segmentError.origin);
                    const destinationError = visibleMultiCityError(segmentError.destination);
                    const dateError = visibleMultiCityError(segmentError.date);
                    return (
                      <article key={segment.id} className="multi-city-row" data-testid={`multi-city-segment-${index}`}>
                        <header className="multi-city-row-head">
                          <div className="multi-city-step-title">
                            <span className="multi-city-step-number">{index + 1}</span>
                            <strong>{(t('segmentLabel') || 'Segment')} {index + 1}</strong>
                          </div>
                          {canRemoveMultiCity ? (
                            <button
                              type="button"
                              className="ghost"
                              data-testid={`remove-segment-${index}`}
                              aria-label={`${t('removeSegmentCta') || 'Remove segment'} ${index + 1}`}
                              onClick={() => removeMultiCitySegment(index)}
                              disabled={searchLoading}
                            >
                              {t('removeSegmentCta') || 'Remove'}
                            </button>
                          ) : null}
                        </header>
                        <div className="multi-city-row-grid">
                          <label>
                            {t('origin')}
                            <AirportAutocomplete
                              testId={`segment-origin-${index}`}
                              ariaLabel={`${t('segmentLabel') || 'Segment'} ${index + 1} ${t('origin')}`}
                              emptyLabel={t('airportAutocompleteEmpty') || 'No airports found'}
                              language={language}
                              placeholder={t('airportAutocompletePlaceholder') || 'Type a city, for example Milan'}
                              value={segment.origin}
                              onChange={(value) => updateMultiCityField(index, 'origin', value)}
                            />
                            {originError ? <span className="error inline-error" data-testid={`segment-origin-error-${index}`}>{originError}</span> : null}
                          </label>
                          <label>
                            {t('destinationLabel') || 'Destination'}
                            <AirportAutocomplete
                              testId={`segment-destination-${index}`}
                              ariaLabel={`${t('segmentLabel') || 'Segment'} ${index + 1} ${t('destinationLabel') || 'Destination'}`}
                              emptyLabel={t('airportAutocompleteEmpty') || 'No airports found'}
                              language={language}
                              placeholder={t('airportAutocompletePlaceholder') || 'Type a city, for example Lisbon'}
                              value={segment.destination}
                              onChange={(value) => updateMultiCityField(index, 'destination', value)}
                            />
                            {destinationError ? <span className="error inline-error" data-testid={`segment-destination-error-${index}`}>{destinationError}</span> : null}
                          </label>
                          <label>
                            {t('departure')}
                            <input
                              data-testid={`segment-date-${index}`}
                              aria-label={`${t('segmentLabel') || 'Segment'} ${index + 1} ${t('departure')}`}
                              type="date"
                              value={segment.date}
                              onClick={openNativeDatePicker}
                              onChange={(e) => updateMultiCityField(index, 'date', e.target.value)}
                            />
                            {dateError ? <span className="error inline-error" data-testid={`segment-date-error-${index}`}>{dateError}</span> : null}
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {multiCityRevealErrors && multiCityValidation.formErrors.length > 0 ? (
                  <div className="multi-city-form-errors">
                    {multiCityValidation.formErrors.map((entry) => (
                      <p key={entry} className="error inline-error">{translateMultiCityError(entry)}</p>
                    ))}
                  </div>
                ) : null}
                <div className="multi-city-actions">
                  <button
                    type="button"
                    className="ghost"
                    data-testid="add-segment"
                    onClick={appendMultiCitySegment}
                    disabled={!canAddMultiCity || searchLoading}
                  >
                    {t('addSegmentCta') || 'Add segment'}
                  </button>
                </div>
              </div>
            ) : null}

            {!isMultiCityMode ? (
              <>
                <label>
                  {t('origin')}
                  <AirportAutocomplete
                    ariaLabel={t('origin')}
                    emptyLabel={t('airportAutocompleteEmpty') || 'No airports found'}
                    language={language}
                    placeholder={t('airportAutocompletePlaceholder') || 'Type a city, for example Milan'}
                    value={searchForm.origin}
                    onChange={(value) => setSearchForm((previous) => ({ ...previous, origin: value }))}
                  />
                </label>

                <label>
                  {t('keyword')}
                  <div className="suggest-wrap">
                    <input
                      autoComplete="off"
                      placeholder={t('keywordPlaceholder')}
                      value={searchForm.destinationQuery}
                      onFocus={() => setShowDestinationSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowDestinationSuggestions(false), 120)}
                      onChange={(e) => {
                        setSearchForm((p) => ({ ...p, destinationQuery: e.target.value }));
                        setShowDestinationSuggestions(true);
                      }}
                    />
                    {showDestinationSuggestions && searchForm.destinationQuery.trim().length > 0 ? (
                      <div className="suggest-menu">
                        {destinationSuggestions.length > 0 ? (
                          destinationSuggestions.map((s) => (
                            <button
                              key={`${s.type}-${s.value}`}
                              type="button"
                              className="suggest-item"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setSearchForm((p) => ({ ...p, destinationQuery: s.type === 'country' ? s.label : s.value }));
                                setShowDestinationSuggestions(false);
                              }}
                            >
                              {s.label}
                            </button>
                          ))
                        ) : (
                          <div className="suggest-empty">{t('destinationNoSuggestions')}</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </label>
              </>
            ) : null}

            {!isMultiCityMode ? (
              <>
                <label>
                  {t('departure')}
                  <input type="date" value={searchForm.dateFrom} onClick={openNativeDatePicker} onChange={(e) => setSearchForm((p) => ({ ...p, periodPreset: 'custom', dateFrom: e.target.value }))} />
                </label>

                <label>
                  {t('tripType') || 'Trip type'}
                  <select
                    value={searchForm.tripType || 'round_trip'}
                    onChange={(e) => setSearchForm((p) => ({ ...p, tripType: e.target.value === 'one_way' ? 'one_way' : 'round_trip' }))}
                  >
                    <option value="round_trip">{t('roundTrip') || 'Round trip'}</option>
                    <option value="one_way">{t('oneWay') || 'One way'}</option>
                  </select>
                </label>

                <label>
                  {t('ret')}
                  <input
                    type="date"
                    value={searchForm.tripType === 'one_way' ? '' : searchForm.dateTo}
                    disabled={searchForm.tripType === 'one_way'}
                    onClick={openNativeDatePicker}
                    onChange={(e) => setSearchForm((p) => ({ ...p, periodPreset: 'custom', dateTo: e.target.value }))}
                  />
                </label>

              </>
            ) : null}

            <label>
              {t('travellers')}
              <input type="number" inputMode="numeric" min={1} max={9} value={searchForm.travellers} onChange={(e) => setSearchForm((p) => ({ ...p, travellers: Math.max(1, Math.min(9, Number(e.target.value) || 1)) }))} />
            </label>

            {isAdvancedMode ? (
              <details className="advanced-block search-advanced-filters" data-testid="advanced-filters-panel" open={advancedFiltersOpen} onToggle={(event) => setAdvancedFiltersOpen(event.currentTarget.open)}>
                <summary>
                  <span>{t('advancedFilters')}{activeAdvancedFilters > 0 ? ` · ${activeAdvancedFilters} ${activeFiltersLabel}` : ''}</span>
                  <small>{t('advancedFiltersHint')}</small>
                </summary>
                {activeAdvancedFilters > 0 ? (
                  <div className="advanced-filters-actions" style={{ display: 'flex', justifyContent: 'flex-end', margin: '0.25rem 0 0.5rem' }}>
                    <button type="button" className="ghost" onClick={resetAdvancedFilters} data-testid="reset-advanced-filters">
                      {resetAdvancedLabel} ({activeAdvancedFilters})
                    </button>
                  </div>
                ) : null}
                <div className="advanced-grid">
                <label>
                  {t('connectionType')} <InfoTip text={tt('connection_help')} />
                  <select value={searchForm.connectionType} onChange={(e) => setSearchForm((p) => ({ ...p, connectionType: e.target.value }))}>
                    {config.connectionTypes.map((type) => (
                      <option key={type} value={type}>
                        {connectionLabel(type)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  {t('travelTime')} <InfoTip text={tt('time_help')} />
                  <select value={searchForm.travelTime} onChange={(e) => setSearchForm((p) => ({ ...p, travelTime: e.target.value }))}>
                    {config.travelTimes.map((timeBand) => (
                      <option key={timeBand} value={timeBand}>
                        {travelTimeLabel(timeBand)}
                      </option>
                    ))}
                  </select>
                </label>

                {!isMultiCityMode ? (
                  <label>
                    {t('period')}
                    <select value={searchForm.periodPreset || 'custom'} onChange={(e) => applyPeriodPreset(e.target.value)}>
                      <option value="custom">{t('periodCustom')}</option>
                      <option value="weekend">{t('periodWeekend')}</option>
                      <option value="week">{t('periodWeek')}</option>
                      <option value="two_weeks">{t('periodTwoWeeks')}</option>
                      <option value="one_month">{t('periodOneMonth')}</option>
                      <option value="three_months">{t('periodThreeMonths')}</option>
                      <option value="six_months">{t('periodSixMonths')}</option>
                      <option value="one_year">{t('periodOneYear')}</option>
                    </select>
                  </label>
                ) : null}

                <label>
                  {t('area')}
                  <select value={searchForm.region} onChange={(e) => setSearchForm((p) => ({ ...p, region: e.target.value, country: '' }))}>
                    {config.regions.map((r) => (
                      <option key={r} value={r}>
                        {regionLabel(r)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  {t('country')}
                  <div className="suggest-wrap">
                    <input
                      autoComplete="off"
                      placeholder={t('countryPlaceholder')}
                      value={searchForm.country}
                      onFocus={() => setShowCountrySuggestions(true)}
                      onBlur={() => setTimeout(() => setShowCountrySuggestions(false), 120)}
                      onChange={(e) => {
                        setSearchForm((p) => ({ ...p, country: e.target.value }));
                        setShowCountrySuggestions(true);
                      }}
                    />
                    {showCountrySuggestions && countrySuggestions.length > 0 ? (
                      <div className="suggest-menu">
                        {countrySuggestions.map((country) => (
                          <button
                            key={`${country.cca2}-${country.name}`}
                            type="button"
                            className="suggest-item"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSearchForm((p) => ({ ...p, country: country.localizedName || country.name }));
                              setShowCountrySuggestions(false);
                            }}
                          >
                            {country.localizedLabel || country.label || country.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </label>
                <label>
                  {t('cabin')}
                  <select value={searchForm.cabinClass} onChange={(e) => setSearchForm((p) => ({ ...p, cabinClass: e.target.value }))}>
                    {config.cabins.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  {t('budget')}
                  <input type="number" inputMode="numeric" min={0} value={searchForm.maxBudget} onChange={(e) => setSearchForm((p) => ({ ...p, maxBudget: Math.max(0, Number(e.target.value) || 0) }))} />
                </label>

                <label>
                  {t('maxStops')} <InfoTip text={tt('stops_help')} />
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={2}
                    value={searchForm.maxStops}
                    onChange={(e) => setSearchForm((p) => ({ ...p, maxStops: Math.max(0, Math.min(2, Number(e.target.value) ?? 0)) }))}
                  />
                </label>

                <label>
                  {t('minComfort')} <InfoTip text={tt('comfort_help')} />
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={searchForm.minComfortScore}
                    onChange={(e) => setSearchForm((p) => ({ ...p, minComfortScore: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))}
                    placeholder="1-100"
                  />
                </label>

                <label>
                  {t('mood')}
                  <select value={searchForm.mood} onChange={(e) => setSearchForm((p) => ({ ...p, mood: e.target.value }))}>
                    {MOOD_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {t(`mood_${value}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  {t('climate')}
                  <select value={searchForm.climatePreference} onChange={(e) => setSearchForm((p) => ({ ...p, climatePreference: e.target.value }))}>
                    {CLIMATE_PREF_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {t(`climate_${value}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  {t('pace')}
                  <select value={searchForm.pace} onChange={(e) => setSearchForm((p) => ({ ...p, pace: e.target.value }))}>
                    <option value="slow">{t('pace_slow')}</option>
                    <option value="normal">{t('pace_normal')}</option>
                    <option value="fast">{t('pace_fast')}</option>
                  </select>
                </label>

                <label>
                  {t('packages')}
                  <select value={searchForm.packageCount} onChange={(e) => setSearchForm((p) => ({ ...p, packageCount: Number(e.target.value) }))}>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                  </select>
                </label>

                <label>
                  {t('aiProviderLabel')}
                  <select value={searchForm.aiProvider} onChange={(e) => setSearchForm((p) => ({ ...p, aiProvider: e.target.value }))}>
                    <option value="none">{t('none')}</option>
                    <option value="chatgpt">{t('aiModeFast')}</option>
                    <option value="claude">{t('aiModeDeep')}</option>
                    <option value="auto">{t('auto')}</option>
                  </select>
                </label>

                <label className="check-row check-row-annotated">
                  <input
                    type="checkbox"
                    checked={Boolean(searchForm.avoidOvertourism)}
                    onChange={(e) => setSearchForm((p) => ({ ...p, avoidOvertourism: e.target.checked }))}
                  />
                  <span className="check-row-copy">
                    <span>{t('avoidOvertourism')}</span>
                    <small>{t('avoidOvertourismHint')}</small>
                  </span>
                  <InfoTip text={tt('overtourism_help')} />
                </label>
                </div>
              </details>
            ) : null}

            <section className="ai-intake-row search-ai-assistant">
              <div className="search-ai-assistant-copy">
                <span className="search-ai-assistant-badge">AI</span>
                <div>
                  <strong>{aiAssistantSummary}</strong>
                  <p>{aiAssistantSummaryNote}</p>
                </div>
              </div>
              <label className="search-ai-prompt-field">
                <span>{t('aiPlannerTitle')}</span>
                <textarea
                  className="ai-intake-box"
                  placeholder={t('aiInputPlaceholder')}
                  value={intakePrompt}
                  onChange={(e) => setIntakePrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      analyzeIntentPrompt();
                    }
                  }}
                />
              </label>
              <div className="search-ai-footer">
                <div className="ai-intake-chips">
                  {quickIntakePrompts.slice(0, 2).map((preset) => (
                    <button key={preset} type="button" className="ghost" onClick={() => runQuickIntakePrompt(preset)} disabled={intakeLoading}>
                      {preset}
                    </button>
                  ))}
                </div>
                <button type="button" className="search-ai-analyze-cta" onClick={() => analyzeIntentPrompt()} disabled={intakeLoading}>
                  {intakeLoading ? t('aiAnalyzing') : t('aiAnalyze')}
                </button>
              </div>
              {intakeInfo ? (
                <p className="ai-intake-result" role="status" aria-live="polite">{intakeInfo}</p>
              ) : null}
            </section>

            <div className="search-actions">
              <label className="check-row check-row-annotated">
                <input type="checkbox" checked={searchForm.cheapOnly} onChange={(e) => setSearchForm((p) => ({ ...p, cheapOnly: e.target.checked }))} />
                <span className="check-row-copy">
                  <span>{t('dealsOnly')}</span>
                  <small>{t('dealsOnlyHint')}</small>
                </span>
              </label>
              <div className="item-actions">
                <span
                  className="submit-search-shell"
                  data-testid="submit-search-action"
                  onClick={revealMultiCityErrors}
                >
                  <button
                    type="submit"
                    data-testid="submit-search"
                    aria-disabled={isSubmitDisabled}
                    disabled={searchLoading}
                  >
                    {searchLoading ? t('searching') : t('landingHeroCta')}
                  </button>
                </span>
                <button type="button" className="ghost" onClick={() => setSearchForm((prev) => ({ ...defaultSearch, origin: prev.origin }))}>
                  {t('resetFilters')}
                </button>
              </div>
            </div>
          </form>

          {isAdvancedMode ? (
            <details className="advanced-block search-advanced-tools" open={advancedToolsOpen} onToggle={(event) => setAdvancedToolsOpen(event.currentTarget.open)}>
              <summary>{t('advancedTools')}</summary>
              {!canUseProFeatures ? <p className="muted">{t('premiumRequired')}</p> : null}
              <div className="item-actions search-advanced-tools-actions">
                <button type="button" className="ghost" onClick={createDurationAlert} disabled={!canUseProFeatures}>
                  {t('durationAlert')}
                </button>
                {!canUseProFeatures ? (
                  <button type="button" className="ghost search-upgrade-cta" onClick={upgradeToPremium}>
                    {t('upgradePremium')}
                  </button>
                ) : null}
                {!canUseEliteFeatures ? <span className="muted">{t('routeInsightsEliteOnly')}</span> : null}
              </div>
            </details>
          ) : null}

          <p className="muted">{t('quickTips')}</p>
          <p className="muted search-trust-note">{searchTrustNote}</p>
          {limitReachedBanner?.show ? (
            <div className="limit-reached-card" role="alert" data-testid="limit-reached-card">
              <div className="limit-reached-card-body">
                <p className="limit-reached-card-title">{limitReachedBanner.title}</p>
                <p className="limit-reached-card-message">{limitReachedBanner.message}</p>
              </div>
              <div className="limit-reached-card-actions">
                <button type="button" className="primary limit-reached-card-cta" onClick={limitReachedBanner.onCta}>
                  {limitReachedBanner.ctaLabel}
                </button>
                <button type="button" className="ghost limit-reached-card-secondary" onClick={limitReachedBanner.onSecondaryCta}>
                  {limitReachedBanner.secondaryCtaLabel}
                </button>
                <button type="button" className="ghost limit-reached-card-dismiss" onClick={limitReachedBanner.onDismiss} aria-label="Dismiss">✕</button>
              </div>
            </div>
          ) : searchError ? <p className="error">{searchError}</p> : null}
          {isMultiCityMode && multiCityRetryVisible ? (
            <div className="item-actions">
              <button type="button" className="ghost" data-testid="retry-multi-city" onClick={retryMultiCity} disabled={searchLoading}>
                {t('retryActionLabel') || 'Retry search'}
              </button>
            </div>
          ) : null}
          {searchResult.flights.length === 0 && searchResult.meta ? (
            <div className="helper-box">
              <p className="muted">{t('noResultsHelper')}</p>
              <button type="button" className="ghost" onClick={autoFixSearchFilters}>
                {t('autoFixFilters')}
              </button>
            </div>
          ) : null}
        
      </section>
  );
}

export default SearchSection;
