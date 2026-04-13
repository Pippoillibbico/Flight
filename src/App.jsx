import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
import { api, COOKIE_SESSION_TOKEN, setCsrfToken } from './api';
import { handleApiError } from './utils/handleApiError';
import { LANGUAGE_OPTIONS } from './i18n';
import { AppProvider } from './context/AppContext';
import LandingSection from './components/LandingSection';
import AuthSection from './components/AuthSection';
import SearchSection from './components/SearchSection';
import ExploreDiscoverySection from './components/ExploreDiscoverySection';
import LanguageMenu from './components/LanguageMenu';
import PersonalHubSection from './components/PersonalHubSection';
import OpportunityFeedSection from './components/OpportunityFeedSection';
import OpportunityDetailSection from './components/OpportunityDetailSection';
import RadarSection from './components/RadarSection';
import AITravelSection from './components/AITravelSection';
import SectionAccessGate from './components/SectionAccessGate';
import UpgradeFlowModal from './features/upgrade-flow/ui/UpgradeFlowModal';
import CookieBanner from './components/CookieBanner';
import { bootstrapConsentPolicy, clearConsent, isConsentGiven } from './utils/cookieConsent';
import { readLocalStorageItem, removeLocalStorageItem, writeLocalStorageItem } from './utils/browserStorage';
import AdminBackofficeSection from './features/admin-dashboard/ui/AdminBackofficeSection';
import AdminBackofficeLoginSection from './features/admin-dashboard/ui/AdminBackofficeLoginSection';
import { localizeClusterDisplayName } from './utils/localizePlace';
import {
  getErrorTrackingData,
  readStoredPostAuthContext,
  useAppDataOperations,
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
  useUpgradeFlowController
} from './features/app-shell';
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
  DEFAULT_MULTI_CITY_RETRY_POLICY,
  addMultiCitySegment,
  buildMultiCitySearchPayload,
  createDefaultMultiCitySegments,
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
  readRememberedEmail,
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
  readStoredUserPlan,
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

const AdvancedAnalyticsSection = lazy(() => import('./components/AdvancedAnalyticsSection'));
const prefetchAdvancedAnalyticsChunk = () => import('./components/AdvancedAnalyticsSection');

function InfoTip({ text }) {
  return (
    <span className="info-tip" tabIndex={0} aria-label={text}>
      i
      <span className="info-tip-box">{text}</span>
    </span>
  );
}

const defaultFrom = format(addDays(new Date(), 14), 'yyyy-MM-dd');
const defaultTo = format(addDays(new Date(), 18), 'yyyy-MM-dd');

const defaultSearch = {
  origin: 'MXP',
  tripType: 'round_trip',
  periodPreset: 'custom',
  region: 'all',
  connectionType: 'all',
  maxStops: '2',
  travelTime: 'all',
  minComfortScore: '',
  country: '',
  destinationQuery: '',
  dateFrom: defaultFrom,
  dateTo: defaultTo,
  cheapOnly: true,
  maxBudget: '',
  travellers: 1,
  cabinClass: 'economy',
  mood: 'relax',
  climatePreference: 'indifferent',
  pace: 'normal',
  avoidOvertourism: false,
  packageCount: 3,
  aiProvider: 'none'
};

const MOOD_OPTIONS = ['relax', 'natura', 'party', 'cultura', 'avventura'];
const CLIMATE_PREF_OPTIONS = ['warm', 'mild', 'cold', 'indifferent'];

