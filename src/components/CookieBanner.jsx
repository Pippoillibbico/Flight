import { useState, useEffect, useCallback } from 'react';
import {
  hasConsented,
  acceptAllConsent,
  rejectOptionalConsent,
  acceptFunctionalOnly,
  getConsentSnapshot,
  saveConsentPreferences
} from '../utils/cookieConsent';

/**
 * GDPR cookie consent banner + settings panel.
 *
 * Supports:
 *  - Accept all
 *  - Functional only
 *  - Necessary only (reject optional)
 *  - Customize preferences
 *  - Reopen settings after an initial choice
 */
function CookieBanner({ t }) {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consentRecorded, setConsentRecorded] = useState(false);
  const [functionalEnabled, setFunctionalEnabled] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);

  const syncFromConsent = useCallback(() => {
    const snapshot = getConsentSnapshot();
    setConsentRecorded(Boolean(snapshot));
    setFunctionalEnabled(Boolean(snapshot?.functional));
    setAnalyticsEnabled(Boolean(snapshot?.analytics));
    if (!snapshot) setVisible(true);
  }, []);

  useEffect(() => {
    if (!hasConsented()) {
      setVisible(true);
      setConsentRecorded(false);
      setFunctionalEnabled(false);
      setAnalyticsEnabled(false);
    } else {
      syncFromConsent();
    }

    function handleConsentChange() {
      syncFromConsent();
      if (hasConsented()) {
        setVisible(false);
        setSettingsOpen(false);
      }
    }

    window.addEventListener('flight_consent_changed', handleConsentChange);
    return () => window.removeEventListener('flight_consent_changed', handleConsentChange);
  }, [syncFromConsent]);

  const tt = useCallback((key, fallback) => (typeof t === 'function' ? t(key) : fallback) || fallback, [t]);

  const handleAcceptAll = useCallback(() => {
    acceptAllConsent();
    setConsentRecorded(true);
    setVisible(false);
    setSettingsOpen(false);
  }, []);

  const handleFunctionalOnly = useCallback(() => {
    acceptFunctionalOnly();
    setConsentRecorded(true);
    setVisible(false);
    setSettingsOpen(false);
  }, []);

  const handleRejectOptional = useCallback(() => {
    rejectOptionalConsent();
    setConsentRecorded(true);
    setVisible(false);
    setSettingsOpen(false);
  }, []);

  const openSettings = useCallback(() => {
    const snapshot = getConsentSnapshot();
    setFunctionalEnabled(Boolean(snapshot?.functional));
    setAnalyticsEnabled(Boolean(snapshot?.analytics));
    setSettingsOpen(true);
    setVisible(false);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    if (!hasConsented()) setVisible(true);
  }, []);

  const saveSettings = useCallback(() => {
    saveConsentPreferences({
      functional: Boolean(functionalEnabled),
      analytics: Boolean(analyticsEnabled)
    });
    setConsentRecorded(true);
    setSettingsOpen(false);
    setVisible(false);
  }, [analyticsEnabled, functionalEnabled]);

  const showBanner = visible || settingsOpen;

  return (
    <>
      {showBanner ? (
        <div className="cookie-banner" role="dialog" aria-modal="false" aria-label={tt('cookieBannerAriaLabel', 'Cookie consent')}>
          <div className="cookie-banner-inner">
            <div className="cookie-banner-text">
              <strong className="cookie-banner-title">{tt('cookieBannerTitle', 'We use cookies')}</strong>
              <p className="cookie-banner-body">
                {tt(
                  'cookieBannerBody',
                  'We use cookies to keep your session secure and, with your consent, to remember your preferences and improve the service. No data is sold to third parties.'
                )}
              </p>

              <button
                type="button"
                className="cookie-banner-details-toggle"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? tt('cookieBannerHideDetails', 'Hide details') : tt('cookieBannerShowDetails', 'Show details')}
                <span className="cookie-banner-caret" aria-hidden="true">
                  {expanded ? ' ▲' : ' ▼'}
                </span>
              </button>

              {expanded ? (
                <dl className="cookie-banner-categories">
                  <div className="cookie-cat-row">
                    <dt>
                      <span className="cookie-cat-badge cookie-cat-badge--on">{tt('cookieCatAlwaysOn', 'Always on')}</span>
                      {tt('cookieCatNecessaryLabel', 'Strictly necessary')}
                    </dt>
                    <dd>
                      {tt(
                        'cookieCatNecessaryDesc',
                        'Authentication session, security tokens, CSRF protection. Required for the site to work. Cannot be disabled.'
                      )}
                    </dd>
                  </div>
                  <div className="cookie-cat-row">
                    <dt>
                      <span className="cookie-cat-badge cookie-cat-badge--optional">{tt('cookieCatOptional', 'Optional')}</span>
                      {tt('cookieCatFunctionalLabel', 'Functional')}
                    </dt>
                    <dd>{tt('cookieCatFunctionalDesc', 'Remember your email at login, your language preference and UI settings. Stored only in your browser.')}</dd>
                  </div>
                  <div className="cookie-cat-row">
                    <dt>
                      <span className="cookie-cat-badge cookie-cat-badge--optional">{tt('cookieCatOptional', 'Optional')}</span>
                      {tt('cookieCatAnalyticsLabel', 'Analytics')}
                    </dt>
                    <dd>{tt('cookieCatAnalyticsDesc', 'Anonymous usage events (searches, clicks) to improve the service. No personal data is shared with third parties.')}</dd>
                  </div>
                </dl>
              ) : null}

              {settingsOpen ? (
                <div className="cookie-settings-panel" data-testid="cookie-settings-panel">
                  <p className="cookie-settings-title">{tt('cookieSettingsTitle', 'Cookie settings')}</p>
                  <p className="cookie-settings-note">
                    {tt('cookieSettingsNecessaryHint', 'Strictly necessary storage is always active and cannot be disabled.')}
                  </p>
                  <label className="cookie-settings-row">
                    <input
                      type="checkbox"
                      checked={functionalEnabled}
                      onChange={(event) => setFunctionalEnabled(Boolean(event.target.checked))}
                    />
                    <span>{tt('cookieCatFunctionalLabel', 'Functional')}</span>
                  </label>
                  <label className="cookie-settings-row">
                    <input
                      type="checkbox"
                      checked={analyticsEnabled}
                      onChange={(event) => setAnalyticsEnabled(Boolean(event.target.checked))}
                    />
                    <span>{tt('cookieCatAnalyticsLabel', 'Analytics')}</span>
                  </label>
                  <div className="cookie-settings-actions">
                    <button type="button" className="cookie-btn cookie-btn--accept-all" onClick={saveSettings}>
                      {tt('cookieSettingsSave', 'Save preferences')}
                    </button>
                    <button type="button" className="cookie-btn cookie-btn--functional" onClick={closeSettings}>
                      {tt('cookieSettingsCancel', 'Cancel')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {!settingsOpen ? (
              <div className="cookie-banner-actions">
                <button type="button" className="cookie-btn cookie-btn--accept-all" onClick={handleAcceptAll}>
                  {tt('cookieBannerAcceptAll', 'Accept all')}
                </button>
                <button type="button" className="cookie-btn cookie-btn--reject" onClick={handleRejectOptional}>
                  {tt('cookieBannerRejectOptional', 'Necessary only')}
                </button>
                <button type="button" className="cookie-btn cookie-btn--functional" onClick={handleFunctionalOnly}>
                  {tt('cookieBannerFunctionalOnly', 'Functional only')}
                </button>
                <button type="button" className="cookie-btn cookie-btn--manage" onClick={openSettings}>
                  {tt('cookieBannerCustomize', 'Customize')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {consentRecorded && !showBanner ? (
        <button
          type="button"
          className="cookie-manage-btn"
          onClick={openSettings}
          aria-label={tt('cookieSettingsTitle', 'Cookie settings')}
          data-testid="cookie-settings-reopen"
        >
          {tt('cookieSettingsManage', 'Cookie settings')}
        </button>
      ) : null}
    </>
  );
}

export default CookieBanner;
