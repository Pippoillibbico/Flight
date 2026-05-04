import { useState, useEffect, useCallback, useRef } from 'react';
import {
  hasConsented,
  acceptAllConsent,
  rejectOptionalConsent,
  acceptFunctionalOnly,
  getConsentSnapshot,
  saveConsentPreferences
} from '../utils/cookieConsent';
import { api } from '../api';

/**
 * GDPR-compliant cookie consent banner + settings modal.
 *
 * Layout:
 *  - Floating card (bottom-center) for the initial notice
 *  - Overlay modal for granular settings with custom toggle switches
 *  - Small "Cookie" pill (bottom-right) to reopen settings after consent
 *
 * GDPR compliance:
 *  - Accept and Reject are equal-size, equal-prominence buttons
 *  - Optional categories are OFF by default (no pre-tick)
 *  - Consent can be withdrawn at any time via the reopen button
 *  - Links to Privacy and Cookie Policy
 */
function CookieBanner({ t }) {
  const [visible, setVisible]               = useState(true);
  const [settingsOpen, setSettingsOpen]     = useState(false);
  const [consentRecorded, setConsentRecorded] = useState(false);
  const [functionalEnabled, setFunctionalEnabled] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled]   = useState(false);
  const bannerRef  = useRef(null);
  const modalRef   = useRef(null);
  const reopenRef  = useRef(null);

  const syncFromConsent = useCallback(() => {
    const snap = getConsentSnapshot();
    setConsentRecorded(Boolean(snap));
    setFunctionalEnabled(Boolean(snap?.functional));
    setAnalyticsEnabled(Boolean(snap?.analytics));
    if (!snap) setVisible(true);
  }, []);

  const tr = useCallback((key, fallback) => (typeof t === 'function' ? t(key) : null) || fallback, [t]);

  const syncConsentServerSide = useCallback(async ({ functional, analytics }) => {
    try {
      await api.updateConsent({
        analytics: Boolean(analytics),
        marketing: false,
        personalization: Boolean(functional)
      });
    } catch {
      // Backend enforcement remains fail-safe (optional tracking denied without consent).
    }
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleAcceptAll = useCallback(() => {
    acceptAllConsent();
    void syncConsentServerSide({ functional: true, analytics: true });
    setConsentRecorded(true);
    setVisible(false);
    setSettingsOpen(false);
  }, [syncConsentServerSide]);

  const handleRejectOptional = useCallback(() => {
    rejectOptionalConsent();
    void syncConsentServerSide({ functional: false, analytics: false });
    setConsentRecorded(true);
    setVisible(false);
    setSettingsOpen(false);
  }, [syncConsentServerSide]);

  const openSettings = useCallback(() => {
    const snap = getConsentSnapshot();
    setFunctionalEnabled(Boolean(snap?.functional));
    setAnalyticsEnabled(Boolean(snap?.analytics));
    setSettingsOpen(true);
    setVisible(false);
  }, []);

  useEffect(() => {
    // Product requirement: keep the banner open on app startup.
    setVisible(true);
    syncFromConsent();
    function handleConsentChange() {
      syncFromConsent();
      if (hasConsented()) { setVisible(false); setSettingsOpen(false); }
    }
    function handleOpenCookieSettings() {
      openSettings();
    }
    window.addEventListener('flight_consent_changed', handleConsentChange);
    window.addEventListener('flight_open_cookie_settings', handleOpenCookieSettings);
    return () => {
      window.removeEventListener('flight_consent_changed', handleConsentChange);
      window.removeEventListener('flight_open_cookie_settings', handleOpenCookieSettings);
    };
  }, [openSettings, syncFromConsent]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    if (!hasConsented()) setVisible(true);
  }, []);

  const saveSettings = useCallback(() => {
    saveConsentPreferences({ functional: Boolean(functionalEnabled), analytics: Boolean(analyticsEnabled) });
    void syncConsentServerSide({ functional: Boolean(functionalEnabled), analytics: Boolean(analyticsEnabled) });
    setConsentRecorded(true);
    setSettingsOpen(false);
    setVisible(false);
  }, [functionalEnabled, analyticsEnabled, syncConsentServerSide]);

  // ── Body padding offset for the banner ──────────────────────────────────
  useEffect(() => {
    const el = document.body;
    if (visible) {
      el.classList.add('has-cookie-banner');
      const update = () => {
        const h = Math.ceil(bannerRef.current?.getBoundingClientRect?.().height || 0);
        if (h > 0) el.style.setProperty('--cookie-banner-offset', `${Math.min(h + 16, window.innerHeight - 48)}px`);
      };
      update();
      window.addEventListener('resize', update);
      const ro = typeof ResizeObserver !== 'undefined' && bannerRef.current
        ? (new ResizeObserver(update), new ResizeObserver(update)) : null;
      if (ro && bannerRef.current) ro.observe(bannerRef.current);
      return () => {
        window.removeEventListener('resize', update);
        if (ro) ro.disconnect();
        el.classList.remove('has-cookie-banner');
        el.style.removeProperty('--cookie-banner-offset');
      };
    }
    el.classList.remove('has-cookie-banner');
    el.style.removeProperty('--cookie-banner-offset');
    return () => {
      el.classList.remove('has-cookie-banner');
      el.style.removeProperty('--cookie-banner-offset');
    };
  }, [visible]);

  // ── Focus management ────────────────────────────────────────────────────
  // Trap focus inside the settings modal
  useEffect(() => {
    if (!settingsOpen || !modalRef.current) return;
    const focusable = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const modal = modalRef.current;
    const first = modal.querySelectorAll(focusable)[0];
    first?.focus();

    function handleKeyDown(e) {
      if (e.key === 'Escape') { closeSettings(); return; }
      if (e.key !== 'Tab') return;
      const els = Array.from(modal.querySelectorAll(focusable));
      const firstEl = els[0];
      const lastEl  = els[els.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault(); lastEl?.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault(); firstEl?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen, closeSettings]);

  // Move focus to reopen button when both banner and modal close
  const prevVisible = useRef(false);
  useEffect(() => {
    const wasOpen = prevVisible.current;
    prevVisible.current = visible || settingsOpen;
    if (wasOpen && !visible && !settingsOpen && reopenRef.current) {
      reopenRef.current.focus();
    }
  }, [visible, settingsOpen]);

  return (
    <>
      {/* ── Main banner ─────────────────────────────────────────────── */}
      {visible && (
        <div
          ref={bannerRef}
          className="ck-banner"
          role="dialog"
          aria-modal="false"
          aria-label={tr('cookieBannerAriaLabel', 'Consenso cookie')}
          aria-live="polite"
        >
          <div className="ck-banner__body">
            {/* Cookie icon + title */}
            <div className="ck-banner__head">
              <span className="ck-banner__icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/>
                  <path d="M8.5 8.5v.01M16 15.5v.01M12 12v.01"/>
                </svg>
              </span>
              <strong className="ck-banner__title">
                {tr('cookieBannerTitle', 'Cookie e privacy')}
              </strong>
            </div>

            <p className="ck-banner__desc">
              {tr(
                'cookieBannerBody',
                'Usiamo cookie e strumenti necessari per far funzionare il servizio. Con il tuo consenso attiviamo anche funzionalità opzionali e analytics per migliorarlo. Non vendiamo dati personali.'
              )}
            </p>

            {/* Links row */}
            <div className="ck-banner__links">
              <button type="button" className="ck-link" onClick={openSettings}>
                {tr('cookieBannerCustomize', 'Personalizza')}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </button>
              <span className="ck-link-sep" aria-hidden="true">·</span>
              <a className="ck-link" href="/cookie-policy" target="_blank" rel="noopener noreferrer">
                {tr('cookieBannerCookieLink', 'Cookie policy')}
              </a>
              <span className="ck-link-sep" aria-hidden="true">·</span>
              <a className="ck-link" href="/privacy-policy" target="_blank" rel="noopener noreferrer">
                {tr('cookieBannerPrivacyLink', 'Privacy policy')}
              </a>
            </div>
          </div>

          {/* Action buttons — equal prominence (GDPR requirement) */}
          <div className="ck-banner__actions">
            <button type="button" className="ck-btn ck-btn--reject" onClick={handleRejectOptional}>
              {tr('cookieBannerRejectOptional', 'Solo necessari')}
            </button>
            <button type="button" className="ck-btn ck-btn--accept" onClick={handleAcceptAll}>
              {tr('cookieBannerAcceptAll', 'Accetta tutto')}
            </button>
          </div>
        </div>
      )}

      {/* ── Settings modal ──────────────────────────────────────────── */}
      {settingsOpen && (
        <div className="ck-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) closeSettings(); }}>
          <div
            ref={modalRef}
            className="ck-modal"
            role="dialog"
            aria-modal="true"
            aria-label={tr('cookieSettingsTitle', 'Impostazioni cookie')}
            data-testid="cookie-settings-panel"
          >
            {/* Modal header */}
            <div className="ck-modal__header">
              <h2 className="ck-modal__title">
                {tr('cookieSettingsTitle', 'Impostazioni cookie')}
              </h2>
              <button
                type="button"
                className="ck-modal__close"
                onClick={closeSettings}
                aria-label={tr('closeLabel', 'Chiudi')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Category rows */}
            <div className="ck-modal__body">

              {/* Necessary — always on */}
              <div className="ck-cat">
                <div className="ck-cat__info">
                  <span className="ck-cat__name">
                    {tr('cookieCatNecessaryLabel', 'Strettamente necessari')}
                  </span>
                  <span className="ck-cat__desc">
                    {tr('cookieCatNecessaryDesc', 'Sessione di autenticazione, token CSRF, protezione sicurezza. Necessari al funzionamento del sito e non disattivabili.')}
                  </span>
                </div>
                <span className="ck-toggle ck-toggle--always" aria-label={tr('cookieCatAlwaysOn', 'Sempre attivo')}>
                  {tr('cookieCatAlwaysOn', 'Sempre attivo')}
                </span>
              </div>

              <div className="ck-cat__divider" />

              {/* Functional */}
              <div className="ck-cat">
                <div className="ck-cat__info">
                  <label className="ck-cat__name" htmlFor="ck-functional">
                    {tr('cookieCatFunctionalLabel', 'Funzionali')}
                  </label>
                  <span className="ck-cat__desc">
                    {tr('cookieCatFunctionalDesc', 'Ricordano l\'email al login, la lingua e le impostazioni dell\'interfaccia. Archiviati solo nel tuo browser.')}
                  </span>
                </div>
                <button
                  id="ck-functional"
                  type="button"
                  role="switch"
                  aria-checked={functionalEnabled}
                  className={`ck-toggle__btn${functionalEnabled ? ' ck-toggle__btn--on' : ''}`}
                  onClick={() => setFunctionalEnabled((v) => !v)}
                >
                  <span className="ck-toggle__knob" />
                  <span className="sr-only">{functionalEnabled ? tr('on', 'Attivo') : tr('off', 'Non attivo')}</span>
                </button>
              </div>

              <div className="ck-cat__divider" />

              {/* Analytics */}
              <div className="ck-cat">
                <div className="ck-cat__info">
                  <label className="ck-cat__name" htmlFor="ck-analytics">
                    {tr('cookieCatAnalyticsLabel', 'Analytics')}
                  </label>
                  <span className="ck-cat__desc">
                    {tr('cookieCatAnalyticsDesc', 'Eventi analytics per misurare utilizzo e qualità del servizio. I dati non sono venduti e vengono trattati secondo la Privacy Policy.')}
                  </span>
                </div>
                <button
                  id="ck-analytics"
                  type="button"
                  role="switch"
                  aria-checked={analyticsEnabled}
                  className={`ck-toggle__btn${analyticsEnabled ? ' ck-toggle__btn--on' : ''}`}
                  onClick={() => setAnalyticsEnabled((v) => !v)}
                >
                  <span className="ck-toggle__knob" />
                  <span className="sr-only">{analyticsEnabled ? tr('on', 'Attivo') : tr('off', 'Non attivo')}</span>
                </button>
              </div>
            </div>

            {/* Modal footer */}
            <div className="ck-modal__footer">
              <button type="button" className="ck-btn ck-btn--reject" onClick={handleRejectOptional}>
                {tr('cookieBannerRejectOptional', 'Solo necessari')}
              </button>
              <button type="button" className="ck-btn ck-btn--save" onClick={saveSettings}>
                {tr('cookieSettingsSave', 'Salva preferenze')}
              </button>
              <button type="button" className="ck-btn ck-btn--accept" onClick={handleAcceptAll}>
                {tr('cookieBannerAcceptAll', 'Accetta tutto')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reopen pill ─────────────────────────────────────────────── */}
      {consentRecorded && !visible && !settingsOpen && (
        <button
          ref={reopenRef}
          type="button"
          className="ck-pill"
          onClick={openSettings}
          aria-label={tr('cookieSettingsTitle', 'Impostazioni cookie')}
          data-testid="cookie-settings-reopen"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/>
            <path d="M8.5 8.5v.01M16 15.5v.01M12 12v.01"/>
          </svg>
          {tr('cookieSettingsManage', 'Cookie')}
        </button>
      )}
    </>
  );
}

export default CookieBanner;
