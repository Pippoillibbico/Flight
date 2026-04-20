import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { extractUpgradeContext } from '../../../utils/handleApiError';

export function useSearchFlowActions({
  api,
  token,
  t,
  searchMode,
  searchForm,
  multiCitySegments,
  intakePrompt,
  DEFAULT_MULTI_CITY_RETRY_POLICY,
  trackSearchEvent,
  getErrorTrackingData,
  validateMultiCityForm,
  buildCurrentMultiCityPayload,
  submitMultiCitySearchWithRetry,
  applySearchResultState,
  refreshSearchHistory,
  canonicalCountryFilter,
  canonicalDestinationQuery,
  asOptionalPositiveInt,
  asOptionalBoundedInt,
  resolveApiError,
  setSearchError,
  setSearchLoading,
  setMultiCityValidation,
  setMultiCityRetryVisible,
  setSearchForm,
  setIntakeInfo,
  setIntakeLoading,
  setIntakeMessages,
  setIntakePrompt,
  onUpgradeRequired = null,
  onLimitReached = null
}) {
  function handleSearchError(error) {
    const upgradeCtx = extractUpgradeContext(error);
    if (upgradeCtx) {
      if (upgradeCtx.source === 'search_limit' && typeof onLimitReached === 'function') {
        onLimitReached();
        return;
      }
      if (typeof onUpgradeRequired === 'function') {
        onUpgradeRequired(upgradeCtx.planType, upgradeCtx.source);
        return;
      }
    }
    setSearchError(resolveApiError(error));
  }
  async function submitSearch(event) {
    event.preventDefault();
    trackSearchEvent('search_submitted', {
      extra:
        searchMode === 'multi_city'
          ? { multiCitySegments: Array.isArray(multiCitySegments) ? multiCitySegments.length : 0 }
          : undefined
    });
    setSearchError('');
    setSearchLoading(true);

    if (searchMode === 'multi_city') {
      const validation = validateMultiCityForm({ segments: multiCitySegments });
      setMultiCityValidation(validation);
      if (!validation.valid) {
        setSearchLoading(false);
        setSearchError(t('multiCityFixValidation'));
        trackSearchEvent('search_validation_blocked', {
          errorCode: 'multi_city_validation_failed',
          errorMessage: t('multiCityFixValidation')
        });
        return;
      }

      const payload = buildCurrentMultiCityPayload();
      setMultiCityRetryVisible(false);

      try {
        const result = await submitMultiCitySearchWithRetry(
          api,
          payload,
          token || undefined,
          DEFAULT_MULTI_CITY_RETRY_POLICY
        );
        applySearchResultState(result);
        trackSearchEvent('search_succeeded', { resultCount: Array.isArray(result?.flights) ? result.flights.length : 0 });
        await refreshSearchHistory();
      } catch (error) {
        handleSearchError(error);
        setMultiCityRetryVisible(true);
        trackSearchEvent('search_failed', getErrorTrackingData(error));
      } finally {
        setSearchLoading(false);
      }
      return;
    }

    const isOneWay = String(searchForm.tripType || 'round_trip') === 'one_way';
    const payload = {
      ...searchForm,
      tripType: isOneWay ? 'one_way' : 'round_trip',
      dateTo: isOneWay ? undefined : searchForm.dateTo,
      country: canonicalCountryFilter(searchForm.country) || undefined,
      destinationQuery: canonicalDestinationQuery(searchForm.destinationQuery) || undefined,
      maxBudget: asOptionalPositiveInt(searchForm.maxBudget),
      maxStops: asOptionalBoundedInt(searchForm.maxStops, { min: 0, max: 2 }),
      minComfortScore: asOptionalBoundedInt(searchForm.minComfortScore, { min: 1, max: 100 }),
      travellers: asOptionalBoundedInt(searchForm.travellers, { min: 1, max: 9 }) ?? 1
    };

    try {
      const result = await api.search(payload, token || undefined);
      applySearchResultState(result);
      trackSearchEvent('search_succeeded', { resultCount: Array.isArray(result?.flights) ? result.flights.length : 0 });
      await refreshSearchHistory();
    } catch (error) {
      handleSearchError(error);
      trackSearchEvent('search_failed', getErrorTrackingData(error));
    } finally {
      setSearchLoading(false);
    }
  }

  async function retryMultiCitySearch() {
    if (searchMode !== 'multi_city') return;
    trackSearchEvent('search_retry_clicked');
    const validation = validateMultiCityForm({ segments: multiCitySegments });
    setMultiCityValidation(validation);
    if (!validation.valid) {
      setSearchError(t('multiCityFixValidation'));
      setMultiCityRetryVisible(false);
      trackSearchEvent('search_validation_blocked', {
        errorCode: 'multi_city_validation_failed',
        errorMessage: t('multiCityFixValidation')
      });
      return;
    }

    const payload = buildCurrentMultiCityPayload();
    setSearchError('');
    setSearchLoading(true);
    setMultiCityRetryVisible(false);
    try {
      const result = await submitMultiCitySearchWithRetry(
        api,
        payload,
        token || undefined,
        DEFAULT_MULTI_CITY_RETRY_POLICY
      );
      applySearchResultState(result);
      trackSearchEvent('search_succeeded', { resultCount: Array.isArray(result?.flights) ? result.flights.length : 0 });
      await refreshSearchHistory();
    } catch (error) {
      handleSearchError(error);
      setMultiCityRetryVisible(true);
      trackSearchEvent('search_failed', getErrorTrackingData(error));
    } finally {
      setSearchLoading(false);
    }
  }

  async function submitJustGo() {
    setSearchError('');
    setSearchLoading(true);
    try {
      if (String(searchForm.tripType || 'round_trip') === 'one_way') {
        throw new Error('Just Go richiede un intervallo andata/ritorno.');
      }
      const tripLengthDays = Math.max(2, differenceInCalendarDays(parseISO(searchForm.dateTo), parseISO(searchForm.dateFrom)));
      const budgetMax = searchForm.maxBudget ? Number(searchForm.maxBudget) : 0;
      if (!Number.isFinite(budgetMax) || budgetMax <= 0) {
        throw new Error(t('justGoBudgetRequired'));
      }

      const result = await api.justGoDecision(
        {
          origin: searchForm.origin,
          region: searchForm.region,
          country: canonicalCountryFilter(searchForm.country) || undefined,
          dateFrom: searchForm.dateFrom,
          dateTo: searchForm.dateTo,
          tripLengthDays,
          budgetMax,
          travellers: Number(searchForm.travellers),
          cabinClass: searchForm.cabinClass,
          mood: searchForm.mood || 'relax',
          climatePreference: searchForm.climatePreference || 'indifferent',
          pace: searchForm.pace || 'normal',
          avoidOvertourism: Boolean(searchForm.avoidOvertourism),
          packageCount: Number(searchForm.packageCount) === 4 ? 4 : 3,
          aiProvider: searchForm.aiProvider || 'none'
        },
        token || undefined
      );

      const flights = (result.recommendations || []).map((item, idx) => ({
        id: item.id || `${searchForm.origin}-${item.destinationIata}-${idx}`,
        origin: searchForm.origin,
        destination: item.destination,
        destinationIata: item.destinationIata,
        region: item.region || searchForm.region,
        area: item.area || '',
        climate: item.climateInPeriod?.comfort || '-',
        price: item.costBreakdown?.flight || item.price || 0,
        avg2024: Math.round((item.costBreakdown?.flight || item.price || 0) * 1.15),
        highSeasonAvg: Math.round((item.costBreakdown?.flight || item.price || 0) * 1.25),
        cheaperThan2024: true,
        cheaperThanHighSeason: true,
        savingVs2024: Math.round((item.costBreakdown?.flight || item.price || 0) * 0.15),
        stopCount: Number.isFinite(item.stopCount) ? item.stopCount : 0,
        stopLabel: item.stopLabel || t('autoSelected'),
        isDirect: item.stopCount === 0,
        durationHours: item.durationHours || tripLengthDays,
        departureHour: item.departureHour || 9,
        arrivalHour: item.arrivalHour || 12,
        departureTimeLabel: item.departureTimeLabel || '--:--',
        arrivalTimeLabel: item.arrivalTimeLabel || '--:--',
        isNightFlight: Boolean(item.isNightFlight),
        comfortScore: item.comfortScore || 70,
        routeType: item.routeType || 'auto',
        link: item.bookingLink || item.link,
        bookingLink: item.bookingLink || item.link,
        travelScore: item.travelScore,
        reasons: item.reasons || [],
        aiWhyNow: item.aiWhyNow || '',
        aiRiskNote: item.aiRiskNote || '',
        trendScore: item.trendScore,
        crowding: item.crowding,
        climateInPeriod: item.climateInPeriod,
        costBreakdown: item.costBreakdown
      }));

      applySearchResultState({
        meta: {
          ...(result.meta || {}),
          count: flights.length,
          stayDays: tripLengthDays,
          mode: 'just_go',
          ai: result.ai || { provider: 'none', enhanced: false }
        },
        alerts: [],
        flights
      });
      await refreshSearchHistory();
    } catch (error) {
      handleSearchError(error);
    } finally {
      setSearchLoading(false);
    }
  }

  async function analyzeIntentPrompt(promptOverride) {
    const text = String(promptOverride ?? intakePrompt).trim();
    if (!text) return;
    setSearchError('');
    setIntakeInfo('');
    setIntakeLoading(true);
    setIntakeMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        text
      }
    ]);
    try {
      const payload = await api.decisionIntake(
        {
          prompt: text,
          aiProvider: searchForm.aiProvider || 'none',
          packageCount: Number(searchForm.packageCount) === 4 ? 4 : 3
        },
        token || undefined
      );
      const prefs = payload.preferences || {};
      setSearchForm((prev) => {
        const next = { ...prev };
        if (prefs.origin) next.origin = String(prefs.origin).toUpperCase();
        if (Number.isFinite(prefs.budgetMax) && prefs.budgetMax > 0) next.maxBudget = String(prefs.budgetMax);
        if (Number.isFinite(prefs.tripLengthDays)) {
          const from = parseISO(prev.dateFrom);
          if (!Number.isNaN(from.getTime())) next.dateTo = format(addDays(from, Number(prefs.tripLengthDays)), 'yyyy-MM-dd');
        }
        if (prefs.mood) next.mood = prefs.mood;
        if (prefs.climatePreference) next.climatePreference = prefs.climatePreference;
        if (prefs.pace) next.pace = prefs.pace;
        if (prefs.region) next.region = prefs.region;
        if (prefs.country) next.country = prefs.country;
        if (typeof prefs.avoidOvertourism === 'boolean') next.avoidOvertourism = prefs.avoidOvertourism;
        if (prefs.packageCount === 4 || prefs.packageCount === 3) next.packageCount = prefs.packageCount;
        return next;
      });
      const summary = payload.summary || t('aiPreferencesUpdated') || 'Preferences updated.';
      setIntakeInfo(summary);
      setIntakeMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: summary
        }
      ]);
      setIntakePrompt('');
    } catch (error) {
      setSearchError(resolveApiError(error));
      setIntakeMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          text: resolveApiError(error)
        }
      ]);
    } finally {
      setIntakeLoading(false);
    }
  }

  function runQuickIntakePrompt(promptText) {
    setIntakePrompt(promptText);
    analyzeIntentPrompt(promptText);
  }

  function applySearchPreset(item) {
    const payload = item?.payload || {};
    setSearchForm((prev) => ({
      ...prev,
      origin: payload.origin || prev.origin,
      region: payload.region || prev.region,
      connectionType: payload.connectionType || prev.connectionType,
      maxStops: Number.isFinite(payload.maxStops) ? String(payload.maxStops) : prev.maxStops,
      travelTime: payload.travelTime || prev.travelTime,
      minComfortScore: Number.isFinite(payload.minComfortScore) ? String(payload.minComfortScore) : prev.minComfortScore,
      country: payload.country || '',
      destinationQuery: payload.destinationQuery || '',
      periodPreset: 'custom',
      dateFrom: payload.dateFrom || prev.dateFrom,
      dateTo: payload.dateTo || prev.dateTo,
      cheapOnly: Boolean(payload.cheapOnly),
      maxBudget: payload.maxBudget ? String(payload.maxBudget) : '',
      travellers: payload.travellers ? String(payload.travellers) : prev.travellers,
      cabinClass: payload.cabinClass || prev.cabinClass
    }));
  }

  function applyPeriodPreset(preset) {
    const map = {
      weekend: [4, 3],
      week: [14, 7],
      two_weeks: [20, 14],
      one_month: [30, 7],
      three_months: [90, 10],
      six_months: [180, 10],
      one_year: [365, 14]
    };
    if (preset === 'custom') {
      setSearchForm((prev) => ({ ...prev, periodPreset: 'custom' }));
      return;
    }
    const target = map[preset];
    if (!target) return;
    const [daysFromNow, stayDays] = target;
    const from = addDays(new Date(), daysFromNow);
    const to = addDays(from, stayDays);
    setSearchForm((prev) => ({
      ...prev,
      periodPreset: preset,
      dateFrom: format(from, 'yyyy-MM-dd'),
      dateTo: format(to, 'yyyy-MM-dd')
    }));
  }

  function autoFixSearchFilters() {
    setSearchForm((prev) => ({
      ...prev,
      region: 'all',
      connectionType: 'all',
      maxStops: '2',
      travelTime: 'all',
      minComfortScore: '',
      country: '',
      cheapOnly: false,
      maxBudget: '',
      travellers: prev.travellers || 1
    }));
  }

  return {
    submitSearch,
    retryMultiCitySearch,
    submitJustGo,
    analyzeIntentPrompt,
    runQuickIntakePrompt,
    applySearchPreset,
    applyPeriodPreset,
    autoFixSearchFilters
  };
}
