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
    { color: 'teal', icon: '\u{1F9E0}', title: t('landingFeatureAiTitle') || 'AI Flight Hacker', desc: t('landingFeatureAiDesc') || 'Scrivi una richiesta naturale: l AI la trasforma in una ricerca intelligente con rotte alternative e tradeoff chiari.', step: '02' },
    { color: 'purple', icon: '\u{1F9ED}', title: t('landingFeature3Title'), desc: t('landingFeature3Desc'), step: '03' },
    { color: 'teal', icon: '\u{1F514}', title: t('landingFeature2Title'), desc: t('landingFeature2Desc'), step: '04' }
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
      desc: t('landingPricingFreeDesc') || 'Cached previews and static recommendations. No live AI or live flight-provider search.',
      features: [
        t('landingPricingFeatureFree1') || 'Cached previews, snapshots, and precomputed results',
        t('landingPricingFeatureFree2') || 'Static recommendations and local search',
        t('landingPricingFeatureFree3') || 'No live AI, live provider search, live triangulation, or live monitoring'
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
      desc: t('landingPricingProDesc') || 'Live AI and flight search capabilities within plan quota.',
      features: [
        t('landingPricingFeaturePro1') || 'Live AI and provider-backed search when configured',
        t('landingPricingFeaturePro2') || 'Live intelligent triangulations',
        t('landingPricingFeaturePro3') || 'Flexible period and month scans within quota',
        t('landingPricingFeaturePro4') || 'AI explanations for routes and tradeoffs',
        t('landingPricingFeaturePro5') || 'Advanced search tools'
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
      desc: t('landingPricingEliteDesc') || 'Advanced automation, alerts, and monitoring for power users.',
      features: [
        t('landingPricingFeatureCreator1') || 'Everything in PRO',
        t('landingPricingFeatureCreator2') || 'Advanced automations',
        t('landingPricingFeatureCreator3') || 'Advanced alerts',
        t('landingPricingFeatureCreator4') || 'Triangulation monitoring',
        t('landingPricingFeatureCreator5') || 'Creator, digital nomad, and power-user workflows'
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
