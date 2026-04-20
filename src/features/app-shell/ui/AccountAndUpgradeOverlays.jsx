import AuthSection from '../../../components/AuthSection';
import UpgradeFlowModal from '../../upgrade-flow/ui/UpgradeFlowModal';

export default function AccountAndUpgradeOverlays({
  adminRouteRequested,
  isAuthenticated,
  showAccountPanel,
  showAuthGateModal,
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
  openOnboardingSetup,
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
  systemCapabilities,
  upgradeFlowState,
  upgradePlanContent,
  userPlanType,
  planComparisonRows,
  closePlanUpgradeFlow,
  submitPlanUpgradeInterest,
  openPremiumSectionFromUpgradeFlow,
  searchLimitValueNote
}) {
  return (
    <>
      <AuthSection
        showAccountPanel={(!adminRouteRequested || isAuthenticated) && (showAccountPanel || showAuthGateModal)}
        darkMode={darkMode}
        setShowAccountPanel={setShowAccountPanel}
        logout={logout}
        formatEur={formatEur}
        billingPricing={billingPricing}
        formatPricingDate={formatPricingDate}
        billingPricingLoading={billingPricingLoading}
        loadBillingPricing={loadBillingPricing}
        billingPricingError={billingPricingError}
        upgradeToPremium={() => upgradeToPremium('account_panel')}
        chooseElitePlan={() => chooseElitePlan('account_panel')}
        reopenOnboarding={openOnboardingSetup}
        setupMfa={setupMfa}
        disableMfa={disableMfa}
        resetMfaSetup={resetMfaSetup}
        mfaActionCode={mfaActionCode}
        setMfaActionCode={setMfaActionCode}
        mfaSetupData={mfaSetupData}
        enableMfa={enableMfa}
        authView={authView}
        authMode={authMode}
        setAuthMode={setAuthMode}
        loginWithFacebook={loginWithFacebook}
        oauthLoading={oauthLoading}
        loginWithGoogle={loginWithGoogle}
        loginWithApple={loginWithApple}
        submitAuth={submitAuth}
        authForm={authForm}
        setAuthForm={setAuthForm}
        setAuthView={setAuthView}
        rememberMe={rememberMe}
        setRememberMe={setRememberMe}
        submitLoginMfa={submitLoginMfa}
        authMfa={authMfa}
        setAuthMfa={setAuthMfa}
        authError={authError}
        deleteAccount={deleteAccount}
        deletingAccount={deletingAccount}
        systemCapabilities={systemCapabilities}
      />

      <UpgradeFlowModal
        isOpen={upgradeFlowState.isOpen}
        step={upgradeFlowState.step}
        content={upgradePlanContent}
        currentPlanType={userPlanType}
        comparisonRows={planComparisonRows}
        valueNoteLabel={upgradeFlowState.source === 'search_limit' ? searchLimitValueNote : undefined}
        onClose={closePlanUpgradeFlow}
        onPrimaryAction={submitPlanUpgradeInterest}
        onOpenPremiumSection={openPremiumSectionFromUpgradeFlow}
      />
    </>
  );
}

