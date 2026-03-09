import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { api, COOKIE_SESSION_TOKEN, setCsrfToken } from './api';
import { handleApiError } from './utils/handleApiError';
import { DEFAULT_LANGUAGE_PACK, LANGS, LANGUAGE_OPTIONS, loadLanguagePack } from './i18n';
import { AppProvider } from './context/AppContext';
import LandingSection from './components/LandingSection';
import AuthSection from './components/AuthSection';
import SearchSection from './components/SearchSection';
import LanguageMenu from './components/LanguageMenu';
import OpportunityFeedSection from './components/OpportunityFeedSection';
import OpportunityDetailSection from './components/OpportunityDetailSection';
import RadarSection from './components/RadarSection';
import AITravelSection from './components/AITravelSection';
import SectionAccessGate from './components/SectionAccessGate';

const AdvancedAnalyticsSection = lazy(() => import('./components/AdvancedAnalyticsSection'));
const prefetchAdvancedAnalyticsChunk = () => import('./components/AdvancedAnalyticsSection');

const defaultFrom = format(addDays(new Date(), 14), 'yyyy-MM-dd');
const defaultTo = format(addDays(new Date(), 18), 'yyyy-MM-dd');

const defaultSearch = {
  origin: 'MXP',
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

const REGION_LABELS_I18N = {
  en: { all: 'All Regions', eu: 'Europe', asia: 'Asia', america: 'America', oceania: 'Oceania' },
  it: { all: 'Tutte le aree', eu: 'Europa', asia: 'Asia', america: 'America', oceania: 'Oceania' }
};

const CONNECTION_LABELS_I18N = {
  en: { all: 'Any', direct: 'Direct only', with_stops: 'With stops' },
  it: { all: 'Qualsiasi', direct: 'Solo diretti', with_stops: 'Con scali' }
};

const TRAVEL_TIME_LABELS_I18N = {
  en: { all: 'Any time', day: 'Day flights', night: 'Night flights' },
  it: { all: 'Qualsiasi orario', day: 'Voli diurni', night: 'Voli notturni' }
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

const POST_AUTH_ACTION_STORAGE_KEY = 'flight_post_auth_action';
const POST_AUTH_MODE_STORAGE_KEY = 'flight_post_auth_mode';
const POST_AUTH_VIEW_STORAGE_KEY = 'flight_post_auth_view';

function App() {
  const [language, setLanguage] = useState('it');
  const [i18nPack, setI18nPack] = useState(DEFAULT_LANGUAGE_PACK);
  const isGarbledI18nText = (value) => {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (!text || !text.includes('?')) return false;
    const qCount = (text.match(/\?/g) || []).length;
    const letterCount = (text.match(/[A-Za-z\u00C0-\u024F\u0400-\u04FF]/g) || []).length;
    return qCount >= 2 && letterCount === 0;
  };
  const t = (key) => {
    const override = i18nPack.extra?.[key];
    if (override) return override;
    const localized = i18nPack.messages?.[key];
    if (isGarbledI18nText(localized)) return DEFAULT_LANGUAGE_PACK.messages?.[key] || key;
    return localized || DEFAULT_LANGUAGE_PACK.messages?.[key] || key;
  };
  const tt = (key) => i18nPack.tooltips?.[key] || DEFAULT_LANGUAGE_PACK.tooltips?.[key] || key;
  const regionLabel = (code) => REGION_LABELS_I18N[language]?.[code] || REGION_LABELS_I18N.en[code] || code;
  const connectionLabel = (code) => CONNECTION_LABELS_I18N[language]?.[code] || CONNECTION_LABELS_I18N.en[code] || code;
  const travelTimeLabel = (code) => TRAVEL_TIME_LABELS_I18N[language]?.[code] || TRAVEL_TIME_LABELS_I18N.en[code] || code;
  useEffect(() => {
    if (!LANGS.includes(language)) {
      setLanguage('en');
    }
  }, [language]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem('flight_language');
      if (saved && LANGS.includes(saved) && saved !== language) setLanguage(saved);
    } catch {
      // ignore storage restrictions
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (LANGS.includes(language)) window.localStorage.setItem('flight_language', language);
    } catch {
      // ignore storage restrictions
    }
  }, [language]);

  useEffect(() => {
    setIntakeMessages((prev) => {
      if (!Array.isArray(prev) || prev.length !== 1) return prev;
      if (prev[0]?.id !== 'assistant-welcome') return prev;
      return [{ ...prev[0], text: t('aiAssistantWelcome') }];
    });
  }, [language]);

  useEffect(() => {
    let active = true;
    loadLanguagePack(language)
      .then((pack) => {
        if (active && pack) setI18nPack(pack);
      })
      .catch(() => {
        if (active) setI18nPack(DEFAULT_LANGUAGE_PACK);
      });

    return () => {
      active = false;
    };
  }, [language]);

  const resolveApiError = (error) => handleApiError(error, { t });

  const [config, setConfig] = useState({
    origins: [],
    regions: ['all', 'eu', 'asia', 'america', 'oceania'],
    cabins: ['economy', 'premium', 'business'],
    connectionTypes: ['all', 'direct', 'with_stops'],
    travelTimes: ['all', 'day', 'night'],
    countriesByRegion: {}
  });

  const [token, setToken] = useState(COOKIE_SESSION_TOKEN);
  const [user, setUser] = useState(null);
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
  const [onboardingDraft, setOnboardingDraft] = useState({
    intent: 'deals',
    budget: '',
    preferredRegion: 'all',
    directOnly: false
  });
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [pendingPostAuthAction, setPendingPostAuthAction] = useState(null);
  const [activeMainSection, setActiveMainSection] = useState('home');
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

  function persistPostAuthAction(action) {
    setPendingPostAuthAction(action || null);
    if (typeof window === 'undefined') return;
    try {
      if (action) window.localStorage.setItem(POST_AUTH_ACTION_STORAGE_KEY, String(action));
      else window.localStorage.removeItem(POST_AUTH_ACTION_STORAGE_KEY);
    } catch {
      // Ignore storage restrictions.
    }
  }

  function persistAuthFunnelState({ authMode: nextAuthMode, authView: nextAuthView }) {
    if (typeof window === 'undefined') return;
    try {
      if (nextAuthMode) window.localStorage.setItem(POST_AUTH_MODE_STORAGE_KEY, String(nextAuthMode));
      if (nextAuthView) window.localStorage.setItem(POST_AUTH_VIEW_STORAGE_KEY, String(nextAuthView));
    } catch {
      // Ignore storage restrictions.
    }
  }

  function clearAuthFunnelState() {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(POST_AUTH_MODE_STORAGE_KEY);
      window.localStorage.removeItem(POST_AUTH_VIEW_STORAGE_KEY);
    } catch {
      // Ignore storage restrictions.
    }
  }

  function beginAuthFlow({ action, authMode: nextAuthMode = 'login', authView: nextAuthView = 'options', keepLandingVisible = true } = {}) {
    setShowLandingPage(keepLandingVisible);
    setShowAccountPanel(true);
    setAuthMode(nextAuthMode);
    setAuthView(nextAuthView);
    setAuthError('');
    persistPostAuthAction(action || null);
    persistAuthFunnelState({ authMode: nextAuthMode, authView: nextAuthView });
  }

  function beginSetAlertAuthFlow({ keepLandingVisible = true } = {}) {
    beginAuthFlow({
      action: 'set_alert',
      authMode: 'register',
      authView: 'options',
      keepLandingVisible
    });
  }

  function InfoTip({ text }) {
    return (
      <span className="info-tip" tabIndex={0} aria-label={text}>
        i
        <span className="info-tip-box">{text}</span>
      </span>
    );
  }

  const notifiedIdsRef = useRef(new Set());

  useEffect(() => {
    api
      .config()
      .then((payload) => {
        setConfig(payload);
        setSearchForm((prev) => ({ ...prev, origin: payload.origins[0]?.code || 'MXP' }));
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
    }, 60000);
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
    if (!user || !pendingPostAuthAction) return;
    if (pendingPostAuthAction === 'enter_app') {
      setShowLandingPage(false);
      setShowAccountPanel(false);
      setSubMessage(t('postAuthEnterAppReady'));
    }
    if (pendingPostAuthAction === 'set_alert') {
      setShowLandingPage(false);
      setShowAccountPanel(false);
      setSubMessage(t('postAuthSetAlertHint'));
    }
    persistPostAuthAction(null);
    clearAuthFunnelState();
  }, [user, pendingPostAuthAction]);

  useEffect(() => {
    if (!user) {
      setShowOnboarding(false);
      return;
    }
    setShowOnboarding(!user.onboardingDone);
  }, [user]);

  useEffect(() => {
    const q = searchForm.destinationQuery.trim();
    if (q.length < 2) return setDestinationSuggestions([]);
    const id = setTimeout(() => {
      api
        .suggestions({ q, region: searchForm.region, country: searchForm.country })
        .then((r) => setDestinationSuggestions(r.items || []))
        .catch(() => setDestinationSuggestions([]));
    }, 160);
    return () => clearTimeout(id);
  }, [searchForm.destinationQuery, searchForm.region, searchForm.country]);

  useEffect(() => {
    const q = searchForm.country.trim();
    if (q.length < 1) return setCountrySuggestions([]);
    const id = setTimeout(() => {
      api
        .countries({ q, limit: 15 })
        .then((r) => setCountrySuggestions(r.items || []))
        .catch(() => setCountrySuggestions([]));
    }, 160);
    return () => clearTimeout(id);
  }, [searchForm.country]);

  useEffect(() => {
    if (!showAccountPanel) return undefined;
    loadBillingPricing(true);
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
    if (typeof window === 'undefined') return;
    try {
      const pending = window.localStorage.getItem(POST_AUTH_ACTION_STORAGE_KEY);
      const storedMode = window.localStorage.getItem(POST_AUTH_MODE_STORAGE_KEY);
      const storedView = window.localStorage.getItem(POST_AUTH_VIEW_STORAGE_KEY);
      if (pending) setPendingPostAuthAction(pending);
      if (storedMode === 'login' || storedMode === 'register') setAuthMode(storedMode);
      if (storedView === 'options' || storedView === 'email') setAuthView(storedView);
    } catch {
      // Ignore storage restrictions.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedEmail = window.localStorage.getItem('remembered_email') || '';
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

  const isAuthenticated = Boolean(user);
  const userPlanType = useMemo(() => {
    if (!user) return 'free';
    const raw = String(user.planType || user.plan_type || '').trim().toLowerCase();
    if (raw === 'elite' || raw === 'creator') return 'elite';
    if (raw === 'pro') return 'pro';
    if (raw === 'free') return 'free';
    return user.isPremium ? 'pro' : 'free';
  }, [user]);
  const canUseRadarPlan = userPlanType === 'pro' || userPlanType === 'elite';
  const canUseAiTravelPlan = userPlanType === 'elite';
  const isMfaChallengeActive = Boolean(authMfa.ticket);
  const isAdvancedMode = uiMode === 'advanced';
  const showAuthGateModal = false;

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
  const heroSubText = t('landingHeroEyebrow');
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
  }, [searchResult.meta, language]);

  const visibleFlights = useMemo(() => {
    const items = [...searchResult.flights];
    if (searchSortBy === 'price') items.sort((a, b) => a.price - b.price || b.savingVs2024 - a.savingVs2024);
    else if (searchSortBy === 'avg2024') items.sort((a, b) => a.avg2024 - b.avg2024 || a.price - b.price);
    else items.sort((a, b) => b.savingVs2024 - a.savingVs2024 || a.price - b.price);
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

  async function loadOpportunityFeed() {
    setOpportunityFeedLoading(true);
    setOpportunityFeedError('');
    try {
      const payload = await api.opportunityFeed(token, { limit: 24, cluster: selectedOpportunityCluster || undefined });
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

  async function loadOpportunityClusters() {
    setDestinationClustersLoading(true);
    setDestinationClustersError('');
    try {
      const payload = await api.opportunityClusters(token, { limit: 12 });
      setDestinationClusters(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      setDestinationClusters([]);
      setDestinationClustersError(resolveApiError(error));
    } finally {
      setDestinationClustersLoading(false);
    }
  }

  async function openOpportunityDetail(opportunityId) {
    if (!opportunityId) return;
    setOpportunityDetailLoading(true);
    setOpportunityDetailError('');
    try {
      const payload = await api.opportunityDetail(token, opportunityId);
      setOpportunityDetail(payload);
    } catch (error) {
      setOpportunityDetail(null);
      setOpportunityDetailError(resolveApiError(error));
    } finally {
      setOpportunityDetailLoading(false);
    }
  }

  async function followOpportunity(opportunityId) {
    if (!isAuthenticated) {
      beginSetAlertAuthFlow({ keepLandingVisible: false });
      return setSubMessage(t('loginRequiredAlert'));
    }
    if (!canUseRadarPlan) {
      setSubMessage('Sblocca tutte le opportunita con PRO');
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
    const displayName = String(cluster?.cluster_name || slug || '').trim();
    if (!slug) return;
    if (!isAuthenticated) {
      beginSetAlertAuthFlow({ keepLandingVisible: false });
      setSubMessage(t('loginRequiredAlert'));
      return;
    }
    if (!canUseRadarPlan) {
      setSubMessage('Il follow destinazioni e disponibile su PRO.');
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
      setSubMessage(`Cluster seguito: ${displayName}`);
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
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
    if (!isAuthenticated) return;
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

  function slugifyFollowValue(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
  }

  function monthsToSeasonSlugs(months) {
    const out = new Set();
    const list = Array.isArray(months) ? months : [];
    if (list.some((m) => [12, 1, 2].includes(Number(m)))) out.add('winter');
    if (list.some((m) => [3, 4, 5].includes(Number(m)))) out.add('spring');
    if (list.some((m) => [6, 7, 8].includes(Number(m)))) out.add('summer');
    if (list.some((m) => [9, 10, 11].includes(Number(m)))) out.add('autumn');
    return Array.from(out);
  }

  async function saveRadarPreferences() {
    if (!isAuthenticated) return;
    if (!canUseRadarPlan) {
      setRadarError('Radar completo disponibile su PRO.');
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

      setRadarMessage('Radar aggiornato con successo.');
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
      setRadarMessage('Follow radar aggiornato.');
    } catch (error) {
      setRadarFollowsError(resolveApiError(error));
    }
  }

  async function runAiTravelQuery() {
    if (!isAuthenticated) return setAiTravelError(t('loginRequiredAlert'));
    if (!canUseAiTravelPlan) {
      setAiTravelError('AI Travel e disponibile solo nel piano ELITE.');
      setActiveMainSection('premium');
      return;
    }
    if (!aiTravelPrompt.trim()) return;
    setAiTravelLoading(true);
    setAiTravelError('');
    try {
      const payload = await api.queryAiTravel(token, { prompt: aiTravelPrompt.trim(), limit: 12 });
      setAiTravelResult(payload);
    } catch (error) {
      setAiTravelResult(null);
      setAiTravelError(resolveApiError(error));
    } finally {
      setAiTravelLoading(false);
    }
  }

  function openOpportunityBooking(url) {
    if (!url) return;
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function runSecurityAuditCheck() {
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

  async function loadBillingPricing(silent = false) {
    if (!silent) setBillingPricingLoading(true);
    setBillingPricingError('');
    try {
      const payload = await api.billingPricing();
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

  async function upgradeToPremium() {
    if (!isAuthenticated) {
      beginAuthFlow({
        action: 'enter_app',
        authMode: 'register',
        authView: 'options',
        keepLandingVisible: false
      });
      return;
    }
    try {
      await api.upgradePro(token);
      const payload = await api.me(token);
      setUser(payload.user);
      setSubMessage('Piano PRO attivo. Opportunita illimitate e radar completo sbloccati.');
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  function activateFreePlan() {
    if (!isAuthenticated) {
      beginAuthFlow({
        action: 'enter_app',
        authMode: 'register',
        authView: 'options',
        keepLandingVisible: false
      });
      return;
    }
    setSubMessage('Piano Free attivo. Continua a scoprire opportunita.');
  }

  async function chooseElitePlan() {
    if (!isAuthenticated) {
      beginAuthFlow({
        action: 'enter_app',
        authMode: 'register',
        authView: 'options',
        keepLandingVisible: false
      });
      return;
    }
    try {
      await api.upgradeElite(token);
      const payload = await api.me(token);
      setUser(payload.user);
      setSubMessage('Piano ELITE attivo. AI travel planner e opportunita rare sbloccate.');
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  async function finishOnboarding() {
    if (!isAuthenticated) return;
    setOnboardingSaving(true);
    try {
      await api.completeOnboarding(token, {
        intent: onboardingDraft.intent,
        budget: onboardingDraft.budget ? Number(onboardingDraft.budget) : undefined,
        preferredRegion: onboardingDraft.preferredRegion,
        directOnly: Boolean(onboardingDraft.directOnly)
      });
      setSearchForm((prev) => ({
        ...prev,
        region: onboardingDraft.preferredRegion || prev.region,
        maxBudget: onboardingDraft.budget || prev.maxBudget,
        connectionType: onboardingDraft.directOnly ? 'direct' : prev.connectionType
      }));
      const payload = await api.me(token);
      setUser(payload.user);
      setShowOnboarding(false);
    } catch (error) {
      setSubMessage(resolveApiError(error));
    } finally {
      setOnboardingSaving(false);
    }
  }

  function buildOutboundHref(flight, surface, partner = 'tde_booking') {
    if (!flight?.destinationIata) return '#';
    const params = new URLSearchParams();
    params.set('partner', partner);
    params.set('surface', surface);
    params.set('origin', String(flight.origin || searchForm.origin || '').toUpperCase());
    params.set('destinationIata', String(flight.destinationIata || '').toUpperCase());
    if (flight.destination) params.set('destination', String(flight.destination));
    params.set('dateFrom', String(flight.dateFrom || searchForm.dateFrom || ''));
    params.set('dateTo', String(flight.dateTo || searchForm.dateTo || ''));
    params.set('travellers', String(Number(searchForm.travellers) || 1));
    params.set('cabinClass', String(searchForm.cabinClass || 'economy'));
    if (Number.isFinite(flight.stopCount)) params.set('stopCount', String(flight.stopCount));
    if (Number.isFinite(flight.comfortScore)) params.set('comfortScore', String(flight.comfortScore));
    if (searchForm.connectionType) params.set('connectionType', searchForm.connectionType);
    if (searchForm.travelTime) params.set('travelTime', searchForm.travelTime);
    if (utmParams.utmSource) params.set('utmSource', utmParams.utmSource);
    if (utmParams.utmMedium) params.set('utmMedium', utmParams.utmMedium);
    if (utmParams.utmCampaign) params.set('utmCampaign', utmParams.utmCampaign);
    return `/api/outbound/resolve?${params.toString()}`;
  }

  function getAlertDraft(subscription) {
    return (
      alertDraftById[subscription.id] || {
        targetPrice: Number.isFinite(subscription.targetPrice) ? String(subscription.targetPrice) : '',
        stayDays: String(subscription.stayDays ?? 7),
        travellers: String(subscription.travellers ?? 1),
        cabinClass: subscription.cabinClass || 'economy',
        cheapOnly: Boolean(subscription.cheapOnly)
      }
    );
  }

  function formatEur(value) {
    return Number(value || 0).toFixed(2);
  }

  function formatPricingDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  }

  function parseCsvText(value, mapper = (x) => x) {
    return String(value || '')
      .split(',')
      .map((item) => mapper(String(item || '').trim()))
      .filter(Boolean);
  }

  function toRadarDraft(item) {
    if (!item) {
      return {
        originAirports: '',
        favoriteDestinations: '',
        favoriteCountries: '',
        budgetCeiling: '',
        preferredTravelMonths: ''
      };
    }
    return {
      originAirports: Array.isArray(item.originAirports) ? item.originAirports.join(', ') : '',
      favoriteDestinations: Array.isArray(item.favoriteDestinations) ? item.favoriteDestinations.join(', ') : '',
      favoriteCountries: Array.isArray(item.favoriteCountries) ? item.favoriteCountries.join(', ') : '',
      budgetCeiling: Number.isFinite(Number(item.budgetCeiling)) ? String(item.budgetCeiling) : '',
      preferredTravelMonths: Array.isArray(item.preferredTravelMonths) ? item.preferredTravelMonths.join(', ') : ''
    };
  }

  function updateAlertDraft(id, patch) {
    setAlertDraftById((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        ...patch
      }
    }));
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError('');
    try {
      if (authMode === 'register') {
        const pass = String(authForm.password || '');
        const confirm = String(authForm.confirmPassword || '');
        if (!authForm.name.trim()) {
          setAuthError(t('fullNameRequired'));
          return;
        }
        if (pass !== confirm) {
          setAuthError(t('passwordMismatch'));
          return;
        }
      }
      const payload = authMode === 'login' ? await api.login({ email: authForm.email, password: authForm.password }) : await api.register({ name: authForm.name, email: authForm.email, password: authForm.password });
      if (payload?.mfaRequired && payload?.ticket) {
        setAuthMfa({ ticket: payload.ticket, code: '', expiresAt: payload.expiresAt || '' });
        return;
      }
      if (typeof window !== 'undefined' && authMode === 'login') {
        try {
          if (rememberMe) window.localStorage.setItem('remembered_email', authForm.email.trim());
          else window.localStorage.removeItem('remembered_email');
        } catch {
          // Ignore storage failures and continue login flow.
        }
      }
      setToken(payload.token || COOKIE_SESSION_TOKEN);
      setCsrfToken(payload.session?.csrfToken || '');
      setUser(payload.user);
      setAuthForm({ name: '', email: '', password: '', confirmPassword: '' });
      setAuthView('options');
      setAuthMfa({ ticket: '', code: '', expiresAt: '' });
      setShowAccountPanel(false);
    } catch (error) {
      setAuthError(resolveApiError(error));
    }
  }

  async function submitLoginMfa(event) {
    event.preventDefault();
    if (!authMfa.ticket || !authMfa.code) return;
    setAuthError('');
    try {
      const payload = await api.loginMfa({ ticket: authMfa.ticket, code: authMfa.code });
      setToken(payload.token || COOKIE_SESSION_TOKEN);
      setCsrfToken(payload.session?.csrfToken || '');
      setUser(payload.user);
      setAuthForm({ name: '', email: '', password: '', confirmPassword: '' });
      setAuthView('options');
      setAuthMfa({ ticket: '', code: '', expiresAt: '' });
      setShowAccountPanel(false);
    } catch (error) {
      setAuthError(resolveApiError(error));
    }
  }

  function startSocialLogin(provider) {
    setAuthError('');
    setOauthLoading(provider);
    persistAuthFunnelState({ authMode, authView });
    window.location.assign(`/api/auth/oauth/${provider}/start`);
  }

  async function loginWithGoogle() {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setAuthError(t('oauthNotAvailable'));
      return;
    }
    startSocialLogin('google');
  }

  async function loginWithApple() {
    const clientId = import.meta.env.VITE_APPLE_CLIENT_ID;
    if (!clientId) {
      setAuthError(t('oauthNotAvailable'));
      return;
    }
    startSocialLogin('apple');
  }

  async function loginWithFacebook() {
    const clientId = import.meta.env.VITE_FACEBOOK_CLIENT_ID;
    if (!clientId) {
      setAuthError(t('oauthNotAvailable'));
      return;
    }
    startSocialLogin('facebook');
  }

  async function setupMfa() {
    try {
      const payload = await api.mfaSetup(token);
      setMfaSetupData(payload);
      setAuthError('');
      setSubMessage(t('mfaReady'));
    } catch (error) {
      setAuthError(resolveApiError(error));
    }
  }

  async function enableMfa() {
    try {
      await api.mfaEnable(token, { code: mfaActionCode });
      const me = await api.me(token);
      setUser(me.user);
      setMfaSetupData(null);
      setMfaActionCode('');
      setSubMessage(t('mfaEnabledOn'));
    } catch (error) {
      setAuthError(resolveApiError(error));
    }
  }

  async function disableMfa() {
    try {
      await api.mfaDisable(token, { code: mfaActionCode });
      const me = await api.me(token);
      setUser(me.user);
      setMfaActionCode('');
      setSubMessage(t('mfaDisabledOn'));
    } catch (error) {
      setAuthError(resolveApiError(error));
    }
  }

  async function submitSearch(event) {
    event.preventDefault();
    setSearchError('');
    setSearchLoading(true);

    const payload = {
      ...searchForm,
      country: searchForm.country.trim() || undefined,
      destinationQuery: searchForm.destinationQuery.trim() || undefined,
      maxBudget: searchForm.maxBudget ? Number(searchForm.maxBudget) : undefined,
      maxStops: searchForm.maxStops === '' ? undefined : Number(searchForm.maxStops),
      minComfortScore: searchForm.minComfortScore === '' ? undefined : Number(searchForm.minComfortScore),
      travellers: Number(searchForm.travellers)
    };

    try {
      const result = await api.search(payload, token || undefined);
      setSearchResult(result);
      setCompareIds([]);
      setDestinationInsights({});
      setInsightLoadingByFlight({});
      setInsightErrorByFlight({});
      await refreshSearchHistory();
    } catch (error) {
      setSearchError(resolveApiError(error));
    } finally {
      setSearchLoading(false);
    }
  }

  async function submitJustGo() {
    setSearchError('');
    setSearchLoading(true);
    try {
      const tripLengthDays = Math.max(2, differenceInCalendarDays(parseISO(searchForm.dateTo), parseISO(searchForm.dateFrom)));
      const budgetMax = searchForm.maxBudget ? Number(searchForm.maxBudget) : 0;
      if (!Number.isFinite(budgetMax) || budgetMax <= 0) {
        throw new Error(t('justGoBudgetRequired'));
      }

      const result = await api.justGoDecision(
        {
          origin: searchForm.origin,
          region: searchForm.region,
          country: searchForm.country.trim() || undefined,
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

      setSearchResult({
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
      setCompareIds([]);
      setDestinationInsights({});
      setInsightLoadingByFlight({});
      setInsightErrorByFlight({});
      await refreshSearchHistory();
    } catch (error) {
      setSearchError(resolveApiError(error));
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
      const summary = payload.summary || 'Preferenze aggiornate.';
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

  async function addToWatchlist(flight) {
    if (!isAuthenticated) return setWatchlistError(t('loginRequiredAlert'));
    try {
      await api.addWatchlist(token, {
        flightId: flight.id,
        destination: flight.destination,
        destinationIata: flight.destinationIata,
        price: flight.price,
        dateFrom: searchForm.dateFrom,
        dateTo: searchForm.dateTo,
        link: flight.bookingLink || flight.link
      });
      await refreshWatchlist();
    } catch (error) {
      setWatchlistError(resolveApiError(error));
    }
  }

  async function removeWatchlistItem(id) {
    try {
      await api.removeWatchlist(token, id);
      await refreshWatchlist();
    } catch (error) {
      setWatchlistError(resolveApiError(error));
    }
  }

  async function createAlertForFlight(flight) {
    if (!isAuthenticated) {
      beginSetAlertAuthFlow({ keepLandingVisible: showLandingPage });
      setSubMessage(t('loginRequiredAlert'));
      return;
    }

    const stayDays = Math.max(2, differenceInCalendarDays(parseISO(searchForm.dateTo), parseISO(searchForm.dateFrom)));
    const daysFromNow = Math.max(1, differenceInCalendarDays(parseISO(searchForm.dateFrom), new Date()));

    try {
      await api.createAlertSubscription(token, {
        origin: searchForm.origin,
        region: searchForm.region,
        country: searchForm.country.trim() || undefined,
        destinationQuery: searchForm.destinationQuery.trim() || undefined,
        destinationIata: flight.destinationIata,
        targetPrice: Number(flight.price),
        connectionType: searchForm.connectionType,
        maxStops: searchForm.maxStops === '' ? undefined : Number(searchForm.maxStops),
        travelTime: searchForm.travelTime,
        minComfortScore: searchForm.minComfortScore === '' ? undefined : Number(searchForm.minComfortScore),
        cheapOnly: searchForm.cheapOnly,
        travellers: Number(searchForm.travellers),
        cabinClass: searchForm.cabinClass,
        stayDays,
        daysFromNow
      });
      await api.runNotificationScan(token);
      await refreshSubscriptions();
      await refreshNotifications();
      setSubMessage(t('alertCreated'));
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  async function createDurationAlert() {
    if (!isAuthenticated) return setSubMessage(t('loginRequiredAlert'));
    if (!canUseRadarPlan) return setSubMessage(t('premiumRequired'));

    const stayDays = Math.max(2, differenceInCalendarDays(parseISO(searchForm.dateTo), parseISO(searchForm.dateFrom)));

    try {
      await api.createAlertSubscription(token, {
        origin: searchForm.origin,
        region: searchForm.region,
        country: searchForm.country.trim() || undefined,
        destinationQuery: searchForm.destinationQuery.trim() || undefined,
        destinationIata: undefined,
        targetPrice: undefined,
        connectionType: searchForm.connectionType,
        maxStops: searchForm.maxStops === '' ? undefined : Number(searchForm.maxStops),
        travelTime: searchForm.travelTime,
        minComfortScore: searchForm.minComfortScore === '' ? undefined : Number(searchForm.minComfortScore),
        cheapOnly: searchForm.cheapOnly,
        travellers: Number(searchForm.travellers),
        cabinClass: searchForm.cabinClass,
        stayDays,
        daysFromNow: undefined
      });
      await api.runNotificationScan(token);
      await refreshSubscriptions();
      await refreshNotifications();
      setSubMessage(t('durationAlertCreated'));
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  async function loadDestinationInsights(flight) {
    if (!canUseAiTravelPlan) return setSubMessage('Route insights disponibili su ELITE.');
    const stayDays = Math.max(2, differenceInCalendarDays(parseISO(searchForm.dateTo), parseISO(searchForm.dateFrom)));
    setInsightErrorByFlight((prev) => ({ ...prev, [flight.id]: '' }));
    setInsightLoadingByFlight((prev) => ({ ...prev, [flight.id]: true }));

    try {
      const payload = await api.destinationInsights({
        origin: searchForm.origin,
        region: searchForm.region,
        country: searchForm.country.trim() || undefined,
        destinationQuery: searchForm.destinationQuery.trim() || flight.destination,
        destinationIata: flight.destinationIata,
        cheapOnly: searchForm.cheapOnly,
        maxBudget: searchForm.maxBudget ? Number(searchForm.maxBudget) : undefined,
        connectionType: searchForm.connectionType,
        maxStops: searchForm.maxStops === '' ? undefined : Number(searchForm.maxStops),
        travelTime: searchForm.travelTime,
        minComfortScore: searchForm.minComfortScore === '' ? undefined : Number(searchForm.minComfortScore),
        travellers: Number(searchForm.travellers),
        cabinClass: searchForm.cabinClass,
        stayDays,
        horizonDays: 120
      }, token);
      setDestinationInsights((prev) => ({ ...prev, [flight.id]: payload }));
    } catch {
      setInsightErrorByFlight((prev) => ({ ...prev, [flight.id]: t('bestDatesError') }));
    } finally {
      setInsightLoadingByFlight((prev) => ({ ...prev, [flight.id]: false }));
    }
  }

  async function deleteSubscription(id) {
    try {
      await api.deleteAlertSubscription(token, id);
      await refreshSubscriptions();
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  async function toggleSubscriptionEnabled(subscription) {
    if (!isAuthenticated) return;
    try {
      await api.updateAlertSubscription(token, subscription.id, { enabled: !subscription.enabled });
      await refreshSubscriptions();
      setSubMessage(t('alertUpdated'));
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  async function saveSubscriptionEdit(subscription) {
    if (!isAuthenticated) return;
    const draft = getAlertDraft(subscription);
    const parsedTarget = draft.targetPrice === '' ? null : Number(draft.targetPrice);
    const parsedStay = Number(draft.stayDays);
    const parsedTravellers = Number(draft.travellers);

    if (!Number.isFinite(parsedStay) || parsedStay < 2 || parsedStay > 30) return setSubMessage(t('updateFailed'));
    if (!Number.isFinite(parsedTravellers) || parsedTravellers < 1 || parsedTravellers > 9) return setSubMessage(t('updateFailed'));
    if (draft.targetPrice !== '' && (!Number.isFinite(parsedTarget) || parsedTarget <= 0)) return setSubMessage(t('updateFailed'));

    try {
      await api.updateAlertSubscription(token, subscription.id, {
        targetPrice: parsedTarget,
        stayDays: parsedStay,
        travellers: parsedTravellers,
        cabinClass: draft.cabinClass,
        cheapOnly: Boolean(draft.cheapOnly)
      });
      await refreshSubscriptions();
      await refreshNotifications();
      setSubMessage(t('alertUpdated'));
    } catch (error) {
      setSubMessage(resolveApiError(error) || t('updateFailed'));
    }
  }

  async function markNotificationRead(id) {
    await api.markNotificationRead(token, id);
    await refreshNotifications();
  }

  async function markAllRead() {
    await api.markAllNotificationsRead(token);
    await refreshNotifications();
  }

  async function enableBrowserNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      await window.Notification.requestPermission();
    } catch {}
  }

  async function logout() {
    try {
      await api.logout(token);
    } catch {}
    persistPostAuthAction(null);
    clearAuthFunnelState();
    setCsrfToken('');
    setToken('');
    setUser(null);
    setMfaSetupData(null);
    setMfaActionCode('');
    setSearchHistory([]);
    setSecurityEvents([]);
    setAlertDraftById({});
    setShowAccountPanel(false);
  }

  async function deleteAccount() {
    if (!user) return;
    const ok = typeof window === 'undefined' ? true : window.confirm(t('deleteAccountConfirm'));
    if (!ok) return;
    setDeletingAccount(true);
    try {
      await api.deleteAccount(token);
      await logout();
      setSubMessage(t('deleteAccountDone'));
    } catch (error) {
      setSubMessage(resolveApiError(error));
    } finally {
      setDeletingAccount(false);
    }
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

  function toggleCompare(flightId) {
    setCompareIds((prev) => {
      if (prev.includes(flightId)) return prev.filter((id) => id !== flightId);
      if (prev.length >= 3) return [...prev.slice(1), flightId];
      return [...prev, flightId];
    });
  }

  async function saveFirstResult() {
    const first = visibleFlights[0];
    if (!first) return;
    await addToWatchlist(first);
  }

  async function alertFirstResult() {
    const first = visibleFlights[0];
    if (!first) return;
    await createAlertForFlight(first);
  }

  function scrollToSection(sectionId) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
  }

  const landingNavItems = [
    { id: 'landing-chiamo', label: t('navChiSiamo') },
    { id: 'landing-pricing', label: t('navPricing') },
    { id: 'landing-contacts', label: t('navContacts') }
  ];

  const landingFeatureCards = [
    { color: 'blue', icon: t('landingFeature1Icon'), title: t('landingFeature1Title'), desc: t('landingFeature1Desc'), step: '01' },
    { color: 'teal', icon: t('landingFeature2Icon'), title: t('landingFeature2Title'), desc: t('landingFeature2Desc'), step: '02' },
    { color: 'purple', icon: t('landingFeature3Icon'), title: t('landingFeature3Title'), desc: t('landingFeature3Desc'), step: '03' }
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
      ctaClassName: 'landing-plan-cta ghost',
      ctaLabel: t('landingPricingCtaFree'),
      onClick: () => setShowLandingPage(false),
      featured: false
    },
    {
      id: 'pro',
      name: t('landingPricingProName') || 'Pro',
      amount: formatEur(7),
      currency: 'EUR',
      period: t('landingPricingMonthly'),
      desc: t('landingPricingProDesc') || 'For regular travellers',
      features: [t('landingPricingFeaturePro1'), t('landingPricingFeaturePro2'), t('landingPricingFeaturePro3'), t('landingPricingFeaturePro4'), t('landingPricingFeaturePro5')],
      ctaClassName: 'landing-plan-cta landing-plan-cta-primary',
      ctaLabel: t('landingPricingCtaPro'),
      onClick: () => { setShowLandingPage(false); setShowAccountPanel(true); },
      featured: true
    },
    {
      id: 'elite',
      name: t('landingPricingCreatorName') || 'Elite',
      amount: formatEur(19),
      currency: 'EUR',
      period: t('landingPricingMonthly'),
      desc: t('landingPricingCreatorDesc') || 'For professionals and analysts',
      features: [t('landingPricingFeatureCreator1'), t('landingPricingFeatureCreator2'), t('landingPricingFeatureCreator3'), t('landingPricingFeatureCreator4'), t('landingPricingFeatureCreator5')],
      ctaClassName: 'landing-plan-cta ghost',
      ctaLabel: t('landingPricingCtaCreator'),
      onClick: () => { setShowLandingPage(false); setShowAccountPanel(true); },
      featured: false
    }
  ];

  const landingContactCards = [
    { icon: '\u2709', label: t('landingEmailLabel'), value: 'hello@flightsuite.app', href: 'mailto:hello@flightsuite.app' },
    { icon: '\u260E', label: t('landingPhoneLabel'), value: '+39 02 0000 0000' },
    { icon: '\u{1F4CD}', label: t('landingAddressLabel'), value: t('landingAddressValue') }
  ];

  function handleLandingPrimaryCta() {
    if (isAuthenticated) {
      setShowLandingPage(false);
      setShowAccountPanel(false);
      setSubMessage(t('postAuthEnterAppReady'));
      return;
    }
    beginAuthFlow({
      action: 'enter_app',
      authMode: 'login',
      authView: 'options',
      keepLandingVisible: false
    });
  }

  function handleLandingSecondaryCta() {
    if (isAuthenticated) {
      setShowLandingPage(false);
      setShowAccountPanel(false);
      setSubMessage(t('postAuthSetAlertHint'));
      return;
    }
    beginSetAlertAuthFlow({ keepLandingVisible: false });
  }

  function requireSectionLogin(targetSection) {
    if (isAuthenticated) {
      setActiveMainSection(targetSection);
      return;
    }
    setActiveMainSection(targetSection);
    beginAuthFlow({
      action: 'enter_app',
      authMode: 'register',
      authView: 'options',
      keepLandingVisible: false
    });
  }

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
      />
    ) : (
    <main className={`page app-shell${darkMode ? ' app-dark' : ''}`}>
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
            <button
              type="button"
              className="landing-accedi-btn"
              onClick={() => (isAuthenticated ? setShowAccountPanel((prev) => !prev) : beginAuthFlow({ action: 'enter_app', keepLandingVisible: false }))}
            >
              {isAuthenticated ? user?.name || t('account') : t('signIn')}
            </button>
          </nav>
        </div>
        <h1>{t('appTitle')}</h1>
        <p className="hero-sub">{heroSubText}</p>
        <div className="app-main-nav">
          <button type="button" className={activeMainSection === 'home' ? 'tab active' : 'tab'} onClick={() => setActiveMainSection('home')}>
            Home
          </button>
          <button type="button" className={activeMainSection === 'explore' ? 'tab active' : 'tab'} onClick={() => setActiveMainSection('explore')}>
            Explore
          </button>
          <button type="button" className={activeMainSection === 'radar' ? 'tab active' : 'tab'} onClick={() => setActiveMainSection('radar')}>
            Radar
          </button>
          <button type="button" className={activeMainSection === 'ai-travel' ? 'tab active' : 'tab'} onClick={() => setActiveMainSection('ai-travel')}>
            AI Travel
          </button>
          <button type="button" className={activeMainSection === 'premium' ? 'tab active' : 'tab'} onClick={() => setActiveMainSection('premium')}>
            Premium
          </button>
        </div>
      </header>

      {showOnboarding && isAuthenticated ? (
        <div className="account-drawer-backdrop" onClick={() => setShowOnboarding(false)}>
          <aside className="account-drawer" role="dialog" aria-modal="true" aria-label={t('onboardingTitle')} onClick={(e) => e.stopPropagation()}>
            <section className="panel account-panel">
              <div className="panel-head">
                <h2>{t('onboardingTitle')}</h2>
                <button className="ghost" type="button" onClick={() => setShowOnboarding(false)}>
                  {t('close')}
                </button>
              </div>
              <p className="muted">{t('onboardingSub')}</p>
              <p className="api-usage-note">{t('aiApiDescriptionShort')}</p>
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
                <input type="number" min={0} value={onboardingDraft.budget} onChange={(e) => setOnboardingDraft((prev) => ({ ...prev, budget: e.target.value }))} />
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
        showAccountPanel={showAccountPanel || showAuthGateModal}
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
        setupMfa={setupMfa}
        disableMfa={disableMfa}
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
      />

      {activeMainSection === 'home' ? (
        <>
          <OpportunityFeedSection
            items={opportunityFeed}
            clusters={destinationClusters}
            clustersLoading={destinationClustersLoading}
            clustersError={destinationClustersError}
            selectedCluster={selectedOpportunityCluster}
            loading={opportunityFeedLoading}
            error={opportunityFeedError}
            onRefresh={loadOpportunityFeed}
            onSelectCluster={setSelectedOpportunityCluster}
            onClearCluster={() => setSelectedOpportunityCluster('')}
            onFollowCluster={followDestinationCluster}
            onView={openOpportunityDetail}
            onFollow={followOpportunity}
            onAlert={followOpportunity}
            onDiscover={() => setActiveMainSection('explore')}
            onActivateRadar={() => setActiveMainSection('radar')}
            isAuthenticated={isAuthenticated}
            onCreateAccount={() => beginAuthFlow({ action: 'enter_app', authMode: 'register', authView: 'options', keepLandingVisible: false })}
            showUpgradePrompt={Boolean(opportunityFeedAccess?.showUpgradePrompt)}
            upgradeMessage={opportunityFeedAccess?.upgradeMessage || 'Sblocca tutte le opportunita con PRO'}
            onUpgradePro={upgradeToPremium}
            onUpgradeElite={chooseElitePlan}
          />
          {(opportunityDetailLoading || opportunityDetailError || opportunityDetail) ? (
            <OpportunityDetailSection
              loading={opportunityDetailLoading}
              error={opportunityDetailError}
              detail={opportunityDetail}
              onClose={() => setOpportunityDetail(null)}
              onFollow={followOpportunity}
              onActivateAlert={followOpportunity}
              onOpenBooking={openOpportunityBooking}
              onViewRelated={openOpportunityDetail}
            />
          ) : null}
        </>
      ) : null}

      {activeMainSection === 'radar' ? (
        isAuthenticated ? (
          <RadarSection
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
            canUseRadar={canUseRadarPlan}
            onUpgradePro={upgradeToPremium}
            onUpgradeElite={chooseElitePlan}
          />
        ) : (
          <SectionAccessGate
            title="Attiva il radar delle opportunita"
            description="Segui aeroporti, destinazioni e budget. Ti avviseremo quando troveremo un'opportunita davvero interessante."
            ctaLabel="Crea account gratis"
            onCta={() => requireSectionLogin('radar')}
          />
        )
      ) : null}

      {activeMainSection === 'ai-travel' ? (
        isAuthenticated ? (
          <>
            <AITravelSection
              prompt={aiTravelPrompt}
              setPrompt={setAiTravelPrompt}
              loading={aiTravelLoading}
              result={aiTravelResult}
              error={aiTravelError}
              onRun={runAiTravelQuery}
              onView={openOpportunityDetail}
              canUseAiTravel={canUseAiTravelPlan}
              onUpgradePro={upgradeToPremium}
              onUpgradeElite={chooseElitePlan}
            />
            {(opportunityDetailLoading || opportunityDetailError || opportunityDetail) ? (
              <OpportunityDetailSection
                loading={opportunityDetailLoading}
                error={opportunityDetailError}
                detail={opportunityDetail}
                onClose={() => setOpportunityDetail(null)}
                onFollow={followOpportunity}
                onActivateAlert={followOpportunity}
                onOpenBooking={openOpportunityBooking}
                onViewRelated={openOpportunityDetail}
              />
            ) : null}
          </>
        ) : (
          <SectionAccessGate
            title="Trova il prossimo viaggio con l'AI"
            description="Descrivi cosa cerchi e lascia che il sistema trovi opportunita reali gia presenti nel feed."
            ctaLabel="Accedi per usare AI Travel"
            onCta={() => requireSectionLogin('ai-travel')}
          />
        )
      ) : null}

      {activeMainSection === 'premium' ? (
        <section className="panel premium-panel">
          <div className="panel-head">
            <h2>Sblocca tutte le opportunita</h2>
          </div>
          <p className="muted">Con PRO ed ELITE ricevi piu radar, piu alert e accesso alle opportunita piu rare.</p>
          <div className="premium-grid">
            <article className="premium-card">
              <p className="premium-plan-tag">FREE</p>
              <p className="premium-price">Gratis</p>
              <p className="premium-card-sub">Per iniziare a scoprire opportunita.</p>
              <ul className="premium-feature-list">
                <li>3 opportunita al giorno</li>
                <li>Feed base</li>
                <li>Ricerca limitata</li>
              </ul>
              <button type="button" className="premium-cta premium-cta-light" onClick={activateFreePlan}>Inizia gratis</button>
            </article>
            <article className="premium-card premium-card-featured">
              <p className="premium-plan-tag">PRO</p>
              <p className="premium-price">7€/mese</p>
              <p className="premium-card-sub">Per chi vuole catturare opportunita in tempo reale.</p>
              <ul className="premium-feature-list">
                <li>Opportunita illimitate</li>
                <li>Radar personalizzato</li>
                <li>Notifiche in tempo reale</li>
                <li>Analisi voli avanzata</li>
              </ul>
              <button type="button" className="premium-cta" onClick={upgradeToPremium}>Passa a PRO</button>
            </article>
            <article className="premium-card">
              <p className="premium-plan-tag">ELITE</p>
              <p className="premium-price">19€/mese</p>
              <p className="premium-card-sub">Per power user e travel intelligence avanzata.</p>
              <ul className="premium-feature-list">
                <li>AI travel planner</li>
                <li>Alert immediati</li>
                <li>Opportunita rare</li>
                <li>Analisi completa delle rotte</li>
              </ul>
              <button type="button" className="premium-cta premium-cta-dark" onClick={chooseElitePlan}>Passa a ELITE</button>
            </article>
          </div>
        </section>
      ) : null}

      {activeMainSection === 'explore' ? (
        <>
      <section className="panel">
        <div className="panel-head">
          <h2>Dove puoi andare spendendo poco</h2>
          {selectedOpportunityCluster ? (
            <button type="button" className="ghost" onClick={() => setSelectedOpportunityCluster('')}>
              Rimuovi filtro cluster
            </button>
          ) : null}
        </div>
        <p className="muted">Scopri le destinazioni piu economiche in questo momento. Usa i filtri qui sotto o un cluster del radar.</p>
        <div className="item-actions">
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
              {cluster.cluster_name}
            </button>
          ))}
        </div>
      </section>

      <SearchSection
        uiMode={uiMode}
        setUiMode={setUiMode}
        submitSearch={submitSearch}
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
        upgradeToPremium={upgradeToPremium}
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
        <section className="panel">
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
        <section className="panel">
          <div className="panel-head">
            <h2>{t('topPicks')}</h2>
          </div>
          <div className="middle-grid">
            {cheapestFlight ? (
              <article className="result-card">
                <div>
                  <strong>{t('cheapestNow')}</strong>
                  <p>
                    {cheapestFlight.destination} ({cheapestFlight.destinationIata}) | EUR {cheapestFlight.price} | {cheapestFlight.stopLabel}
                  </p>
                </div>
                <div className="item-actions">
                  <a
                    href={buildOutboundHref(cheapestFlight, 'top_picks')}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('partnerCta')}
                  </a>
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
                    {bestValueFlight.destination} ({bestValueFlight.destinationIata}) | {t('save')} EUR {bestValueFlight.savingVs2024} | {bestValueFlight.stopLabel}
                  </p>
                </div>
                <div className="item-actions">
                  <a
                    href={buildOutboundHref(bestValueFlight, 'top_picks')}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('partnerCta')}
                  </a>
                  <button type="button" className="ghost" onClick={() => createAlertForFlight(bestValueFlight)}>
                    {t('alertAtPrice')}
                  </button>
                </div>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>{t('results')}</h2>
          {isAdvancedMode ? (
            <label className="sort-pick">
              {t('sortBy')}
              <select value={searchSortBy} onChange={(e) => setSearchSortBy(e.target.value)}>
                <option value="saving">{t('sortSaving')}</option>
                <option value="price">{t('sortPrice')}</option>
                <option value="avg2024">{t('sortAvg2024')}</option>
              </select>
            </label>
          ) : null}
        </div>

        {searchResult.flights.length === 0 ? <p className="muted">{t('noResults')}</p> : null}

        <div className="results-grid">
          {visibleFlights.map((flight) => (
            <article key={flight.id} className="result-card">
              <div>
                <strong>
                  {flight.origin} {t('to')} {flight.destination} ({flight.destinationIata})
                </strong>
                <p>
                  EUR {flight.price} | {flight.stopLabel} | {flight.departureTimeLabel} {t('to')} {flight.arrivalTimeLabel} | {flight.durationHours}h | {t('comfort')} {flight.comfortScore}/100
                </p>
                {Number.isFinite(flight.travelScore) ? (
                  <p>
                    {t('travelScore')} {flight.travelScore}/100 | {t('totalEstimated')} EUR {flight.costBreakdown?.total ?? '-'} | {t('climate')} {flight.climateInPeriod?.avgTempC ?? '-'}C | {t('crowding')}{' '}
                    {flight.crowding?.index ?? '-'}
                  </p>
                ) : null}
                {Array.isArray(flight.reasons) && flight.reasons.length > 0 ? <p>{flight.reasons.slice(0, 2).join(' | ')}</p> : null}
                {flight.aiWhyNow ? <p>AI: {flight.aiWhyNow}</p> : null}
              </div>
              <div className="item-actions">
                <a
                  href={buildOutboundHref(flight, 'results')}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('partnerCta')}
                </a>
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
                      <a
                        href={buildOutboundHref({ ...windowItem, origin: flight.origin, stopCount: flight.stopCount, comfortScore: flight.comfortScore }, 'insights')}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('partnerCta')}
                      </a>
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
                    {flight.destination} ({flight.destinationIata})
                  </strong>
                  <p>EUR {flight.price}</p>
                  <p>
                    {flight.stopLabel} | {flight.durationHours}h
                  </p>
                  <p>{t('savingVs2024')}: EUR {flight.savingVs2024}</p>
                  <p>{flight.climate}</p>
                </div>
                <div className="item-actions">
                  <a
                    href={buildOutboundHref(flight, 'compare')}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('partnerCta')}
                  </a>
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
                      <a
                        href={buildOutboundHref(
                          {
                            origin: item.flightId?.split('-')?.[0] || searchForm.origin,
                            destinationIata: item.destinationIata,
                            destination: item.destination,
                            dateFrom: item.dateFrom,
                            dateTo: item.dateTo
                          },
                          'watchlist'
                        )}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('partnerCta')}
                      </a>
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
    )}
    </AppProvider>
  );
}

export default App;




