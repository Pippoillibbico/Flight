export function createLandingNavItems(t) {
  return [
    { id: 'landing-ai-hacker', label: t('navAiHacker') || 'AI Flight Hacker' },
    { id: 'landing-chiamo', label: t('navChiSiamo') },
    { id: 'landing-pricing', label: t('navPricing') },
    { id: 'landing-contacts', label: t('navContacts') }
  ];
}

export function createLandingFeatureCards(t) {
  return [
    { color: 'blue', icon: '\u{1F50D}', title: t('landingFeature1Title'), desc: t('landingFeature1Desc'), step: '01' },
    { color: 'teal', icon: '\u{1F9E0}', title: t('landingFeatureAiTitle') || 'AI Flight Hacker', desc: t('landingFeatureAiDesc') || "Scrivi una richiesta naturale: l'AI la trasforma in una ricerca intelligente con rotte alternative e confronti chiari.", step: '02' },
    { color: 'purple', icon: '\u{1F9ED}', title: t('landingFeature2Title'), desc: t('landingFeature2Desc'), step: '03' },
    { color: 'teal', icon: '\u{1F514}', title: t('landingFeature3Title'), desc: t('landingFeature3Desc'), step: '04' }
  ];
}

export function createLandingValueCards(t) {
  return [
    { icon: '01', title: t('landingChiSiamoValue1'), desc: t('landingChiSiamoValue1Desc') },
    { icon: '02', title: t('landingChiSiamoValue2'), desc: t('landingChiSiamoValue2Desc') },
    { icon: '03', title: t('landingChiSiamoValue3'), desc: t('landingChiSiamoValue3Desc') }
  ];
}

export function createLandingPricingPlans({ t, formatEur, onChooseFreePlan, onChoosePremiumPlan, backendPricing = null }) {
  // Use live backend prices when available, fall back to hardcoded defaults.
  const proMonthly = backendPricing?.pro?.monthlyEur ?? backendPricing?.pro?.priceMonthlyEur ?? 12;
  const eliteMonthly =
    backendPricing?.elite?.monthlyEur ??
    backendPricing?.elite?.priceMonthlyEur ??
    backendPricing?.creator?.monthlyEur ??
    backendPricing?.creator?.priceMonthlyEur ??
    22;
  const proAnnual   = +(proMonthly   * 12 * 0.75 / 12).toFixed(2);
  const eliteAnnual = +(eliteMonthly * 12 * 0.75 / 12).toFixed(2);

  return [
    {
      id: 'free',
      name: t('landingPricingFreeName') || 'Free',
      amountText: t('landingPricingFreePrice') || 'Free',
      desc: t('landingPricingFreeDesc') || 'Discover travel ideas and opportunities worth exploring without spending a thing.',
      features: [
        t('landingPricingFeatureFree1') || 'Travel ideas and opportunities worth exploring',
        t('landingPricingFeatureFree2') || 'Route and destination previews',
        t('landingPricingFeatureFree3') || 'AI and live fare checks available with Premium'
      ],
      monthlyBillingNote: t('landingPricingFreeBillingNote') || 'Always free',
      annualBillingNote: t('landingPricingFreeBillingNote') || 'Always free',
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
      desc: t('landingPricingProDesc') || 'Find smarter routes with AI Flight Hacker, live fare checks, and broader comparisons.',
      features: [
        t('landingPricingFeaturePro1') || 'AI Flight Hacker turns your request into routes worth comparing',
        t('landingPricingFeaturePro2') || 'Live fare checks across available services',
        t('landingPricingFeaturePro3') || 'Smart triangulations and flexible dates',
        t('landingPricingFeaturePro4') || 'Clear guidance on savings, risks, and alternatives',
        t('landingPricingFeaturePro5') || 'Broader comparisons, including different currencies'
      ],
      monthlyBillingNote: t('landingPricingMonthlyBillingNote') || 'Billed monthly',
      annualBillingNote: `${t('landingPricingAnnualBillingPrefix') || 'Billed yearly at EUR'} ${formatEur(Math.round(proAnnual * 12))}`,
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
      desc: t('landingPricingEliteDesc') || 'Keep the radar running with more alerts, monitoring, and automations for frequent travelers.',
      features: [
        t('landingPricingFeatureCreator1') || 'Everything included in Premium',
        t('landingPricingFeatureCreator2') || 'Advanced alerts for the routes you care about',
        t('landingPricingFeatureCreator3') || 'Monitoring for the best triangulations',
        t('landingPricingFeatureCreator4') || 'Automations so you do not miss the right moment',
        t('landingPricingFeatureCreator5') || 'Built for creators, digital nomads, and expert travelers'
      ],
      monthlyBillingNote: t('landingPricingMonthlyBillingNote') || 'Billed monthly',
      annualBillingNote: `${t('landingPricingAnnualBillingPrefix') || 'Billed yearly at EUR'} ${formatEur(Math.round(eliteAnnual * 12))}`,
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
