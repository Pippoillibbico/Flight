import LanguageMenu from '../../../components/LanguageMenu';
import { LANGUAGE_OPTIONS } from '../../../i18n';

export default function AppHeroHeader({
  darkMode,
  setDarkMode,
  language,
  setLanguage,
  t,
  isAuthenticated,
  adminRouteRequested,
  openOnboardingSetup,
  setShowAccountPanel,
  setAuthMode,
  setAuthView,
  setAuthError,
  beginAuthFlow,
  user,
  heroSubText,
  isLiveDataSource,
  heroDataSourceNote,
  opportunityFeedCount,
  destinationClusterCount,
  radarMatchesCount,
  radarSessionActivated,
  userPlanType,
  activeMainSection,
  setActiveMainSection
}) {
  return (
    <header className="hero">
      <div className="hero-top-row">
        <span className="hero-brand-logo" aria-label="Jetly" role="img">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 44" width="180" height="44" aria-hidden="true">
            <defs>
              <linearGradient id="hdr-j" gradientUnits="userSpaceOnUse" x1="7" y1="3" x2="25" y2="41">
                <stop offset="0%" stopColor="#70bbff" />
                <stop offset="50%" stopColor="#2176f5" />
                <stop offset="100%" stopColor="#0d48d0" />
              </linearGradient>
            </defs>
            <path
              d="M 10 6 L 19 6 L 25 12 L 21 12 L 18 9 L 18 29 Q 18 37 10.5 37 Q 4 37 3 31"
              fill="none"
              stroke="url(#hdr-j)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text
              x="36"
              y="30"
              fontFamily="'Inter','Helvetica Neue',Arial,sans-serif"
              fontWeight="800"
              fontSize="24"
              letterSpacing="3"
              fill="currentColor"
            >
              JETLY
            </text>
          </svg>
        </span>
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
          <LanguageMenu language={language} setLanguage={setLanguage} options={LANGUAGE_OPTIONS} title={t('language')} />
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
        <p className="hero-sub">{adminRouteRequested ? 'Private analytics and control room for launch monitoring.' : heroSubText}</p>
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
              <span className="app-hero-pill">{opportunityFeedCount} feed opportunities</span>
              <span className="app-hero-pill">{destinationClusterCount} destination clusters</span>
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
              <strong className="app-hero-preview-value">{radarMatchesCount}</strong>
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
  );
}

