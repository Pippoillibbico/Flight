import type { UpgradePlanContent, UpgradePlanType } from '../types/index.ts';

const PLAN_CONTENT: Record<UpgradePlanType, UpgradePlanContent> = {
  pro: {
    planType: 'pro',
    badgeLabel: 'PRO',
    title: 'Upgrade to PRO',
    description: 'Track more routes, save more itineraries, and unlock advanced radar messaging.',
    benefits: [
      'Track up to 10 routes and never miss a major drop',
      'Save up to 10 itineraries in your personal hub',
      'Advanced radar messaging for stronger opportunity context',
      'Full AI Travel generation without free-plan candidate cap'
    ],
    primaryCtaLabel: 'Upgrade to PRO',
    submittedTitle: 'PRO interest recorded',
    submittedMessage: 'Your upgrade interest has been saved. To activate PRO server-side quotas, complete billing setup in your account settings.'
  },
  elite: {
    planType: 'elite',
    badgeLabel: 'ELITE',
    title: 'Discover ELITE',
    description: 'Unlock unlimited limits and priority intelligence for the highest-value opportunities.',
    benefits: [
      'Unlimited tracked routes and unlimited saved itineraries',
      'Priority radar messaging on top-value opportunities',
      'Priority-deal visibility before standard users',
      'Full AI Travel generation with premium intelligence positioning'
    ],
    primaryCtaLabel: 'Go ELITE',
    submittedTitle: 'ELITE interest recorded',
    submittedMessage: 'Your upgrade interest has been saved. To activate ELITE server-side quotas, complete billing setup in your account settings.'
  }
};

export function getUpgradePlanContent(planType: UpgradePlanType): UpgradePlanContent {
  return PLAN_CONTENT[planType];
}
