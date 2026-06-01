import AuthSection from '../../../components/AuthSection';
import UpgradeFlowModal from '../../upgrade-flow/ui/UpgradeFlowModal';

function formatCheckoutAmount(value) {
  const amount = Number(value);
  const safeAmount = Number.isFinite(amount) && amount >= 0 ? amount : 0;
  return `EUR ${safeAmount.toFixed(2)}`;
}

function createCheckoutCart(planType, billingPricing, t) {
  const normalizedPlanType = planType === 'elite' ? 'elite' : 'pro';
  const pricing =
    normalizedPlanType === 'elite'
      ? billingPricing?.elite || billingPricing?.creator || null
      : billingPricing?.pro || null;
  const amount = Number(pricing?.monthlyEur ?? (normalizedPlanType === 'elite' ? 22 : 12));
  const amountLabel = formatCheckoutAmount(amount);
  return {
    planName: normalizedPlanType === 'elite' ? 'Flight Suite Elite' : 'Flight Suite Pro',
    intervalLabel: t('upgradeFlowMonthlySubscription'),
    quantity: 1,
    unitAmountLabel: amountLabel,
    totalLabel: amountLabel
  };
}

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
  checkoutLoading,
  searchLimitValueNote,
  t
}) {
  const checkoutCart = upgradePlanContent
    ? createCheckoutCart(upgradePlanContent.planType, billingPricing, t)
    : null;

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
        checkoutLoading={checkoutLoading}
        checkoutCart={checkoutCart}
        comparisonRows={planComparisonRows}
        valueNoteLabel={upgradeFlowState.source === 'search_limit' ? searchLimitValueNote : t('upgradeFlowValueNote')}
        closeLabel={t('close')}
        comparePlansLabel={t('upgradeFlowComparePlans')}
        goToPremiumLabel={t('upgradeFlowGoToPremium')}
        trustLineLabel={t('upgradeFlowTrustLine')}
        planSpotlightLabel={t('upgradeFlowPlanSpotlight')}
        planComparisonLabel={t('upgradeFlowPlanComparison')}
        planComparisonAriaLabel={t('upgradeFlowPlanComparisonAria')}
        featureLabel={t('upgradeFlowFeatureLabel')}
        currentPlanLabel={t('upgradeFlowCurrentPlan')}
        checkoutCartLabel={t('upgradeFlowCheckoutCart')}
        checkoutProviderLabel={t('upgradeFlowCheckoutProvider')}
        totalTodayLabel={t('upgradeFlowTotalToday')}
        checkoutLoadingLabel={t('upgradeFlowOpeningCheckout')}
        onClose={closePlanUpgradeFlow}
        onPrimaryAction={submitPlanUpgradeInterest}
        onOpenPremiumSection={openPremiumSectionFromUpgradeFlow}
      />
    </>
  );
}
