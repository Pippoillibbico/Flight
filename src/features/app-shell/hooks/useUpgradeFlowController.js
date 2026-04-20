import { useCallback, useMemo, useState } from 'react';
import {
  closeUpgradeFlow,
  createUpgradeFlowState,
  createUpgradeIntentTracker,
  getUpgradePlanContent,
  openUpgradeFlow,
  persistUpgradeInterest,
  submitUpgradeFlow
} from '../../upgrade-flow';
import { isMockBillingUpgradeEnabled } from '../domain/billing-mode.js';

export function useUpgradeFlowController({
  user,
  applyLocalPlanChange,
  setSubMessage,
  setActiveMainSection,
  // Optional: pass to sync server-side plan when mock billing is enabled.
  api = null,
  token = null,
  systemCapabilities = null
}) {
  const [upgradeFlowState, setUpgradeFlowState] = useState(() => createUpgradeFlowState());
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const upgradeIntentTracker = useMemo(() => createUpgradeIntentTracker(), []);
  const isProductionBuild = String(import.meta?.env?.MODE || '').trim().toLowerCase() === 'production' || Boolean(import.meta?.env?.PROD);
  const mockBillingEnabled = isMockBillingUpgradeEnabled({
    systemCapabilities,
    isProduction: isProductionBuild
  });

  const upgradePlanContent = useMemo(
    () => (upgradeFlowState.planType ? getUpgradePlanContent(upgradeFlowState.planType, upgradeFlowState.source) : null),
    [upgradeFlowState.planType, upgradeFlowState.source]
  );

  const openPlanUpgradeFlow = useCallback(
    (planType, source = 'unknown') => {
      const normalizedPlanType = planType === 'elite' ? 'elite' : 'pro';
      const normalizedSource = String(source || 'unknown').trim() || 'unknown';
      setSubMessage('');
      // Track that the upgrade CTA was shown (conversion funnel step 1).
      upgradeIntentTracker.track('upgrade_cta_shown', normalizedPlanType, normalizedSource);
      if (normalizedPlanType === 'elite') {
        upgradeIntentTracker.track('elite_cta_clicked', 'elite', normalizedSource);
        upgradeIntentTracker.track('elite_modal_opened', 'elite', normalizedSource);
      } else {
        upgradeIntentTracker.track('upgrade_cta_clicked', 'pro', normalizedSource);
        upgradeIntentTracker.track('upgrade_modal_opened', 'pro', normalizedSource);
      }
      setUpgradeFlowState((current) => openUpgradeFlow(current, normalizedPlanType, normalizedSource));
    },
    [setSubMessage, upgradeIntentTracker]
  );

  const closePlanUpgradeFlow = useCallback(() => {
    setUpgradeFlowState(closeUpgradeFlow());
  }, []);

  const submitPlanUpgradeInterest = useCallback(async () => {
    if (!upgradeFlowState.isOpen || !upgradeFlowState.planType) return;
    const planType = upgradeFlowState.planType;
    const source = String(upgradeFlowState.source || 'unknown');

    upgradeIntentTracker.track('upgrade_primary_cta_clicked', planType, source);
    persistUpgradeInterest(planType, source, user?.id ? String(user.id) : null);

    // ── Real Stripe checkout (production path) ─────────────────────────────
    // When Stripe is configured (billing_mock_mode !== true) redirect the user
    // to a real Stripe Checkout session instead of applying a local plan change.
    if (!mockBillingEnabled && api && token) {
      setCheckoutLoading(true);
      setSubMessage('');
      try {
        const result = await api.billingCheckout(token, {
          planType: planType === 'elite' ? 'elite' : 'pro'
        });
        if (result?.checkoutUrl) {
          upgradeIntentTracker.track('checkout_session_created', planType, source);
          upgradeIntentTracker.track('checkout_started', planType, source);
          window.location.href = result.checkoutUrl;
          return; // Navigation started — do not continue
        }
        // No URL returned — fall through to mock path
        setSubMessage('Checkout unavailable right now. Please try again.');
      } catch {
        setSubMessage('Unable to start checkout. Please try again.');
      } finally {
        setCheckoutLoading(false);
      }
      return;
    }

    // ── Mock / demo path (dev/test only) ────────────────────────────────────
    if (mockBillingEnabled) {
      applyLocalPlanChange(planType);
      setUpgradeFlowState((current) => submitUpgradeFlow(current));
      const mockEndpoint = planType === 'elite' ? api.mockUpgradeElite : api.mockUpgradePro;
      if (typeof mockEndpoint === 'function') {
        mockEndpoint(token).catch(() => {});
      }
      return;
    }
    setSubMessage('Checkout unavailable right now. Please try again.');
  }, [
    api,
    applyLocalPlanChange,
    mockBillingEnabled,
    setSubMessage,
    token,
    upgradeFlowState.isOpen,
    upgradeFlowState.planType,
    upgradeFlowState.source,
    upgradeIntentTracker,
    user?.id
  ]);

  const openPremiumSectionFromUpgradeFlow = useCallback(() => {
    setActiveMainSection('premium');
    setUpgradeFlowState(closeUpgradeFlow());
  }, [setActiveMainSection]);

  const upgradeToPremium = useCallback(
    (source = 'unknown') => {
      openPlanUpgradeFlow('pro', source);
    },
    [openPlanUpgradeFlow]
  );

  const chooseElitePlan = useCallback(
    (source = 'unknown') => {
      openPlanUpgradeFlow('elite', source);
    },
    [openPlanUpgradeFlow]
  );

  return {
    upgradeFlowState,
    upgradePlanContent,
    checkoutLoading,
    openPlanUpgradeFlow,
    closePlanUpgradeFlow,
    submitPlanUpgradeInterest,
    openPremiumSectionFromUpgradeFlow,
    upgradeToPremium,
    chooseElitePlan
  };
}
