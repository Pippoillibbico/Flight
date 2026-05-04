import { setCsrfToken, COOKIE_SESSION_TOKEN } from '../../../api';

export function useAuthSessionActions({
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
  clearRememberedEmail,
  sendAdminTelemetryEvent
}) {
  async function completeAuthSession(payload) {
    setToken(COOKIE_SESSION_TOKEN);
    setCsrfToken(payload?.session?.csrfToken || '');

    let resolvedUser = payload?.user || null;
    if (!resolvedUser) {
      try {
        const mePayload = await api.me(COOKIE_SESSION_TOKEN);
        resolvedUser = mePayload?.user || null;
        if (mePayload?.session?.csrfToken) setCsrfToken(mePayload.session.csrfToken);
      } catch {
        // Fallback to token-based session hydration effect.
      }
    }

    if (resolvedUser) {
      setUser(resolvedUser);
    }

    setAuthForm({ name: '', email: '', password: '', confirmPassword: '' });
    setAuthView('options');
    setAuthMfa({ ticket: '', code: '', expiresAt: '' });
    setShowLandingPage(false);
    setShowAccountPanel(false);
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError('');
    try {
      if (authMode === 'register' && typeof sendAdminTelemetryEvent === 'function') {
        sendAdminTelemetryEvent({
          eventType: 'signup_started',
          source: 'auth_form',
          surface: 'auth_register'
        });
      }
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
      const payload =
        authMode === 'login'
          ? await api.login({ email: authForm.email, password: authForm.password })
          : await api.register({ name: authForm.name, email: authForm.email, password: authForm.password });
      if (payload?.mfaRequired && payload?.ticket) {
        setAuthMfa({ ticket: payload.ticket, code: '', expiresAt: payload.expiresAt || '' });
        return;
      }
      if (typeof window !== 'undefined' && authMode === 'login') {
        try {
          if (rememberMe) writeRememberedEmail(authForm.email.trim());
          else clearRememberedEmail();
        } catch {
          // Ignore storage failures and continue login flow.
        }
      }
      await completeAuthSession(payload);
      if (authMode === 'register' && typeof sendAdminTelemetryEvent === 'function') {
        sendAdminTelemetryEvent({
          eventType: 'signup_completed',
          source: 'auth_form',
          surface: 'auth_register'
        });
      }
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
      await completeAuthSession(payload);
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
    startSocialLogin('google');
  }

  async function loginWithFacebook() {
    startSocialLogin('facebook');
  }

  async function setupMfa() {
    try {
      const payload = await api.mfaSetup(token);
      setMfaSetupData(payload);
      setMfaActionCode('');
      setAuthError('');
      setSubMessage(t('mfaReady'));
    } catch (error) {
      setAuthError(resolveApiError(error));
    }
  }

  function resetMfaSetup() {
    setMfaSetupData(null);
    setMfaActionCode('');
    setAuthError('');
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

  async function finishOnboarding() {
    if (!user) return;
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

  async function logout() {
    try {
      await api.logout(token);
    } catch {}
    persistPostAuthAction(null);
    persistPostAuthSection(null);
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
      clearLocalTravelData({ includeAccountHints: true });
      clearConsent();
      setSubMessage(t('deleteAccountDone'));
    } catch (error) {
      setSubMessage(resolveApiError(error));
    } finally {
      setDeletingAccount(false);
    }
  }

  return {
    submitAuth,
    submitLoginMfa,
    loginWithGoogle,
    loginWithFacebook,
    setupMfa,
    resetMfaSetup,
    enableMfa,
    disableMfa,
    finishOnboarding,
    logout,
    deleteAccount
  };
}
