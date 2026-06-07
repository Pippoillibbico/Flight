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
  setShowAccountPanel,
  setAuthMode,
  setAuthView,
  setAuthError,
  beginAuthFlow,
  user,
  heroSubText,
  isLiveDataSource,
  heroDataSourceNote,
  setActiveMainSection,
  setShowLandingPage
}) {
  const goHome = () => {
    setActiveMainSection('home');
    if (typeof setShowLandingPage === 'function') {
      setShowLandingPage(true);
    }
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/');
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  };

  return (
    <header className="hero">
      <div className="hero-top-row">
        <a
          href="/"
          className="hero-brand-logo landing-brand-home-link"
          aria-label={t('navHome')}
          onClick={(event) => {
            event.preventDefault();
            goHome();
          }}
        >
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
        </a>
        <nav className="landing-nav hero-controls">
          <button type="button" className="landing-ctrl-btn landing-theme-btn app-header-control-btn" onClick={() => setDarkMode((prev) => !prev)}>
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
            <span className="landing-ctrl-label">{darkMode ? t('themeDark') : t('themeLight')}</span>
          </button>
          <LanguageMenu language={language} setLanguage={setLanguage} options={LANGUAGE_OPTIONS} title={t('language')} />
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
    </header>
  );
}
