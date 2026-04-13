import type { UpgradeFlowState, UpgradePlanType } from '../types/index.ts';

export function createUpgradeFlowState(): UpgradeFlowState {
  return {
    isOpen: false,
    planType: null,
    step: 'details',
    source: null
  };
}

export function openUpgradeFlow(
  current: UpgradeFlowState,
  planType: UpgradePlanType,
  source: string | null = null
): UpgradeFlowState {
  return {
    ...current,
    isOpen: true,
    planType,
    step: 'details',
    source
  };
}

export function submitUpgradeFlow(current: UpgradeFlowState): UpgradeFlowState {
  if (!current.isOpen || !current.planType) return current;
  return {
    ...current,
    step: 'submitted'
  };
}

export function closeUpgradeFlow(): UpgradeFlowState {
  return createUpgradeFlowState();
}
