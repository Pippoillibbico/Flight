export function useLandingActions({
  isAuthenticated,
  t,
  beginAuthFlow,
  persistPostAuthAction,
  persistPostAuthSection,
  clearAuthFunnelState,
  setShowLandingPage,
  setShowAccountPanel,
  setSubMessage,
  setActiveMainSection
}) {
  function scrollToSection(sectionId) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
  }

  function enterGuestApp(targetSection = 'home') {
    persistPostAuthAction(null);
    persistPostAuthSection(null);
    clearAuthFunnelState();
    setShowLandingPage(false);
    setShowAccountPanel(false);
    setActiveMainSection(targetSection);
  }

  function handleLandingPrimaryCta() {
    if (isAuthenticated) {
      setShowLandingPage(false);
      setShowAccountPanel(false);
      setSubMessage(t('postAuthEnterAppReady'));
      setActiveMainSection('home');
      return;
    }
    enterGuestApp('home');
  }

  function handleLandingSecondaryCta() {
    if (isAuthenticated) {
      setShowLandingPage(false);
      setShowAccountPanel(false);
      setSubMessage(t('postAuthSetAlertHint'));
      setActiveMainSection('radar');
      return;
    }
    enterGuestApp('radar');
  }

  function handleLandingSignIn() {
    beginAuthFlow({
      action: 'enter_app',
      authMode: 'login',
      authView: 'options',
      keepLandingVisible: false,
      targetSection: 'explore'
    });
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
      keepLandingVisible: false,
      targetSection
    });
  }

  return {
    scrollToSection,
    enterGuestApp,
    handleLandingPrimaryCta,
    handleLandingSecondaryCta,
    handleLandingSignIn,
    requireSectionLogin
  };
}
