import { useCallback, useEffect, useMemo, useRef } from 'react';
import { api, COOKIE_SESSION_TOKEN, setCsrfToken } from './api';
import { handleApiError } from './utils/handleApiError';
import { LANGUAGE_OPTIONS } from './i18n';
import { AppProvider } from './context/AppContext';
import LandingSection from './components/LandingSection';
import InfoTip from './components/InfoTip';
import QuotaWarningBanner from './components/QuotaWarningBanner';
import TrialBanner from './components/TrialBanner';
import PremiumPanelSection from './components/PremiumPanelSection';
import CookieBanner from './components/CookieBanner';
import AccountAndUpgradeOverlays from './features/app-shell/ui/AccountAndUpgradeOverlays';
import { bootstrapConsentPolicy, clearConsent, isConsentGiven } from './utils/cookieConsent';
import { readLocalStorageItem, removeLocalStorageItem, writeLocalStorageItem } from './utils/browserStorage';
import AdminMainSection from './features/app-shell/ui/AdminMainSection';
import AppHeroHeader from './features/app-shell/ui/AppHeroHeader';
import AiTravelMainSection from './features/app-shell/ui/AiTravelMainSection';
import ExploreMainSection from './features/app-shell/ui/ExploreMainSection';
import HomeMainSection from './features/app-shell/ui/HomeMainSection';
import OnboardingModal from './features/app-shell/ui/OnboardingModal';
import RadarMainSection from './features/app-shell/ui/RadarMainSection';
import { localizeClusterDisplayName } from './utils/localizePlace';
import {
  getErrorTrackingData,
  useAppDataOperations,
  useAssistantWelcomeEffect,
  useAppBrowserEffects,
  useAppSuggestionEffects,
  useAppState,
  useAppLocalization,
  useAdminTelemetryBridge,
  useAuthSessionActions,
  useAuthFlowCoordinator,
  useBookingFlow,
  useLandingActions,
  useOpportunityFlow,
  useRadarSessionController,
  useResultInteractionActions,
  useSearchFlowActions,
  useUpgradeFlowController,
  useQuotaStatus,
  useConversionTriggers
} from './features/app-shell';
import {
  activateFreePlanAction,
  createApplyLocalPlanChange,
  createMultiCityLocalActions,
  handleClearLocalTravelDataAction,
  handleTrackedRoutesLimitReachedAction,
  handleUntrackedRouteFromHubAction,
  saveRecentItineraryWithPlanGateAction,
  viewDealsForTrackedRouteAction
} from './features/app-shell/domain/app-local-actions';
import {
  asOptionalBoundedInt,
  asOptionalPositiveInt,
  buildGatewayItineraryItems,
  buildItineraryGenerationInputs,
  buildItineraryGenerationPreferences,
  dealLabelText,
  formatEur,
  formatGeneratedSummary,
  formatPricingDate,
  monthsToSeasonSlugs,
  parseCsvText,
  radarStateText,
  slugifyFollowValue,
  toRadarDraft
} from './features/app-shell/domain/app-helpers';
import {
  CLIMATE_PREF_OPTIONS,
  DEFAULT_SEARCH_FORM,
  MOOD_OPTIONS,
  QUICK_INTAKE_PROMPTS_I18N
} from './features/app-shell/domain/app-defaults';
import {
  createLandingContactCards,
  createLandingFeatureCards,
  createLandingNavItems,
  createLandingPricingPlans,
  createLandingValueCards
} from './features/app-shell/domain/landing-content';
import { createPremiumPackages } from './features/app-shell/domain/premium-packages';
import {
  DEFAULT_MULTI_CITY_RETRY_POLICY,
  addMultiCitySegment,
  buildMultiCitySearchPayload,
  removeMultiCitySegment,
  submitMultiCitySearchWithRetry,
  updateMultiCitySegmentField,
  validateMultiCityForm
} from './features/multi-city';
import { createBookingClickedTracker, createBookingHandoffLayer } from './features/booking-handoff';
import { createFunnelEventService, createFunnelTracker } from './features/funnel-tracking';
import { enrichItinerariesWithDeal, sortByDealPriority } from './features/deal-engine';
import { enrichItinerariesWithRadar, sortByRadarPriority } from './features/radar-engine';
import {
  explainGeneratedItinerary,
  generateCandidateItineraries,
  rankGeneratedItineraries
} from './features/itinerary-generator';
import {
  createAiGateway,
  createAnthropicAdapter,
  createMockAiAdapter,
  createOpenAiAdapter
} from './features/ai-gateway';
import {
  clearLocalTravelData,
  clearRememberedEmail,
  createSavedItineraryFromOpportunity,
  readSavedItineraries,
  saveRecentItinerary,
  writeRememberedEmail
} from './features/personal-hub/storage';
import {
  evaluateUsageLimit,
  getPlanComparisonRows,
  getPlanEntitlements,
  getUpgradeTriggerContent,
  normalizeUserPlan,
  resolveEffectivePlan,
  writeStoredUserPlan
} from './features/monetization';
import { scoreItineraries, sortItinerariesByTravelScore } from './features/travel-score';
import {
  createAdminDashboardApi,
  mapFunnelEventToAdminTelemetry,
  mapUpgradeEventToAdminTelemetry,
  resolveAdminAccess
} from './features/admin-dashboard';

const prefetchAdvancedAnalyticsChunk = () => import('./components/AdvancedAnalyticsSection');

