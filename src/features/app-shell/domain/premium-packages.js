/**
 * @param {{
 *   t: Function,
 *   premiumBillingCycle: 'monthly'|'annual',
 *   activateFreePlan: Function,
 *   upgradeToPremium: Function,
 *   chooseElitePlan: Function,
 *   backendPricing?: { pro?: { monthlyEur?: number }, elite?: { monthlyEur?: number }, creator?: { monthlyEur?: number } }
 * }} options
 */
export function createPremiumPackages({
  t,
  premiumBillingCycle,
  activateFreePlan,
  upgradeToPremium,
  chooseElitePlan,
  // Live prices fetched from /api/billing/pricing — fall back to constants if absent
  backendPricing = null
}) {
  // Prices from backend are authoritative; fallback only if backend is unavailable
  const proMonthlyEur = Number(backendPricing?.pro?.monthlyEur) || 12;
  const eliteMonthlyEur = Number(backendPricing?.elite?.monthlyEur ?? backendPricing?.creator?.monthlyEur) || 22;

  // Annual pricing: 30% discount applied to the monthly price
  const ANNUAL_DISCOUNT = 0.30;
  const proAnnualMonthlyEur = Math.round(proMonthlyEur * (1 - ANNUAL_DISCOUNT) * 100) / 100;
  const proAnnualYearlyEur = Math.round(proAnnualMonthlyEur * 12 * 100) / 100;
  const proAnnualSaveEur = Math.round((proMonthlyEur * 12 - proAnnualYearlyEur) * 100) / 100;

  const eliteAnnualMonthlyEur = Math.round(eliteMonthlyEur * (1 - ANNUAL_DISCOUNT) * 100) / 100;
  const eliteAnnualYearlyEur = Math.round(eliteAnnualMonthlyEur * 12 * 100) / 100;
  const eliteAnnualSaveEur = Math.round((eliteMonthlyEur * 12 - eliteAnnualYearlyEur) * 100) / 100;
  const label = (key, fallback) => {
    const value = t(key);
    return value && value !== key ? value : fallback;
  };
  const annualBillingPrefix = label('landingPricingAnnualBillingPrefix', 'Billed yearly at EUR');
  const formatAnnualEquivalent = (amount) => label('premiumAnnualEquivalentPrefix', 'Equivalent to EUR {amount}/month with one annual payment.').replace('{amount}', amount);
  const formatAnnualSave = (amount) => label('premiumAnnualSavePrefix', 'Save EUR {amount} per year vs monthly.').replace('{amount}', amount);
  const freeIncluded = [
    label('pricingFreeFeature1', 'Cached previews, snapshots, and precomputed results'),
    label('pricingFreeFeature2', 'Static recommendations and local search'),
    label('pricingFreeFeature3', 'No live AI, live flight provider calls, live triangulation, or live monitoring')
  ];
  const proIncluded = [
    label('pricingProFeature1', 'Live AI and provider-backed flight search when configured'),
    label('pricingProFeature2', 'Live intelligent triangulations'),
    label('pricingProFeature3', 'Live intelligent triangulations and flexible period scans within quota'),
    label('pricingProFeature4', 'AI route explanations and advanced search tools')
  ];
  const creatorIncluded = [
    label('pricingEliteFeature1', 'Everything in PRO'),
    label('pricingEliteFeature2', 'Advanced automations and advanced alerts'),
    label('pricingEliteFeature3', 'Triangulation monitoring for creators, digital nomads, and power users')
  ];
  return [
    {
      id: 'free',
      badge: label('premiumPlanBadgeFree', 'Starter'),
      badgeDetail: label('premiumPlanBadgeDetailFree', 'For first-time users'),
      planName: 'FREE',
      subtitle: label('pricingFreeSub', 'Free previews based on cached data, snapshots, and static recommendations. No live search or live AI included.'),
      valueTitle: label('premiumValueTitleFree', 'Zero variable-cost preview'),
      valueItems: freeIncluded.slice(1),
      meterStops: ['3/day', '7/day', '15/day'],
      monthly: {
        discountTag: '',
        legacyPrice: '',
        price: 'EUR 0',
        priceSuffix: label('landingPricingMonthly', '/month'),
        billingNote: label('premiumBillingNoCard', 'No card required'),
        billingSubNote: label('premiumBillingSubFree', 'Start immediately and upgrade only when you need more.'),
        saveNote: label('premiumSaveNoteFree', 'Always free.')
      },
      annual: {
        discountTag: '',
        legacyPrice: '',
        price: 'EUR 0',
        priceSuffix: label('landingPricingMonthly', '/month'),
        billingNote: label('premiumBillingNoAnnualFree', 'No annual billing'),
        billingSubNote: label('premiumBillingSubFreeAnnual', 'FREE plan stays unchanged across billing cycles.'),
        saveNote: label('premiumSaveNoteFree', 'Always free.')
      },
      compareNote: label('premiumCompareNoteFree', 'Best for trying the platform with zero variable-cost usage.'),
      included: freeIncluded,
      missing: [
        label('premiumMissingLiveAi', 'Live AI'),
        label('premiumMissingLiveProvider', 'Live flight provider search'),
        label('premiumMissingLiveTriangulation', 'Live triangulations and live alerts')
      ],
      ctaLabel: t('pricingFreeCta'),
      ctaClassName: 'premium-cta premium-cta-light',
      onClick: activateFreePlan,
      cardTestId: 'premium-plan-free',
      ctaTestId: 'premium-switch-free'
    },
    {
      id: 'pro',
      badge: label('premiumPlanBadgePro', 'Most popular'),
      badgeDetail: label('premiumPlanBadgeDetailPro', 'For regular travelers'),
      planName: 'PRO',
      subtitle: label('pricingProSub', 'Smart search with AI and live capabilities within plan quota.'),
      valueTitle: label('premiumValueTitlePro', 'Live search and AI'),
      valueItems: proIncluded.slice(1),
      meterStops: ['12', '9', '7'],
      monthly: {
        discountTag: '',
        legacyPrice: '',
        price: `EUR ${proMonthlyEur}`,
        priceSuffix: label('landingPricingMonthly', '/month'),
        billingNote: label('landingPricingMonthlyBillingNote', 'Billed monthly'),
        billingSubNote: label('premiumBillingSubPro', 'Full PRO access with month-to-month flexibility.'),
        saveNote: label('premiumSaveNotePro', 'Cancel anytime.')
      },
      annual: {
        discountTag: label('premiumBillingAnnualDiscountLong', 'UP TO 30% OFF'),
        legacyPrice: `EUR ${proMonthlyEur}`,
        price: `EUR ${proAnnualMonthlyEur}`,
        priceSuffix: label('landingPricingMonthly', '/month'),
        billingNote: `${annualBillingPrefix} ${proAnnualYearlyEur}`,
        billingSubNote: formatAnnualEquivalent(proAnnualMonthlyEur),
        saveNote: formatAnnualSave(proAnnualSaveEur)
      },
      compareNote: label('premiumCompareNotePro', 'Ideal for live research, route explanations, and flexible scans within quota.'),
      included: proIncluded,
      missing: [
        label('premiumMissingAdvancedAutomations', 'Advanced automations'),
        label('premiumMissingAdvancedAlerts', 'Advanced alert workflows'),
        label('premiumMissingTriangulationMonitoring', 'Triangulation monitoring')
      ],
      ctaLabel: t('pricingProCta'),
      ctaClassName: 'premium-cta',
      onClick: () => upgradeToPremium('premium_page'),
      cardTestId: 'premium-plan-pro',
      ctaTestId: 'premium-upgrade-pro'
    },
    {
      id: 'elite',
      badge: label('premiumPlanBadgeElite', 'Best value'),
      badgeDetail: label('premiumPlanBadgeDetailElite', 'For power workflows'),
      planName: 'ELITE',
      subtitle: label('pricingEliteSub', 'Automation, advanced alerts, and continuous monitoring for power users.'),
      valueTitle: label('premiumValueTitleElite', 'Creator-grade automation'),
      valueItems: creatorIncluded.slice(1),
      meterStops: ['29', '24', '21'],
      monthly: {
        discountTag: '',
        legacyPrice: '',
        price: `EUR ${eliteMonthlyEur}`,
        priceSuffix: label('landingPricingMonthly', '/month'),
        billingNote: label('landingPricingMonthlyBillingNote', 'Billed monthly'),
        billingSubNote: label('premiumBillingSubElite', 'Priority intelligence and advanced planning unlocked.'),
        saveNote: label('premiumSaveNoteElite', 'Priority intelligence unlocked.')
      },
      annual: {
        discountTag: label('premiumBillingAnnualDiscount', '30% OFF'),
        legacyPrice: `EUR ${eliteMonthlyEur}`,
        price: `EUR ${eliteAnnualMonthlyEur}`,
        priceSuffix: label('landingPricingMonthly', '/month'),
        billingNote: `${annualBillingPrefix} ${eliteAnnualYearlyEur}`,
        billingSubNote: formatAnnualEquivalent(eliteAnnualMonthlyEur),
        saveNote: formatAnnualSave(eliteAnnualSaveEur)
      },
      compareNote: label('premiumCompareNoteElite', 'For creators, digital nomads, and power users who need monitoring and automation.'),
      included: creatorIncluded,
      missing: [],
      ctaLabel: t('pricingEliteCta'),
      ctaClassName: 'premium-cta premium-cta-dark',
      onClick: () => chooseElitePlan('premium_page'),
      cardTestId: 'premium-plan-elite',
      ctaTestId: 'premium-upgrade-elite'
    }
  ].map((plan) => {
    const pricing = premiumBillingCycle === 'annual' ? plan.annual : plan.monthly;
    const { monthly, annual, ...basePlan } = plan;
    return {
      ...basePlan,
      ...pricing
    };
  });
}
