export type UserPlan = 'free' | 'pro' | 'elite';

export type RadarMessagingTier = 'basic' | 'advanced' | 'priority';

export interface PlanEntitlements {
  plan: UserPlan;
  trackedRoutesLimit: number | null;
  savedItinerariesLimit: number | null;
  aiTravelCandidatesLimit: number | null;
  radarMessagingTier: RadarMessagingTier;
  hasPriorityDealsMessaging: boolean;
}

export interface UsageLimitState {
  limit: number | null;
  used: number;
  remaining: number | null;
  reached: boolean;
}

export type UpgradeTriggerContext =
  | 'tracked_routes_limit'
  | 'saved_itineraries_limit'
  | 'radar_hot_opened'
  | 'ai_travel_limit'
  | 'personal_hub';

export interface UpgradeTriggerContent {
  title: string;
  message: string;
  proLabel: string;
  eliteLabel: string;
}

export interface PlanComparisonRow {
  feature: string;
  free: string;
  pro: string;
  elite: string;
}
