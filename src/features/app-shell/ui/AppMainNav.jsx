export default function AppMainNav({
  t,
  isAuthenticated,
  radarMatchesCount,
  radarSessionActivated,
  userPlanType,
  activeMainSection,
  setActiveMainSection
}) {
  const radarMatchCount = Number(radarMatchesCount) || 0;
  const normalizedUserPlanType = String(userPlanType || 'free').trim().toLowerCase();
  const hasPaidPlan = normalizedUserPlanType !== 'free';
  const planNavLabel = hasPaidPlan ? t('navMyPlan') : t('navPlans');
  const navHint = (key, fallback) => {
    const localized = t(key);
    return localized && localized !== key ? localized : fallback;
  };
  const shouldShowRadarPreview = isAuthenticated || radarMatchCount > 0 || radarSessionActivated;

  return (
    <nav className="app-main-nav" aria-label={t('appTitle')}>
      <button
        type="button"
        className={activeMainSection === 'home' ? 'tab active' : 'tab'}
        onClick={() => setActiveMainSection('home')}
        data-testid="app-nav-home"
      >
        <span>{t('navHome')}</span>
        <small>{navHint('navHomeHint', 'Overview')}</small>
      </button>
      <button
        type="button"
        className={activeMainSection === 'explore' ? 'tab active' : 'tab'}
        onClick={() => setActiveMainSection('explore')}
        data-testid="app-nav-explore"
      >
        <span>{t('navExplore')}</span>
        <small>{navHint('navExploreHint', 'Search flights')}</small>
      </button>
      <button
        type="button"
        className={activeMainSection === 'radar' ? 'tab active' : 'tab'}
        onClick={() => setActiveMainSection('radar')}
        data-testid="app-nav-radar"
      >
        <span>{t('navRadar')}</span>
        <small>{shouldShowRadarPreview ? `${radarMatchCount} ${t('heroRadarSnapshots')}` : navHint('navRadarHint', 'Alerts and routes')}</small>
      </button>
      <button
        type="button"
        className={activeMainSection === 'ai-travel' ? 'tab active' : 'tab'}
        onClick={() => setActiveMainSection('ai-travel')}
        data-testid="app-nav-ai-travel"
      >
        <span>{t('navAiTravel')}</span>
        <small>{navHint('navAiTravelHint', 'Guided ideas')}</small>
      </button>
      <button
        type="button"
        className={activeMainSection === 'premium' ? 'tab active' : 'tab'}
        onClick={() => setActiveMainSection('premium')}
        data-testid="app-nav-premium"
      >
        <span>{planNavLabel}</span>
        <small>{hasPaidPlan ? navHint('navMyPlanHint', 'Manage') : navHint('navPlansHint', 'Unlock more')}</small>
      </button>
    </nav>
  );
}
