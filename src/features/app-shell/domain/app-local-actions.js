export function createMultiCityLocalActions({
  setMultiCitySegments,
  setMultiCityRetryVisible,
  updateMultiCitySegmentField,
  addMultiCitySegment,
  removeMultiCitySegment,
  buildMultiCitySearchPayload,
  multiCitySegments,
  searchForm,
  canonicalDestinationQuery,
  canonicalCountryFilter,
  asOptionalPositiveInt,
  asOptionalBoundedInt
}) {
  function setMultiCitySegmentValue(segmentIndex, field, value) {
    setMultiCitySegments((prev) => updateMultiCitySegmentField(prev, segmentIndex, field, value));
    setMultiCityRetryVisible(false);
  }

  function appendMultiCitySegment() {
    setMultiCitySegments((prev) => addMultiCitySegment(prev));
    setMultiCityRetryVisible(false);
  }

  function deleteMultiCitySegment(segmentIndex) {
    setMultiCitySegments((prev) => removeMultiCitySegment(prev, segmentIndex));
    setMultiCityRetryVisible(false);
  }

  function buildCurrentMultiCityPayload() {
    return buildMultiCitySearchPayload(multiCitySegments, {
      originFallback: searchForm.origin,
      destinationQueryFallback: canonicalDestinationQuery(searchForm.destinationQuery) || undefined,
      region: searchForm.region,
      country: canonicalCountryFilter(searchForm.country) || undefined,
      cheapOnly: Boolean(searchForm.cheapOnly),
      maxBudget: asOptionalPositiveInt(searchForm.maxBudget),
      connectionType: searchForm.connectionType,
      maxStops: asOptionalBoundedInt(searchForm.maxStops, { min: 0, max: 2 }),
      travelTime: searchForm.travelTime,
      minComfortScore: asOptionalBoundedInt(searchForm.minComfortScore, { min: 1, max: 100 }),
      travellers: asOptionalBoundedInt(searchForm.travellers, { min: 1, max: 9 }) ?? 1,
      cabinClass: searchForm.cabinClass
    });
  }

  return {
    setMultiCitySegmentValue,
    appendMultiCitySegment,
    deleteMultiCitySegment,
    buildCurrentMultiCityPayload
  };
}

export function createApplyLocalPlanChange({
  normalizeUserPlan,
  resolveEffectivePlan,
  userPlanType,
  setLocalUserPlan,
  setUser,
  setSubMessage,
  t
}) {
  return function applyLocalPlanChange(nextPlanType) {
    const requestedPlan = normalizeUserPlan(nextPlanType);
    const normalizedPlan = requestedPlan === 'free' ? 'free' : resolveEffectivePlan(userPlanType, requestedPlan);
    setLocalUserPlan(normalizedPlan);
    setUser((prev) => {
      if (!prev) return prev;
      const nextIsPremium = normalizedPlan === 'pro' || normalizedPlan === 'elite';
      return {
        ...prev,
        planType: normalizedPlan,
        plan_type: normalizedPlan,
        isPremium: nextIsPremium
      };
    });
    if (normalizedPlan === 'elite') {
      setSubMessage(t('planEliteActivated'));
    } else if (normalizedPlan === 'pro') {
      setSubMessage(t('planProActivated'));
    } else {
      setSubMessage(t('planFreeActivated'));
    }
  };
}

export function saveRecentItineraryWithPlanGateAction({
  item,
  createSavedItineraryFromOpportunity,
  readSavedItineraries,
  evaluateUsageLimit,
  planEntitlements,
  saveRecentItinerary
}) {
  const entry = createSavedItineraryFromOpportunity(item);
  const existing = readSavedItineraries();
  if (!entry) {
    return {
      saved: false,
      limitReached: false,
      usage: evaluateUsageLimit(existing.length, planEntitlements.savedItinerariesLimit)
    };
  }

  const alreadySaved = existing.some((saved) => String(saved?.key || '').trim() === entry.key);
  const usage = evaluateUsageLimit(existing.length, planEntitlements.savedItinerariesLimit);
  if (!alreadySaved && usage.reached) {
    return {
      saved: false,
      limitReached: true,
      usage
    };
  }

  saveRecentItinerary(entry, planEntitlements.savedItinerariesLimit);
  return {
    saved: true,
    limitReached: false,
    usage
  };
}

export function activateFreePlanAction({ isAuthenticated, beginAuthFlow, applyLocalPlanChange }) {
  if (!isAuthenticated) {
    beginAuthFlow({
      action: 'enter_app',
      authMode: 'register',
      authView: 'options',
      keepLandingVisible: false,
      targetSection: 'premium'
    });
    return;
  }
  applyLocalPlanChange('free');
}

export function viewDealsForTrackedRouteAction({ slug, setActiveMainSection, setSelectedOpportunityCluster }) {
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!normalizedSlug) return;
  setActiveMainSection('home');
  setSelectedOpportunityCluster(normalizedSlug);
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(() => {
      document.querySelector('[data-testid="opportunity-feed-panel"]')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  }
}

export function handleUntrackedRouteFromHubAction({ slug, selectedOpportunityCluster, setSelectedOpportunityCluster }) {
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!normalizedSlug) return;
  if (String(selectedOpportunityCluster || '').trim().toLowerCase() === normalizedSlug) {
    setSelectedOpportunityCluster('');
  }
}

export function handleClearLocalTravelDataAction({
  clearLocalTravelData,
  setRadarSessionActivated,
  setSelectedOpportunityCluster,
  setOpportunityDetail,
  setOpportunityDetailUpgradePrompt,
  clearBookingHandoffError,
  clearOpportunityBookingError,
  setSubMessage
}) {
  const result = clearLocalTravelData({ includeAccountHints: true });
  setRadarSessionActivated(false);
  setSelectedOpportunityCluster('');
  setOpportunityDetail(null);
  setOpportunityDetailUpgradePrompt(null);
  clearBookingHandoffError();
  clearOpportunityBookingError();
  if (result.failedKeys.length > 0) {
    setSubMessage('Some local data could not be cleared due to browser restrictions.');
  } else {
    setSubMessage('Local travel data cleared on this device.');
  }
}

export function handleTrackedRoutesLimitReachedAction({
  meta,
  evaluateUsageLimit,
  planEntitlements,
  getUpgradeTriggerContent,
  userPlanType,
  setSubMessage
}) {
  const usage = evaluateUsageLimit(meta?.used, meta?.limit ?? planEntitlements.trackedRoutesLimit);
  const content = getUpgradeTriggerContent(userPlanType, 'tracked_routes_limit', {
    used: usage.used,
    limit: usage.limit
  });
  setSubMessage(content.message);
}

