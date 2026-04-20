export function createLandingNavItems(t) {
  return [
    { id: 'landing-chiamo', label: t('navChiSiamo') },
    { id: 'landing-pricing', label: t('navPricing') },
    { id: 'landing-contacts', label: t('navContacts') }
  ];
}

export function createLandingFeatureCards(t) {
  return [
    { color: 'blue', icon: '\u{1F50D}', title: t('landingFeature1Title'), desc: t('landingFeature1Desc'), step: '01' },
    { color: 'teal', icon: '\u{1F514}', title: t('landingFeature2Title'), desc: t('landingFeature2Desc'), step: '02' },
    { color: 'purple', icon: '\u{1F9ED}', title: t('landingFeature3Title'), desc: t('landingFeature3Desc'), step: '03' }
  ];
}

export function createLandingValueCards(t) {
  return [
    { icon: '\u{1F4B8}', title: t('landingChiSiamoValue1'), desc: t('landingChiSiamoValue1Desc') },
    { icon: '\u{1F512}', title: t('landingChiSiamoValue2'), desc: t('landingChiSiamoValue2Desc') },
    { icon: '\u{1F680}', title: t('landingChiSiamoValue3'), desc: t('landingChiSiamoValue3Desc') }
  ];
}

export function createLandingPricingPlans({ t, formatEur, onChooseFreePlan, onChoosePremiumPlan, backendPricing = null }) {
  // Use live backend prices when available, fall back to hardcoded defaults.
  const proMonthly  = backendPricing?.pro?.priceMonthlyEur   ?? 7;
  const eliteMonthly = backendPricing?.creator?.priceMonthlyEur ?? backendPricing?.elite?.priceMonthlyEur ?? 19;
  const proAnnual   = +(proMonthly   * 12 * 0.75 / 12).toFixed(2);
  const eliteAnnual = +(eliteMonthly * 12 * 0.75 / 12).toFixed(2);

  return [
    {
      id: 'free',
      name: t('landingPricingFreeName') || 'Free',
      amountText: t('landingPricingFreePrice') || 'Free',
      desc: t('landingPricingFreeDesc') || 'Perfect for occasional travellers',
      features: [t('landingPricingFeatureFree1'), t('landingPricingFeatureFree2'), t('landingPricingFeatureFree3')],
      monthlyBillingNote: 'Always free',
      annualBillingNote: 'Always free',
      ctaClassName: 'landing-plan-cta ghost',
      ctaLabel: t('landingPricingCtaFree'),
      onClick: onChooseFreePlan,
      featured: false
    },
    {
      id: 'pro',
      name: t('landingPricingProName') || 'Pro',
      amount: formatEur(proMonthly),
      monthlyAmount: formatEur(proMonthly),
      annualAmount: formatEur(proAnnual),
      annualDiscountTag: `Save ${formatEur(Math.round((proMonthly - proAnnual) * 12))} EUR/year`,
      currency: 'EUR',
      period: t('landingPricingMonthly'),
      desc: t('landingPricingProDesc') || 'For regular travellers',
      features: [t('landingPricingFeaturePro1'), t('landingPricingFeaturePro2'), t('landingPricingFeaturePro3'), t('landingPricingFeaturePro4'), t('landingPricingFeaturePro5')],
      monthlyBillingNote: 'Billed monthly',
      annualBillingNote: `Billed yearly at EUR ${formatEur(Math.round(proAnnual * 12))}`,
      ctaClassName: 'landing-plan-cta landing-plan-cta-primary',
      ctaLabel: t('landingPricingCtaPro'),
      onClick: onChoosePremiumPlan,
      featured: true
    },
    {
      id: 'elite',
      name: t('landingPricingEliteName') || t('landingPricingCreatorName') || 'Elite',
      amount: formatEur(eliteMonthly),
      monthlyAmount: formatEur(eliteMonthly),
      annualAmount: formatEur(eliteAnnual),
      annualDiscountTag: `Save ${formatEur(Math.round((eliteMonthly - eliteAnnual) * 12))} EUR/year`,
      currency: 'EUR',
      period: t('landingPricingMonthly'),
      desc: t('landingPricingEliteDesc') || t('landingPricingCreatorDesc') || 'For professionals and analysts',
      features: [t('landingPricingFeatureCreator1'), t('landingPricingFeatureCreator2'), t('landingPricingFeatureCreator3'), t('landingPricingFeatureCreator4'), t('landingPricingFeatureCreator5')],
      monthlyBillingNote: 'Billed monthly',
      annualBillingNote: `Billed yearly at EUR ${formatEur(Math.round(eliteAnnual * 12))}`,
      ctaClassName: 'landing-plan-cta ghost',
      ctaLabel: t('landingPricingCtaElite') || t('landingPricingCtaCreator'),
      onClick: onChoosePremiumPlan,
      featured: false
    }
  ];
}

export function createLandingContactCards(t) {
  return [
    { icon: '\u2709', label: t('landingEmailLabel'), value: 'hello@flightsuite.app', href: 'mailto:hello@flightsuite.app' },
    { icon: '\u{1F4CD}', label: t('landingAddressLabel'), value: t('landingAddressValue') }
  ];
}