function App() {
  const {
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
  } = useAppLocalization();

  useEffect(() => {
    bootstrapConsentPolicy();
  }, []);

  const resolveApiError = (error) => handleApiError(error, { t });

  const {
    config,
    setConfig,
    originCityByIata,
    resolveCityName,
    token,
    setToken,
    user,
    setUser,
    localUserPlan,
    setLocalUserPlan,
    authMode,
    setAuthMode,
    showAccountPanel,
    setShowAccountPanel,
    authError,
    setAuthError,
    authForm,
    setAuthForm,
    authView,
    setAuthView,
    rememberMe,
    setRememberMe,
    authMfa,
    setAuthMfa,
    oauthLoading,
    setOauthLoading,
    deletingAccount,
    setDeletingAccount,
    searchForm,
    setSearchForm,
    searchMode,
    setSearchMode,
    multiCitySegments,
    setMultiCitySegments,
    multiCityValidation,
    setMultiCityValidation,
    multiCityRetryVisible,
    setMultiCityRetryVisible,
    uiMode,
    setUiMode,
    searchError,
    setSearchError,
    searchLoading,
    setSearchLoading,
    intakeLoading,
    setIntakeLoading,
    intakePrompt,
    setIntakePrompt,
    intakeInfo,
    setIntakeInfo,
    intakeMessages,
    setIntakeMessages,
    searchResult,
    setSearchResult,
    searchHistory,
    setSearchHistory,
    searchSortBy,
    setSearchSortBy,
    compareIds,
    setCompareIds,
    watchlist,
    setWatchlist,
    watchlistError,
    setWatchlistError,
    subscriptions,
    setSubscriptions,
    subMessage,
    setSubMessage,
    alertDraftById,
    setAlertDraftById,
    notifications,
    setNotifications,
    unreadCount,
    setUnreadCount,
    notifError,
    setNotifError,
    securityInfo,
    setSecurityInfo,
    securityEvents,
    setSecurityEvents,
    securityError,
    setSecurityError,
    securityAudit,
    setSecurityAudit,
    securityAuditLoading,
    setSecurityAuditLoading,
    securityAuditError,
    setSecurityAuditError,
    featureAudit,
    setFeatureAudit,
    featureAuditLoading,
    setFeatureAuditLoading,
    featureAuditError,
    setFeatureAuditError,
    outboundReport,
    setOutboundReport,
    outboundReportError,
    setOutboundReportError,
    outboundReportLoading,
    setOutboundReportLoading,
    outboundCsvLoading,
    setOutboundCsvLoading,
    monetizationReport,
    setMonetizationReport,
    monetizationLoading,
    setMonetizationLoading,
    monetizationError,
    setMonetizationError,
    billingPricing,
    setBillingPricing,
    billingPricingLoading,
    setBillingPricingLoading,
    billingPricingError,
    setBillingPricingError,
    funnelReport,
    setFunnelReport,
    funnelLoading,
    setFunnelLoading,
    funnelError,
    setFunnelError,
    destinationInsights,
    setDestinationInsights,
    insightLoadingByFlight,
    setInsightLoadingByFlight,
    insightErrorByFlight,
    setInsightErrorByFlight,
    destinationSuggestions,
    setDestinationSuggestions,
    countrySuggestions,
    setCountrySuggestions,
    showDestinationSuggestions,
    setShowDestinationSuggestions,
    showCountrySuggestions,
    setShowCountrySuggestions,
    mfaSetupData,
    setMfaSetupData,
    mfaActionCode,
    setMfaActionCode,
    showOnboarding,
    setShowOnboarding,
    showLandingPage,
    setShowLandingPage,
    darkMode,
    setDarkMode,
    premiumBillingCycle,
    setPremiumBillingCycle,
    onboardingDraft,
    setOnboardingDraft,
    onboardingSaving,
    setOnboardingSaving,
    pendingPostAuthAction,
    setPendingPostAuthAction,
    pendingPostAuthSection,
    setPendingPostAuthSection,
    activeMainSection,
    setActiveMainSection,
    adminRouteRequested,
    setAdminRouteRequested,
    adminDashboardReport,
    setAdminDashboardReport,
    adminDashboardLoading,
    setAdminDashboardLoading,
    adminDashboardError,
    setAdminDashboardError,
    opportunityFeed,
    setOpportunityFeed,
    opportunityFeedAccess,
    setOpportunityFeedAccess,
    destinationClusters,
    setDestinationClusters,
    selectedOpportunityCluster,
    setSelectedOpportunityCluster,
    destinationClustersLoading,
    setDestinationClustersLoading,
    destinationClustersError,
    setDestinationClustersError,
    opportunityFeedLoading,
    setOpportunityFeedLoading,
    opportunityFeedError,
    setOpportunityFeedError,
    opportunityDetail,
    setOpportunityDetail,
    opportunityDetailLoading,
    setOpportunityDetailLoading,
    opportunityDetailError,
    setOpportunityDetailError,
    opportunityDetailUpgradePrompt,
    setOpportunityDetailUpgradePrompt,
    radarDraft,
    setRadarDraft,
    radarSaving,
    setRadarSaving,
    radarMessage,
    setRadarMessage,
    radarError,
    setRadarError,
    radarMatches,
    setRadarMatches,
    radarMatchesLoading,
    setRadarMatchesLoading,
    radarMatchesError,
    setRadarMatchesError,
    radarFollows,
    setRadarFollows,
    radarFollowsLoading,
    setRadarFollowsLoading,
    radarFollowsError,
    setRadarFollowsError,
    opportunityPipelineStatus,
    setOpportunityPipelineStatus,
    opportunityPipelineStatusLoading,
    setOpportunityPipelineStatusLoading,
    opportunityPipelineStatusError,
    setOpportunityPipelineStatusError,
    aiTravelPrompt,
    setAiTravelPrompt,
    aiTravelLoading,
    setAiTravelLoading,
    aiTravelResult,
    setAiTravelResult,
    aiTravelError,
    setAiTravelError,
    exploreDiscoveryInput,
    setExploreDiscoveryInput,
    exploreBudgetItems,
    setExploreBudgetItems,
    exploreBudgetLoading,
    setExploreBudgetLoading,
    exploreBudgetError,
    setExploreBudgetError,
    exploreMapPoints,
    setExploreMapPoints,
    exploreMapLoading,
    setExploreMapLoading,
    exploreMapError,
    setExploreMapError,
    exploreSelectedDestination,
    setExploreSelectedDestination,
    systemCapabilities,
    notifiedIdsRef,
    openPlanUpgradeFlowRef,
    onLimitReachedRef
  } = useAppState({
    apiClient: api,
    cookieSessionToken: COOKIE_SESSION_TOKEN,
    assistantWelcomeText: t('aiAssistantWelcome')
  });
  const {
    radarSessionActivated,
    setRadarSessionActivated,
    activateRadarSessionFlag,
    activateRadarFromFeedSession
  } = useRadarSessionController({ setActiveMainSection });
  const { persistPostAuthAction, persistPostAuthSection, persistAuthFunnelState, clearAuthFunnelState, beginAuthFlow, beginSetAlertAuthFlow } =
    useAuthFlowCoordinator({
      activeMainSection,
      setShowLandingPage,
      setShowAccountPanel,
      setAuthMode,
      setAuthView,
      setAuthError,
      setPendingPostAuthAction,
      setPendingPostAuthSection
    });
  useEffect(() => {
    setMultiCityValidation(validateMultiCityForm({ segments: multiCitySegments }));
  }, [multiCitySegments]);

  useEffect(() => {
    if (searchMode === 'multi_city') return;
    setMultiCityRetryVisible(false);
  }, [searchMode]);

  useEffect(() => {
    if (searchMode !== 'multi_city') return;
    setMultiCityRetryVisible(false);
  }, [searchForm, searchMode]);

  useEffect(() => {
    if (searchMode !== 'multi_city') return;
    const firstSegment = Array.isArray(multiCitySegments) ? multiCitySegments[0] : null;
    if (!firstSegment || String(firstSegment.origin || '').trim()) return;
    const fallbackOrigin = String(searchForm.origin || '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{3}$/.test(fallbackOrigin)) return;
    setMultiCitySegments((prev) => updateMultiCitySegmentField(prev, 0, 'origin', fallbackOrigin));
  }, [searchMode, searchForm.origin, multiCitySegments]);

  const { setMultiCitySegmentValue, appendMultiCitySegment, deleteMultiCitySegment, buildCurrentMultiCityPayload } = createMultiCityLocalActions({
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
  });

  function applySearchResultState(result) {
    const flights = enrichItinerariesWithRadar(
      enrichItinerariesWithDeal(scoreItineraries(Array.isArray(result?.flights) ? result.flights : []))
    );
    setSearchResult({
      ...(result || {}),
      flights
    });
    const resolvedRequestMode = String(result?.meta?.requestMode || result?.meta?.mode || '').trim().toLowerCase();
    const effectiveSearchMode = resolvedRequestMode === 'multi_city' ? 'multi_city' : searchMode;
    trackSearchEvent('results_rendered', {
      searchModeOverride: effectiveSearchMode,
      resultCount: flights.length,
      extra: {
        requestMode: resolvedRequestMode || undefined
      }
    });
    clearBookingHandoffError();
    setCompareIds([]);
    setDestinationInsights({});
    setInsightLoadingByFlight({});
    setInsightErrorByFlight({});
  }

  useEffect(() => {
    api
      .config()
      .then((payload) => {
        setConfig(payload);
        const fallbackOrigin = payload.origins[0]?.code || 'MXP';
        setSearchForm((prev) => ({ ...prev, origin: fallbackOrigin }));
        setExploreDiscoveryInput((prev) => ({
          ...prev,
          origin: /^[A-Za-z]{3}$/.test(String(prev.origin || '')) ? String(prev.origin).toUpperCase() : fallbackOrigin
        }));
      })
      .catch(() => {
        setConfig({
          origins: [],
          regions: ['all', 'eu', 'asia', 'america', 'oceania'],
          cabins: ['economy', 'premium', 'business'],
          connectionTypes: ['all', 'direct', 'with_stops'],
          travelTimes: ['all', 'day', 'night'],
          countriesByRegion: {}
        });
      });
  }, []);

  useEffect(() => {
    loadBillingPricing();
    const timer = setInterval(() => {
      loadBillingPricing(true);
    }, 300000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!token) {
      setCsrfToken('');
      setUser(null);
      setOpportunityFeedAccess(null);
      setWatchlist([]);
      setSubscriptions([]);
      setAlertDraftById({});
      setNotifications([]);
      setUnreadCount(0);
      setSecurityEvents([]);
      setSecurityInfo({ isLocked: false, lockUntil: null, failedLoginCount: 0 });
      setRadarFollows([]);
      setOpportunityPipelineStatus(null);
      return;
    }

    api
      .me(token)
      .then((payload) => {
        setUser(payload.user);
        setCsrfToken(payload.session?.csrfToken || '');
        setSecurityInfo(payload.security || { isLocked: false, lockUntil: null, failedLoginCount: 0 });
      })
      .catch(() => {
        setCsrfToken('');
        setToken('');
      });
  }, [token]);

  useEffect(() => {
    if (!user || !pendingPostAuthAction) return;
    const preferredSection = String(pendingPostAuthSection || '').trim().toLowerCase();
    const defaultSection = pendingPostAuthAction === 'set_alert' ? 'radar' : 'explore';
    const nextSection = preferredSection || defaultSection;
    if (pendingPostAuthAction === 'enter_app') {
      setShowLandingPage(false);
      setShowAccountPanel(false);
      setSubMessage(t('postAuthEnterAppReady'));
      setActiveMainSection(nextSection);
    }
    if (pendingPostAuthAction === 'set_alert') {
      setShowLandingPage(false);
      setShowAccountPanel(false);
      setSubMessage(t('postAuthSetAlertHint'));
      setActiveMainSection(nextSection);
    }
    persistPostAuthAction(null);
    persistPostAuthSection(null);
    clearAuthFunnelState();
  }, [user, pendingPostAuthAction, pendingPostAuthSection]);

  useEffect(() => {
    if (!user) {
      setShowOnboarding(false);
      return;
    }
    setShowOnboarding(!user.onboardingDone);
  }, [user]);

  useAssistantWelcomeEffect({
    language,
    i18nPack,
    t,
    setIntakeMessages
  });

  useAppSuggestionEffects({
    api,
    searchForm,
    language,
    canonicalCountryFilter,
    canonicalDestinationQuery,
    localizeDestinationSuggestionLabel,
    normalizeSuggestionToken,
    resolveSuggestionCityToken,
    setDestinationSuggestions,
    setCountrySuggestions
  });

  const isAuthenticated = Boolean(user);
  const backendUserPlanType = useMemo(() => {
    if (!user) return 'free';
    const raw = String(user.planType || user.plan_type || '').trim().toLowerCase();
    if (raw === 'elite' || raw === 'creator') return 'elite';
    if (raw === 'pro') return 'pro';
    if (raw === 'free') return 'free';
    return user.isPremium ? 'pro' : 'free';
  }, [user]);
  const userPlanType = useMemo(
    () => resolveEffectivePlan(backendUserPlanType, localUserPlan),
    [backendUserPlanType, localUserPlan]
  );
  const planEntitlements = useMemo(() => getPlanEntitlements(userPlanType), [userPlanType]);
  const planComparisonRows = useMemo(() => getPlanComparisonRows(), []);
  const canUseRadarPlan = userPlanType === 'pro' || userPlanType === 'elite';
  const canUseAiTravelPlan = userPlanType === 'elite';
  const isMfaChallengeActive = Boolean(authMfa.ticket);
  const isAdvancedMode = uiMode === 'advanced';
  const showAuthGateModal = false;
  const adminAccess = useMemo(
    () =>
      resolveAdminAccess({
        userEmail: user?.email,
        allowlistCsv: import.meta?.env?.VITE_ADMIN_ALLOWLIST_EMAILS || ''
      }),
    [user?.email]
  );
  const isAdminUser = adminAccess.isAdmin;

  useEffect(() => {
    writeStoredUserPlan(localUserPlan);
  }, [localUserPlan]);

  useEffect(() => {
    const normalizedBackend = normalizeUserPlan(backendUserPlanType);
    const resolved = resolveEffectivePlan(localUserPlan, normalizedBackend);
    if (resolved !== localUserPlan) {
      setLocalUserPlan(resolved);
    }
  }, [backendUserPlanType, localUserPlan]);

  const quickIntakePrompts = QUICK_INTAKE_PROMPTS_I18N[language] || QUICK_INTAKE_PROMPTS_I18N.en;
  const isLiveDataSource = systemCapabilities?.data_source === 'live';
  const heroSubText = isLiveDataSource
    ? t('appHeroSubLive') || 'Live provider mode active. Radar is scanning current fares.'
    : t('appHeroSubSynthetic') || 'Historical/demo mode active. Use signals to explore and verify final live fare before booking.';
  const heroDataSourceNote = isLiveDataSource
    ? t('appDataSourceLiveNote') || 'Connected to live providers.'
    : t('appDataSourceSyntheticNote') || 'Using historical signals: useful for discovery, not a final booking quote.';
  const authTitle = authMode === 'login' ? t('signIn') : t('register');
  const authUi = {
    welcomeTitle: t('authWelcomeTitle'),
    welcomeSub: t('authWelcomeSub'),
    email: t('continueEmail'),
    facebook: t('continueFacebook'),
    google: t('continueGoogle'),
    apple: t('continueApple'),
    remember: t('rememberMe'),
    legalPrefix: t('legalPrefix'),
    legalTerms: t('legalTerms'),
    legalAnd: t('legalAnd'),
    legalPrivacy: t('legalPrivacy')
  };
  const processedCheckoutSessionRef = useRef(null);

  const offerSummary = useMemo(() => {
    if (!searchResult.meta) return t('noSearch');
    return `${searchResult.meta.count} ${t('offers')} | ${t('stay')} ${searchResult.meta.stayDays} ${t('days')}`;
  }, [searchResult.meta, language, i18nPack]);

  const visibleFlights = useMemo(() => {
    const items = [...searchResult.flights];
    if (searchSortBy === 'price') {
      items.sort((a, b) => a.price - b.price || b.savingVs2024 - a.savingVs2024);
    } else if (searchSortBy === 'avg2024') {
      items.sort((a, b) => a.avg2024 - b.avg2024 || a.price - b.price);
    } else if (searchSortBy === 'travelScore') {
      return sortItinerariesByTravelScore(items);
    } else if (searchSortBy === 'deal') {
      return sortByDealPriority(items);
    } else if (searchSortBy === 'radar') {
      return sortByRadarPriority(items);
    } else {
      items.sort((a, b) => b.savingVs2024 - a.savingVs2024 || a.price - b.price);
    }
    return items;
  }, [searchResult.flights, searchSortBy]);

  const cheapestFlight = useMemo(() => {
    if (!visibleFlights.length) return null;
    return [...visibleFlights].sort((a, b) => a.price - b.price)[0];
  }, [visibleFlights]);

  const bestValueFlight = useMemo(() => {
    if (!visibleFlights.length) return null;
    return [...visibleFlights].sort((a, b) => b.savingVs2024 - a.savingVs2024)[0];
  }, [visibleFlights]);

  const comparedFlights = useMemo(() => {
    if (!compareIds.length) return [];
    const map = new Map(searchResult.flights.map((f) => [f.id, f]));
    return compareIds.map((id) => map.get(id)).filter(Boolean);
  }, [compareIds, searchResult.flights]);

  const appContextValue = useMemo(
    () => ({
      t,
      tt,
      InfoTip,
      language,
      setLanguage,
      LANGUAGE_OPTIONS,
      isAuthenticated,
      user,
      authUi,
      authTitle,
      isMfaChallengeActive,
      offerSummary,
      isAdvancedMode,
      connectionLabel,
      regionLabel,
      travelTimeLabel,
      MOOD_OPTIONS,
      CLIMATE_PREF_OPTIONS,
      defaultSearch: DEFAULT_SEARCH_FORM
    }),
    [
      language,
      isAuthenticated,
      user,
      authUi,
      authTitle,
      isMfaChallengeActive,
      offerSummary,
      isAdvancedMode,
      t,
      tt
    ]
  );

  const utmParams = useMemo(() => {
    if (typeof window === 'undefined') return {};
    const params = new URLSearchParams(window.location.search);
    return {
      utmSource: params.get('utm_source') || undefined,
      utmMedium: params.get('utm_medium') || undefined,
      utmCampaign: params.get('utm_campaign') || undefined
    };
  }, []);

  const bookingHandoffLayer = useMemo(() => createBookingHandoffLayer(), []);
  const bookingClickTracker = useMemo(() => createBookingClickedTracker({ apiClient: api }), []);
  const funnelTracker = useMemo(() => createFunnelTracker(), []);
  const funnelEventService = useMemo(() => createFunnelEventService(funnelTracker), [funnelTracker]);
  const adminDashboardApi = useMemo(() => createAdminDashboardApi(api), []);
  const { sendAdminTelemetryEvent, trackSearchEvent, trackResultInteraction, trackItineraryOpened } = useAdminTelemetryBridge({
    isAuthenticated,
    searchMode,
    funnelEventService,
    adminDashboardApi,
    token,
    mapFunnelEventToAdminTelemetry,
    mapUpgradeEventToAdminTelemetry
  });
  const {
    submitAuth,
    submitLoginMfa,
    loginWithGoogle,
    loginWithApple,
    loginWithFacebook,
    setupMfa,
    resetMfaSetup,
    enableMfa,
    disableMfa,
    finishOnboarding,
    openOnboardingSetup,
    logout,
    deleteAccount
  } = useAuthSessionActions({
    api,
    token,
    user,
    authMode,
    authForm,
    authView,
    rememberMe,
    authMfa,
    mfaActionCode,
    onboardingDraft,
    t,
    setToken,
    setUser,
    setAuthForm,
    setAuthView,
    setAuthMfa,
    setShowLandingPage,
    setShowAccountPanel,
    setAuthError,
    setOauthLoading,
    setSubMessage,
    setMfaSetupData,
    setMfaActionCode,
    setSearchHistory,
    setSecurityEvents,
    setAlertDraftById,
    setDeletingAccount,
    setOnboardingSaving,
    setSearchForm,
    setShowOnboarding,
    resolveApiError,
    persistAuthFunnelState,
    persistPostAuthAction,
    persistPostAuthSection,
    clearAuthFunnelState,
    clearLocalTravelData,
    clearConsent,
    writeRememberedEmail,
    clearRememberedEmail
  });
  const aiGateway = useMemo(
    () =>
      createAiGateway({
        adapters: {
          openai: createOpenAiAdapter(),
          anthropic: createAnthropicAdapter(),
          mock: createMockAiAdapter({
            handlers: {
              itinerary_generation: async ({ input, planType }) => {
                const generationInputs = Array.isArray(input?.generationInputs) ? input.generationInputs : [];
                const preferences = input?.preferences && typeof input.preferences === 'object' ? input.preferences : {};
                if (generationInputs.length === 0) {
                  return {
                    ok: true,
                    data: {
                      summary: formatGeneratedSummary(language, 0),
                      items: [],
                      totalItems: 0,
                      truncatedByPlan: false
                    }
                  };
                }

                const candidates = generateCandidateItineraries(generationInputs, preferences);
                const ranked = rankGeneratedItineraries(candidates, preferences).map((candidate) => ({
                  ...candidate,
                  explanation: explainGeneratedItinerary(candidate, preferences)
                }));
                const entitlements = getPlanEntitlements(planType);
                const limit = entitlements.aiTravelCandidatesLimit;
                const hasLimit = Number.isFinite(Number(limit)) && Number(limit) > 0;
                const safeLimit = hasLimit ? Math.max(1, Math.round(Number(limit))) : null;
                const limited = safeLimit === null ? ranked : ranked.slice(0, safeLimit);

                return {
                  ok: true,
                  data: {
                    summary: formatGeneratedSummary(language, limited.length),
                    items: buildGatewayItineraryItems(limited),
                    totalItems: ranked.length,
                    truncatedByPlan: safeLimit !== null && ranked.length > safeLimit
                  }
                };
              }
            }
          })
        },
        providerAvailability: {
          openai: false,
          anthropic: false,
          mock: true
        }
      }),
    [language]
  );
  const {
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
  } = useAppDataOperations({
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
    setIntakePrompt,
    openPlanUpgradeFlowRef
  });

  // These effects depend on functions returned by useAppDataOperations and must be
  // declared AFTER that hook to avoid a TDZ (temporal dead zone) reference error.
  useEffect(() => {
    if (!token || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const checkoutSessionId = String(params.get('session_id') || '').trim();
    if (!checkoutSessionId || processedCheckoutSessionRef.current === checkoutSessionId) return;
    processedCheckoutSessionRef.current = checkoutSessionId;

    (async () => {
      try {
        await api.billingSyncSubscription(token);
      } catch {}

      try {
        const payload = await api.me(token);
        setUser(payload.user);
        setCsrfToken(payload.session?.csrfToken || '');
        setSecurityInfo(payload.security || { isLocked: false, lockUntil: null, failedLoginCount: 0 });
      } catch {}

      refreshSubscriptions();

      params.delete('session_id');
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, document.title, nextUrl);
    })();
  }, [token, refreshSubscriptions]);

  useEffect(() => {
    if (!user) return;
    refreshWatchlist();
    refreshSubscriptions();
    refreshNotifications();
    refreshSearchHistory();
    refreshSecurityActivity();
    loadOpportunityFeed();
    loadOpportunityClusters();
    loadRadarPreferences();
    loadRadarMatches();
    loadRadarFollows();
    loadOpportunityPipelineStatus();

    const timer = setInterval(() => refreshNotifications(true), 30000);
    return () => clearInterval(timer);
  }, [user]);

  useEffect(() => {
    if (showLandingPage) return;
    loadOpportunityFeed();
    loadOpportunityClusters();
  }, [showLandingPage, user]);

  useEffect(() => {
    if (showLandingPage) return;
    loadOpportunityFeed();
  }, [selectedOpportunityCluster, showLandingPage]);

  useEffect(() => {
    if (showLandingPage) return;
    if (activeMainSection !== 'explore') return;
    if (exploreBudgetLoading || exploreMapLoading) return;
    if (exploreBudgetItems.length > 0 || exploreMapPoints.length > 0) return;
    loadExploreDiscovery().catch(() => {});
  }, [activeMainSection, showLandingPage]);

  useAppBrowserEffects({
    showAccountPanel,
    user,
    setShowAccountPanel,
    loadBillingPricing,
    setAuthError,
    setToken,
    cookieSessionToken: COOKIE_SESSION_TOKEN,
    persistPostAuthAction,
    persistPostAuthSection,
    setPendingPostAuthAction,
    setAuthMode,
    setAuthView,
    setPendingPostAuthSection,
    setAuthForm,
    setRememberMe,
    showLandingPage,
    darkMode,
    showOnboarding,
    setAdminRouteRequested,
    setShowLandingPage,
    setActiveMainSection,
    activeMainSection,
    isAdvancedMode,
    prefetchAdvancedAnalyticsChunk
  });

  const {
    submitSearch,
    retryMultiCitySearch,
    submitJustGo,
    analyzeIntentPrompt,
    runQuickIntakePrompt,
    applySearchPreset,
    applyPeriodPreset,
    autoFixSearchFilters
  } = useSearchFlowActions({
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
    onUpgradeRequired: (planType, source) => openPlanUpgradeFlowRef.current?.(planType, source),
    onLimitReached: () => onLimitReachedRef.current?.()
  });

  const applyLocalPlanChange = createApplyLocalPlanChange({
    normalizeUserPlan,
    resolveEffectivePlan,
    userPlanType,
    setLocalUserPlan,
    setUser,
    setSubMessage,
    t
  });

  const {
    upgradeFlowState,
    upgradePlanContent,
    openPlanUpgradeFlow,
    closePlanUpgradeFlow,
    submitPlanUpgradeInterest,
    openPremiumSectionFromUpgradeFlow,
    upgradeToPremium,
    chooseElitePlan
  } = useUpgradeFlowController({
    user,
    applyLocalPlanChange,
    setSubMessage,
    setActiveMainSection,
    api,
    token,
    systemCapabilities
  });
  // Keep ref in sync so useAppDataOperations can invoke the upgrade modal on 402 errors.
  openPlanUpgradeFlowRef.current = openPlanUpgradeFlow;

  const {
    showLimitedResultsBanner,
    onSearchCompleted,
    onDealOpened,
    dismissLimitedResultsBanner,
    onLimitedResultsCtaClicked,
    shouldShowUrgencyPrompt,
    showLimitReachedBanner,
    onLimitReached,
    dismissLimitReachedBanner
  } = useConversionTriggers({ userPlanType });
  onLimitReachedRef.current = onLimitReached;

  const { quota } = useQuotaStatus({ api, token, isAuthenticated });
  const {
    bookingHandoffError,
    opportunityBookingError,
    clearBookingHandoffError,
    clearOpportunityBookingError,
    handleBookingFromSearchFlight,
    openOpportunityBooking
  } = useBookingFlow({
    bookingHandoffLayer,
    bookingClickTracker,
    funnelEventService,
    searchForm,
    searchMode,
    t,
    utmParams,
    resolveUpgradeTriggerContent: (trigger, meta) => getUpgradeTriggerContent(userPlanType, trigger, meta),
    saveRecentItineraryWithPlanGate,
    setOpportunityDetailUpgradePrompt,
    trackResultInteraction
  });
  const { openOpportunityDetail, openSavedHubItinerary } = useOpportunityFlow({
    api,
    token,
    opportunityFeed,
    userPlanType,
    resolveApiError,
    saveRecentItineraryWithPlanGate,
    resolveUpgradeTriggerContent: (trigger, meta) => getUpgradeTriggerContent(userPlanType, trigger, meta),
    trackResultInteraction,
    trackItineraryOpened,
    clearOpportunityBookingError,
    setOpportunityDetail,
    setOpportunityDetailLoading,
    setOpportunityDetailError,
    setOpportunityDetailUpgradePrompt,
    shouldShowUrgencyPrompt
  });
  const {
    getAlertDraft,
    updateAlertDraft,
    addToWatchlist,
    removeWatchlistItem,
    createAlertForFlight,
    createDurationAlert,
    loadDestinationInsights,
    deleteSubscription,
    toggleSubscriptionEnabled,
    saveSubscriptionEdit,
    markNotificationRead,
    markAllRead,
    enableBrowserNotifications,
    toggleCompare,
    saveFirstResult,
    alertFirstResult
  } = useResultInteractionActions({
    api,
    token,
    t,
    isAuthenticated,
    canUseRadarPlan,
    canUseAiTravelPlan,
    searchForm,
    showLandingPage,
    alertDraftById,
    visibleFlights,
    trackResultInteraction,
    beginSetAlertAuthFlow,
    canonicalCountryFilter,
    canonicalDestinationQuery,
    resolveApiError,
    refreshWatchlist,
    refreshSubscriptions,
    refreshNotifications,
    setWatchlistError,
    setSubMessage,
    setAlertDraftById,
    setDestinationInsights,
    setInsightLoadingByFlight,
    setInsightErrorByFlight,
    setCompareIds
  });
  const {
    scrollToSection,
    handleLandingPrimaryCta,
    handleLandingSecondaryCta,
    handleLandingSignIn,
    requireSectionLogin
  } = useLandingActions({
    isAuthenticated,
    t,
    beginAuthFlow,
    persistPostAuthAction,
    persistPostAuthSection,
    clearAuthFunnelState,
    setShowLandingPage,
    setShowAccountPanel,
    setSubMessage,
    setActiveMainSection
  });

  function saveRecentItineraryWithPlanGate(item) {
    return saveRecentItineraryWithPlanGateAction({
      item,
      createSavedItineraryFromOpportunity,
      readSavedItineraries,
      evaluateUsageLimit,
      planEntitlements,
      saveRecentItinerary
    });
  }

  function activateFreePlan() {
    return activateFreePlanAction({
      isAuthenticated,
      beginAuthFlow,
      applyLocalPlanChange
    });
  }

  function viewDealsForTrackedRoute(slug) {
    return viewDealsForTrackedRouteAction({
      slug,
      setActiveMainSection,
      setSelectedOpportunityCluster
    });
  }

  function handleUntrackedRouteFromHub(slug) {
    return handleUntrackedRouteFromHubAction({
      slug,
      selectedOpportunityCluster,
      setSelectedOpportunityCluster
    });
  }

  function handleClearLocalTravelData() {
    return handleClearLocalTravelDataAction({
      clearLocalTravelData,
      setRadarSessionActivated,
      setSelectedOpportunityCluster,
      setOpportunityDetail,
      setOpportunityDetailUpgradePrompt,
      clearBookingHandoffError,
      clearOpportunityBookingError,
      setSubMessage
    });
  }

  function handleTrackedRoutesLimitReached(meta) {
    return handleTrackedRoutesLimitReachedAction({
      meta,
      evaluateUsageLimit,
      planEntitlements,
      getUpgradeTriggerContent,
      userPlanType,
      setSubMessage
    });
  }

  const closeAdminBackoffice = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
    }
    setAdminRouteRequested(false);
    setActiveMainSection('explore');
  }, []);

  const activateRadarFromFeedWithTelemetry = useCallback(() => {
    activateRadarFromFeedSession();
    sendAdminTelemetryEvent({
      eventType: 'radar_activated',
      source: 'opportunity_feed',
      planType: userPlanType
    });
  }, [activateRadarFromFeedSession, sendAdminTelemetryEvent, userPlanType]);

  const activateRadarFromHubWithTelemetry = useCallback(() => {
    activateRadarFromFeedSession();
    sendAdminTelemetryEvent({
      eventType: 'radar_activated',
      source: 'personal_hub',
      planType: userPlanType
    });
  }, [activateRadarFromFeedSession, sendAdminTelemetryEvent, userPlanType]);

  useEffect(() => {
    if (activeMainSection !== 'admin') return;
    if (!isAuthenticated || !isAdminUser) return;
    void loadAdminBackofficeReport();
  }, [activeMainSection, isAuthenticated, isAdminUser, token]);


  const openPremiumFromLanding = useCallback(
    () =>
      beginAuthFlow({
        action: 'enter_app',
        authMode: 'register',
        authView: 'options',
        keepLandingVisible: false,
        targetSection: 'premium'
      }),
    [beginAuthFlow]
  );

  const landingNavItems = createLandingNavItems(t);
  const landingFeatureCards = createLandingFeatureCards(t);
  const landingValueCards = createLandingValueCards(t);
  const landingPricingPlans = createLandingPricingPlans({
    t,
    formatEur,
    onChooseFreePlan: () => setShowLandingPage(false),
    onChoosePremiumPlan: openPremiumFromLanding,
    backendPricing: billingPricing
  });
  const landingContactCards = createLandingContactCards(t);

  const premiumPackages = createPremiumPackages({
    t,
    premiumBillingCycle,
    activateFreePlan,
    upgradeToPremium,
    chooseElitePlan,
    // Pass live backend prices so the UI never shows stale hardcoded values
    backendPricing: billingPricing
  });

  const isAnnualBilling = premiumBillingCycle === 'annual';

  // Conversion trigger counters — fire when a search completes or a deal detail opens.
  const prevSearchMetaRef = useRef(null);
  useEffect(() => {
    if (!searchResult.meta || searchResult.meta === prevSearchMetaRef.current) return;
    prevSearchMetaRef.current = searchResult.meta;
    if (userPlanType === 'free') onSearchCompleted();
  }, [searchResult.meta]);

  useEffect(() => {
    if (!opportunityDetail) return;
    if (userPlanType === 'free') onDealOpened();
  }, [opportunityDetail]);

  return (
    <AppProvider value={appContextValue}>
      {showLandingPage ? (
      <LandingSection
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        landingNavItems={landingNavItems}
        scrollToSection={scrollToSection}
        setShowLandingPage={setShowLandingPage}
        setShowAccountPanel={setShowAccountPanel}
        landingFeatureCards={landingFeatureCards}
        landingValueCards={landingValueCards}
        landingPricingPlans={landingPricingPlans}
        landingContactCards={landingContactCards}
        onHeroPrimaryCta={handleLandingPrimaryCta}
        onHeroSecondaryCta={handleLandingSecondaryCta}
        onOpenAuth={handleLandingSignIn}
      />
    ) : (
    <>
    <main className={`page app-shell${darkMode ? ' app-dark' : ''}${activeMainSection === 'home' ? ' app-home' : ''}${adminRouteRequested ? ' app-admin-route' : ''}`}>
      <AppHeroHeader
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        language={language}
        setLanguage={setLanguage}
        t={t}
        isAuthenticated={isAuthenticated}
        adminRouteRequested={adminRouteRequested}
        openOnboardingSetup={openOnboardingSetup}
        setShowAccountPanel={setShowAccountPanel}
        setAuthMode={setAuthMode}
        setAuthView={setAuthView}
        setAuthError={setAuthError}
        beginAuthFlow={beginAuthFlow}
        user={user}
        heroSubText={heroSubText}
        isLiveDataSource={isLiveDataSource}
        heroDataSourceNote={heroDataSourceNote}
        opportunityFeedCount={opportunityFeed.length}
        destinationClusterCount={destinationClusters.length}
        radarMatchesCount={radarMatches.length}
        radarSessionActivated={radarSessionActivated}
        userPlanType={userPlanType}
        activeMainSection={activeMainSection}
        setActiveMainSection={setActiveMainSection}
      />

      {isAuthenticated && quota ? (
        <QuotaWarningBanner
          quota={quota}
          planId={userPlanType}
          onUpgrade={openPlanUpgradeFlow}
        />
      ) : null}

      {isAuthenticated && user?.isInTrial ? (
        <TrialBanner
          trialDaysRemaining={
            user.trialEndsAt
              ? Math.max(1, Math.ceil((new Date(user.trialEndsAt) - Date.now()) / (24 * 60 * 60 * 1000)))
              : 1
          }
          trialEndsAt={user.trialEndsAt ?? null}
          onUpgrade={openPlanUpgradeFlow}
        />
      ) : null}

      <OnboardingModal
        isOpen={showOnboarding}
        isAuthenticated={isAuthenticated}
        t={t}
        onboardingDraft={onboardingDraft}
        setOnboardingDraft={setOnboardingDraft}
        config={config}
        regionLabel={regionLabel}
        finishOnboarding={finishOnboarding}
        onboardingSaving={onboardingSaving}
        setShowOnboarding={setShowOnboarding}
      />

      <AccountAndUpgradeOverlays
        adminRouteRequested={adminRouteRequested}
        isAuthenticated={isAuthenticated}
        showAccountPanel={showAccountPanel}
        showAuthGateModal={showAuthGateModal}
        darkMode={darkMode}
        setShowAccountPanel={setShowAccountPanel}
        logout={logout}
        formatEur={formatEur}
        billingPricing={billingPricing}
        formatPricingDate={formatPricingDate}
        billingPricingLoading={billingPricingLoading}
        loadBillingPricing={loadBillingPricing}
        billingPricingError={billingPricingError}
        upgradeToPremium={upgradeToPremium}
        chooseElitePlan={chooseElitePlan}
        openOnboardingSetup={openOnboardingSetup}
        setupMfa={setupMfa}
        disableMfa={disableMfa}
        resetMfaSetup={resetMfaSetup}
        mfaActionCode={mfaActionCode}
        setMfaActionCode={setMfaActionCode}
        mfaSetupData={mfaSetupData}
        enableMfa={enableMfa}
        authView={authView}
        authMode={authMode}
        setAuthMode={setAuthMode}
        loginWithFacebook={loginWithFacebook}
        oauthLoading={oauthLoading}
        loginWithGoogle={loginWithGoogle}
        loginWithApple={loginWithApple}
        submitAuth={submitAuth}
        authForm={authForm}
        setAuthForm={setAuthForm}
        setAuthView={setAuthView}
        rememberMe={rememberMe}
        setRememberMe={setRememberMe}
        submitLoginMfa={submitLoginMfa}
        authMfa={authMfa}
        setAuthMfa={setAuthMfa}
        authError={authError}
        deleteAccount={deleteAccount}
        deletingAccount={deletingAccount}
        systemCapabilities={systemCapabilities}
        upgradeFlowState={upgradeFlowState}
        upgradePlanContent={upgradePlanContent}
        userPlanType={userPlanType}
        planComparisonRows={planComparisonRows}
        closePlanUpgradeFlow={closePlanUpgradeFlow}
        submitPlanUpgradeInterest={submitPlanUpgradeInterest}
        openPremiumSectionFromUpgradeFlow={openPremiumSectionFromUpgradeFlow}
        searchLimitValueNote={t('searchLimitUpgradeCta')}
      />

      {activeMainSection === 'admin' ? (
        <AdminMainSection
          isAuthenticated={isAuthenticated}
          isAdminUser={isAdminUser}
          authForm={authForm}
          authError={authError}
          setAuthForm={setAuthForm}
          submitAuth={submitAuth}
          adminDashboardLoading={adminDashboardLoading}
          adminDashboardError={adminDashboardError}
          adminDashboardReport={adminDashboardReport}
          loadAdminBackofficeReport={loadAdminBackofficeReport}
          closeAdminBackoffice={closeAdminBackoffice}
        />
      ) : null}

      {activeMainSection === 'home' ? (
        <HomeMainSection
          isAuthenticated={isAuthenticated}
          destinationClusters={destinationClusters}
          language={language}
          userPlanType={userPlanType}
          quota={quota}
          planEntitlements={planEntitlements}
          radarSessionActivated={radarSessionActivated}
          viewDealsForTrackedRoute={viewDealsForTrackedRoute}
          handleUntrackedRouteFromHub={handleUntrackedRouteFromHub}
          handleClearLocalTravelData={handleClearLocalTravelData}
          openSavedHubItinerary={openSavedHubItinerary}
          activateRadarFromHubWithTelemetry={activateRadarFromHubWithTelemetry}
          upgradeToPremium={upgradeToPremium}
          chooseElitePlan={chooseElitePlan}
          searchForm={searchForm}
          opportunityFeed={opportunityFeed}
          destinationClustersLoading={destinationClustersLoading}
          destinationClustersError={destinationClustersError}
          selectedOpportunityCluster={selectedOpportunityCluster}
          opportunityFeedLoading={opportunityFeedLoading}
          opportunityFeedError={opportunityFeedError}
          refreshOpportunityFeedNow={refreshOpportunityFeedNow}
          setSelectedOpportunityCluster={setSelectedOpportunityCluster}
          followDestinationClusterFromFeed={followDestinationClusterFromFeed}
          openOpportunityDetail={openOpportunityDetail}
          followOpportunity={followOpportunity}
          setActiveMainSection={setActiveMainSection}
          activateRadarFromFeedWithTelemetry={activateRadarFromFeedWithTelemetry}
          beginAuthFlow={beginAuthFlow}
          t={t}
          opportunityFeedAccess={opportunityFeedAccess}
          handleTrackedRoutesLimitReached={handleTrackedRoutesLimitReached}
          systemCapabilities={systemCapabilities}
          opportunityDetailLoading={opportunityDetailLoading}
          opportunityDetailError={opportunityDetailError}
          opportunityDetail={opportunityDetail}
          opportunityBookingError={opportunityBookingError}
          setOpportunityDetail={setOpportunityDetail}
          clearOpportunityBookingError={clearOpportunityBookingError}
          setOpportunityDetailUpgradePrompt={setOpportunityDetailUpgradePrompt}
          openOpportunityBooking={openOpportunityBooking}
          opportunityDetailUpgradePrompt={opportunityDetailUpgradePrompt}
          limitedResultsBanner={userPlanType === 'free' ? {
            show: showLimitedResultsBanner,
            title: t('limitedResultsBannerTitle'),
            message: t('limitedResultsBannerMessage'),
            ctaLabel: t('limitedResultsBannerCta'),
            onCta: () => { onLimitedResultsCtaClicked(); upgradeToPremium('limited_results'); },
            onDismiss: dismissLimitedResultsBanner
          } : null}
        />
      ) : null}

      {activeMainSection === 'radar' ? (
        <RadarMainSection
          isAuthenticated={isAuthenticated}
          t={t}
          language={language}
          token={token}
          canUseRadarPlan={canUseRadarPlan}
          upgradeToPremium={upgradeToPremium}
          chooseElitePlan={chooseElitePlan}
          requireSectionLogin={requireSectionLogin}
          sendAdminTelemetryEvent={sendAdminTelemetryEvent}
          radarDraft={radarDraft}
          setRadarDraft={setRadarDraft}
          radarSaving={radarSaving}
          radarMessage={radarMessage}
          radarError={radarError}
          radarMatches={radarMatches}
          radarMatchesLoading={radarMatchesLoading}
          radarMatchesError={radarMatchesError}
          radarFollows={radarFollows}
          radarFollowsLoading={radarFollowsLoading}
          radarFollowsError={radarFollowsError}
          destinationClusters={destinationClusters}
          destinationClustersLoading={destinationClustersLoading}
          destinationClustersError={destinationClustersError}
          opportunityPipelineStatus={opportunityPipelineStatus}
          opportunityPipelineStatusLoading={opportunityPipelineStatusLoading}
          opportunityPipelineStatusError={opportunityPipelineStatusError}
          loadRadarMatches={loadRadarMatches}
          loadRadarFollows={loadRadarFollows}
          loadOpportunityPipelineStatus={loadOpportunityPipelineStatus}
          openOpportunityDebugView={openOpportunityDebugView}
          exportOpportunityDebugSnapshot={exportOpportunityDebugSnapshot}
          removeRadarFollow={removeRadarFollow}
          followDestinationCluster={followDestinationCluster}
          saveRadarPreferences={saveRadarPreferences}
          radarSessionActivated={radarSessionActivated}
          radarMessagingTier={planEntitlements.radarMessagingTier}
          preferredOrigin={searchForm.origin}
        />
      ) : null}

      {activeMainSection === 'ai-travel' ? (
        <AiTravelMainSection
          isAuthenticated={isAuthenticated}
          t={t}
          language={language}
          aiTravelPrompt={aiTravelPrompt}
          setAiTravelPrompt={setAiTravelPrompt}
          aiTravelLoading={aiTravelLoading}
          aiTravelResult={aiTravelResult}
          aiTravelError={aiTravelError}
          runAiTravelQuery={runAiTravelQuery}
          openOpportunityDetail={openOpportunityDetail}
          userPlanType={userPlanType}
          canUseAiTravelPlan={canUseAiTravelPlan}
          opportunityDetailLoading={opportunityDetailLoading}
          opportunityDetailError={opportunityDetailError}
          opportunityDetail={opportunityDetail}
          opportunityBookingError={opportunityBookingError}
          setOpportunityDetail={setOpportunityDetail}
          clearOpportunityBookingError={clearOpportunityBookingError}
          setOpportunityDetailUpgradePrompt={setOpportunityDetailUpgradePrompt}
          followOpportunity={followOpportunity}
          openOpportunityBooking={openOpportunityBooking}
          opportunityDetailUpgradePrompt={opportunityDetailUpgradePrompt}
          upgradeToPremium={upgradeToPremium}
          chooseElitePlan={chooseElitePlan}
          requireSectionLogin={requireSectionLogin}
        />
      ) : null}

      {activeMainSection === 'premium' ? (
        <PremiumPanelSection
          t={t}
          premiumBillingCycle={premiumBillingCycle}
          setPremiumBillingCycle={setPremiumBillingCycle}
          isAnnualBilling={isAnnualBilling}
          premiumPackages={premiumPackages}
        />
      ) : null}

      {activeMainSection === 'explore' ? (
        <ExploreMainSection
        t={t}
        tt={tt}
        language={language}
        selectedOpportunityCluster={selectedOpportunityCluster}
        setSelectedOpportunityCluster={setSelectedOpportunityCluster}
        destinationClusters={destinationClusters}
        setActiveMainSection={setActiveMainSection}
        systemCapabilities={systemCapabilities}
        config={config}
        exploreDiscoveryInput={exploreDiscoveryInput}
        setExploreDiscoveryInput={setExploreDiscoveryInput}
        loadExploreDiscovery={loadExploreDiscovery}
        exploreBudgetLoading={exploreBudgetLoading}
        exploreBudgetError={exploreBudgetError}
        exploreBudgetItems={exploreBudgetItems}
        exploreMapPoints={exploreMapPoints}
        exploreMapLoading={exploreMapLoading}
        exploreMapError={exploreMapError}
        exploreSelectedDestination={exploreSelectedDestination}
        setExploreSelectedDestination={setExploreSelectedDestination}
        applyExploreDestination={applyExploreDestination}
        uiMode={uiMode}
        setUiMode={setUiMode}
        submitSearch={submitSearch}
        searchMode={searchMode}
        setSearchMode={setSearchMode}
        multiCitySegments={multiCitySegments}
        multiCityValidation={multiCityValidation}
        setMultiCitySegmentValue={setMultiCitySegmentValue}
        appendMultiCitySegment={appendMultiCitySegment}
        deleteMultiCitySegment={deleteMultiCitySegment}
        retryMultiCitySearch={retryMultiCitySearch}
        multiCityRetryVisible={multiCityRetryVisible}
        intakePrompt={intakePrompt}
        setIntakePrompt={setIntakePrompt}
        analyzeIntentPrompt={analyzeIntentPrompt}
        quickIntakePrompts={quickIntakePrompts}
        runQuickIntakePrompt={runQuickIntakePrompt}
        intakeLoading={intakeLoading}
        intakeMessages={intakeMessages}
        intakeInfo={intakeInfo}
        searchForm={searchForm}
        setSearchForm={setSearchForm}
        showDestinationSuggestions={showDestinationSuggestions}
        setShowDestinationSuggestions={setShowDestinationSuggestions}
        destinationSuggestions={destinationSuggestions}
        applyPeriodPreset={applyPeriodPreset}
        showCountrySuggestions={showCountrySuggestions}
        setShowCountrySuggestions={setShowCountrySuggestions}
        countrySuggestions={countrySuggestions}
        submitJustGo={submitJustGo}
        searchLoading={searchLoading}
        createDurationAlert={createDurationAlert}
        upgradeToPremium={() => upgradeToPremium('search_results_soft_gate')}
        canUseProFeatures={canUseRadarPlan}
        canUseEliteFeatures={canUseAiTravelPlan}
        searchError={searchError}
        searchResult={searchResult}
        autoFixSearchFilters={autoFixSearchFilters}
        limitReachedBanner={userPlanType === 'free' ? {
          show: showLimitReachedBanner,
          title: t('limitReachedBannerTitle'),
          message: t('limitReachedBannerMessage'),
          ctaLabel: t('limitReachedBannerCta'),
          secondaryCtaLabel: t('limitReachedBannerSecondaryCta'),
          onCta: () => { dismissLimitReachedBanner(); openPlanUpgradeFlowRef.current?.('pro', 'search_limit'); },
          onSecondaryCta: () => openPlanUpgradeFlowRef.current?.('pro', 'search_limit'),
          onDismiss: dismissLimitReachedBanner
        } : null}
        isAdvancedMode={isAdvancedMode}
        isAuthenticated={isAuthenticated}
        runFeatureAuditCheck={runFeatureAuditCheck}
        featureAuditLoading={featureAuditLoading}
        featureAuditError={featureAuditError}
        featureAudit={featureAudit}
        loadMonetizationReport={loadMonetizationReport}
        monetizationLoading={monetizationLoading}
        monetizationError={monetizationError}
        monetizationReport={monetizationReport}
        loadFunnelReport={loadFunnelReport}
        funnelLoading={funnelLoading}
        funnelError={funnelError}
        funnelReport={funnelReport}
        loadOutboundReport={loadOutboundReport}
        outboundReportLoading={outboundReportLoading}
        exportOutboundReportCsv={exportOutboundReportCsv}
        outboundCsvLoading={outboundCsvLoading}
        outboundReportError={outboundReportError}
        outboundReport={outboundReport}
        runSecurityAuditCheck={runSecurityAuditCheck}
        securityAuditLoading={securityAuditLoading}
        securityAuditError={securityAuditError}
        securityAudit={securityAudit}
        refreshSecurityActivity={refreshSecurityActivity}
        securityInfo={securityInfo}
        securityError={securityError}
        securityEvents={securityEvents}
        refreshSearchHistory={refreshSearchHistory}
        searchHistory={searchHistory}
        regionLabel={regionLabel}
        applySearchPreset={applySearchPreset}
        visibleFlights={visibleFlights}
        saveFirstResult={saveFirstResult}
        alertFirstResult={alertFirstResult}
        cheapestFlight={cheapestFlight}
        bestValueFlight={bestValueFlight}
        resolveCityName={resolveCityName}
        dealLabelText={dealLabelText}
        handleBookingFromSearchFlight={handleBookingFromSearchFlight}
        addToWatchlist={addToWatchlist}
        createAlertForFlight={createAlertForFlight}
        searchSortBy={searchSortBy}
        setSearchSortBy={setSearchSortBy}
        bookingHandoffError={bookingHandoffError}
        radarStateText={radarStateText}
        compareIds={compareIds}
        toggleCompare={toggleCompare}
        loadDestinationInsights={loadDestinationInsights}
        insightLoadingByFlight={insightLoadingByFlight}
        canUseAiTravelPlan={canUseAiTravelPlan}
        insightErrorByFlight={insightErrorByFlight}
        destinationInsights={destinationInsights}
        comparedFlights={comparedFlights}
        setCompareIds={setCompareIds}
        subMessage={subMessage}
        subscriptions={subscriptions}
        getAlertDraft={getAlertDraft}
        connectionLabel={connectionLabel}
        updateAlertDraft={updateAlertDraft}
        saveSubscriptionEdit={saveSubscriptionEdit}
        toggleSubscriptionEnabled={toggleSubscriptionEnabled}
        deleteSubscription={deleteSubscription}
        refreshSubscriptions={refreshSubscriptions}
        unreadCount={unreadCount}
        enableBrowserNotifications={enableBrowserNotifications}
        markAllRead={markAllRead}
        notifError={notifError}
        notifications={notifications}
        markNotificationRead={markNotificationRead}
        refreshWatchlist={refreshWatchlist}
        watchlistError={watchlistError}
        watchlist={watchlist}
        removeWatchlistItem={removeWatchlistItem}
      />
      ) : null}
    </main>
    </>
    )}
    <CookieBanner t={t} />
    </AppProvider>
  );
}

export default App;





