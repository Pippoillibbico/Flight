export type UpgradePlanType = 'pro' | 'elite';
export type UpgradeFlowStep = 'details' | 'submitted';

export type UpgradeTrackingEventType =
  | 'upgrade_cta_shown'
  | 'upgrade_cta_clicked'
  | 'upgrade_modal_opened'
  | 'upgrade_primary_cta_clicked'
  | 'checkout_started'
  | 'checkout_session_created'
  | 'checkout_completed'
  | 'elite_cta_clicked'
  | 'elite_modal_opened'
  | 'trial_banner_shown'
  | 'trial_upgrade_clicked'
  | 'upgrade_prompt_shown'
  | 'upgrade_prompt_dismissed';
export type UpgradeSourceContext = 'web_app' | 'admin_backoffice' | 'api_client';

export interface UpgradeFlowState {
  isOpen: boolean;
  planType: UpgradePlanType | null;
  step: UpgradeFlowStep;
  source: string | null;
}

export interface UpgradePlanContent {
  planType: UpgradePlanType;
  badgeLabel: string;
  title: string;
  description: string;
  benefits: string[];
  primaryCtaLabel: string;
  submittedTitle: string;
  submittedMessage: string;
}

export interface UpgradeTrackingEvent {
  eventType: UpgradeTrackingEventType;
  planType: UpgradePlanType;
  source?: string;
  at: string;
  eventId?: string;
  eventVersion?: number;
  schemaVersion?: number;
  sourceContext?: UpgradeSourceContext;
}
