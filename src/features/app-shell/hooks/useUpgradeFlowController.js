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
  const upgradeIntentTracker = useMemo(() => createUpgradeIntentTracker(), []);

  const upgradePlanContent = useMemo(
    () => (upgradeFlowState.planType ? getUpgradePlanContent(upgradeFlowState.planType) : null),
    [upgradeFlowState.planType]
  );

  const openPlanUpgradeFlow = useCallback(
    (planType, source = 'unknown') => {
      const normalizedPlanType = planType === 'elite' ? 'elite' : 'pro';
      const normalizedSource = String(source || 'unknown').trim() || 'unknown';
      setSubMessage('');
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

  const submitPlanUpgradeInterest = useCallback(() => {
    if (!upgradeFlowState.isOpen || !upgradeFlowState.planType) return;
    const planType = upgradeFlowState.planType;
    const source = String(upgradeFlowState.source || 'unknown');
    upgradeIntentTracker.track('upgrade_primary_cta_clicked', planType, source);
    persistUpgradeInterest(planType, source, user?.id ? String(user.id) : null);
    applyLocalPlanChange(planType);
    setUpgradeFlowState((current) => submitUpgradeFlow(current));

    // When mock billing is enabled (dev/demo), also sync the upgrade server-side
    // so that server-enforced quota limits reflect the new plan immediately.
    if (systemCapabilities?.billing_mock_mode === true && api && token) {
      const mockEndpoint = planType === 'elite' ? api.mockUpgradeElite : api.mockUpgradePro;
      if (typeof mockEndpoint === 'function') {
        mockEndpoint(token).catch(() => {});
      }
    }
  }, [
    api,
    applyLocalPlanChange,
    systemCapabilities,
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
    closePlanUpgradeFlow,
    submitPlanUpgradeInterest,
    openPremiumSectionFromUpgradeFlow,
    upgradeToPremium,
    chooseElitePlan
  };
}
