/**
 * @param {{
 *   t: Function,
 *   premiumBillingCycle: 'monthly'|'annual',
 *   activateFreePlan: Function,
 *   upgradeToPremium: Function,
 *   chooseElitePlan: Function,
 *   backendPricing?: { pro?: { monthlyEur?: number }, creator?: { monthlyEur?: number } }
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
  const proMonthlyEur = Number(backendPricing?.pro?.monthlyEur) || 12.99;
  const eliteMonthlyEur = Number(backendPricing?.creator?.monthlyEur) || 29.99;

  // Annual pricing: 30% discount applied to the monthly price
  const ANNUAL_DISCOUNT = 0.30;
  const proAnnualMonthlyEur = Math.round(proMonthlyEur * (1 - ANNUAL_DISCOUNT) * 100) / 100;
  const proAnnualYearlyEur = Math.round(proAnnualMonthlyEur * 12 * 100) / 100;
  const proAnnualSaveEur = Math.round((proMonthlyEur * 12 - proAnnualYearlyEur) * 100) / 100;

  const eliteAnnualMonthlyEur = Math.round(eliteMonthlyEur * (1 - ANNUAL_DISCOUNT) * 100) / 100;
  const eliteAnnualYearlyEur = Math.round(eliteAnnualMonthlyEur * 12 * 100) / 100;
  const eliteAnnualSaveEur = Math.round((eliteMonthlyEur * 12 - eliteAnnualYearlyEur) * 100) / 100;
  return [
    {
      id: 'free',
      badge: 'Starter',
      badgeDetail: 'For first-time users',
      planName: 'FREE',
      subtitle: t('pricingFreeSub'),
      valueTitle: t('pricingFreeFeature1'),
      valueItems: [t('pricingFreeFeature2'), t('pricingFreeFeature3')],
      meterStops: ['3/day', '7/day', '15/day'],
      monthly: {
        discountTag: '',
        legacyPrice: '',
        price: 'EUR 0',
        priceSuffix: '/month',
        billingNote: 'No card required',
        billingSubNote: 'Start immediately and upgrade only when you need more.',
        saveNote: 'Always free.'
      },
      annual: {
        discountTag: '',
        legacyPrice: '',
        price: 'EUR 0',
        priceSuffix: '/month',
        billingNote: 'No annual billing',
        billingSubNote: 'FREE plan stays unchanged across billing cycles.',
        saveNote: 'Always free.'
      },
      compareNote: t('premiumCompareNoteFree') || 'Best for trying the platform with zero risk.',
      included: [t('pricingFreeFeature1'), t('pricingFreeFeature2'), t('pricingFreeFeature3')],
      missing: [t('pricingProFeature2'), t('pricingProFeature3'), t('pricingEliteFeature1')],
      ctaLabel: t('pricingFreeCta'),
      ctaClassName: 'premium-cta premium-cta-light',
      onClick: activateFreePlan,
      cardTestId: 'premium-plan-free',
      ctaTestId: 'premium-switch-free'
    },
    {
      id: 'pro',
      badge: 'Most Popular',
      badgeDetail: 'For regular travelers',
      planName: 'PRO',
      subtitle: t('pricingProSub'),
      valueTitle: t('pricingProFeature1'),
      valueItems: [t('pricingProFeature2'), t('pricingProFeature3')],
      meterStops: ['12', '9', '7'],
      monthly: {
        discountTag: '',
        legacyPrice: '',
        price: `EUR ${proMonthlyEur}`,
        priceSuffix: '/month',
        billingNote: 'Billed monthly',
        billingSubNote: 'Full PRO access with month-to-month flexibility.',
        saveNote: 'Cancel anytime.'
      },
      annual: {
        discountTag: 'UP TO 30% OFF',
        legacyPrice: `EUR ${proMonthlyEur}`,
        price: `EUR ${proAnnualMonthlyEur}`,
        priceSuffix: '/month',
        billingNote: `Billed yearly at EUR ${proAnnualYearlyEur}`,
        billingSubNote: `Equivalent to EUR ${proAnnualMonthlyEur}/month with one annual payment.`,
        saveNote: `Save EUR ${proAnnualSaveEur} per year vs monthly.`
      },
      compareNote: t('premiumCompareNotePro') || 'Ideal if you want to monitor prices and act fast.',
      included: [t('pricingProFeature1'), t('pricingProFeature2'), t('pricingProFeature3'), t('pricingProFeature4')],
      missing: [t('pricingEliteFeature1'), t('pricingEliteFeature2'), t('pricingEliteFeature3')],
      ctaLabel: t('pricingProCta'),
      ctaClassName: 'premium-cta',
      onClick: () => upgradeToPremium('premium_page'),
      cardTestId: 'premium-plan-pro',
      ctaTestId: 'premium-upgrade-pro'
    },
    {
      id: 'elite',
      badge: 'Best Value',
      badgeDetail: 'For power workflows',
      planName: 'ELITE',
      subtitle: t('pricingEliteSub'),
      valueTitle: t('pricingEliteFeature1'),
      valueItems: [t('pricingEliteFeature2'), t('pricingEliteFeature3')],
      meterStops: ['29', '24', '21'],
      monthly: {
        discountTag: '',
        legacyPrice: '',
        price: `EUR ${eliteMonthlyEur}`,
        priceSuffix: '/month',
        billingNote: 'Billed monthly',
        billingSubNote: 'Priority intelligence and advanced planning unlocked.',
        saveNote: 'Priority intelligence unlocked.'
      },
      annual: {
        discountTag: '30% OFF',
        legacyPrice: `EUR ${eliteMonthlyEur}`,
        price: `EUR ${eliteAnnualMonthlyEur}`,
        priceSuffix: '/month',
        billingNote: `Billed yearly at EUR ${eliteAnnualYearlyEur}`,
        billingSubNote: `Equivalent to EUR ${eliteAnnualMonthlyEur}/month when billed annually.`,
        saveNote: `Save EUR ${eliteAnnualSaveEur} per year vs monthly.`
      },
      compareNote: t('premiumCompareNoteElite') || 'For power users who need AI planning and premium depth.',
      included: [t('pricingEliteFeature1'), t('pricingEliteFeature2'), t('pricingEliteFeature3'), t('pricingEliteFeature4')],
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
