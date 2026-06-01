import type { UpgradePlanContent, UpgradePlanType } from '../types/index.ts';

const SOURCE_OVERRIDES: Partial<Record<string, Partial<UpgradePlanContent>>> = {
  search_limit: {
    title: 'Hai raggiunto il limite gratuito',
    description: 'Il piano FREE usa solo cache, snapshot e raccomandazioni statiche. Con PRO sblocchi AI live e ricerca live nei limiti del piano.',
    primaryCtaLabel: 'Continua con PRO'
  },
  limited_results: {
    title: 'Sblocca risultati reali',
    description: 'Stai vedendo una preview cached. Con PRO accedi a ricerca live, AI live e triangolazioni live nei limiti del piano.',
    primaryCtaLabel: 'Sblocca risultati reali'
  }
};

function label(t: ((key: string) => string) | null | undefined, key: string, fallback: string): string {
  const value = typeof t === 'function' ? t(key) : '';
  return value && value !== key ? value : fallback;
}

function benefitAt(content: UpgradePlanContent, index: number): string {
  return content.benefits[index] ?? '';
}

const PLAN_CONTENT: Record<UpgradePlanType, UpgradePlanContent> = {
  pro: {
    planType: 'pro',
    badgeLabel: 'PRO',
    title: 'Upgrade to PRO',
    description: 'Unlock live AI, live provider-backed search, intelligent triangulations, and flexible scans within plan quota.',
    benefits: [
      'Live AI and provider-backed flight search when configured',
      'Live intelligent triangulations and flexible period scans within quota',
      'AI explanations for routes, savings, and tradeoffs',
      'Advanced search tools without Free plan live-cost restrictions'
    ],
    primaryCtaLabel: 'Upgrade to PRO',
    submittedTitle: 'PRO interest recorded',
    submittedMessage: 'Your upgrade interest has been saved. To activate PRO server-side quotas, complete billing setup in your account settings.'
  },
  elite: {
    planType: 'elite',
    badgeLabel: 'ELITE',
    title: 'Discover ELITE',
    description: 'Add advanced automations, advanced alerts, and triangulation monitoring for power users.',
    benefits: [
      'Everything in PRO',
      'Advanced automations for recurring travel workflows',
      'Advanced alerts and continuous monitoring',
      'Triangulation monitoring for creators, digital nomads, and power users'
    ],
    primaryCtaLabel: 'Go ELITE',
    submittedTitle: 'ELITE interest recorded',
    submittedMessage: 'Your upgrade interest has been saved. To activate ELITE server-side quotas, complete billing setup in your account settings.'
  }
};

export function getUpgradePlanContent(planType: UpgradePlanType, source?: string | null, t?: (key: string) => string): UpgradePlanContent {
  const base = PLAN_CONTENT[planType];
  const overrides = source ? SOURCE_OVERRIDES[source] : undefined;
  const merged = overrides ? { ...base, ...overrides } : base;
  if (planType === 'elite') {
    return {
      ...merged,
      title: label(t, 'upgradeFlowEliteTitle', merged.title),
      description: label(t, 'upgradeFlowEliteDescription', merged.description),
      benefits: [
        label(t, 'upgradeFlowEliteBenefit1', benefitAt(merged, 0)),
        label(t, 'upgradeFlowEliteBenefit2', benefitAt(merged, 1)),
        label(t, 'upgradeFlowEliteBenefit3', benefitAt(merged, 2)),
        label(t, 'upgradeFlowEliteBenefit4', benefitAt(merged, 3))
      ],
      primaryCtaLabel: label(t, 'pricingEliteCta', merged.primaryCtaLabel),
      submittedTitle: label(t, 'upgradeFlowEliteSubmittedTitle', merged.submittedTitle),
      submittedMessage: label(t, 'upgradeFlowEliteSubmittedMessage', merged.submittedMessage)
    };
  }
  return {
    ...merged,
    title: label(t, source === 'search_limit' ? 'upgradeFlowSearchLimitTitle' : source === 'limited_results' ? 'upgradeFlowLimitedResultsTitle' : 'upgradeFlowProTitle', merged.title),
    description: label(t, source === 'search_limit' ? 'upgradeFlowSearchLimitDescription' : source === 'limited_results' ? 'upgradeFlowLimitedResultsDescription' : 'upgradeFlowProDescription', merged.description),
    benefits: [
      label(t, 'upgradeFlowProBenefit1', benefitAt(merged, 0)),
      label(t, 'upgradeFlowProBenefit2', benefitAt(merged, 1)),
      label(t, 'upgradeFlowProBenefit3', benefitAt(merged, 2)),
      label(t, 'upgradeFlowProBenefit4', benefitAt(merged, 3))
    ],
    primaryCtaLabel: label(t, source === 'search_limit' ? 'upgradeFlowSearchLimitCta' : source === 'limited_results' ? 'upgradeFlowLimitedResultsCta' : 'pricingProCta', merged.primaryCtaLabel),
    submittedTitle: label(t, 'upgradeFlowProSubmittedTitle', merged.submittedTitle),
    submittedMessage: label(t, 'upgradeFlowProSubmittedMessage', merged.submittedMessage)
  };
}
