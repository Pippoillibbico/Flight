import { useEffect } from 'react';
import { localizeCountryByIso2 } from '../../../utils/localizePlace';
import { readRememberedEmail } from '../../personal-hub/storage';
import { readStoredPostAuthContext } from './useAuthFlowCoordinator';

export function useAssistantWelcomeEffect({ language, i18nPack, t, setIntakeMessages }) {
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
  }, [language, i18nPack, t, setIntakeMessages]);
}

export function useAppSuggestionEffects({
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
}) {
  useEffect(() => {
    const q = canonicalDestinationQuery(searchForm.destinationQuery);
    if (q.length < 1) {
      setDestinationSuggestions([]);
      return;
    }
    const id = setTimeout(() => {
      const canonicalCountry = canonicalCountryFilter(searchForm.country);
      const queryToken = normalizeSuggestionToken(q);
      api
        .suggestions({ q, region: searchForm.region, country: canonicalCountry, limit: 12 })
        .then((destinationRes) => {
          const destinationItems = Array.isArray(destinationRes?.items)
            ? destinationRes.items
                .map((item) => {
                  const value = String(item?.value || '').trim();
                  const baseLabel = String(item?.label || value).trim();
                  const type = String(item?.type || 'destination').trim().toLowerCase();
                  if (type === 'country') return null;
                  const label = localizeDestinationSuggestionLabel(baseLabel);
                  if (!value || !label) return null;

                  const normalizedLabel = normalizeSuggestionToken(label);
                  const normalizedValue = normalizeSuggestionToken(value);
                  const fullStarts = normalizedLabel.startsWith(queryToken) || normalizedValue.startsWith(queryToken);
                  const tokenStarts = `${normalizedLabel} ${normalizedValue}`
                    .split(' ')
                    .filter(Boolean)
                    .some((token) => token.startsWith(queryToken));
                  const partialContains =
                    queryToken.length >= 4 && (normalizedLabel.includes(queryToken) || normalizedValue.includes(queryToken));

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
            merged.push({ type: item.type, value: item.value, label: item.label });
            if (merged.length >= 10) break;
          }
          setDestinationSuggestions(merged);
        })
        .catch(() => setDestinationSuggestions([]));
    }, 120);
    return () => clearTimeout(id);
  }, [
    api,
    searchForm.destinationQuery,
    searchForm.region,
    searchForm.country,
    language,
    setDestinationSuggestions
  ]);

  useEffect(() => {
    const q = String(searchForm.country || '').trim();
    if (q.length < 1) {
      setCountrySuggestions([]);
      return;
    }
    const id = setTimeout(() => {
      const canonicalQuery = canonicalCountryFilter(q) || q;
      api
        .countries({ q: canonicalQuery, limit: 15 })
        .then((response) => {
          const nextItems = (response.items || []).map((item) => {
            const canonicalName = String(item?.name || '').trim();
            const iso2 = String(item?.cca2 || '').trim();
            const localizedName = localizeCountryByIso2(iso2, canonicalName, language);
            return {
              ...item,
              localizedName,
              localizedLabel: localizedName
            };
          });
          setCountrySuggestions(nextItems);
        })
        .catch(() => setCountrySuggestions([]));
    }, 160);
    return () => clearTimeout(id);
  }, [api, searchForm.country, language, setCountrySuggestions]);
}

export function useAppBrowserEffects({
  showAccountPanel,
  user,
  setShowAccountPanel,
  loadBillingPricing,
  setAuthError,
  setToken,
  cookieSessionToken,
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
}) {
  useEffect(() => {
    if (!showAccountPanel) return undefined;
    loadBillingPricing(true, true);
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && user) setShowAccountPanel(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showAccountPanel, user, setShowAccountPanel, loadBillingPricing]);

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
      setToken(cookieSessionToken);
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
  }, [
    setAuthError,
    setShowAccountPanel,
    setToken,
    cookieSessionToken,
    persistPostAuthAction,
    persistPostAuthSection
  ]);

  useEffect(() => {
    const { pendingAction: pending, authMode: storedMode, authView: storedView, section: storedSection } = readStoredPostAuthContext();
    if (pending) setPendingPostAuthAction(pending);
    if (storedMode === 'login' || storedMode === 'register') setAuthMode(storedMode);
    if (storedView === 'options' || storedView === 'email') setAuthView(storedView);
    if (storedSection) setPendingPostAuthSection(String(storedSection).trim().toLowerCase());
  }, [setPendingPostAuthAction, setAuthMode, setAuthView, setPendingPostAuthSection]);

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
  }, [setAuthForm, setRememberMe]);

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
  }, [
    activeMainSection,
    user,
    setAdminRouteRequested,
    setShowLandingPage,
    setActiveMainSection,
    setShowAccountPanel,
    setAuthMode,
    setAuthView,
    setAuthError
  ]);

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
  }, [isAdvancedMode, prefetchAdvancedAnalyticsChunk]);
}
