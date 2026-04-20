import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readStoredUserPlan } from '../../monetization';
import { createDefaultSearchForm, DEFAULT_SEARCH_DATE_FROM, DEFAULT_SEARCH_DATE_TO } from '../domain/app-defaults';
import { createDefaultMultiCitySegments, validateMultiCityForm } from '../../multi-city';

const DEFAULT_APP_CONFIG = {
  origins: [],
  regions: ['all', 'eu', 'asia', 'america', 'oceania'],
  cabins: ['economy', 'premium', 'business'],
  connectionTypes: ['all', 'direct', 'with_stops'],
  travelTimes: ['all', 'day', 'night'],
  countriesByRegion: {}
};

const DEFAULT_BILLING_PRICING = {
  free: { monthlyEur: 0 },
  pro: { monthlyEur: 12.99 },
  creator: { monthlyEur: 29.99 },
  updatedAt: null,
  lastCostCheckAt: null
};

const DEFAULT_RADAR_DRAFT = {
  originAirports: '',
  favoriteDestinations: '',
  favoriteCountries: '',
  budgetCeiling: '',
  preferredTravelMonths: ''
};

const DEFAULT_EXPLORE_DISCOVERY_INPUT = {
  origin: 'MXP',
  budgetMax: '450',
  limit: 24
};

function createInitialMultiCitySegments() {
  return createDefaultMultiCitySegments(DEFAULT_SEARCH_DATE_FROM, DEFAULT_SEARCH_DATE_TO);
}

export function useAppState({ apiClient, cookieSessionToken, assistantWelcomeText }) {
  const [config, setConfig] = useState(DEFAULT_APP_CONFIG);

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

  const [token, setToken] = useState(cookieSessionToken);
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

  const [searchForm, setSearchForm] = useState(() => createDefaultSearchForm());
  const [searchMode, setSearchMode] = useState('single');
  const [multiCitySegments, setMultiCitySegments] = useState(() => createInitialMultiCitySegments());
  const [multiCityValidation, setMultiCityValidation] = useState(() =>
    validateMultiCityForm({
      segments: createInitialMultiCitySegments()
    })
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
      text: assistantWelcomeText
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
  const [billingPricing, setBillingPricing] = useState(DEFAULT_BILLING_PRICING);
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
  const [radarDraft, setRadarDraft] = useState(DEFAULT_RADAR_DRAFT);
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
  const [exploreDiscoveryInput, setExploreDiscoveryInput] = useState(DEFAULT_EXPLORE_DISCOVERY_INPUT);
  const [exploreBudgetItems, setExploreBudgetItems] = useState([]);
  const [exploreBudgetLoading, setExploreBudgetLoading] = useState(false);
  const [exploreBudgetError, setExploreBudgetError] = useState('');
  const [exploreMapPoints, setExploreMapPoints] = useState([]);
  const [exploreMapLoading, setExploreMapLoading] = useState(false);
  const [exploreMapError, setExploreMapError] = useState('');
  const [exploreSelectedDestination, setExploreSelectedDestination] = useState('');
  const [systemCapabilities, setSystemCapabilities] = useState(null);

  const notifiedIdsRef = useRef(new Set());
  const openPlanUpgradeFlowRef = useRef(null);
  const onLimitReachedRef = useRef(null);

  useEffect(() => {
    apiClient
      .systemCapabilities()
      .then((data) => setSystemCapabilities(data?.capabilities || null))
      .catch(() => {});
  }, [apiClient]);

  return {
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
    setSystemCapabilities,
    notifiedIdsRef,
    openPlanUpgradeFlowRef,
    onLimitReachedRef
  };
}
