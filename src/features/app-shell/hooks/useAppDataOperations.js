import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

export function useAppDataOperations({
  api,
  token,
  isAuthenticated,
  isAdminUser,
  canUseRadarPlan,
  canUseAiTravelPlan,
  searchForm,
  searchMode,
  searchSortBy,
  searchResult,
  opportunityFeed,
  selectedOpportunityCluster,
  opportunityPipelineStatus,
  radarDraft,
  userPlanType,
  aiTravelPrompt,
  onboardingDraft,
  language,
  t,
  getUpgradeTriggerContent,
  trackResultInteraction,
  sendAdminTelemetryEvent,
  beginSetAlertAuthFlow,
  buildCurrentMultiCityPayload,
  buildItineraryGenerationInputs,
  buildItineraryGenerationPreferences,
  asOptionalPositiveInt,
  asOptionalBoundedInt,
  canonicalCountryFilter,
  canonicalDestinationQuery,
  resolveApiError,
  toRadarDraft,
  parseCsvText,
  slugifyFollowValue,
  monthsToSeasonSlugs,
  localizeClusterDisplayName,
  aiGateway,
  applySearchResultState,
  refreshSearchHistoryDependency,
  setSearchForm,
  setSearchError,
  setSearchLoading,
  setWatchlist,
  setWatchlistError,
  setSubscriptions,
  setSubMessage,
  setAlertDraftById,
  setNotifications,
  setUnreadCount,
  setNotifError,
  setSecurityEvents,
  setSecurityError,
  setSearchHistory,
  setOpportunityFeed,
  setOpportunityFeedAccess,
  setOpportunityFeedLoading,
  setOpportunityFeedError,
  setDestinationClusters,
  setDestinationClustersLoading,
  setDestinationClustersError,
  setExploreBudgetItems,
  setExploreBudgetLoading,
  setExploreBudgetError,
  setExploreMapPoints,
  setExploreMapLoading,
  setExploreMapError,
  setExploreDiscoveryInput,
  exploreDiscoveryInput,
  exploreSelectedDestination,
  setExploreSelectedDestination,
  setActiveMainSection,
  setRadarDraft,
  setRadarError,
  setRadarSaving,
  setRadarMessage,
  setRadarMatches,
  setRadarMatchesLoading,
  setRadarMatchesError,
  setRadarFollows,
  setRadarFollowsLoading,
  setRadarFollowsError,
  setOpportunityPipelineStatus,
  setOpportunityPipelineStatusLoading,
  setOpportunityPipelineStatusError,
  setAiTravelResult,
  setAiTravelLoading,
  setAiTravelError,
  setSecurityAudit,
  setSecurityAuditLoading,
  setSecurityAuditError,
  setFeatureAudit,
  setFeatureAuditLoading,
  setFeatureAuditError,
  setOutboundReport,
  setOutboundReportLoading,
  setOutboundReportError,
  setOutboundCsvLoading,
  setMonetizationReport,
  setMonetizationLoading,
  setMonetizationError,
  setBillingPricing,
  setBillingPricingLoading,
  setBillingPricingError,
  setFunnelReport,
  setFunnelLoading,
  setFunnelError,
  setDestinationInsights,
  setInsightLoadingByFlight,
  setInsightErrorByFlight,
  activateRadarSessionFlag,
  loadOpportunityPipelineStatusDependency,
  loadRadarMatchesDependency,
  loadRadarFollowsDependency,
  adminDashboardApi,
  setAdminDashboardReport,
  setAdminDashboardLoading,
  setAdminDashboardError,
  COOKIE_SESSION_TOKEN,
  notifiedIdsRef,
  trackSearchEvent,
  getErrorTrackingData,
  submitMultiCitySearchWithRetry,
  DEFAULT_MULTI_CITY_RETRY_POLICY,
  multiCitySegments,
  setMultiCityValidation,
  validateMultiCityForm,
  setMultiCityRetryVisible,
  intakePrompt,
  setIntakeInfo,
  setIntakeLoading,
  setIntakeMessages,
  setIntakePrompt
}) {
  async function refreshWatchlist() {
    if (!isAuthenticated) return;
    setWatchlistError('');
    try {
      const payload = await api.watchlist(token);
      setWatchlist(payload.items);
    } catch (error) {
      setWatchlistError(resolveApiError(error));
    }
  }

  async function refreshSubscriptions() {
    if (!isAuthenticated) return;
    try {
      const payload = await api.listAlertSubscriptions(token);
      setSubscriptions(payload.items);
      setAlertDraftById((prev) => {
        const next = {};
        for (const item of payload.items || []) {
          next[item.id] = prev[item.id] || {
            targetPrice: Number.isFinite(item.targetPrice) ? String(item.targetPrice) : '',
            stayDays: String(item.stayDays ?? 7),
            travellers: String(item.travellers ?? 1),
            cabinClass: item.cabinClass || 'economy',
            cheapOnly: Boolean(item.cheapOnly)
          };
        }
        return next;
      });
    } catch {
      setSubscriptions([]);
    }
  }

  async function refreshNotifications(isPolling = false) {
    if (!isAuthenticated) return;
    setNotifError('');
    try {
      const payload = await api.listNotifications(token);
      setNotifications(payload.items);
      setUnreadCount(payload.unread);

      const canUseBrowserNotifications =
        typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted';
      if (isPolling && canUseBrowserNotifications) {
        for (const n of payload.items) {
          if (n.readAt || notifiedIdsRef.current.has(n.id)) continue;
          notifiedIdsRef.current.add(n.id);
          try {
            new window.Notification(n.title, { body: n.message });
          } catch {
            break;
          }
        }
      }
    } catch (error) {
      setNotifError(resolveApiError(error));
    }
  }

  async function refreshSearchHistory() {
    if (!isAuthenticated) return;
    try {
      const payload = await api.searchHistory(token);
      setSearchHistory(payload.items || []);
    } catch {
      setSearchHistory([]);
    }
  }

  async function refreshSecurityActivity() {
    if (!isAuthenticated) return;
    setSecurityError('');
    try {
      const payload = await api.securityActivity(token);
      setSecurityEvents(payload.items || []);
    } catch (error) {
      setSecurityEvents([]);
      setSecurityError(resolveApiError(error));
    }
  }

  async function loadOpportunityFeed(forceRefresh = false) {
    setOpportunityFeedLoading(true);
    setOpportunityFeedError('');
    try {
      const payload = await api.opportunityFeed(
        token,
        { limit: 24, cluster: selectedOpportunityCluster || undefined },
        { forceRefresh }
      );
      setOpportunityFeed(payload.items || []);
      setOpportunityFeedAccess(payload.access || null);
    } catch (error) {
      setOpportunityFeed([]);
      setOpportunityFeedAccess(null);
      setOpportunityFeedError(resolveApiError(error));
    } finally {
      setOpportunityFeedLoading(false);
    }
  }

  async function loadOpportunityClusters(forceRefresh = false) {
    setDestinationClustersLoading(true);
    setDestinationClustersError('');
    try {
      const payload = await api.opportunityClusters(token, { limit: 12 }, { forceRefresh });
      setDestinationClusters(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      setDestinationClusters([]);
      setDestinationClustersError(resolveApiError(error));
    } finally {
      setDestinationClustersLoading(false);
    }
  }

  async function loadExploreDiscovery(overrides = {}) {
    const origin = String(overrides.origin ?? exploreDiscoveryInput.origin ?? '').trim().toUpperCase();
    const budgetCandidate = overrides.budgetMax ?? exploreDiscoveryInput.budgetMax;
    const budgetMax = Number(budgetCandidate);
    const limitCandidate = Number(overrides.limit ?? exploreDiscoveryInput.limit ?? 24);
    const limit = Number.isFinite(limitCandidate) && limitCandidate > 0 ? Math.min(60, Math.max(5, Math.round(limitCandidate))) : 24;

    if (!/^[A-Z]{3}$/.test(origin)) {
      setExploreBudgetItems([]);
      setExploreMapPoints([]);
      setExploreBudgetError(t('exploreDiscoveryOriginRequired'));
      setExploreMapError('');
      return;
    }
    if (!Number.isFinite(budgetMax) || budgetMax <= 0) {
      setExploreBudgetItems([]);
      setExploreMapPoints([]);
      setExploreBudgetError(t('exploreDiscoveryBudgetRequired'));
      setExploreMapError('');
      return;
    }

    setExploreBudgetLoading(true);
    setExploreMapLoading(true);
    setExploreBudgetError('');
    setExploreMapError('');
    setExploreDiscoveryInput((prev) => ({
      ...prev,
      origin,
      budgetMax: String(Math.round(budgetMax)),
      limit
    }));

    const [budgetResult, mapResult] = await Promise.allSettled([
      api.opportunityExploreBudget(token, { origin, budgetMax, limit }),
      api.opportunityExploreMap(token, { origin, budgetMax, limit })
    ]);

    if (budgetResult.status === 'fulfilled') {
      const items = Array.isArray(budgetResult.value?.items) ? budgetResult.value.items : [];
      setExploreBudgetItems(items);
      if (!items.length) setExploreSelectedDestination('');
      else {
        const selected = String(exploreSelectedDestination || '').toUpperCase();
        const hasSelected = items.some((item) => String(item.destination_airport || '').toUpperCase() === selected);
        if (!selected || !hasSelected) setExploreSelectedDestination(String(items[0].destination_airport || '').toUpperCase());
      }
    } else {
      setExploreBudgetItems([]);
      setExploreBudgetError(resolveApiError(budgetResult.reason));
    }

    if (mapResult.status === 'fulfilled') {
      const points = Array.isArray(mapResult.value?.points) ? mapResult.value.points : [];
      setExploreMapPoints(points);
    } else {
      setExploreMapPoints([]);
      setExploreMapError(resolveApiError(mapResult.reason));
    }

    setExploreBudgetLoading(false);
    setExploreMapLoading(false);
  }

  function applyExploreDestination(item) {
    const destinationAirport = String(item?.destination_airport || '').toUpperCase();
    const destinationQuery = String(item?.destination_city || destinationAirport || '').trim();
    const budgetValue = Number(item?.price_from);
    const resolvedBudget = Number.isFinite(budgetValue) && budgetValue > 0 ? String(Math.round(budgetValue)) : '';
    if (!destinationQuery) return;
    setExploreSelectedDestination(destinationAirport);
    setActiveMainSection('home');
    setSearchForm((prev) => ({
      ...prev,
      origin: String(exploreDiscoveryInput.origin || prev.origin || '').toUpperCase() || prev.origin,
      destinationQuery,
      maxBudget: resolvedBudget || prev.maxBudget,
      cheapOnly: true
    }));
    setSubMessage(`${t('exploreDiscoveryAppliedPrefix')} ${destinationQuery}`);
  }

  async function followOpportunity(opportunityId) {
    if (!isAuthenticated) {
      beginSetAlertAuthFlow({ keepLandingVisible: false });
      return setSubMessage(t('loginRequiredAlert'));
    }
    if (!canUseRadarPlan) {
      setSubMessage(t('upgradePromptUnlockAll'));
      setActiveMainSection('premium');
      return;
    }
    try {
      await api.followOpportunity(token, opportunityId);
      await refreshSubscriptions();
      await api.runNotificationScan(token);
      await refreshNotifications();
      setSubMessage(t('alertCreated'));
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  async function followDestinationCluster(cluster) {
    const slug = String(cluster?.slug || '').trim();
    const displayName = localizeClusterDisplayName(cluster, language) || String(cluster?.cluster_name || slug || '').trim();
    if (!slug) return;
    if (!isAuthenticated) {
      beginSetAlertAuthFlow({ keepLandingVisible: false });
      setSubMessage(t('loginRequiredAlert'));
      return;
    }
    if (!canUseRadarPlan) {
      setSubMessage(t('followDestinationProOnly'));
      setActiveMainSection('premium');
      return;
    }
    try {
      await api.followEntity(token, {
        entityType: 'destination_cluster',
        slug,
        displayName,
        followType: 'radar',
        metadata: { source: 'cluster_follow' }
      });
      await loadRadarFollows();
      setSubMessage(`${t('clusterFollowedPrefix')} ${displayName}`);
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  async function followDestinationClusterFromFeed(cluster) {
    if (!isAuthenticated) {
      beginSetAlertAuthFlow({ keepLandingVisible: false });
      setSubMessage(t('loginRequiredAlert'));
      return;
    }
    if (!canUseRadarPlan) {
      const content = getUpgradeTriggerContent(userPlanType, 'personal_hub');
      setSubMessage(content.message);
      return;
    }
    trackResultInteraction('track_route', 'opportunity_feed', String(cluster?.slug || '').trim().toLowerCase() || undefined);
    await followDestinationCluster(cluster);
  }

  async function loadRadarPreferences() {
    if (!isAuthenticated) return;
    setRadarError('');
    try {
      const payload = await api.getRadarPreferences(token);
      setRadarDraft(toRadarDraft(payload.item));
    } catch (error) {
      setRadarError(resolveApiError(error));
    }
  }

  async function loadRadarMatches() {
    if (!isAuthenticated) return;
    setRadarMatchesLoading(true);
    setRadarMatchesError('');
    try {
      const payload = await api.radarMatches(token);
      setRadarMatches(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      setRadarMatches([]);
      setRadarMatchesError(resolveApiError(error));
    } finally {
      setRadarMatchesLoading(false);
    }
  }

  async function loadRadarFollows() {
    if (!isAuthenticated) return;
    setRadarFollowsLoading(true);
    setRadarFollowsError('');
    try {
      const payload = await api.listFollows(token);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setRadarFollows(items.filter((item) => String(item.follow_type || '').toLowerCase() === 'radar'));
    } catch (error) {
      setRadarFollows([]);
      setRadarFollowsError(resolveApiError(error));
    } finally {
      setRadarFollowsLoading(false);
    }
  }

  async function loadOpportunityPipelineStatus() {
    if (!isAuthenticated || !isAdminUser) {
      setOpportunityPipelineStatus(null);
      setOpportunityPipelineStatusError('');
      return;
    }
    setOpportunityPipelineStatusLoading(true);
    setOpportunityPipelineStatusError('');
    try {
      const payload = await api.opportunityDebug(token);
      if (payload?.opportunityPipeline) {
        setOpportunityPipelineStatus(payload);
      } else {
        const fallback = await api.opportunityPipelineStatus(token);
        setOpportunityPipelineStatus({ opportunityPipeline: fallback?.status || null });
      }
    } catch (error) {
      try {
        const fallback = await api.opportunityPipelineStatus(token);
        setOpportunityPipelineStatus({ opportunityPipeline: fallback?.status || null });
      } catch {
        setOpportunityPipelineStatus(null);
      }
      setOpportunityPipelineStatusError(resolveApiError(error));
    } finally {
      setOpportunityPipelineStatusLoading(false);
    }
  }

  async function openOpportunityDebugView() {
    let payload = opportunityPipelineStatus;
    if (!payload) {
      try {
        payload = await api.opportunityDebug(token);
      } catch (error) {
        setOpportunityPipelineStatusError(resolveApiError(error));
        return;
      }
    }
    if (!payload) return;
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  async function exportOpportunityDebugSnapshot() {
    let payload = opportunityPipelineStatus;
    if (!payload) {
      try {
        payload = await api.opportunityDebug(token);
      } catch (error) {
        setOpportunityPipelineStatusError(resolveApiError(error));
        return;
      }
    }
    if (!payload) return;
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `opportunity-debug-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function saveRadarPreferences() {
    if (!isAuthenticated) return;
    if (!canUseRadarPlan) {
      setRadarError(t('radarUpgradeTitle'));
      setActiveMainSection('premium');
      return;
    }
    setRadarSaving(true);
    setRadarError('');
    setRadarMessage('');
    try {
      const body = {
        originAirports: parseCsvText(radarDraft.originAirports, (x) => x.toUpperCase()),
        favoriteDestinations: parseCsvText(radarDraft.favoriteDestinations),
        favoriteCountries: parseCsvText(radarDraft.favoriteCountries),
        budgetCeiling: radarDraft.budgetCeiling ? Number(radarDraft.budgetCeiling) : null,
        preferredTravelMonths: parseCsvText(radarDraft.preferredTravelMonths, (x) => Number(x)).filter((x) => Number.isFinite(x) && x >= 1 && x <= 12)
      };
      await api.updateRadarPreferences(token, body);
      const existingRadarFollowsPayload = await api.listFollows(token);
      const existingRadarFollows = Array.isArray(existingRadarFollowsPayload?.items)
        ? existingRadarFollowsPayload.items.filter((item) => String(item.follow_type || '').toLowerCase() === 'radar')
        : [];
      for (const item of existingRadarFollows) {
        await api.unfollowEntity(token, item.id);
      }

      const followItems = [];
      for (const airport of body.originAirports) {
        followItems.push({ entityType: 'airport', slug: slugifyFollowValue(airport), displayName: airport });
      }
      for (const city of body.favoriteDestinations) {
        followItems.push({ entityType: 'city', slug: slugifyFollowValue(city), displayName: city });
      }
      for (const country of body.favoriteCountries) {
        followItems.push({ entityType: 'country', slug: slugifyFollowValue(country), displayName: country });
      }
      if (Number.isFinite(Number(body.budgetCeiling)) && Number(body.budgetCeiling) > 0) {
        const value = Number(body.budgetCeiling);
        const bucket = value <= 250 ? 'under_250' : value <= 400 ? 'under_400' : value <= 600 ? 'under_600' : 'above_600';
        followItems.push({ entityType: 'budget_bucket', slug: bucket, displayName: bucket.replace(/_/g, ' ') });
      }
      for (const season of monthsToSeasonSlugs(body.preferredTravelMonths)) {
        followItems.push({ entityType: 'season', slug: season, displayName: season });
      }

      const dedupe = new Set();
      for (const item of followItems) {
        const key = `${item.entityType}:${item.slug}`;
        if (!item.slug || dedupe.has(key)) continue;
        dedupe.add(key);
        await api.followEntity(token, { ...item, followType: 'radar', metadata: { source: 'radar_preferences' } });
      }

      setRadarMessage(t('radarSavedSuccess'));
      activateRadarSessionFlag();
      sendAdminTelemetryEvent({
        eventType: 'radar_activated',
        source: 'radar_preferences_save',
        planType: userPlanType
      });
      await loadRadarMatches();
      await loadRadarFollows();
      await loadOpportunityPipelineStatus();
    } catch (error) {
      setRadarError(resolveApiError(error));
    } finally {
      setRadarSaving(false);
    }
  }

  async function removeRadarFollow(followId) {
    if (!isAuthenticated || !followId) return;
    setRadarFollowsError('');
    try {
      await api.unfollowEntity(token, followId);
      await loadRadarFollows();
      setRadarMessage(t('radarFollowUpdated'));
    } catch (error) {
      setRadarFollowsError(resolveApiError(error));
    }
  }

  async function runAiTravelQuery() {
    if (!isAuthenticated) return setAiTravelError(t('loginRequiredAlert'));
    if (!aiTravelPrompt.trim()) return;
    setAiTravelLoading(true);
    setAiTravelError('');
    try {
      const generationInputs = buildItineraryGenerationInputs({ searchResult, opportunityFeed, searchForm });
      const preferences = buildItineraryGenerationPreferences({ searchForm, searchSortBy, searchMode });
      const gatewayResult = await aiGateway.execute({
        taskType: 'itinerary_generation',
        planType: userPlanType,
        input: {
          prompt: aiTravelPrompt,
          generationInputs,
          preferences
        },
        maxOutputTokens: userPlanType === 'elite' ? 1800 : userPlanType === 'pro' ? 1100 : 450,
        schemaKey: 'itinerary_generation'
      });

      if (!gatewayResult.ok) {
        const blockedByPolicy = Boolean(gatewayResult.telemetry?.blockedByPolicy);
        if (blockedByPolicy) {
          const content = getUpgradeTriggerContent(userPlanType, 'ai_travel_limit');
          setAiTravelError(content.message);
          setSubMessage(content.message);
        } else {
          setAiTravelError(String(gatewayResult.error?.message || 'AI request failed.'));
        }
        setAiTravelResult(null);
        return;
      }

      setAiTravelResult(gatewayResult.data || null);
    } catch (error) {
      setAiTravelResult(null);
      setAiTravelError(resolveApiError(error));
    } finally {
      setAiTravelLoading(false);
    }
  }

  async function runSecurityAuditCheck() {
    if (!isAuthenticated || !isAdminUser) {
      setSecurityAudit(null);
      setSecurityAuditError('Admin access required.');
      return;
    }
    setSecurityAuditLoading(true);
    setSecurityAuditError('');
    try {
      const payload = await api.healthSecurity();
      setSecurityAudit(payload);
    } catch (error) {
      setSecurityAudit(null);
      setSecurityAuditError(resolveApiError(error));
    } finally {
      setSecurityAuditLoading(false);
    }
  }

  async function runFeatureAuditCheck() {
    setFeatureAuditLoading(true);
    setFeatureAuditError('');
    try {
      const payload = await api.healthFeatures();
      setFeatureAudit(payload);
    } catch (error) {
      setFeatureAudit(null);
      setFeatureAuditError(resolveApiError(error));
    } finally {
      setFeatureAuditLoading(false);
    }
  }

  async function loadOutboundReport() {
    if (!isAuthenticated) return;
    setOutboundReportLoading(true);
    setOutboundReportError('');
    try {
      const payload = await api.outboundReport(token);
      setOutboundReport(payload);
    } catch (error) {
      setOutboundReport(null);
      setOutboundReportError(resolveApiError(error));
    } finally {
      setOutboundReportLoading(false);
    }
  }

  async function exportOutboundReportCsv() {
    if (!isAuthenticated) return;
    setOutboundCsvLoading(true);
    setOutboundReportError('');
    try {
      const csv = await api.outboundReportCsv(token);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `outbound-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setOutboundReportError(resolveApiError(error));
    } finally {
      setOutboundCsvLoading(false);
    }
  }

  async function loadMonetizationReport() {
    if (!isAuthenticated) return;
    setMonetizationLoading(true);
    setMonetizationError('');
    try {
      const payload = await api.monetizationReport(token);
      setMonetizationReport(payload);
    } catch (error) {
      setMonetizationReport(null);
      setMonetizationError(resolveApiError(error));
    } finally {
      setMonetizationLoading(false);
    }
  }

  async function loadBillingPricing(silent = false, forceRefresh = false) {
    if (!silent) setBillingPricingLoading(true);
    setBillingPricingError('');
    try {
      const payload = await api.billingPricing({ forceRefresh });
      const pricing = payload?.pricing || {};
      setBillingPricing({
        free: { monthlyEur: Number(pricing?.free?.monthlyEur || 0) },
        pro: { monthlyEur: Number(pricing?.pro?.monthlyEur || 7) },
        creator: { monthlyEur: Number(pricing?.creator?.monthlyEur || 19) },
        updatedAt: pricing?.updatedAt || null,
        lastCostCheckAt: pricing?.lastCostCheckAt || null
      });
    } catch (error) {
      if (!silent) setBillingPricingError(resolveApiError(error));
    } finally {
      if (!silent) setBillingPricingLoading(false);
    }
  }

  async function loadFunnelReport() {
    if (!isAuthenticated) return;
    setFunnelLoading(true);
    setFunnelError('');
    try {
      const payload = await api.funnelAnalytics(token);
      setFunnelReport(payload);
    } catch (error) {
      setFunnelReport(null);
      setFunnelError(resolveApiError(error));
    } finally {
      setFunnelLoading(false);
    }
  }

  async function loadAdminBackofficeReport() {
    if (!isAuthenticated || !isAdminUser) {
      setAdminDashboardReport(null);
      setAdminDashboardError('');
      return;
    }
    setAdminDashboardLoading(true);
    setAdminDashboardError('');
    try {
      const payload = await adminDashboardApi.loadReport(token || undefined);
      setAdminDashboardReport(payload);
    } catch (error) {
      setAdminDashboardReport(null);
      setAdminDashboardError(resolveApiError(error));
    } finally {
      setAdminDashboardLoading(false);
    }
  }

  async function refreshOpportunityFeedNow() {
    if (isAuthenticated && token && token !== COOKIE_SESSION_TOKEN) {
      try {
        await api.opportunityPipelineRun(token);
      } catch {
        // Non blocca il refresh UI se la pipeline non puo partire.
      }
    }
    await Promise.all([
      loadOpportunityFeed(true),
      loadOpportunityClusters(true),
      isAuthenticated && isAdminUser ? loadOpportunityPipelineStatus() : Promise.resolve()
    ]);
  }

  return {
    refreshWatchlist,
    refreshSubscriptions,
    refreshNotifications,
    refreshSearchHistory,
    refreshSecurityActivity,
    loadOpportunityFeed,
    loadOpportunityClusters,
    loadExploreDiscovery,
    applyExploreDestination,
    followOpportunity,
    followDestinationCluster,
    followDestinationClusterFromFeed,
    loadRadarPreferences,
    loadRadarMatches,
    loadRadarFollows,
    loadOpportunityPipelineStatus,
    openOpportunityDebugView,
    exportOpportunityDebugSnapshot,
    saveRadarPreferences,
    removeRadarFollow,
    runAiTravelQuery,
    runSecurityAuditCheck,
    runFeatureAuditCheck,
    loadOutboundReport,
    exportOutboundReportCsv,
    loadMonetizationReport,
    loadBillingPricing,
    loadFunnelReport,
    loadAdminBackofficeReport,
    refreshOpportunityFeedNow
  };
}
