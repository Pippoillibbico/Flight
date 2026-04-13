import { z } from 'zod';
import { useAppContext } from '../context/AppContext';
import { validateProps } from '../utils/validateProps';

const SearchSectionPropsSchema = z
  .object({
    uiMode: z.enum(['simple', 'advanced']),
    intakePrompt: z.string(),
    intakeLoading: z.boolean(),
    intakeInfo: z.string(),
    searchLoading: z.boolean(),
    searchError: z.string(),
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
    searchResult: z.object({ flights: z.array(z.any()), meta: z.any() }).passthrough(),
    config: z.object({ origins: z.array(z.any()), regions: z.array(z.any()), cabins: z.array(z.any()), connectionTypes: z.array(z.any()), travelTimes: z.array(z.any()) }).passthrough()
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
    prefetchAdvancedAnalyticsChunk
  } = validateProps(SearchSectionPropsSchema, props, 'SearchSection');
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

          <form className="search-grid" onSubmit={submitSearch}>
            <div className="ai-intake-row">
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
              <p className="ai-api-note">{t('aiApiDescription')}</p>
              <div className="ai-intake-chat" role="status" aria-live="polite">
                {intakeMessages.slice(-8).map((message) => (
                  <div key={message.id} className={message.role === 'user' ? 'ai-note-card ai-note-user' : 'ai-note-card ai-note-assistant'}>
                    <span className="ai-note-role">{message.role === 'user' ? t('aiInput') : t('aiResponse')}</span>
                    <p>{message.text}</p>
                  </div>
                ))}
              </div>
              <div className="ai-intake-chips">
                {quickIntakePrompts.map((preset) => (
                  <button key={preset} type="button" className="ghost" onClick={() => runQuickIntakePrompt(preset)} disabled={intakeLoading}>
                    {preset}
                  </button>
                ))}
              </div>
              <div className="item-actions">
                <button type="button" className="ghost" onClick={analyzeIntentPrompt} disabled={intakeLoading}>
                  {intakeLoading ? t('aiAnalyzing') : t('aiAnalyze')}
                </button>
                {intakeInfo ? <span className="muted">{intakeInfo}</span> : null}
              </div>
            </div>

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
                  placeholder={t('keywordPlaceholder')}
                  value={searchForm.destinationQuery}
                  onFocus={() => setShowDestinationSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowDestinationSuggestions(false), 120)}
                  onChange={(e) => {
                    setSearchForm((p) => ({ ...p, destinationQuery: e.target.value }));
                    setShowDestinationSuggestions(true);
                  }}
                />
                {showDestinationSuggestions && destinationSuggestions.length > 0 ? (
                  <div className="suggest-menu">
                    {destinationSuggestions.map((s) => (
                      <button
                        key={`${s.type}-${s.value}`}
                        type="button"
                        className="suggest-item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSearchForm((p) => ({ ...p, destinationQuery: s.value }));
                          setShowDestinationSuggestions(false);
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </label>

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

            <label>
              {t('departure')}
              <input type="date" value={searchForm.dateFrom} onChange={(e) => setSearchForm((p) => ({ ...p, periodPreset: 'custom', dateFrom: e.target.value }))} />
            </label>

            <label>
              {t('ret')}
              <input type="date" value={searchForm.dateTo} onChange={(e) => setSearchForm((p) => ({ ...p, periodPreset: 'custom', dateTo: e.target.value }))} />
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

            {isAdvancedMode ? (
              <label>
                {t('travellers')}
                <input type="number" min={1} max={9} value={searchForm.travellers} onChange={(e) => setSearchForm((p) => ({ ...p, travellers: e.target.value }))} />
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
                              setSearchForm((p) => ({ ...p, country: country.name }));
                              setShowCountrySuggestions(false);
                            }}
                          >
                            {country.label}
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
                  <input type="number" min={0} value={searchForm.maxBudget} onChange={(e) => setSearchForm((p) => ({ ...p, maxBudget: e.target.value }))} />
                </label>

                <label>
                  {t('maxStops')} <InfoTip text={tt('stops_help')} />
                  <input
                    type="number"
                    min={0}
                    max={2}
                    value={searchForm.maxStops}
                    onChange={(e) => setSearchForm((p) => ({ ...p, maxStops: e.target.value }))}
                  />
                </label>

                <label>
                  {t('minComfort')} <InfoTip text={tt('comfort_help')} />
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={searchForm.minComfortScore}
                    onChange={(e) => setSearchForm((p) => ({ ...p, minComfortScore: e.target.value }))}
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

                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={Boolean(searchForm.avoidOvertourism)}
                    onChange={(e) => setSearchForm((p) => ({ ...p, avoidOvertourism: e.target.checked }))}
                  />
                  {t('avoidOvertourism')}
                </label>
              </div>
            </details>

            <div className="search-actions">
              <label className="check-row">
                <input type="checkbox" checked={searchForm.cheapOnly} onChange={(e) => setSearchForm((p) => ({ ...p, cheapOnly: e.target.checked }))} />
                {t('dealsOnly')}
              </label>
              <div className="item-actions">
                <button type="button" className="ghost" onClick={() => setSearchForm((prev) => ({ ...defaultSearch, origin: prev.origin }))}>
                  {t('resetFilters')}
                </button>
                <button type="button" className="ghost" onClick={submitJustGo} disabled={searchLoading}>
                  {searchLoading ? t('deciding') : t('justGo')}
                </button>
                <button type="submit" disabled={searchLoading}>
                  {searchLoading ? t('searching') : t('landingHeroCta')}
                </button>
              </div>
            </div>
          </form>

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

          {isAdvancedMode ? (
            <details className="advanced-block" open>
              <summary>{t('advancedTools')}</summary>
              {!canUseProFeatures ? <p className="muted">{t('premiumRequired')}</p> : null}
              <div className="item-actions">
                <button type="button" className="ghost" onClick={createDurationAlert} disabled={!canUseProFeatures}>
                  {t('durationAlert')}
                </button>
                {!canUseProFeatures ? (
                  <button type="button" className="ghost" onClick={upgradeToPremium}>
                    {t('upgradePremium')}
                  </button>
                ) : null}
                {!canUseEliteFeatures ? <span className="muted">{t('routeInsightsEliteOnly')}</span> : null}
              </div>
            </details>
          ) : null}

          <p className="muted">{t('quickTips')}</p>
          {searchError ? <p className="error">{searchError}</p> : null}
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
