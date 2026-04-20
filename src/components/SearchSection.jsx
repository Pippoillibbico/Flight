import { z } from 'zod';
import { useAppContext } from '../context/AppContext';
import { validateProps } from '../utils/validateProps';

const FunctionPropSchema = z.custom((value) => typeof value === 'function', {
  message: 'Expected function prop.'
});

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
    defaultSearch
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
    submitJustGo,
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
  const isSubmitDisabled = searchLoading || (isMultiCityMode && !multiCityValidation.valid);
  const quickStartTitle = t('searchQuickStartTitle') || 'Fast path to your first useful result';
  const quickStartCopy =
    t('searchQuickStartCopy') || '1) Pick origin and dates 2) Run search 3) Track or book the best opportunity.';
  const aiAssistantSummary = t('searchAiAssistantSummary') || 'Optional: describe your trip in one sentence';
  const aiAssistantSummaryNote = t('searchAiAssistantSummaryNote') || 'We can auto-fill filters from your intent.';
  const searchTrustNote =
    t('searchTrustNote') || 'Results depend on connected providers. Always verify final fare before purchase.';
  return (
<section className="panel search-panel">
          <div className="panel-head">
            <h2>{t('search')}</h2>
            <div className="search-head-tools">
              <span className="summary">{offerSummary}</span>
              <div className="mode-switch" role="group" aria-label={t('mode')}>
                <button type="button" className={uiMode === 'simple' ? 'tab active' : 'tab'} onClick={() => setUiMode('simple')}>
                  {t('simpleMode')}
                </button>
                <button
                  type="button"
                  className={uiMode === 'advanced' ? 'tab active' : 'tab'}
                  onMouseEnter={() => prefetchAdvancedAnalyticsChunk?.()}
                  onFocus={() => prefetchAdvancedAnalyticsChunk?.()}
                  onClick={() => setUiMode('advanced')}
                >
                  {t('advancedMode')}
                </button>
                <InfoTip text={tt('mode_help')} />
              </div>
            </div>
          </div>
          <p className="muted">{t('explorePageSubtitle')}</p>
          <div className="search-quick-start" data-testid="search-quick-start">
            <p className="search-quick-start-title">{quickStartTitle}</p>
            <p className="search-quick-start-copy">{quickStartCopy}</p>
          </div>

          <form className="search-grid" onSubmit={submitSearch}>
            <details className="ai-intake-row search-ai-assistant" open={isAdvancedMode ? true : undefined}>
              <summary className="search-ai-assistant-summary">
                <span>{aiAssistantSummary}</span>
                <small>{aiAssistantSummaryNote}</small>
              </summary>
              <label>
                {t('aiPlannerTitle')}
                <p className="ai-planner-hint">{t('aiPlannerHint')}</p>
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
              <div className="ai-intake-chips">
                {quickIntakePrompts.map((preset) => (
                  <button key={preset} type="button" className="ghost" onClick={() => runQuickIntakePrompt(preset)} disabled={intakeLoading}>
                    {preset}
                  </button>
                ))}
              </div>
              <div className="item-actions">
                <button type="button" className="ghost" onClick={() => analyzeIntentPrompt()} disabled={intakeLoading}>
                  {intakeLoading ? t('aiAnalyzing') : t('aiAnalyze')}
                </button>
              </div>
              {intakeInfo ? (
                <p className="ai-intake-result" role="status" aria-live="polite">{intakeInfo}</p>
              ) : null}
            </details>

            <div className="trip-mode-toggle" role="group" aria-label={t('tripModeLabel') || 'Search mode'}>
              <button
                type="button"
                data-testid="single-trip-toggle"
                className={`${isMultiCityMode ? 'tab' : 'tab active'} search-mode-toggle-btn`}
                onClick={() => setSearchMode('single')}
              >
                {t('singleTripLabel') || 'Single trip'}
              </button>
              <button
                type="button"
                data-testid="multi-city-toggle"
                className={`${isMultiCityMode ? 'tab active' : 'tab'} search-mode-toggle-btn`}
                onClick={() => setSearchMode('multi_city')}
              >
                {t('multiCityLabel') || 'Multi-city'}
              </button>
            </div>

            {isMultiCityMode ? (
              <div className="multi-city-block" data-testid="multi-city-panel">
                <div className="multi-city-head">
                  <strong>{t('multiCityLabel') || 'Multi-city'}</strong>
                  <span className="muted">{t('multiCityHint') || 'Define 2 to 6 travel segments in chronological order.'}</span>
                </div>
                <div className="multi-city-list">
                  {multiCitySegments.map((segment, index) => {
                    const segmentError = multiCityValidation.segmentErrors[index] || {};
                    return (
                      <article key={segment.id} className="multi-city-row" data-testid={`multi-city-segment-${index}`}>
                        <header className="multi-city-row-head">
                          <strong>{(t('segmentLabel') || 'Segment')} {index + 1}</strong>
                          <button
                            type="button"
                            className="ghost"
                            data-testid={`remove-segment-${index}`}
                            aria-label={`${t('removeSegmentCta') || 'Remove segment'} ${index + 1}`}
                            onClick={() => deleteMultiCitySegment(index)}
                            disabled={!canRemoveMultiCity || searchLoading}
                          >
                            {t('removeSegmentCta') || 'Remove'}
                          </button>
                        </header>
                        <div className="multi-city-row-grid">
                          <label>
                            {t('origin')}
                            <input
                              data-testid={`segment-origin-${index}`}
                              aria-label={`${t('segmentLabel') || 'Segment'} ${index + 1} ${t('origin')}`}
                              autoComplete="off"
                              placeholder="MXP"
                              maxLength={3}
                              value={segment.origin}
                              onChange={(e) => setMultiCitySegmentValue(index, 'origin', e.target.value)}
                            />
                            {segmentError.origin ? <span className="error inline-error" data-testid={`segment-origin-error-${index}`}>{segmentError.origin}</span> : null}
                          </label>
                          <label>
                            {t('destinationLabel') || 'Destination'}
                            <input
                              data-testid={`segment-destination-${index}`}
                              aria-label={`${t('segmentLabel') || 'Segment'} ${index + 1} ${t('destinationLabel') || 'Destination'}`}
                              autoComplete="off"
                              placeholder="LIS"
                              maxLength={3}
                              value={segment.destination}
                              onChange={(e) => setMultiCitySegmentValue(index, 'destination', e.target.value)}
                            />
                            {segmentError.destination ? <span className="error inline-error" data-testid={`segment-destination-error-${index}`}>{segmentError.destination}</span> : null}
                          </label>
                          <label>
                            {t('departure')}
                            <input
                              data-testid={`segment-date-${index}`}
                              aria-label={`${t('segmentLabel') || 'Segment'} ${index + 1} ${t('departure')}`}
                              type="date"
                              value={segment.date}
                              onChange={(e) => setMultiCitySegmentValue(index, 'date', e.target.value)}
                            />
                            {segmentError.date ? <span className="error inline-error" data-testid={`segment-date-error-${index}`}>{segmentError.date}</span> : null}
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {multiCityValidation.formErrors.length > 0 ? (
                  <div className="multi-city-form-errors">
                    {multiCityValidation.formErrors.map((entry) => (
                      <p key={entry} className="error inline-error">{entry}</p>
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
                  <select className="origin-select" value={searchForm.origin} onChange={(e) => setSearchForm((p) => ({ ...p, origin: e.target.value }))}>
                    {config.origins.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.code} - {o.label.replace(` (${o.code})`, '')}
                      </option>
                    ))}
                  </select>
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
              <>
                <label>
                  {t('departure')}
                  <input type="date" value={searchForm.dateFrom} onChange={(e) => setSearchForm((p) => ({ ...p, periodPreset: 'custom', dateFrom: e.target.value }))} />
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
                    onChange={(e) => setSearchForm((p) => ({ ...p, periodPreset: 'custom', dateTo: e.target.value }))}
                  />
                </label>

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
              </>
            ) : null}

            {isAdvancedMode ? (
              <label>
                {t('travellers')}
                <input type="number" inputMode="numeric" min={1} max={9} value={searchForm.travellers} onChange={(e) => setSearchForm((p) => ({ ...p, travellers: Math.max(1, Math.min(9, Number(e.target.value) || 1)) }))} />
              </label>
            ) : null}

            <details className="advanced-block" open={isAdvancedMode ? true : undefined}>
              <summary>{t('advancedFilters')}</summary>
              <div className="advanced-grid">
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
                    <option value="chatgpt">ChatGPT (OpenAI API)</option>
                    <option value="claude">Claude (Anthropic API)</option>
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

            <div className="search-actions">
              <label className="check-row check-row-annotated">
                <input type="checkbox" checked={searchForm.cheapOnly} onChange={(e) => setSearchForm((p) => ({ ...p, cheapOnly: e.target.checked }))} />
                <span className="check-row-copy">
                  <span>{t('dealsOnly')}</span>
                  <small>{t('dealsOnlyHint')}</small>
                </span>
              </label>
              <div className="item-actions">
                <button type="submit" data-testid="submit-search" disabled={isSubmitDisabled}>
                  {searchLoading ? t('searching') : t('landingHeroCta')}
                </button>
                {!isMultiCityMode ? (
                  <button type="button" className="ghost" onClick={submitJustGo} disabled={searchLoading}>
                    {searchLoading ? t('deciding') : t('justGo')}
                  </button>
                ) : null}
                <button type="button" className="ghost" onClick={() => setSearchForm((prev) => ({ ...defaultSearch, origin: prev.origin }))}>
                  {t('resetFilters')}
                </button>
              </div>
            </div>
          </form>

          {!isMultiCityMode ? (
          <div className="date-presets">
            <span className="muted">{t('datePresets')}</span>
            <div className="item-actions">
              <button type="button" className="ghost" onClick={() => applyPeriodPreset('weekend')}>
                {t('presetWeekend')}
              </button>
              <button type="button" className="ghost" onClick={() => applyPeriodPreset('week')}>
                {t('presetWeek')}
              </button>
              <button type="button" className="ghost" onClick={() => applyPeriodPreset('two_weeks')}>
                {t('presetTwoWeeks')}
              </button>
              <button type="button" className="ghost" onClick={() => applyPeriodPreset('one_month')}>
                {t('presetOneMonth')}
              </button>
              <button type="button" className="ghost" onClick={() => applyPeriodPreset('three_months')}>
                {t('presetThreeMonths')}
              </button>
              <button type="button" className="ghost" onClick={() => applyPeriodPreset('six_months')}>
                {t('presetSixMonths')}
              </button>
              <button type="button" className="ghost" onClick={() => applyPeriodPreset('one_year')}>
                {t('presetOneYear')}
              </button>
            </div>
          </div>
          ) : null}

          {isAdvancedMode ? (
            <details className="advanced-block" open>
              <summary>{t('advancedTools')}</summary>
              {!canUseProFeatures ? <p className="muted">{t('premiumRequired')}</p> : null}
              <div className="item-actions">
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
              <button type="button" className="ghost" data-testid="retry-multi-city" onClick={retryMultiCitySearch} disabled={searchLoading}>
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