const QUICK_INTAKE_PROMPTS_I18N = {
  en: [
    'I have 400 EUR, flying from FCO, warm weather, 4 days, slow pace.',
    'From MXP with 550 EUR, I want nature and low crowding for 5 days.',
    'Party weekend from BGY with 300 EUR, quick trip.',
    '7 days culture trip from FCO with 700 EUR budget and mild weather.'
  ],
  it: [
    'Ho 400 euro, parto da FCO, voglio caldo, 4 giorni, ritmo slow.',
    'Parto da MXP con 550 euro, voglio natura e poca folla per 5 giorni.',
    'Weekend party da 300 euro da BGY, viaggio veloce.',
    '7 giorni cultura da FCO con budget 700 euro, clima temperato.'
  ]
};

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

  useEffect(() => {
    setIntakeMessages((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      let hasChanged = false;
      const next = prev.map((entry) => {
        if (entry?.id !== 'assistant-welcome') return entry;
        const localizedText = t('aiAssistantWelcome');
        if (entry.text === localizedText) return entry;
        hasChanged = true;
        return { ...entry, text: localizedText };
      });
      return hasChanged ? next : prev;
    });
  }, [language, i18nPack]);

  const resolveApiError = (error) => handleApiError(error, { t });

  const [config, setConfig] = useState({
    origins: [],
    regions: ['all', 'eu', 'asia', 'america', 'oceania'],
    cabins: ['economy', 'premium', 'business'],
    connectionTypes: ['all', 'direct', 'with_stops'],
    travelTimes: ['all', 'day', 'night'],
    countriesByRegion: {}
  });
  const originCityByIata = useMemo(() => {
    const map = new Map();
    for (const origin of Array.isArray(config.origins) ? config.origins : []) {
      const code = String(origin?.code || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) continue;
      const city = String(origin?.city || '').trim();
      if (city) {
        map.set(code, city);
        continue;
      }
      const label = String(origin?.label || '').trim();
      const fallback = label.replace(/\s*\([A-Za-z]{3}\)\s*$/, '').trim();
      if (fallback) map.set(code, fallback);
    }
    return map;
  }, [config.origins]);
  const resolveCityName = useCallback(
    (value, fallbackIata = '') => {
      const text = String(value || '').trim();
      if (text && !/^[A-Za-z]{3}$/.test(text)) {
        return text.replace(/\s*\([A-Za-z]{3}\)\s*$/, '').trim();
      }
      const code = String(fallbackIata || text || '')
        .trim()
        .toUpperCase();
      if (/^[A-Z]{3}$/.test(code)) {
        return originCityByIata.get(code) || code;
      }
      return text;
    },
    [originCityByIata]
  );

  const [token, setToken] = useState(COOKIE_SESSION_TOKEN);
  const [user, setUser] = useState(null);
  const [localUserPlan, setLocalUserPlan] = useState(() => readStoredUserPlan());
  const [authMode, setAuthMode] = useState('login');
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [authView, setAuthView] = useState('options');
  const [rememberMe, setRememberMe] = useState(true);
  const [authMfa, setAuthMfa] = useState({ ticket: '', code: '', expiresAt: '' });
  const [oauthLoading, setOauthLoading] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  const [searchForm, setSearchForm] = useState(defaultSearch);
  const [searchMode, setSearchMode] = useState('single');
  const [multiCitySegments, setMultiCitySegments] = useState(() => createDefaultMultiCitySegments(defaultFrom, defaultTo));
  const [multiCityValidation, setMultiCityValidation] = useState(() =>
    validateMultiCityForm({ segments: createDefaultMultiCitySegments(defaultFrom, defaultTo) })
  );
  const [multiCityRetryVisible, setMultiCityRetryVisible] = useState(false);
  const [uiMode, setUiMode] = useState('simple');
  const [searchError, setSearchError] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [intakePrompt, setIntakePrompt] = useState('');
  const [intakeInfo, setIntakeInfo] = useState('');
  const [intakeMessages, setIntakeMessages] = useState([
    {
      id: 'assistant-welcome',
      role: 'assistant',
      text: t('aiAssistantWelcome')
    }
  ]);
  const [searchResult, setSearchResult] = useState({ meta: null, alerts: [], flights: [] });
  const [searchHistory, setSearchHistory] = useState([]);
  const [searchSortBy, setSearchSortBy] = useState('saving');
  const [compareIds, setCompareIds] = useState([]);

  const [watchlist, setWatchlist] = useState([]);
  const [watchlistError, setWatchlistError] = useState('');

  const [subscriptions, setSubscriptions] = useState([]);
  const [subMessage, setSubMessage] = useState('');
  const [alertDraftById, setAlertDraftById] = useState({});

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifError, setNotifError] = useState('');
  const [securityInfo, setSecurityInfo] = useState({ isLocked: false, lockUntil: null, failedLoginCount: 0 });
  const [securityEvents, setSecurityEvents] = useState([]);
  const [securityError, setSecurityError] = useState('');
  const [securityAudit, setSecurityAudit] = useState(null);
  const [securityAuditLoading, setSecurityAuditLoading] = useState(false);
  const [securityAuditError, setSecurityAuditError] = useState('');
  const [featureAudit, setFeatureAudit] = useState(null);
  const [featureAuditLoading, setFeatureAuditLoading] = useState(false);
  const [featureAuditError, setFeatureAuditError] = useState('');
  const [outboundReport, setOutboundReport] = useState(null);
  const [outboundReportError, setOutboundReportError] = useState('');
  const [outboundReportLoading, setOutboundReportLoading] = useState(false);
  const [outboundCsvLoading, setOutboundCsvLoading] = useState(false);
  const [monetizationReport, setMonetizationReport] = useState(null);
  const [monetizationLoading, setMonetizationLoading] = useState(false);
  const [monetizationError, setMonetizationError] = useState('');
  const [billingPricing, setBillingPricing] = useState({
    free: { monthlyEur: 0 },
    pro: { monthlyEur: 7 },
    creator: { monthlyEur: 19 },
    updatedAt: null,
    lastCostCheckAt: null
  });
  const [billingPricingLoading, setBillingPricingLoading] = useState(false);
  const [billingPricingError, setBillingPricingError] = useState('');
  const [funnelReport, setFunnelReport] = useState(null);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [funnelError, setFunnelError] = useState('');
  const [destinationInsights, setDestinationInsights] = useState({});
  const [insightLoadingByFlight, setInsightLoadingByFlight] = useState({});
  const [insightErrorByFlight, setInsightErrorByFlight] = useState({});

  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [countrySuggestions, setCountrySuggestions] = useState([]);
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
  const [showCountrySuggestions, setShowCountrySuggestions] = useState(false);
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [mfaActionCode, setMfaActionCode] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showLandingPage, setShowLandingPage] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [premiumBillingCycle, setPremiumBillingCycle] = useState('annual');
  const [onboardingDraft, setOnboardingDraft] = useState({
    intent: 'deals',
    budget: '',
    preferredRegion: 'all',
    directOnly: false
  });
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [pendingPostAuthAction, setPendingPostAuthAction] = useState(null);
  const [pendingPostAuthSection, setPendingPostAuthSection] = useState(null);
  const [activeMainSection, setActiveMainSection] = useState('home');
  const [adminRouteRequested, setAdminRouteRequested] = useState(() => {
    if (typeof window === 'undefined') return false;
    const path = String(window.location.pathname || '').trim().toLowerCase();
    return path === '/admin' || path === '/backoffice';
  });
  const [adminDashboardReport, setAdminDashboardReport] = useState(null);
  const [adminDashboardLoading, setAdminDashboardLoading] = useState(false);
  const [adminDashboardError, setAdminDashboardError] = useState('');
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
  const [opportunityFeed, setOpportunityFeed] = useState([]);
  const [opportunityFeedAccess, setOpportunityFeedAccess] = useState(null);
  const [destinationClusters, setDestinationClusters] = useState([]);
  const [selectedOpportunityCluster, setSelectedOpportunityCluster] = useState('');
  const [destinationClustersLoading, setDestinationClustersLoading] = useState(false);
  const [destinationClustersError, setDestinationClustersError] = useState('');
  const [opportunityFeedLoading, setOpportunityFeedLoading] = useState(false);
  const [opportunityFeedError, setOpportunityFeedError] = useState('');
  const [opportunityDetail, setOpportunityDetail] = useState(null);
  const [opportunityDetailLoading, setOpportunityDetailLoading] = useState(false);
  const [opportunityDetailError, setOpportunityDetailError] = useState('');
  const [opportunityDetailUpgradePrompt, setOpportunityDetailUpgradePrompt] = useState(null);
  const [radarDraft, setRadarDraft] = useState({
    originAirports: '',
    favoriteDestinations: '',
    favoriteCountries: '',
    budgetCeiling: '',
    preferredTravelMonths: ''
  });
  const [radarSaving, setRadarSaving] = useState(false);
  const [radarMessage, setRadarMessage] = useState('');
  const [radarError, setRadarError] = useState('');
  const [radarMatches, setRadarMatches] = useState([]);
  const [radarMatchesLoading, setRadarMatchesLoading] = useState(false);
  const [radarMatchesError, setRadarMatchesError] = useState('');
  const [radarFollows, setRadarFollows] = useState([]);
  const [radarFollowsLoading, setRadarFollowsLoading] = useState(false);
  const [radarFollowsError, setRadarFollowsError] = useState('');
  const [opportunityPipelineStatus, setOpportunityPipelineStatus] = useState(null);
  const [opportunityPipelineStatusLoading, setOpportunityPipelineStatusLoading] = useState(false);
  const [opportunityPipelineStatusError, setOpportunityPipelineStatusError] = useState('');
  const [aiTravelPrompt, setAiTravelPrompt] = useState('');
  const [aiTravelLoading, setAiTravelLoading] = useState(false);
  const [aiTravelResult, setAiTravelResult] = useState(null);
  const [aiTravelError, setAiTravelError] = useState('');
  const [exploreDiscoveryInput, setExploreDiscoveryInput] = useState({
    origin: 'MXP',
    budgetMax: '450',
    limit: 24
  });
  const [exploreBudgetItems, setExploreBudgetItems] = useState([]);
  const [exploreBudgetLoading, setExploreBudgetLoading] = useState(false);
  const [exploreBudgetError, setExploreBudgetError] = useState('');
  const [exploreMapPoints, setExploreMapPoints] = useState([]);
  const [exploreMapLoading, setExploreMapLoading] = useState(false);
  const [exploreMapError, setExploreMapError] = useState('');
  const [exploreSelectedDestination, setExploreSelectedDestination] = useState('');

  // Runtime capability matrix — fetched once from the public /api/system/capabilities endpoint.
  // Used to gate UI copy and features based on what is actually configured server-side.
  const [systemCapabilities, setSystemCapabilities] = useState(null);
  useEffect(() => {
    api.systemCapabilities().then((data) => setSystemCapabilities(data?.capabilities || null)).catch(() => {});
  }, []);

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

  const notifiedIdsRef = useRef(new Set());

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

  useEffect(() => {
    const q = canonicalDestinationQuery(searchForm.destinationQuery);
    if (q.length < 1) return setDestinationSuggestions([]);
    const id = setTimeout(() => {
      const canonicalCountry = canonicalCountryFilter(searchForm.country);
      const queryToken = normalizeSuggestionToken(q);
      api.suggestions({ q, region: searchForm.region, country: canonicalCountry, limit: 12 })
        .then((destinationRes) => {
          const destinationItems = Array.isArray(destinationRes?.items)
            ? destinationRes.items
                .map((item) => {
                  const value = String(item?.value || '').trim();
                  const baseLabel = String(item?.label || value).trim();
                  const type = String(item?.type || 'destination').trim().toLowerCase();
                  // Keep destination field focused on cities/airports only.
                  if (type === 'country') return null;
                  const label = localizeDestinationSuggestionLabel(baseLabel);
                  if (!value || !label) return null;

                  const normalizedLabel = normalizeSuggestionToken(label);
                  const normalizedValue = normalizeSuggestionToken(value);
                  const fullStarts =
                    normalizedLabel.startsWith(queryToken) ||
                    normalizedValue.startsWith(queryToken);
                  const tokenStarts = `${normalizedLabel} ${normalizedValue}`
                    .split(' ')
                    .filter(Boolean)
                    .some((token) => token.startsWith(queryToken));
                  const partialContains =
                    queryToken.length >= 4 &&
                    (normalizedLabel.includes(queryToken) || normalizedValue.includes(queryToken));

                  if (!fullStarts && !tokenStarts && !partialContains) return null;
                  const relevanceScore = fullStarts ? 3 : tokenStarts ? 2 : 1;
                  return { type, value, label, relevanceScore };
                })
                .filter(Boolean)
                .sort((a, b) => {
                  if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
                  return a.label.localeCompare(b.label, language);
                })
            : [];

          const merged = [];
          const seen = new Set();
          for (const item of destinationItems) {
            const cityToken = resolveSuggestionCityToken(item);
            const normalizedValue = normalizeSuggestionToken(item.value);
            const dedupeKey = cityToken ? `city:${cityToken}` : `value:${normalizedValue}`;
            if (!dedupeKey || dedupeKey.endsWith(':')) continue;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            merged.push({
              type: item.type,
              value: item.value,
              label: item.label
            });
            if (merged.length >= 10) break;
          }
          setDestinationSuggestions(merged);
        })
        .catch(() => setDestinationSuggestions([]));
    }, 120);
    return () => clearTimeout(id);
  }, [searchForm.destinationQuery, searchForm.region, searchForm.country, language]);

  useEffect(() => {
    const q = searchForm.country.trim();
    if (q.length < 1) return setCountrySuggestions([]);
    const id = setTimeout(() => {
      const canonicalQuery = canonicalCountryFilter(q) || q;
      api
        .countries({ q: canonicalQuery, limit: 15 })
        .then((r) =>
          setCountrySuggestions(
            (r.items || []).map((item) => {
              const canonicalName = String(item?.name || '').trim();
              const iso2 = String(item?.cca2 || '').trim();
              const localizedName = localizeCountryByIso2(iso2, canonicalName, language);
              return {
                ...item,
                localizedName,
                localizedLabel: localizedName
              };
            })
          )
        )
        .catch(() => setCountrySuggestions([]));
    }, 160);
    return () => clearTimeout(id);
  }, [searchForm.country, language]);

  useEffect(() => {
    if (!showAccountPanel) return undefined;
    loadBillingPricing(true, true);
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && user) setShowAccountPanel(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showAccountPanel, user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get('oauth');
    const reason = params.get('reason');
    if (oauth === 'error') {
      setAuthError(reason ? `OAuth error: ${reason}` : 'OAuth sign-in failed.');
      setShowAccountPanel(true);
    }
    if (oauth === 'success') {
      setToken(COOKIE_SESSION_TOKEN);
      setShowAccountPanel(false);
      persistPostAuthAction('enter_app');
      const hasStoredSection = Boolean(readStoredPostAuthContext().section);
      if (!hasStoredSection) persistPostAuthSection('explore');
    }
    if (oauth === 'error' || oauth === 'success') {
      params.delete('oauth');
      params.delete('reason');
      params.delete('provider');
      const cleaned = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', cleaned);
    }
  }, []);

  useEffect(() => {
    const { pendingAction: pending, authMode: storedMode, authView: storedView, section: storedSection } = readStoredPostAuthContext();
    if (pending) setPendingPostAuthAction(pending);
    if (storedMode === 'login' || storedMode === 'register') setAuthMode(storedMode);
    if (storedView === 'options' || storedView === 'email') setAuthView(storedView);
    if (storedSection) setPendingPostAuthSection(String(storedSection).trim().toLowerCase());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedEmail = readRememberedEmail();
      if (savedEmail) {
        setAuthForm((prev) => ({ ...prev, email: savedEmail }));
        setRememberMe(true);
      }
    } catch {
      // Ignore storage access issues (e.g. private mode restrictions).
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const landingClass = 'landing-dark-active';
    const appClass = 'app-dark-active';
    document.body.classList.toggle(landingClass, showLandingPage && darkMode);
    document.body.classList.toggle(appClass, !showLandingPage && darkMode);
    return () => {
      document.body.classList.remove(landingClass);
      document.body.classList.remove(appClass);
    };
  }, [showLandingPage, darkMode]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const scrollLockClass = 'app-scroll-lock';
    const shouldLockScroll = showAccountPanel || showOnboarding;
    document.body.classList.toggle(scrollLockClass, shouldLockScroll);
    return () => {
      document.body.classList.remove(scrollLockClass);
    };
  }, [showAccountPanel, showOnboarding]);

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
  const canRunAiTravelMvp = isAuthenticated;
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromPath = () => {
      const path = String(window.location.pathname || '').trim().toLowerCase();
      const isAdminPath = path === '/admin' || path === '/backoffice';
      setAdminRouteRequested(isAdminPath);
      if (isAdminPath) {
        setShowLandingPage(false);
        setActiveMainSection('admin');
        if (!user) {
          setShowAccountPanel(false);
          setAuthMode('login');
          setAuthView('email');
          setAuthError('');
        } else {
          setShowAccountPanel(false);
        }
      } else if (activeMainSection === 'admin') {
        setActiveMainSection('explore');
      }
    };
    syncFromPath();
    window.addEventListener('popstate', syncFromPath);
    return () => window.removeEventListener('popstate', syncFromPath);
  }, [activeMainSection, user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isAdvancedMode) return;
    const connection = navigator?.connection || navigator?.mozConnection || navigator?.webkitConnection;
    const saveData = Boolean(connection?.saveData);
    const effectiveType = String(connection?.effectiveType || '').toLowerCase();
    if (saveData || effectiveType.includes('2g')) return;

    let cancelled = false;
    let timeoutId = null;
    let idleId = null;
    const warmup = () => {
      if (cancelled) return;
      prefetchAdvancedAnalyticsChunk().catch(() => {});
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(warmup, { timeout: 4000 });
    } else {
      timeoutId = window.setTimeout(warmup, 1200);
    }

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      if (idleId && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId);
    };
  }, [isAdvancedMode]);
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
      defaultSearch
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
    setIntakePrompt
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
    setIntakePrompt
  });
  const {
    upgradeFlowState,
    upgradePlanContent,
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
    setOpportunityDetailUpgradePrompt
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

  function applyLocalPlanChange(nextPlanType) {
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
  }

  function saveRecentItineraryWithPlanGate(item) {
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

  function activateFreePlan() {
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

  function viewDealsForTrackedRoute(slug) {
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

  function handleUntrackedRouteFromHub(slug) {
    const normalizedSlug = String(slug || '').trim().toLowerCase();
    if (!normalizedSlug) return;
    if (String(selectedOpportunityCluster || '').trim().toLowerCase() === normalizedSlug) {
      setSelectedOpportunityCluster('');
    }
  }

  function handleClearLocalTravelData() {
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

  function handleTrackedRoutesLimitReached(meta) {
    const usage = evaluateUsageLimit(meta?.used, meta?.limit ?? planEntitlements.trackedRoutesLimit);
    const content = getUpgradeTriggerContent(userPlanType, 'tracked_routes_limit', {
      used: usage.used,
      limit: usage.limit
    });
    setSubMessage(content.message);
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


  const landingNavItems = [
    { id: 'landing-chiamo', label: t('navChiSiamo') },
    { id: 'landing-pricing', label: t('navPricing') },
    { id: 'landing-contacts', label: t('navContacts') }
  ];

  const landingFeatureCards = [
    { color: 'blue', icon: '\u{1F50D}', title: t('landingFeature1Title'), desc: t('landingFeature1Desc'), step: '01' },
    { color: 'teal', icon: '\u{1F514}', title: t('landingFeature2Title'), desc: t('landingFeature2Desc'), step: '02' },
    { color: 'purple', icon: '\u{1F9ED}', title: t('landingFeature3Title'), desc: t('landingFeature3Desc'), step: '03' }
  ];

  const landingValueCards = [
    { icon: '\u{1F4B8}', title: t('landingChiSiamoValue1'), desc: t('landingChiSiamoValue1Desc') },
    { icon: '\u{1F512}', title: t('landingChiSiamoValue2'), desc: t('landingChiSiamoValue2Desc') },
    { icon: '\u{1F680}', title: t('landingChiSiamoValue3'), desc: t('landingChiSiamoValue3Desc') }
  ];

  const landingPricingPlans = [
    {
      id: 'free',
      name: t('landingPricingFreeName') || 'Free',
      amountText: t('landingPricingFreePrice') || 'Free',
      desc: t('landingPricingFreeDesc') || 'Perfect for occasional travellers',
      features: [t('landingPricingFeatureFree1'), t('landingPricingFeatureFree2'), t('landingPricingFeatureFree3')],
      monthlyBillingNote: 'Always free',
      annualBillingNote: 'Always free',
      ctaClassName: 'landing-plan-cta ghost',
      ctaLabel: t('landingPricingCtaFree'),
      onClick: () => setShowLandingPage(false),
      featured: false
    },
    {
      id: 'pro',
      name: t('landingPricingProName') || 'Pro',
      amount: formatEur(7),
      monthlyAmount: formatEur(7),
      annualAmount: formatEur(4.92),
      annualDiscountTag: 'Save 25 EUR/year',
      currency: 'EUR',
      period: t('landingPricingMonthly'),
      desc: t('landingPricingProDesc') || 'For regular travellers',
      features: [t('landingPricingFeaturePro1'), t('landingPricingFeaturePro2'), t('landingPricingFeaturePro3'), t('landingPricingFeaturePro4'), t('landingPricingFeaturePro5')],
      monthlyBillingNote: 'Billed monthly',
      annualBillingNote: `Billed yearly at EUR ${formatEur(59)}`,
      ctaClassName: 'landing-plan-cta landing-plan-cta-primary',
      ctaLabel: t('landingPricingCtaPro'),
      onClick: () =>
        beginAuthFlow({
          action: 'enter_app',
          authMode: 'register',
          authView: 'options',
          keepLandingVisible: false,
          targetSection: 'premium'
        }),
      featured: true
    },
    {
      id: 'elite',
      name: t('landingPricingEliteName') || t('landingPricingCreatorName') || 'Elite',
      amount: formatEur(19),
      monthlyAmount: formatEur(19),
      annualAmount: formatEur(14),
      annualDiscountTag: 'Save 60 EUR/year',
      currency: 'EUR',
      period: t('landingPricingMonthly'),
      desc: t('landingPricingEliteDesc') || t('landingPricingCreatorDesc') || 'For professionals and analysts',
      features: [t('landingPricingFeatureCreator1'), t('landingPricingFeatureCreator2'), t('landingPricingFeatureCreator3'), t('landingPricingFeatureCreator4'), t('landingPricingFeatureCreator5')],
      monthlyBillingNote: 'Billed monthly',
      annualBillingNote: `Billed yearly at EUR ${formatEur(168)}`,
      ctaClassName: 'landing-plan-cta ghost',
      ctaLabel: t('landingPricingCtaElite') || t('landingPricingCtaCreator'),
      onClick: () =>
        beginAuthFlow({
          action: 'enter_app',
          authMode: 'register',
          authView: 'options',
          keepLandingVisible: false,
          targetSection: 'premium'
        }),
      featured: false
    }
  ];

  const landingContactCards = [
    { icon: '\u2709', label: t('landingEmailLabel'), value: 'hello@flightsuite.app', href: 'mailto:hello@flightsuite.app' },
    { icon: '\u{1F4CD}', label: t('landingAddressLabel'), value: t('landingAddressValue') }
  ];

  const premiumPackages = [
    {
      id: 'free',
      badge: 'Starter',
      badgeDetail: 'For first-time users',
      planName: 'FREE',
      subtitle: t('pricingFreeSub'),
      valueTitle: t('pricingFreeFeature1'),
      valueItems: [t('pricingFreeFeature2'), t('pricingFreeFeature3')],
      meterStops: ['3/day', '7/day', '15/day'],
      monthly: {
        discountTag: '',
        legacyPrice: '',
        price: 'EUR 0',
        priceSuffix: '/month',
        billingNote: 'No card required',
        billingSubNote: 'Start immediately and upgrade only when you need more.',
        saveNote: 'Always free.'
      },
      annual: {
        discountTag: '',
        legacyPrice: '',
        price: 'EUR 0',
        priceSuffix: '/month',
        billingNote: 'No annual billing',
        billingSubNote: 'FREE plan stays unchanged across billing cycles.',
        saveNote: 'Always free.'
      },
      compareNote: t('premiumCompareNoteFree') || 'Best for trying the platform with zero risk.',
      included: [t('pricingFreeFeature1'), t('pricingFreeFeature2'), t('pricingFreeFeature3')],
      missing: [t('pricingProFeature2'), t('pricingProFeature3'), t('pricingEliteFeature1')],
      ctaLabel: t('pricingFreeCta'),
      ctaClassName: 'premium-cta premium-cta-light',
      onClick: activateFreePlan,
      cardTestId: 'premium-plan-free',
      ctaTestId: 'premium-switch-free'
    },
    {
      id: 'pro',
      badge: 'Most Popular',
      badgeDetail: 'For regular travelers',
      planName: 'PRO',
      subtitle: t('pricingProSub'),
      valueTitle: t('pricingProFeature1'),
      valueItems: [t('pricingProFeature2'), t('pricingProFeature3')],
      meterStops: ['12', '9', '7'],
      monthly: {
        discountTag: '',
        legacyPrice: '',
        price: 'EUR 7',
        priceSuffix: '/month',
        billingNote: 'Billed monthly',
        billingSubNote: 'Full PRO access with month-to-month flexibility.',
        saveNote: 'Cancel anytime.'
      },
      annual: {
        discountTag: 'UP TO 30% OFF',
        legacyPrice: 'EUR 7',
        price: 'EUR 4.92',
        priceSuffix: '/month',
        billingNote: 'Billed yearly at EUR 59',
        billingSubNote: 'Equivalent to EUR 4.92/month with one annual payment.',
        saveNote: 'Save EUR 25 per year vs monthly.'
      },
      compareNote: t('premiumCompareNotePro') || 'Ideal if you want to monitor prices and act fast.',
      included: [t('pricingProFeature1'), t('pricingProFeature2'), t('pricingProFeature3'), t('pricingProFeature4')],
      missing: [t('pricingEliteFeature1'), t('pricingEliteFeature2'), t('pricingEliteFeature3')],
      ctaLabel: t('pricingProCta'),
      ctaClassName: 'premium-cta',
      onClick: () => upgradeToPremium('premium_page'),
      cardTestId: 'premium-plan-pro',
      ctaTestId: 'premium-upgrade-pro'
    },
    {
      id: 'elite',
      badge: 'Best Value',
      badgeDetail: 'For power workflows',
      planName: 'ELITE',
      subtitle: t('pricingEliteSub'),
      valueTitle: t('pricingEliteFeature1'),
      valueItems: [t('pricingEliteFeature2'), t('pricingEliteFeature3')],
      meterStops: ['29', '24', '21'],
      monthly: {
        discountTag: '',
        legacyPrice: '',
        price: 'EUR 19',
        priceSuffix: '/month',
        billingNote: 'Billed monthly',
        billingSubNote: 'Priority intelligence and advanced planning unlocked.',
        saveNote: 'Priority intelligence unlocked.'
      },
      annual: {
        discountTag: '26% OFF',
        legacyPrice: 'EUR 19',
        price: 'EUR 14',
        priceSuffix: '/month',
        billingNote: 'Billed yearly at EUR 168',
        billingSubNote: 'Equivalent to EUR 14/month when billed annually.',
        saveNote: 'Save EUR 60 per year vs monthly.'
      },
      compareNote: t('premiumCompareNoteElite') || 'For power users who need AI planning and premium depth.',
      included: [t('pricingEliteFeature1'), t('pricingEliteFeature2'), t('pricingEliteFeature3'), t('pricingEliteFeature4')],
      missing: [],
      ctaLabel: t('pricingEliteCta'),
      ctaClassName: 'premium-cta premium-cta-dark',
      onClick: () => chooseElitePlan('premium_page'),
      cardTestId: 'premium-plan-elite',
      ctaTestId: 'premium-upgrade-elite'
    }
  ].map((plan) => {
    const pricing = premiumBillingCycle === 'annual' ? plan.annual : plan.monthly;
    const { monthly, annual, ...basePlan } = plan;
    return {
      ...basePlan,
      ...pricing
    };
  });

  const isAnnualBilling = premiumBillingCycle === 'annual';


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
      <header className="hero">
        <div className="hero-top-row">
          <p className="eyebrow">{t('landingTitle')}</p>
          <nav className="landing-nav hero-controls">
            <button type="button" className="landing-ctrl-btn landing-theme-btn" onClick={() => setDarkMode((prev) => !prev)}>
              {darkMode ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              )}
              <span className="landing-ctrl-label">{darkMode ? 'Dark' : 'Light'}</span>
            </button>
            <LanguageMenu
              language={language}
              setLanguage={setLanguage}
              options={LANGUAGE_OPTIONS}
              title={t('language')}
            />
            {isAuthenticated && !adminRouteRequested ? (
              <button type="button" className="landing-ctrl-btn landing-onboarding-cta" onClick={openOnboardingSetup}>
                {t('onboardingReopenCta')}
              </button>
            ) : null}
            <button
              type="button"
              className="landing-accedi-btn"
              data-testid="header-account-button"
              onClick={() => {
                if (isAuthenticated) {
                  setShowAccountPanel((prev) => !prev);
                  return;
                }
                if (adminRouteRequested) {
                  setAuthMode('login');
                  setAuthView('email');
                  setAuthError('');
                  if (typeof window !== 'undefined') {
                    window.requestAnimationFrame(() => {
                      document.querySelector('[data-testid="admin-backoffice-login"]')?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                      });
                    });
                  }
                  return;
                }
                beginAuthFlow({
                  action: 'enter_app',
                  authMode: 'login',
                  authView: 'email',
                  keepLandingVisible: false,
                  targetSection: 'explore'
                });
              }}
            >
              {isAuthenticated ? user?.name || t('account') : t('signIn')}
            </button>
          </nav>
        </div>
        <div className="app-hero-headline-group">
          <h1>{adminRouteRequested ? 'Admin Backoffice' : t('appTitle')}</h1>
          <p className="hero-sub">
            {adminRouteRequested
              ? 'Private analytics and control room for launch monitoring.'
              : heroSubText}
          </p>
          {!adminRouteRequested ? (
            <p className={`hero-data-source-note${isLiveDataSource ? ' live' : ' synthetic'}`} data-testid="hero-data-source-note">
              {heroDataSourceNote}
            </p>
          ) : null}
        </div>
        {!adminRouteRequested ? (
          <div className="app-hero-cinematic-row">
            <div className="app-hero-cinematic-main">
              <div className="app-hero-pill-row">
                <span className={`app-hero-pill${isLiveDataSource ? ' app-hero-pill-live' : ''}`}>
                  {isLiveDataSource ? 'Live providers connected' : 'Historical intelligence mode'}
                </span>
                <span className="app-hero-pill">{opportunityFeed.length} feed opportunities</span>
                <span className="app-hero-pill">{destinationClusters.length} destination clusters</span>
              </div>
              <div className="item-actions app-hero-direct-actions">
                <button type="button" onClick={() => setActiveMainSection('explore')}>
                  {t('landingHeroCta')}
                </button>
                <button type="button" className="ghost" onClick={() => setActiveMainSection('premium')}>
                  {t('premiumPageTitle')}
                </button>
              </div>
            </div>
            <div className="app-hero-preview-grid">
              <article className="app-hero-preview-card">
                <p className="app-hero-preview-label">Radar snapshots</p>
                <strong className="app-hero-preview-value">{radarMatches.length}</strong>
                <p className="app-hero-preview-copy">{radarSessionActivated ? 'Session active' : 'Activate radar to monitor routes'}</p>
              </article>
              <article className="app-hero-preview-card app-hero-preview-card-accent">
                <p className="app-hero-preview-label">Current plan</p>
                <strong className="app-hero-preview-value">{String(userPlanType || 'free').toUpperCase()}</strong>
                <p className="app-hero-preview-copy">Upgrade when you need deeper intelligence and automation.</p>
              </article>
            </div>
          </div>
        ) : null}
        {!adminRouteRequested ? (
          <div className="app-main-nav">
            <button
              type="button"
              className={activeMainSection === 'home' ? 'tab active' : 'tab'}
              onClick={() => setActiveMainSection('home')}
              data-testid="app-nav-home"
            >
              Home
            </button>
            <button
              type="button"
              className={activeMainSection === 'explore' ? 'tab active' : 'tab'}
              onClick={() => setActiveMainSection('explore')}
              data-testid="app-nav-explore"
            >
              Explore
            </button>
            <button
              type="button"
              className={activeMainSection === 'radar' ? 'tab active' : 'tab'}
              onClick={() => setActiveMainSection('radar')}
              data-testid="app-nav-radar"
            >
              Radar
            </button>
            <button
              type="button"
              className={activeMainSection === 'ai-travel' ? 'tab active' : 'tab'}
              onClick={() => setActiveMainSection('ai-travel')}
              data-testid="app-nav-ai-travel"
            >
              AI Travel
            </button>
            <button
              type="button"
              className={activeMainSection === 'premium' ? 'tab active' : 'tab'}
              onClick={() => setActiveMainSection('premium')}
              data-testid="app-nav-premium"
            >
              Premium
            </button>
          </div>
        ) : null}
      </header>

      {showOnboarding && isAuthenticated ? (
        <div className="account-drawer-backdrop" onClick={() => setShowOnboarding(false)}>
          <aside className="account-drawer" role="dialog" aria-modal="true" aria-label={t('onboardingTitle')} onClick={(e) => e.stopPropagation()}>
            <section className="panel account-panel onboarding-panel">
              <div className="panel-head">
                <h2>{t('onboardingTitle')}</h2>
                <button className="ghost" type="button" onClick={() => setShowOnboarding(false)}>
                  {t('close')}
                </button>
              </div>
              <p className="muted">{t('onboardingSub')}</p>
              <p className="api-usage-note onboarding-tip">{t('aiApiDescriptionShort')}</p>
              <label>
                {t('onboardingIntent')}
                <select value={onboardingDraft.intent} onChange={(e) => setOnboardingDraft((prev) => ({ ...prev, intent: e.target.value }))}>
                  <option value="deals">{t('onboardingDeals')}</option>
                  <option value="family">{t('onboardingFamily')}</option>
                  <option value="business">{t('onboardingBusiness')}</option>
                  <option value="weekend">{t('onboardingWeekend')}</option>
                </select>
              </label>
              <label>
                {t('onboardingBudget')}
                <input type="number" inputMode="numeric" min={0} value={onboardingDraft.budget} onChange={(e) => setOnboardingDraft((prev) => ({ ...prev, budget: e.target.value }))} />
              </label>
              <label>
                {t('onboardingRegion')}
                <select
                  value={onboardingDraft.preferredRegion}
                  onChange={(e) => setOnboardingDraft((prev) => ({ ...prev, preferredRegion: e.target.value }))}
                >
                  {config.regions.map((r) => (
                    <option key={r} value={r}>
                      {regionLabel(r)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={onboardingDraft.directOnly}
                  onChange={(e) => setOnboardingDraft((prev) => ({ ...prev, directOnly: e.target.checked }))}
                />
                {t('onboardingDirect')}
              </label>
              <button type="button" onClick={finishOnboarding} disabled={onboardingSaving}>
                {onboardingSaving ? `${t('finishOnboarding')}...` : t('finishOnboarding')}
              </button>
            </section>
          </aside>
        </div>
      ) : null}

      <AuthSection
        showAccountPanel={(!adminRouteRequested || isAuthenticated) && (showAccountPanel || showAuthGateModal)}
        darkMode={darkMode}
        setShowAccountPanel={setShowAccountPanel}
        logout={logout}
        formatEur={formatEur}
        billingPricing={billingPricing}
        formatPricingDate={formatPricingDate}
        billingPricingLoading={billingPricingLoading}
        loadBillingPricing={loadBillingPricing}
        billingPricingError={billingPricingError}
        upgradeToPremium={() => upgradeToPremium('account_panel')}
        chooseElitePlan={() => chooseElitePlan('account_panel')}
        reopenOnboarding={openOnboardingSetup}
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
      />

      <UpgradeFlowModal
        isOpen={upgradeFlowState.isOpen}
        step={upgradeFlowState.step}
        content={upgradePlanContent}
        currentPlanType={userPlanType}
        comparisonRows={planComparisonRows}
        onClose={closePlanUpgradeFlow}
        onPrimaryAction={submitPlanUpgradeInterest}
        onOpenPremiumSection={openPremiumSectionFromUpgradeFlow}
      />

      {activeMainSection === 'admin' ? (
        !isAuthenticated ? (
          <AdminBackofficeLoginSection
            authForm={authForm}
            authError={authError}
            onEmailChange={(value) => setAuthForm((prev) => ({ ...prev, email: value }))}
            onPasswordChange={(value) => setAuthForm((prev) => ({ ...prev, password: value }))}
            onSubmit={submitAuth}
            data-testid="admin-backoffice-login-section"
          />
        ) : (
          <AdminBackofficeSection
            isAuthorized={isAuthenticated && isAdminUser}
            loading={adminDashboardLoading}
            error={adminDashboardError}
            report={adminDashboardReport}
            onRefresh={loadAdminBackofficeReport}
            onBackToApp={closeAdminBackoffice}
            data-testid="admin-backoffice-section"
          />
        )
      ) : null}

      {activeMainSection === 'home' ? (
        <>
          {isAuthenticated ? (
            <PersonalHubSection
              clusters={destinationClusters}
              language={language}
              planType={userPlanType}
              trackedRoutesLimit={planEntitlements.trackedRoutesLimit}
              savedItinerariesLimit={planEntitlements.savedItinerariesLimit}
              radarMessagingTier={planEntitlements.radarMessagingTier}
              radarSessionActivated={radarSessionActivated}
              onViewDeals={viewDealsForTrackedRoute}
              onUntrackRoute={handleUntrackedRouteFromHub}
              onClearLocalData={handleClearLocalTravelData}
              onOpenItinerary={openSavedHubItinerary}
              onActivateRadar={activateRadarFromHubWithTelemetry}
              onUpgradePro={() => upgradeToPremium('personal_hub_prompt')}
              onUpgradeElite={() => chooseElitePlan('personal_hub_prompt')}
            />
          ) : null}
          <OpportunityFeedSection
            items={opportunityFeed}
            clusters={destinationClusters}
            clustersLoading={destinationClustersLoading}
            clustersError={destinationClustersError}
            selectedCluster={selectedOpportunityCluster}
            loading={opportunityFeedLoading}
            error={opportunityFeedError}
            onRefresh={refreshOpportunityFeedNow}
            onSelectCluster={setSelectedOpportunityCluster}
            onClearCluster={() => setSelectedOpportunityCluster('')}
            onFollowCluster={followDestinationClusterFromFeed}
            onView={openOpportunityDetail}
            onFollow={followOpportunity}
            onAlert={followOpportunity}
            onDiscover={() => setActiveMainSection('explore')}
            onActivateRadar={activateRadarFromFeedWithTelemetry}
            isAuthenticated={isAuthenticated}
            radarSessionActivated={radarSessionActivated}
            onCreateAccount={() =>
              beginAuthFlow({
                action: 'enter_app',
                authMode: 'register',
                authView: 'options',
                keepLandingVisible: false,
                targetSection: 'explore'
              })
            }
            t={t}
            language={language}
            planType={userPlanType}
            trackedRoutesLimit={planEntitlements.trackedRoutesLimit}
            showUpgradePrompt={Boolean(opportunityFeedAccess?.showUpgradePrompt) && userPlanType === 'free'}
            upgradeMessage={t(opportunityFeedAccess?.upgradeMessageKey || 'upgradePromptUnlockAll')}
            onTrackedRoutesLimitReached={handleTrackedRoutesLimitReached}
            onUpgradePro={() => upgradeToPremium('opportunity_feed_prompt')}
            onUpgradeElite={() => chooseElitePlan('opportunity_feed_prompt')}
            dataSource={systemCapabilities?.data_source || 'synthetic'}
          />
          {(opportunityDetailLoading || opportunityDetailError || opportunityDetail) ? (
            <OpportunityDetailSection
              loading={opportunityDetailLoading}
              error={opportunityDetailError}
              detail={opportunityDetail}
              language={language}
              t={t}
              bookingError={opportunityBookingError}
              onClose={() => {
                setOpportunityDetail(null);
                clearOpportunityBookingError();
                setOpportunityDetailUpgradePrompt(null);
              }}
              onFollow={followOpportunity}
              onActivateAlert={followOpportunity}
              onOpenBooking={openOpportunityBooking}
              onViewRelated={openOpportunityDetail}
              upgradePrompt={opportunityDetailUpgradePrompt}
              onUpgradePro={() => upgradeToPremium('opportunity_detail_prompt')}
              onUpgradeElite={() => chooseElitePlan('opportunity_detail_prompt')}
            />
          ) : null}
        </>
      ) : null}

      {activeMainSection === 'radar' ? (
        isAuthenticated ? (
          <RadarSection
            t={t}
            language={language}
            draft={radarDraft}
            setDraft={setRadarDraft}
            saving={radarSaving}
            message={radarMessage}
            error={radarError}
            matches={radarMatches}
            matchesLoading={radarMatchesLoading}
            matchesError={radarMatchesError}
            follows={radarFollows}
            followsLoading={radarFollowsLoading}
            followsError={radarFollowsError}
            suggestedClusters={destinationClusters}
            clustersLoading={destinationClustersLoading}
            clustersError={destinationClustersError}
            pipelineStatus={opportunityPipelineStatus}
            pipelineStatusLoading={opportunityPipelineStatusLoading}
            pipelineStatusError={opportunityPipelineStatusError}
            onRefreshMatches={loadRadarMatches}
            onRefreshFollows={loadRadarFollows}
            onRefreshPipeline={loadOpportunityPipelineStatus}
            onOpenDebug={openOpportunityDebugView}
            onExportDebug={exportOpportunityDebugSnapshot}
            onRemoveFollow={removeRadarFollow}
            onFollowCluster={followDestinationCluster}
            onSave={saveRadarPreferences}
            sessionActivated={radarSessionActivated}
            radarMessagingTier={planEntitlements.radarMessagingTier}
            canUseRadar={canUseRadarPlan}
            token={token}
            onUpgradePro={() => upgradeToPremium('radar_prompt')}
            onUpgradeElite={() => chooseElitePlan('radar_prompt')}
          />
        ) : (
          <SectionAccessGate
            title={t('radarPageTitle')}
            description={t('radarPageAccessDescription')}
            ctaLabel={t('opportunityFeedSoftGateCta')}
            onCta={() => requireSectionLogin('radar')}
          />
        )
      ) : null}

      {activeMainSection === 'ai-travel' ? (
        isAuthenticated ? (
          <>
            <AITravelSection
              t={t}
              language={language}
              prompt={aiTravelPrompt}
              setPrompt={setAiTravelPrompt}
              loading={aiTravelLoading}
              result={aiTravelResult}
              error={aiTravelError}
              onRun={runAiTravelQuery}
              onView={openOpportunityDetail}
              planType={userPlanType}
              canUseAiTravel={canRunAiTravelMvp}
              onUpgradePro={() => upgradeToPremium('ai_travel_prompt')}
              onUpgradeElite={() => chooseElitePlan('ai_travel_prompt')}
            />
            {(opportunityDetailLoading || opportunityDetailError || opportunityDetail) ? (
              <OpportunityDetailSection
                loading={opportunityDetailLoading}
                error={opportunityDetailError}
                detail={opportunityDetail}
                language={language}
                t={t}
                bookingError={opportunityBookingError}
                onClose={() => {
                  setOpportunityDetail(null);
                  clearOpportunityBookingError();
                  setOpportunityDetailUpgradePrompt(null);
                }}
                onFollow={followOpportunity}
                onActivateAlert={followOpportunity}
                onOpenBooking={openOpportunityBooking}
                onViewRelated={openOpportunityDetail}
                upgradePrompt={opportunityDetailUpgradePrompt}
                onUpgradePro={() => upgradeToPremium('opportunity_detail_prompt')}
                onUpgradeElite={() => chooseElitePlan('opportunity_detail_prompt')}
              />
            ) : null}
          </>
        ) : (
          <SectionAccessGate
            title={t('aiTravelPageTitle')}
            description={t('aiTravelPageSubtitle')}
            ctaLabel={t('signInToUseAiTravel')}
            onCta={() => requireSectionLogin('ai-travel')}
          />
        )
      ) : null}

      {activeMainSection === 'premium' ? (
        <div className="ph-shell">
          <section className="ph-panel" data-testid="premium-panel">
            <div className="ph-panel-glow" aria-hidden="true" />
            <div className="ph-head">
              <p className="ph-eyebrow">Premium Access</p>
              <h2 className="ph-title">{t('premiumPageTitle')}</h2>
              <p className="ph-subtitle">{t('premiumPageSubtitle')}</p>
              <div className="ph-cycle-wrap" data-testid="premium-billing-controls">
                <div className={`ph-cycle-pill ph-cycle-pill--${premiumBillingCycle}`} role="radiogroup" aria-label="Billing cycle">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={premiumBillingCycle === 'monthly'}
                    data-testid="premium-billing-monthly"
                    className={`ph-cycle-btn${premiumBillingCycle === 'monthly' ? ' ph-cycle-btn--on' : ''}`}
                    onClick={() => setPremiumBillingCycle('monthly')}
                  >
                    <span>Monthly</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={premiumBillingCycle === 'annual'}
                    data-testid="premium-billing-annual"
                    className={`ph-cycle-btn${premiumBillingCycle === 'annual' ? ' ph-cycle-btn--on' : ''}`}
                    onClick={() => setPremiumBillingCycle('annual')}
                  >
                    <span>Annual</span>
                    <span className="ph-cycle-save-chip">30% off</span>
                  </button>
                  <span className="ph-cycle-pill-active" aria-hidden="true" />
                </div>
                <span className={`ph-off-badge${isAnnualBilling ? ' ph-off-badge--active' : ''}`}>
                  {isAnnualBilling ? 'Annual pricing active - save up to 30%' : 'Switch to annual and save up to 30%'}
                </span>
              </div>
            </div>

            <div className="ph-grid">
              {premiumPackages.map((plan) => (
                <article
                  key={plan.id}
                  className={`ph-card ph-card--${plan.id}${plan.id === 'pro' ? ' ph-card--featured' : ''}`}
                  data-testid={plan.cardTestId}
                >
                  <div className="ph-card-top">
                    {plan.id === 'pro' ? (
                      <p className="ph-top-label ph-top-label--featured">Recommended</p>
                    ) : plan.id === 'elite' ? (
                      <p className="ph-top-label ph-top-label--elite">Best value</p>
                    ) : (
                      <p className="ph-top-label ph-top-label--free">Get started</p>
                    )}
                    <p className="ph-top-caption">{plan.badgeDetail}</p>
                  </div>

                  <div className="ph-card-inner">
                    <div className="ph-name-row">
                      <h3 className="ph-plan-name">{plan.planName}</h3>
                      <span className="ph-plan-badge">{plan.badge}</span>
                      {isAnnualBilling && plan.discountTag ? <span className="ph-disc">{plan.discountTag}</span> : null}
                    </div>
                    <p className="ph-plan-desc">{plan.subtitle}</p>

                    <div className="ph-price-block">
                      <div className="ph-price-row">
                        {plan.legacyPrice ? <span className="ph-old-price">{plan.legacyPrice}</span> : null}
                        <span className="ph-price">{plan.price}</span>
                        <span className="ph-per">{plan.priceSuffix}</span>
                      </div>
                      <p className="ph-billing-note">{plan.billingNote}</p>
                      <p className="ph-billing-sub-note">{plan.billingSubNote}</p>
                    </div>

                    <div className="ph-val-box">
                      <p className="ph-val-headline">{plan.valueTitle}</p>
                      <ul className="ph-val-list">
                        {plan.valueItems.map((item) => (
                          <li key={`${plan.id}-v-${item}`}>{item}</li>
                        ))}
                      </ul>
                      <ul className="ph-meter-stops" aria-hidden="true">
                        {plan.meterStops.map((step, idx) => (
                          <li key={`${plan.id}-m-${step}`} className={idx === 0 ? 'ph-meter-stop--active' : ''}>{step}</li>
                        ))}
                      </ul>
                    </div>

                    <ul className="ph-feats">
                      {plan.included.map((feat) => (
                        <li key={`${plan.id}-i-${feat}`} className="ph-feat ph-feat--yes">
                          <span className="ph-feat-icon">+</span>{feat}
                        </li>
                      ))}
                      {plan.missing.map((feat) => (
                        <li key={`${plan.id}-x-${feat}`} className="ph-feat ph-feat--no">
                          <span className="ph-feat-icon">-</span>{feat}
                        </li>
                      ))}
                    </ul>

                    <div className="ph-card-actions">
                      <button
                        type="button"
                        className={`ph-cta ph-cta--${plan.id}`}
                        onClick={plan.onClick}
                        data-testid={plan.ctaTestId}
                      >
                        <span>{plan.ctaLabel}</span>
                        <span className="ph-cta-arrow" aria-hidden="true">{'->'}</span>
                      </button>
                      <p className="ph-save-line">{plan.saveNote}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <p className="ph-trust">
              {t('premiumTrustNote') || 'No payment is charged in this step. You can switch or cancel anytime.'}
            </p>
          </section>
        </div>
      ) : null}

      {activeMainSection === 'explore' ? (
        <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('explorePageTitle')}</h2>
          {selectedOpportunityCluster ? (
            <button type="button" className="ghost" onClick={() => setSelectedOpportunityCluster('')}>
              {t('exploreClearClusterFilter')}
            </button>
          ) : null}
        </div>
        <p className="muted">{t('explorePageSubtitleExtended')}</p>
        <div className="item-actions explore-cluster-shortcuts">
          {destinationClusters.slice(0, 6).map((cluster) => (
            <button
              key={cluster.slug}
              type="button"
              className={selectedOpportunityCluster === cluster.slug ? 'tab active' : 'tab'}
              onClick={() => {
                setSelectedOpportunityCluster(cluster.slug);
                setActiveMainSection('home');
              }}
            >
              {localizeClusterDisplayName(cluster, language)}
            </button>
          ))}
        </div>
      </section>

      <ExploreDiscoverySection
        t={t}
        language={language}
        dataSource={systemCapabilities?.data_source || 'synthetic'}
        origins={config.origins}
        value={exploreDiscoveryInput}
        onChange={(next) => setExploreDiscoveryInput((prev) => ({ ...prev, ...next }))}
        onSubmit={loadExploreDiscovery}
        loading={exploreBudgetLoading}
        error={exploreBudgetError}
        budgetItems={exploreBudgetItems}
        mapPoints={exploreMapPoints}
        mapLoading={exploreMapLoading}
        mapError={exploreMapError}
        selectedDestination={exploreSelectedDestination}
        onSelectDestination={setExploreSelectedDestination}
        onApplyDestination={applyExploreDestination}
      />

      <SearchSection
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
        config={config}
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
        prefetchAdvancedAnalyticsChunk={prefetchAdvancedAnalyticsChunk}
      />

      {isAdvancedMode ? (
        <Suspense fallback={<section className="panel"><p className="muted">{t('loadReport')}...</p></section>}>
          <AdvancedAnalyticsSection
            t={t}
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
          />
        </Suspense>
      ) : null}

      {!isAdvancedMode && visibleFlights.length > 0 ? (
        <section className="panel search-quick-actions-panel">
          <div className="panel-head">
            <h2>{t('quickActions')}</h2>
          </div>
          <div className="item-actions">
            <button type="button" onClick={saveFirstResult}>
              {t('saveBest')}
            </button>
            <button type="button" className="ghost" onClick={alertFirstResult}>
              {t('alertBest')}
            </button>
          </div>
        </section>
      ) : null}

      {visibleFlights.length > 0 ? (
        <section className="panel search-top-picks-panel">
          <div className="panel-head">
            <h2>{t('topPicks')}</h2>
          </div>
          <div className="middle-grid">
            {cheapestFlight ? (
              <article className="result-card">
                <div>
                  <strong>{t('cheapestNow')}</strong>
                  <p>
                    {resolveCityName(cheapestFlight.destination, cheapestFlight.destinationIata)} | EUR {cheapestFlight.price} | {cheapestFlight.stopLabel}
                  </p>
                  {cheapestFlight.dealLabel ? (
                    <p className={`deal-value-label deal-value-${cheapestFlight.dealLabel}`}>
                      {dealLabelText(t, cheapestFlight.dealLabel)} {cheapestFlight.dealReason ? `- ${cheapestFlight.dealReason}` : ''}
                    </p>
                  ) : null}
                </div>
                <div className="item-actions">
                  <button
                    type="button"
                    data-testid="book-top-pick"
                    onClick={() => handleBookingFromSearchFlight(cheapestFlight, 'top_picks')}
                  >
                    {t('partnerCta')}
                  </button>
                  <button type="button" onClick={() => addToWatchlist(cheapestFlight)}>
                    {t('save')}
                  </button>
                </div>
              </article>
            ) : null}
            {bestValueFlight ? (
              <article className="result-card">
                <div>
                  <strong>{t('bestValue')}</strong>
                  <p>
                    {resolveCityName(bestValueFlight.destination, bestValueFlight.destinationIata)} | {t('savingVs2024')}: EUR {bestValueFlight.savingVs2024} | {bestValueFlight.stopLabel}
                  </p>
                  {bestValueFlight.dealLabel ? (
                    <p className={`deal-value-label deal-value-${bestValueFlight.dealLabel}`}>
                      {dealLabelText(t, bestValueFlight.dealLabel)} {bestValueFlight.dealReason ? `- ${bestValueFlight.dealReason}` : ''}
                    </p>
                  ) : null}
                </div>
                <div className="item-actions">
                  <button
                    type="button"
                    data-testid="book-best-value"
                    onClick={() => handleBookingFromSearchFlight(bestValueFlight, 'top_picks')}
                  >
                    {t('partnerCta')}
                  </button>
                  <button type="button" className="ghost" onClick={() => createAlertForFlight(bestValueFlight)}>
                    {t('alertAtPrice')}
                  </button>
                </div>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="panel search-results-panel">
        <div className="panel-head">
          <h2>{t('results')}</h2>
          {isAdvancedMode ? (
            <label className="sort-pick">
              {t('sortBy')}
              <select value={searchSortBy} onChange={(e) => setSearchSortBy(e.target.value)}>
                <option value="saving">{t('sortSaving')}</option>
                <option value="price">{t('sortPrice')}</option>
                <option value="avg2024">{t('sortAvg2024')}</option>
                <option value="travelScore">{t('sortTravelScore') || `${t('travelScore')} (${t('bestValue')})`}</option>
                <option value="deal">{t('sortDealPriority')}</option>
                <option value="radar">{t('sortRadarPriority')}</option>
              </select>
            </label>
          ) : null}
        </div>
        {searchResult?.meta?.bookability ? (
          <p className="muted">
            {t('searchModeLabel')}: {searchResult.meta.searchMode || t('notAvailable')} | {t('bookabilityLabel')}: {searchResult.meta.bookability}
          </p>
        ) : null}
        {searchResult?.inventory?.providerValidated?.degradedReason ? (
          <p className="muted">
            {t('providerValidationDegradedLabel')}: {String(searchResult.inventory.providerValidated.degradedReason)}
          </p>
        ) : null}

        {searchResult.flights.length === 0 ? <p className="muted">{t('noResults')}</p> : null}
        {bookingHandoffError ? <p className="error" data-testid="booking-handoff-error">{bookingHandoffError}</p> : null}

        <div className="results-grid">
          {visibleFlights.map((flight) => (
            <article key={flight.id} className="result-card" data-testid={`result-card-${flight.id}`}>
              <div>
                <strong>
                  {resolveCityName(flight.origin, flight.origin)} {t('to')} {resolveCityName(flight.destination, flight.destinationIata)}
                </strong>
                <p>
                  EUR {flight.price} | {flight.stopLabel} | {flight.departureTimeLabel} {t('to')} {flight.arrivalTimeLabel} | {flight.durationHours}h | {t('comfort')} {flight.comfortScore}/100
                </p>
                {Number.isFinite(flight.travelScore) ? (
                  <p>
                    <span data-testid={`travel-score-${flight.id}`}>{t('travelScore')} {flight.travelScore}/100</span> | {t('totalEstimated')} EUR {flight.costBreakdown?.total ?? '-'} | {t('climate')} {flight.climateInPeriod?.avgTempC ?? '-'}C | {t('crowding')}{' '}
                    {flight.crowding?.index ?? '-'}
                  </p>
                ) : null}
                {flight.dealLabel ? (
                  <p className={`deal-value-label deal-value-${flight.dealLabel}`} data-testid={`deal-label-${flight.id}`}>
                    {dealLabelText(t, flight.dealLabel)} {flight.dealReason ? `- ${flight.dealReason}` : ''}
                  </p>
                ) : null}
                {flight.radarState ? (
                  <p className={`radar-state-badge radar-state-${flight.radarState}`} data-testid={`radar-badge-${flight.id}`}>
                    {radarStateText(t, flight.radarState)} {flight.radarReason ? `- ${flight.radarReason}` : ''}
                  </p>
                ) : null}
                {Array.isArray(flight.reasons) && flight.reasons.length > 0 ? <p>{flight.reasons.slice(0, 2).join(' | ')}</p> : null}
                {flight.aiWhyNow ? <p>AI: {flight.aiWhyNow}</p> : null}
              </div>
              <div className="item-actions">
                <button
                  type="button"
                  data-testid={`book-result-${flight.id}`}
                  onClick={() => handleBookingFromSearchFlight(flight, 'results')}
                >
                  {t('partnerCta')}
                </button>
                <button type="button" onClick={() => addToWatchlist(flight)}>{t('save')}</button>
                <button type="button" className="ghost" onClick={() => createAlertForFlight(flight)}>{t('alertAtPrice')}</button>
                <button
                  type="button"
                  className={compareIds.includes(flight.id) ? 'tab active' : 'ghost'}
                  onClick={() => toggleCompare(flight.id)}
                >
                  {t('compare')}
                </button>
                <InfoTip text={tt('compare_help')} />
                {isAdvancedMode ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => loadDestinationInsights(flight)}
                  disabled={Boolean(insightLoadingByFlight[flight.id]) || !canUseAiTravelPlan}
                >
                    {insightLoadingByFlight[flight.id] ? t('bestDatesLoading') : t('bestDates')}
                  </button>
                ) : null}
                {isAdvancedMode ? <InfoTip text={tt('best_dates_help')} /> : null}
              </div>
              {isAdvancedMode && insightErrorByFlight[flight.id] ? <p className="error">{insightErrorByFlight[flight.id]}</p> : null}
              {isAdvancedMode && destinationInsights[flight.id]?.windows?.length ? (
                <div className="list-stack">
                  <p className="muted">
                    {t('suggestedDates')} | min EUR {destinationInsights[flight.id].stats?.minPrice ?? '-'} | avg EUR{' '}
                    {destinationInsights[flight.id].stats?.avgPrice ?? '-'}
                  </p>
                  {destinationInsights[flight.id].windows.slice(0, 3).map((windowItem) => (
                    <div key={`${flight.id}-${windowItem.dateFrom}-${windowItem.dateTo}`} className="watch-item">
                      <div>
                        <strong>
                          {windowItem.dateFrom} {t('to')} {windowItem.dateTo}
                        </strong>
                        <p>
                          EUR {windowItem.price} | {t('avg2024Label')} EUR {windowItem.avg2024}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleBookingFromSearchFlight(
                            {
                              ...windowItem,
                              origin: flight.origin,
                              stopCount: flight.stopCount,
                              comfortScore: flight.comfortScore
                            },
                            'insights'
                          )
                        }
                      >
                        {t('partnerCta')}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
        {visibleFlights.length > 0 ? <p className="muted">{t('affiliateDisclosure')}</p> : null}
      </section>

      {comparedFlights.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <h2>{t('comparedFlights')}</h2>
            <button type="button" className="ghost" onClick={() => setCompareIds([])}>
              {t('clearCompare')}
            </button>
          </div>
          <div className="compare-grid">
            {comparedFlights.map((flight) => (
              <article key={flight.id} className="watch-item compare-card">
                <div>
                  <strong>
                    {resolveCityName(flight.destination, flight.destinationIata)}
                  </strong>
                  <p>EUR {flight.price}</p>
                  <p>
                    {flight.stopLabel} | {flight.durationHours}h
                  </p>
                  <p>{t('savingVs2024')}: EUR {flight.savingVs2024}</p>
                  <p>{flight.climate}</p>
                </div>
                <div className="item-actions">
                  <button
                    type="button"
                    onClick={() => handleBookingFromSearchFlight(flight, 'compare')}
                  >
                    {t('partnerCta')}
                  </button>
                  <button type="button" onClick={() => addToWatchlist(flight)}>
                    {t('save')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {isAuthenticated ? (
        <>
          <section className="middle-grid">
            <article className="panel">
              <div className="panel-head">
                <h2>{t('priceAlerts')}</h2>
                <button className="ghost" type="button" onClick={refreshSubscriptions} disabled={!isAuthenticated}>{t('refresh')}</button>
              </div>
              <p className="muted">{t('priceAlertsHelp')}</p>
              {subMessage ? <p className="muted">{subMessage}</p> : null}
              {subscriptions.length === 0 ? <p className="muted">{t('noAlerts')}</p> : null}
              <div className="list-stack">
                {subscriptions.map((s) => {
                  const draft = getAlertDraft(s);
                  return (
                    <div key={s.id} className="watch-item">
                      <div className="alert-row-main">
                        <strong>{t('myAlerts')}</strong>
                        <p>
                          {s.origin} | {regionLabel(s.region)} | {s.scanMode === 'duration_auto' ? `${t('smart')} ${s.stayDays}d` : `EUR ${s.targetPrice}`} |{' '}
                          {connectionLabel(s.connectionType) || t('any')} | {s.enabled ? t('on') : t('off')}
                        </p>
                        {isAdvancedMode ? (
                          <details className="advanced-block" open>
                            <summary>{t('editAlert')}</summary>
                            <div className="alert-inline-grid">
                              <label>
                                {t('eurTarget')}
                                <input
                                  type="number"
                                  min={0}
                                  value={draft.targetPrice}
                                  onChange={(e) => updateAlertDraft(s.id, { targetPrice: e.target.value })}
                                  placeholder={t('emptyAuto')}
                                />
                              </label>
                              <label>
                                {t('stayDays')}
                                <input type="number" min={2} max={30} value={draft.stayDays} onChange={(e) => updateAlertDraft(s.id, { stayDays: e.target.value })} />
                              </label>
                              <label>
                                {t('travellers')}
                                <input
                                  type="number"
                                  min={1}
                                  max={9}
                                  value={draft.travellers}
                                  onChange={(e) => updateAlertDraft(s.id, { travellers: e.target.value })}
                                />
                              </label>
                              <label>
                                {t('cabin')}
                                <select value={draft.cabinClass} onChange={(e) => updateAlertDraft(s.id, { cabinClass: e.target.value })}>
                                  {config.cabins.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="check-row">
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft.cheapOnly)}
                                  onChange={(e) => updateAlertDraft(s.id, { cheapOnly: e.target.checked })}
                                />
                                {t('dealsOnly')}
                              </label>
                            </div>
                            <button className="ghost" type="button" onClick={() => saveSubscriptionEdit(s)}>
                              {t('saveChanges')}
                            </button>
                          </details>
                        ) : null}
                      </div>
                      <div className="item-actions">
                        <button className="ghost" type="button" onClick={() => toggleSubscriptionEnabled(s)}>
                          {s.enabled ? t('disableAlert') : t('enableAlert')}
                        </button>
                        <button className="ghost" type="button" onClick={() => deleteSubscription(s.id)}>
                          {t('remove')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <h2>{t('notifications')} ({unreadCount})</h2>
                <div className="item-actions">
                  <button className="ghost" type="button" onClick={enableBrowserNotifications}>{t('enableBrowser')}</button>
                  <button className="ghost" type="button" onClick={markAllRead} disabled={!isAuthenticated}>{t('markAllRead')}</button>
                </div>
              </div>
              {notifError ? <p className="error">{notifError}</p> : null}
              {notifications.length === 0 ? <p className="muted">{t('noNotifications')}</p> : null}
              <div className="list-stack">
                {notifications.map((n) => (
                  <div key={n.id} className={n.readAt ? 'watch-item muted-item' : 'watch-item'}>
                    <div>
                      <strong>{n.title}</strong>
                      <p>{n.message}</p>
                    </div>
                    {!n.readAt ? <button className="ghost" type="button" onClick={() => markNotificationRead(n.id)}>{t('markRead')}</button> : null}
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="middle-grid">
            <article className="panel">
              <div className="panel-head">
                <h2>{t('watchlist')}</h2>
                <button className="ghost" type="button" onClick={refreshWatchlist} disabled={!isAuthenticated}>{t('refresh')}</button>
              </div>
              <p className="muted">{t('watchlistHelp')}</p>
              {watchlistError ? <p className="error">{watchlistError}</p> : null}
              {watchlist.length === 0 ? <p className="muted">{t('emptyWatchlist')}</p> : null}
              <div className="list-stack">
                {watchlist.map((item) => (
                  <div key={item.id} className="watch-item">
                    <div>
                      <strong>{item.destination}</strong>
                      <p>EUR {item.price} | {item.dateFrom} {t('to')} {item.dateTo}</p>
                    </div>
                    <div className="item-actions">
                      <button
                        type="button"
                        onClick={() =>
                          handleBookingFromSearchFlight(
                            {
                              origin: item.flightId?.split('-')?.[0] || searchForm.origin,
                              destinationIata: item.destinationIata,
                              destination: item.destination,
                              dateFrom: item.dateFrom,
                              dateTo: item.dateTo
                            },
                            'watchlist'
                          )
                        }
                      >
                        {t('partnerCta')}
                      </button>
                      <button className="ghost" type="button" onClick={() => removeWatchlistItem(item.id)}>{t('remove')}</button>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : null}
      </>
      ) : null}
    </main>
    </>
    )}
    <CookieBanner t={t} />
    </AppProvider>
  );
}

export default App;

