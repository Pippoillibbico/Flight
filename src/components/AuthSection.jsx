import { useState, useRef, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { useAppContext } from '../context/AppContext';
import { validateProps } from '../utils/validateProps';

const AuthSectionPropsSchema = z
  .object({
    showAccountPanel: z.boolean(),
    darkMode: z.boolean().optional().default(false),
    authView: z.string(),
    authMode: z.string(),
    rememberMe: z.boolean(),
    authError: z.string(),
    oauthLoading: z.string(),
    mfaActionCode: z.string(),
    reopenOnboarding: z.any().optional(),
    authForm: z.object({ name: z.string(), email: z.string(), password: z.string(), confirmPassword: z.string().optional() }),
    authMfa: z.object({ ticket: z.string(), code: z.string(), expiresAt: z.string() }),
    deleteAccount: z.any(),
    deletingAccount: z.boolean(),
    billingPricing: z
      .object({
        free: z.object({ monthlyEur: z.number() }),
        pro: z.object({ monthlyEur: z.number() }),
        creator: z.object({ monthlyEur: z.number() }),
        updatedAt: z.any(),
        lastCostCheckAt: z.any()
      })
      .passthrough(),
    // systemCapabilities gates which OAuth providers are rendered.
    // When null (not yet loaded), all buttons are shown to avoid flicker.
    systemCapabilities: z.record(z.string(), z.any()).nullable().optional().default(null)
  })
  .passthrough();

function EyeIcon({ open }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function PasswordField({ id, label, value, onChange, minLength, required, inputTestId }) {
  const [show, setShow] = useState(false);
  return (
    <label className="auth-field-label" htmlFor={id}>
      {label}
      <span className="auth-password-wrap">
        <input
          id={id}
          data-testid={inputTestId}
          type={show ? 'text' : 'password'}
          required={required}
          minLength={minLength}
          value={value}
          onChange={onChange}
          className="auth-password-input"
          autoComplete={id === 'password' ? 'current-password' : 'new-password'}
        />
        <button
          type="button"
          className="auth-password-toggle"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Nascondi password' : 'Mostra password'}
          tabIndex={0}
        >
          <EyeIcon open={show} />
        </button>
      </span>
    </label>
  );
}

function AuthSection(props) {
  const { t, isAuthenticated, user, authUi, authTitle, isMfaChallengeActive } = useAppContext();
  const {
    showAccountPanel,
    darkMode,
    setShowAccountPanel,
    logout,
    formatEur,
    billingPricing,
    formatPricingDate,
    billingPricingLoading,
    loadBillingPricing,
    billingPricingError,
    upgradeToPremium,
    chooseElitePlan,
    reopenOnboarding,
    setupMfa,
    disableMfa,
    resetMfaSetup,
    mfaActionCode,
    setMfaActionCode,
    mfaSetupData,
    enableMfa,
    authView,
    authMode,
    setAuthMode,
    loginWithFacebook,
    oauthLoading,
    loginWithGoogle,
    loginWithApple,
    submitAuth,
    authForm,
    setAuthForm,
    setAuthView,
    rememberMe,
    setRememberMe,
    submitLoginMfa,
    authMfa,
    setAuthMfa,
    authError,
    deleteAccount,
    deletingAccount,
    systemCapabilities
  } = validateProps(AuthSectionPropsSchema, props, 'AuthSection');

  // When capabilities are null (not yet loaded), show all buttons to avoid flicker.
  // When loaded, hide buttons for providers that are not configured server-side.
  const cap = systemCapabilities;
  const showGoogle = cap === null || cap?.oauth_google?.active !== false;
  const showFacebook = cap === null || cap?.oauth_facebook?.active !== false;
  const showApple = cap === null || cap?.oauth_apple?.active !== false;
  const anyOAuthAvailable = showGoogle || showFacebook || showApple;

  const mfaInputRef = useRef(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMfaSubmitting, setIsMfaSubmitting] = useState(false);

  useEffect(() => {
    if (isMfaChallengeActive && mfaInputRef.current) {
      mfaInputRef.current.focus();
    }
  }, [isMfaChallengeActive]);

  const handleSubmitAuth = useCallback(async (e) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await submitAuth(e);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, submitAuth]);

  const handleSubmitMfa = useCallback(async (e) => {
    if (isMfaSubmitting) return;
    setIsMfaSubmitting(true);
    try {
      await submitLoginMfa(e);
    } finally {
      setIsMfaSubmitting(false);
    }
  }, [isMfaSubmitting, submitLoginMfa]);

  const planTypeRaw = String(user?.planType || user?.plan_type || '').trim().toLowerCase();
  const planType = planTypeRaw === 'creator' ? 'elite' : planTypeRaw || (user?.isPremium ? 'pro' : 'free');
  const mfaCodeValue = String(mfaActionCode || '').trim();
  const hasMfaCode = /^\d{6}$/.test(mfaCodeValue);
  const mfaSetupActive = Boolean(!user?.mfaEnabled && mfaSetupData?.qrDataUrl);
  // Email form only appears after clicking "Continue with email", not on the initial options view
  const showEmailForm = authView === 'email';
  const formattedMfaManualKey = (() => {
    const key = String(mfaSetupData?.manualKey || '')
      .replace(/\s+/g, '')
      .toUpperCase();
    if (!key) return '';
    return key.match(/.{1,4}/g)?.join(' ') || key;
  })();

  if (!showAccountPanel) return null;

  return (
    <div
      className={`account-drawer-backdrop ${!isAuthenticated ? 'auth-modal-backdrop' : ''}${darkMode ? ' app-shell app-dark' : ''}`}
      onClick={() => setShowAccountPanel(false)}
    >
      <aside
        className={`account-drawer ${!isAuthenticated ? 'auth-modal-drawer' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('account')}
        onClick={(e) => e.stopPropagation()}
      >
        <section className={`panel account-panel ${isAuthenticated ? 'auth-account-panel' : ''} ${!isAuthenticated ? 'auth-panel-surface' : ''}`}>
          {isAuthenticated ? (
            <div className="panel-head">
              <h2>{t('account')}</h2>
              <div className="item-actions">
                <button className="ghost account-close-btn" type="button" onClick={() => setShowAccountPanel(false)} aria-label={t('close')}>
                  {'\u00D7'}
                </button>
                <button className="ghost" type="button" onClick={logout}>
                  {t('logout')}
                </button>
              </div>
            </div>
          ) : null}

          {isAuthenticated ? (
            <div className="user-box account-user-box">
              <strong>{user.name}</strong>
              <span className="account-user-email">{user.email}</span>
              <span className="account-user-meta">{t('activePlanLabel')}: {String(planType || 'free').toUpperCase()}</span>
              <span className="account-user-meta">{user.mfaEnabled ? t('mfaEnabledOn') : t('mfaDisabledOn')}</span>
              <div className="watch-item account-pricing-card">
                <div>
                  <strong>{t('pricingLive')}</strong>
                  <p>Free EUR {formatEur(billingPricing.free?.monthlyEur)} | Pro EUR {formatEur(billingPricing.pro?.monthlyEur)} | Elite EUR {formatEur(billingPricing.creator?.monthlyEur)}</p>
                  <p className="muted">
                    {t('pricingLastCheck')}: {formatPricingDate(billingPricing.lastCostCheckAt || billingPricing.updatedAt)}
                  </p>
                </div>
                <div className="item-actions">
                  <button className="ghost" type="button" onClick={() => loadBillingPricing()} disabled={billingPricingLoading}>
                    {billingPricingLoading ? `${t('pricingRefresh')}...` : t('pricingRefresh')}
                  </button>
                </div>
              </div>
              {billingPricingError ? <p className="error">{billingPricingError}</p> : null}
              <div className="item-actions account-actions">
                {planType === 'free' ? (
                  <button className="ghost" type="button" onClick={upgradeToPremium}>
                    {t('pricingProCta')}
                  </button>
                ) : null}
                {planType !== 'elite' ? (
                  <button className="ghost" type="button" onClick={chooseElitePlan}>
                    {t('pricingEliteCta')}
                  </button>
                ) : null}
              </div>
              {typeof reopenOnboarding === 'function' ? (
                <div className="watch-item account-onboarding-card">
                  <div>
                    <strong>{t('onboardingTitle')}</strong>
                    <p className="muted">{t('onboardingReopenHint')}</p>
                  </div>
                  <div className="item-actions">
                    <button className="ghost" type="button" onClick={reopenOnboarding}>
                      {t('onboardingReopenCta')}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="watch-item account-security-card">
                <div className="account-security-head">
                  <strong>{t('mfaSecurityTitle')}</strong>
                  <span className={`account-security-status ${user.mfaEnabled ? 'enabled' : 'disabled'}`}>
                    {user.mfaEnabled ? t('mfaSecurityStatusOn') : t('mfaSecurityStatusOff')}
                  </span>
                </div>
                <p className="muted">{user.mfaEnabled ? t('mfaEnabledFlowHint') : t('mfaSetupFlowHint')}</p>
                {mfaSetupActive ? (
                  <div className="account-mfa-flow">
                    <p className="muted">
                      <strong>1.</strong> {t('mfaStepScanQr')}
                    </p>
                    {mfaSetupData?.qrDataUrl ? (
                      <div className="account-mfa-visual">
                        <img className="account-mfa-qr" src={mfaSetupData.qrDataUrl} alt="MFA QR Code" />
                      </div>
                    ) : null}
                    {formattedMfaManualKey ? (
                      <div className="account-mfa-manual-key">
                        <span className="account-mfa-manual-label">{t('mfaManualKeyLabel')}:</span>
                        <code className="account-mfa-manual-value">{formattedMfaManualKey}</code>
                      </div>
                    ) : null}
                    <p className="muted">
                      <strong>2.</strong> {t('mfaStepConfirmCode')}
                    </p>
                    <label className="account-mfa-input" htmlFor="mfa-setup-code">
                      {t('mfaCode')}
                      <input
                        id="mfa-setup-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={mfaCodeValue}
                        onChange={(e) => setMfaActionCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        maxLength={6}
                      />
                    </label>
                    <div className="item-actions">
                      <button className="ghost" type="button" onClick={enableMfa} disabled={!hasMfaCode}>
                        {t('mfaEnable')}
                      </button>
                      <button className="ghost" type="button" onClick={resetMfaSetup}>
                        {t('back')}
                      </button>
                    </div>
                  </div>
                ) : null}
                {!user.mfaEnabled && !mfaSetupActive ? (
                  <button className="ghost" type="button" onClick={setupMfa}>
                    {t('mfaStartSetupCta')}
                  </button>
                ) : null}
                {user.mfaEnabled ? (
                  <div className="account-mfa-flow">
                    <label className="account-mfa-input" htmlFor="mfa-disable-code">
                      {t('mfaDisableCodeLabel')}
                      <input
                        id="mfa-disable-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={mfaCodeValue}
                        onChange={(e) => setMfaActionCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        maxLength={6}
                      />
                    </label>
                    <button className="ghost" type="button" onClick={disableMfa} disabled={!hasMfaCode}>
                      {t('mfaDisable')}
                    </button>
                  </div>
                ) : null}
              </div>
              {authError ? <p className="error" role="alert">{authError}</p> : null}
              <div className="watch-item account-danger-zone">
                <strong>{t('deleteAccount')}</strong>
                <p className="muted">{t('deleteAccountHint')}</p>
                <button className="ghost danger" type="button" onClick={deleteAccount} disabled={deletingAccount}>
                  {deletingAccount ? `${t('deleteAccount')}...` : t('deleteAccount')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="auth-shell">
                {!isMfaChallengeActive ? (
                  <>
                    <div className="auth-brand-row">
                      <img
                        src="/jetly-logo.png"
                        alt="Jetly"
                        className="auth-modal-logo"
                        draggable="false"
                      />
                      <button
                        type="button"
                        className="auth-close-btn"
                        data-testid="auth-modal-close"
                        onClick={() => setShowAccountPanel(false)}
                        aria-label={t('close')}
                      >
                        {'\u00D7'}
                      </button>
                    </div>
                    <h3>{authUi.welcomeTitle}</h3>
                    <p className="muted auth-subtitle">{authUi.welcomeSub}</p>
                    <p className="muted auth-conversion-note">
                      {t('authFastStartHint') || 'Create your account in under a minute. No credit card required.'}
                    </p>

                    <div className="social-auth social-auth-stack">
                      {anyOAuthAvailable ? (
                        <p className="auth-social-label">{t('authSocialOrEmailLabel') || 'Continue with'}</p>
                      ) : null}
                      <button
                        type="button"
                        className={`auth-provider-btn${authView === 'email' ? ' active' : ''}`}
                        onClick={() => {
                          setAuthMode('login');
                          setAuthView('email');
                        }}
                      >
                        {authUi.email}
                      </button>
                      {showGoogle ? (
                        <button type="button" className="auth-provider-btn" onClick={loginWithGoogle} disabled={oauthLoading === 'google'}>
                          <span className="social-icon google" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.29h6.45a5.52 5.52 0 0 1-2.4 3.62v3.01h3.88c2.27-2.09 3.56-5.17 3.56-8.65z"/>
                              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.92l-3.88-3.01c-1.08.73-2.46 1.17-4.05 1.17-3.12 0-5.77-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24z"/>
                              <path fill="#FBBC05" d="M5.28 14.29A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.37-2.29V6.6H1.27A12 12 0 0 0 0 12c0 1.94.46 3.78 1.27 5.4l4.01-3.11z"/>
                              <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.43-3.43C17.95 1.18 15.24 0 12 0A12 12 0 0 0 1.27 6.6l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77z"/>
                            </svg>
                          </span>
                          {oauthLoading === 'google' ? (
                            <span className="auth-btn-loading"><span className="auth-spinner" aria-hidden="true" /> {authUi.google}</span>
                          ) : authUi.google}
                        </button>
                      ) : null}
                      {showFacebook ? (
                        <button type="button" className="auth-provider-btn" onClick={loginWithFacebook} disabled={oauthLoading === 'facebook'}>
                          <span className="social-icon facebook" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <path fill="currentColor" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.026 4.388 11.022 10.125 11.926v-8.437H7.078v-3.49h3.047V9.413c0-3.017 1.792-4.687 4.533-4.687 1.313 0 2.686.236 2.686.236v2.965h-1.514c-1.491 0-1.956.93-1.956 1.885v2.26h3.328l-.532 3.49h-2.796V24C19.612 23.095 24 18.1 24 12.073z"/>
                            </svg>
                          </span>
                          {oauthLoading === 'facebook' ? (
                            <span className="auth-btn-loading"><span className="auth-spinner" aria-hidden="true" /> {authUi.facebook}</span>
                          ) : authUi.facebook}
                        </button>
                      ) : null}
                      {showApple ? (
                        <button type="button" className="auth-provider-btn" onClick={loginWithApple} disabled={oauthLoading === 'apple'}>
                          <span className="social-icon apple" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <path fill="currentColor" d="M16.37 12.5c.02 2.16 1.9 2.88 1.92 2.89-.02.05-.3 1.05-1 2.07-.6.88-1.22 1.75-2.2 1.77-.96.02-1.27-.56-2.37-.56-1.1 0-1.44.54-2.33.58-.94.04-1.66-.94-2.26-1.81-1.24-1.78-2.2-5.03-.92-7.28.63-1.12 1.76-1.83 2.98-1.85.93-.02 1.81.62 2.37.62.55 0 1.59-.77 2.68-.66.46.02 1.75.18 2.57 1.39-.07.04-1.54.91-1.54 2.84zM14.83 4.6c.5-.6.85-1.42.76-2.25-.73.03-1.62.48-2.14 1.08-.47.54-.88 1.4-.77 2.22.82.06 1.65-.42 2.15-1.05z"/>
                            </svg>
                          </span>
                          {oauthLoading === 'apple' ? (
                            <span className="auth-btn-loading"><span className="auth-spinner" aria-hidden="true" /> {authUi.apple}</span>
                          ) : authUi.apple}
                        </button>
                      ) : null}
                    </div>

                    {showEmailForm ? (
                      <form className="form-stack auth-email-form" onSubmit={handleSubmitAuth} noValidate>
                        {authMode === 'register' ? (
                          <label htmlFor="auth-name">
                            {t('fullName')}
                            <input
                              id="auth-name"
                              required
                              autoComplete="name"
                              value={authForm.name}
                              onChange={(e) => setAuthForm((p) => ({ ...p, name: e.target.value }))}
                            />
                          </label>
                        ) : null}
                        <label htmlFor="auth-email">
                          {t('email')}
                          <input
                            id="auth-email"
                            data-testid="auth-email-input"
                            type="email"
                            required
                            autoComplete="email"
                            value={authForm.email}
                            onChange={(e) => setAuthForm((p) => ({ ...p, email: e.target.value }))}
                          />
                        </label>
                        <PasswordField
                          id="password"
                          label={t('password')}
                          value={authForm.password}
                          onChange={(e) => setAuthForm((p) => ({ ...p, password: e.target.value }))}
                          minLength={authMode === 'register' ? 10 : 8}
                          required
                          inputTestId="auth-password-input"
                        />
                        {authMode === 'register' ? (
                          <PasswordField
                            id="confirm-password"
                            label={t('confirmPassword')}
                            value={authForm.confirmPassword || ''}
                            onChange={(e) => setAuthForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                            minLength={10}
                            required
                            inputTestId="auth-confirm-password-input"
                          />
                        ) : null}
                        {authMode === 'register' ? <p className="muted">{t('passwordRule')}</p> : null}
                        <label className="check-row auth-remember-row">
                          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                          {authUi.remember}
                        </label>
                        <div className="item-actions auth-form-actions">
                          <button type="submit" data-testid="auth-submit" disabled={isSubmitting} aria-busy={isSubmitting}>
                            {isSubmitting ? (
                              <span className="auth-btn-loading"><span className="auth-spinner" aria-hidden="true" /> {authTitle}</span>
                            ) : authTitle}
                          </button>
                          {authView === 'email' ? (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => setAuthView('options')}
                              data-testid="auth-back-to-options"
                            >
                              {t('back')}
                            </button>
                          ) : null}
                        </div>
                        <p className="muted auth-mode-switch">
                          {authMode === 'login' ? (
                            <>
                              {t('noAccountYet')}{' '}
                              <button type="button" className="auth-inline-link" onClick={() => setAuthMode('register')}>
                                {t('register')}
                              </button>
                            </>
                          ) : (
                            <>
                              {t('alreadyAccount')}{' '}
                              <button type="button" className="auth-inline-link" onClick={() => setAuthMode('login')}>
                                {t('signIn')}
                              </button>
                            </>
                          )}
                        </p>
                      </form>
                    ) : null}

                    <p className="muted auth-legal">
                      {authUi.legalPrefix}{' '}
                      <span className="auth-legal-link">{authUi.legalTerms}</span>{' '}
                      {authUi.legalAnd}{' '}
                      <span className="auth-legal-link">{authUi.legalPrivacy}</span>.
                    </p>
                  </>
                ) : (
                  <form className="form-stack" onSubmit={handleSubmitMfa} noValidate>
                    <h3>{t('mfaLoginTitle')}</h3>
                    <p className="muted">{t('mfaLoginHint')}</p>
                    <label htmlFor="mfa-login-code">
                      {t('mfaCode')}
                      <input
                        id="mfa-login-code"
                        ref={mfaInputRef}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        aria-label={t('mfaCode')}
                        aria-required="true"
                        value={authMfa.code}
                        onChange={(e) => setAuthMfa((prev) => ({ ...prev, code: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                        placeholder="123456"
                        maxLength={8}
                      />
                    </label>
                    <div className="item-actions">
                      <button type="submit" disabled={isMfaSubmitting || !authMfa.code} aria-busy={isMfaSubmitting}>
                        {isMfaSubmitting ? (
                          <span className="auth-btn-loading"><span className="auth-spinner" aria-hidden="true" /> {t('mfaContinue')}</span>
                        ) : t('mfaContinue')}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={isMfaSubmitting}
                        onClick={() => setAuthMfa({ ticket: '', code: '', expiresAt: '' })}
                      >
                        {t('back')}
                      </button>
                    </div>
                  </form>
                )}
              </div>
              <div role="alert" aria-live="polite" className="auth-error-region">
                {authError ? <p className="error auth-error-msg">{authError}</p> : null}
              </div>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

export default AuthSection;
