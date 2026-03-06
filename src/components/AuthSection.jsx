import { z } from 'zod';
import { useAppContext } from '../context/AppContext';
import { validateProps } from '../utils/validateProps';

const AuthSectionPropsSchema = z
  .object({
    showAccountPanel: z.boolean(),
    authView: z.string(),
    authMode: z.string(),
    rememberMe: z.boolean(),
    authError: z.string(),
    oauthLoading: z.string(),
    mfaActionCode: z.string(),
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
      .passthrough()
  })
  .passthrough();

function AuthSection(props) {
  const { t, isAuthenticated, user, authUi, authTitle, isMfaChallengeActive } = useAppContext();
  const {
    showAccountPanel,
    setShowAccountPanel,
    logout,
    formatEur,
    billingPricing,
    formatPricingDate,
    billingPricingLoading,
    loadBillingPricing,
    billingPricingError,
    upgradeToPremium,
    setupMfa,
    disableMfa,
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
    deletingAccount
  } = validateProps(AuthSectionPropsSchema, props, 'AuthSection');
  if (!showAccountPanel) return null;

  return (
<div
  className={`account-drawer-backdrop ${!isAuthenticated ? 'auth-modal-backdrop' : ''}`}
  onClick={() => {
    if (isAuthenticated) setShowAccountPanel(false);
  }}
>
          <aside
            className={`account-drawer ${!isAuthenticated ? 'auth-modal-drawer' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={t('account')}
            onClick={(e) => e.stopPropagation()}
          >
            <section className={`panel account-panel ${!isAuthenticated ? 'auth-panel-surface' : ''}`}>
              {isAuthenticated ? (
                <div className="panel-head">
                  <h2>{t('account')}</h2>
                  <div className="item-actions">
                    <button className="ghost" type="button" onClick={() => setShowAccountPanel(false)}>
                      x
                    </button>
                    <button className="ghost" type="button" onClick={logout}>
                      {t('logout')}
                    </button>
                  </div>
                </div>
              ) : null}

              {isAuthenticated ? (
                <div className="user-box">
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                  <span>{user.isPremium ? t('premiumActive') : t('premiumFeatures')}</span>
                  <span>{user.mfaEnabled ? t('mfaEnabledOn') : t('mfaDisabledOn')}</span>
                  <div className="watch-item">
                    <div>
                      <strong>{t('pricingLive')}</strong>
                      <p>Free EUR {formatEur(billingPricing.free?.monthlyEur)} | Pro EUR {formatEur(billingPricing.pro?.monthlyEur)} | Creator EUR {formatEur(billingPricing.creator?.monthlyEur)}</p>
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
                  <div className="item-actions">
                    {!user.isPremium ? (
                      <button className="ghost" type="button" onClick={upgradeToPremium}>
                        {t('upgradePremium')}
                      </button>
                    ) : null}
                    {!user.mfaEnabled ? (
                      <button className="ghost" type="button" onClick={setupMfa}>
                        {t('mfaSetup')}
                      </button>
                    ) : (
                      <button className="ghost" type="button" onClick={disableMfa} disabled={!mfaActionCode}>
                        {t('mfaDisable')}
                      </button>
                    )}
                    <button className="ghost danger" type="button" onClick={deleteAccount} disabled={deletingAccount}>
                      {deletingAccount ? `${t('deleteAccount')}...` : t('deleteAccount')}
                    </button>
                  </div>
                  {mfaSetupData?.qrDataUrl ? <img src={mfaSetupData.qrDataUrl} alt="MFA QR" style={{ maxWidth: 180, borderRadius: 10 }} /> : null}
                  {mfaSetupData?.manualKey ? <p className="muted">Manual key: {mfaSetupData.manualKey}</p> : null}
                  <label>
                    {t('mfaCode')}
                    <input value={mfaActionCode} onChange={(e) => setMfaActionCode(e.target.value.trim())} placeholder="123456" />
                  </label>
                  {!user.mfaEnabled && mfaSetupData ? (
                    <button className="ghost" type="button" onClick={enableMfa} disabled={!mfaActionCode}>
                      {t('mfaEnable')}
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="auth-shell">
                    {!isMfaChallengeActive ? (
                      <>
                        <div className="auth-brand-row" />
                        <h3>{authUi.welcomeTitle}</h3>
                        <p className="muted auth-subtitle">{authUi.welcomeSub}</p>

                        <div className="social-auth social-auth-stack">
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
                          <button type="button" className="auth-provider-btn" onClick={loginWithFacebook} disabled={oauthLoading === 'facebook'}>
                            <span className="social-icon facebook" aria-hidden="true">
                              <svg viewBox="0 0 24 24">
                                <path fill="currentColor" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.026 4.388 11.022 10.125 11.926v-8.437H7.078v-3.49h3.047V9.413c0-3.017 1.792-4.687 4.533-4.687 1.313 0 2.686.236 2.686.236v2.965h-1.514c-1.491 0-1.956.93-1.956 1.885v2.26h3.328l-.532 3.49h-2.796V24C19.612 23.095 24 18.1 24 12.073z"/>
                              </svg>
                            </span>
                            {oauthLoading === 'facebook' ? `${authUi.facebook}...` : authUi.facebook}
                          </button>
                          <button type="button" className="auth-provider-btn" onClick={loginWithGoogle} disabled={oauthLoading === 'google'}>
                            <span className="social-icon google" aria-hidden="true">
                              <svg viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.29h6.45a5.52 5.52 0 0 1-2.4 3.62v3.01h3.88c2.27-2.09 3.56-5.17 3.56-8.65z"/>
                                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.92l-3.88-3.01c-1.08.73-2.46 1.17-4.05 1.17-3.12 0-5.77-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24z"/>
                                <path fill="#FBBC05" d="M5.28 14.29A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.37-2.29V6.6H1.27A12 12 0 0 0 0 12c0 1.94.46 3.78 1.27 5.4l4.01-3.11z"/>
                                <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.43-3.43C17.95 1.18 15.24 0 12 0A12 12 0 0 0 1.27 6.6l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77z"/>
                              </svg>
                            </span>
                            {oauthLoading === 'google' ? `${authUi.google}...` : authUi.google}
                          </button>
                          <button type="button" className="auth-provider-btn" onClick={loginWithApple} disabled={oauthLoading === 'apple'}>
                            <span className="social-icon apple" aria-hidden="true">
                              <svg viewBox="0 0 24 24">
                                <path fill="currentColor" d="M16.37 12.5c.02 2.16 1.9 2.88 1.92 2.89-.02.05-.3 1.05-1 2.07-.6.88-1.22 1.75-2.2 1.77-.96.02-1.27-.56-2.37-.56-1.1 0-1.44.54-2.33.58-.94.04-1.66-.94-2.26-1.81-1.24-1.78-2.2-5.03-.92-7.28.63-1.12 1.76-1.83 2.98-1.85.93-.02 1.81.62 2.37.62.55 0 1.59-.77 2.68-.66.46.02 1.75.18 2.57 1.39-.07.04-1.54.91-1.54 2.84zM14.83 4.6c.5-.6.85-1.42.76-2.25-.73.03-1.62.48-2.14 1.08-.47.54-.88 1.4-.77 2.22.82.06 1.65-.42 2.15-1.05z"/>
                              </svg>
                            </span>
                            {oauthLoading === 'apple' ? `${authUi.apple}...` : authUi.apple}
                          </button>
                        </div>

                        {authView === 'email' ? (
                          <form className="form-stack auth-email-form" onSubmit={submitAuth}>
                            {authMode === 'register' ? (
                              <label>
                                {t('fullName')}
                                <input required value={authForm.name} onChange={(e) => setAuthForm((p) => ({ ...p, name: e.target.value }))} />
                              </label>
                            ) : null}
                            <label>
                              {t('email')}
                              <input type="email" required value={authForm.email} onChange={(e) => setAuthForm((p) => ({ ...p, email: e.target.value }))} />
                            </label>
                            <label>
                              {t('password')}
                              <input type="password" required minLength={10} value={authForm.password} onChange={(e) => setAuthForm((p) => ({ ...p, password: e.target.value }))} />
                            </label>
                            {authMode === 'register' ? (
                              <label>
                                {t('confirmPassword')}
                                <input
                                  type="password"
                                  required
                                  minLength={10}
                                  value={authForm.confirmPassword || ''}
                                  onChange={(e) => setAuthForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                                />
                              </label>
                            ) : null}
                            {authMode === 'register' ? <p className="muted">{t('passwordRule')}</p> : null}
                            <div className="item-actions">
                              <button type="submit">{authTitle}</button>
                              <button type="button" className="ghost" onClick={() => setAuthView('options')}>
                                {t('back')}
                              </button>
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

                        <label className="check-row auth-remember-row">
                          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                          {authUi.remember}
                        </label>
                        <p className="muted auth-legal">
                          {authUi.legalPrefix} <u>{authUi.legalTerms}</u> {authUi.legalAnd} <u>{authUi.legalPrivacy}</u>.
                        </p>
                      </>
                    ) : (
                      <form className="form-stack" onSubmit={submitLoginMfa}>
                        <h3>{t('mfaLoginTitle')}</h3>
                        <p className="muted">{t('mfaLoginHint')}</p>
                        <label>
                          {t('mfaCode')}
                          <input value={authMfa.code} onChange={(e) => setAuthMfa((prev) => ({ ...prev, code: e.target.value.trim() }))} placeholder="123456" />
                        </label>
                        <div className="item-actions">
                          <button type="submit">{t('mfaContinue')}</button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setAuthMfa({ ticket: '', code: '', expiresAt: '' })}
                          >
                            {t('back')}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                  {authError ? <p className="error">{authError}</p> : null}
                </>
              )}
            </section>
          </aside>
        </div>
  );
}

export default AuthSection;
