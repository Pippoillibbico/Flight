import { useState } from 'react';
import { z } from 'zod';
import { useAppContext } from '../context/AppContext';
import { validateProps } from '../utils/validateProps';
import LanguageMenu from './LanguageMenu';

const LandingSectionPropsSchema = z
  .object({
    darkMode: z.boolean(),
    landingNavItems: z.array(z.object({ id: z.string(), label: z.string() })),
    landingFeatureCards: z.array(z.object({ color: z.string(), icon: z.string(), title: z.string(), desc: z.string(), step: z.string() })),
    landingValueCards: z.array(z.object({ icon: z.string(), title: z.string(), desc: z.string() })),
    landingPricingPlans: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          features: z.array(z.string()),
          amountText: z.string().optional(),
          amount: z.union([z.string(), z.number()]).optional(),
          currency: z.string().optional(),
          period: z.string().optional(),
          desc: z.string().optional(),
          ctaClassName: z.string().optional(),
          ctaLabel: z.string().optional(),
          featured: z.boolean().optional(),
          onClick: z.any().optional()
        })
        .passthrough()
    ),
    landingContactCards: z.array(z.object({ icon: z.string(), label: z.string(), value: z.string(), href: z.string().optional() })),
    onHeroPrimaryCta: z.function().optional(),
    onHeroSecondaryCta: z.function().optional(),
    onOpenAuth: z.function().optional()
  })
  .passthrough();

function LandingFeatureIcon({ variant }) {
  if (variant === 'teal') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3a4 4 0 0 1 4 4c0 1.32-.64 2.5-1.63 3.23A4.98 4.98 0 0 1 17 14.5V16h1a2 2 0 0 1 0 4h-1a2 2 0 0 1-4 0H11a2 2 0 0 1-4 0H6a2 2 0 0 1 0-4h1v-1.5a4.98 4.98 0 0 1 2.63-4.27A3.99 3.99 0 0 1 8 7a4 4 0 0 1 4-4Z" />
      </svg>
    );
  }
  if (variant === 'purple') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V2Zm8 0h2v2h-2V2Zm0 4h2v2h-2V6Zm-4-4h2v2h-2V2Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.5 3a7.5 7.5 0 1 0 4.76 13.3l4.22 4.22 1.42-1.42-4.22-4.22A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z" />
    </svg>
  );
}

function PricingCheckIcon() {
  return (
    <svg className="landing-plan-check-icon" width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

const BILLING_COPY_BY_LANGUAGE = {
  en: {
    monthly: 'Monthly',
    annual: 'Annual',
    annualSave: 'Save up to 30%',
    annualHint: 'Annual plan active',
    monthlyHint: 'Switch to annual and save'
  },
  it: {
    monthly: 'Mensile',
    annual: 'Annuale',
    annualSave: 'Risparmia fino al 30%',
    annualHint: 'Piano annuale attivo',
    monthlyHint: 'Passa all annuale e risparmia'
  },
  es: {
    monthly: 'Mensual',
    annual: 'Anual',
    annualSave: 'Ahorra hasta un 30%',
    annualHint: 'Plan anual activo',
    monthlyHint: 'Cambia a anual y ahorra'
  },
  fr: {
    monthly: 'Mensuel',
    annual: 'Annuel',
    annualSave: 'Economisez jusqu a 30%',
    annualHint: 'Abonnement annuel actif',
    monthlyHint: 'Passez en annuel et economisez'
  },
  de: {
    monthly: 'Monatlich',
    annual: 'Jahrlich',
    annualSave: 'Bis zu 30% sparen',
    annualHint: 'Jahresplan aktiv',
    monthlyHint: 'Auf Jahrlich wechseln und sparen'
  },
  pt: {
    monthly: 'Mensal',
    annual: 'Anual',
    annualSave: 'Economize ate 30%',
    annualHint: 'Plano anual ativo',
    monthlyHint: 'Mude para anual e economize'
  }
};

function resolveBillingCopy(language) {
  const normalized = String(language || 'en').toLowerCase();
  if (normalized.startsWith('it')) return BILLING_COPY_BY_LANGUAGE.it;
  if (normalized.startsWith('es')) return BILLING_COPY_BY_LANGUAGE.es;
  if (normalized.startsWith('fr')) return BILLING_COPY_BY_LANGUAGE.fr;
  if (normalized.startsWith('de')) return BILLING_COPY_BY_LANGUAGE.de;
  if (normalized.startsWith('pt')) return BILLING_COPY_BY_LANGUAGE.pt;
  return BILLING_COPY_BY_LANGUAGE.en;
}

function LandingSection(props) {
  const { t, language, setLanguage, LANGUAGE_OPTIONS } = useAppContext();
  const {
    darkMode,
    setDarkMode,
    landingNavItems,
    scrollToSection,
    setShowLandingPage,
    setShowAccountPanel,
    landingFeatureCards,
    landingValueCards,
    landingPricingPlans,
    landingContactCards,
    onHeroPrimaryCta,
    onHeroSecondaryCta,
    onOpenAuth
  } = validateProps(LandingSectionPropsSchema, props, 'LandingSection');

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [landingBillingCycle, setLandingBillingCycle] = useState('monthly');
  const isAnnualBilling = landingBillingCycle === 'annual';
  const billingCopy = resolveBillingCopy(language);
  const landingPricingPlansResolved = landingPricingPlans.map((plan) => {
    const period = String(plan.period || t('landingPricingMonthly') || '/month');
    const monthlyAmount = String(plan.monthlyAmount || plan.amount || '');
    const annualAmount = String(plan.annualAmount || '');
    const useAnnual = isAnnualBilling && Boolean(annualAmount);
    if (plan.amountText) {
      return {
        ...plan,
        displayAmountText: String(plan.amountText),
        displayBillingNote: String(plan.monthlyBillingNote || plan.annualBillingNote || 'Always free'),
        displayDiscountTag: '',
        displayOldAmount: ''
      };
    }
    return {
      ...plan,
      displayAmountText: '',
      displayCurrency: String(plan.currency || 'EUR'),
      displayAmount: useAnnual ? annualAmount : monthlyAmount,
      displayPeriod: period,
      displayBillingNote: String(useAnnual ? plan.annualBillingNote || plan.monthlyBillingNote || '' : plan.monthlyBillingNote || ''),
      displayDiscountTag: String(useAnnual ? plan.annualDiscountTag || '' : ''),
      displayOldAmount: useAnnual ? monthlyAmount : ''
    };
  });

  return (
    <main className={`landing-shell${darkMode ? ' landing-dark' : ''}`}>

      {/* -- HEADER --------------------------------------- */}
      <header className="landing-header">
        <div className="landing-brand">
          <span className="landing-brand-logo" aria-label="Jetly" role="img">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 44" width="180" height="44" aria-hidden="true">
              <defs>
                <linearGradient id="ldg-j" gradientUnits="userSpaceOnUse" x1="7" y1="3" x2="25" y2="41">
                  <stop offset="0%"   stopColor="#70bbff"/>
                  <stop offset="50%"  stopColor="#2176f5"/>
                  <stop offset="100%" stopColor="#0d48d0"/>
                </linearGradient>
              </defs>
              <path
                d="M 10 6 L 19 6 L 25 12 L 21 12 L 18 9 L 18 29 Q 18 37 10.5 37 Q 4 37 3 31"
                fill="none"
                stroke="url(#ldg-j)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <text
                x="36" y="30"
                fontFamily="'Inter','Helvetica Neue',Arial,sans-serif"
                fontWeight="800"
                fontSize="24"
                letterSpacing="3"
                fill="currentColor"
              >JETLY</text>
            </svg>
          </span>
        </div>

        {/* Desktop nav */}
        <nav className="landing-nav" aria-label="Main navigation">
          {landingNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="landing-nav-link"
              onClick={() => scrollToSection(item.id)}
            >
              {item.label}
            </button>
          ))}
          <span className="landing-nav-sep" aria-hidden="true" />

          <button
            type="button"
            className="landing-ctrl-btn landing-theme-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setDarkMode((d) => !d)}
            aria-label={darkMode ? t('themeSwitchToLight') : t('themeSwitchToDark')}
          >
            {darkMode ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            )}
            <span className="landing-ctrl-label">{darkMode ? t('themeDark') : t('themeLight')}</span>
          </button>

          <LanguageMenu
            language={language}
            setLanguage={setLanguage}
            options={LANGUAGE_OPTIONS}
            title={t('language')}
          />
          <button
            type="button"
            className="landing-accedi-btn"
            data-testid="landing-signin-button"
            onClick={() => {
              if (onOpenAuth) onOpenAuth();
              else {
                setShowLandingPage(false);
                setShowAccountPanel(true);
              }
            }}
          >
            {t('navSignIn')}
          </button>
        </nav>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="landing-hamburger"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((o) => !o)}
        >
          <span className={`landing-hamburger-bar${mobileMenuOpen ? ' open' : ''}`} aria-hidden="true" />
          <span className={`landing-hamburger-bar${mobileMenuOpen ? ' open' : ''}`} aria-hidden="true" />
          <span className={`landing-hamburger-bar${mobileMenuOpen ? ' open' : ''}`} aria-hidden="true" />
        </button>
      </header>

      {/* Mobile nav drawer */}
      {mobileMenuOpen ? (
        <nav className="landing-mobile-nav" aria-label="Mobile navigation">
          {landingNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="landing-mobile-nav-link"
              onClick={() => { scrollToSection(item.id); setMobileMenuOpen(false); }}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className="landing-accedi-btn landing-mobile-signin"
            data-testid="landing-signin-button-mobile"
            onClick={() => {
              setMobileMenuOpen(false);
              if (onOpenAuth) onOpenAuth();
              else { setShowLandingPage(false); setShowAccountPanel(true); }
            }}
          >
            {t('navSignIn')}
          </button>
        </nav>
      ) : null}

      {/* -- HERO ----------------------------------------- */}
      <section className="landing-hero">
        <div className="landing-hero-deco" aria-hidden="true">
          <svg viewBox="0 0 520 320" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="400" cy="80" r="180" fill="rgba(15,111,255,0.06)" />
            <circle cx="460" cy="200" r="100" fill="rgba(15,111,255,0.04)" />
            <path d="M340 60 L480 140 L340 180 L280 140Z" fill="rgba(15,111,255,0.05)" />
          </svg>
        </div>

        <div className="landing-hero-body">
          <p className="eyebrow">{t('landingHeroEyebrow')}</p>
          <h1 className="landing-hero-title">{t('landingHeroTitle')}</h1>
          <p className="hero-sub">{t('landingHeroSub')}</p>
          <div className="landing-hero-cta">
            <button
              type="button"
              className="landing-cta-primary"
              onClick={() => (onHeroPrimaryCta ? onHeroPrimaryCta() : setShowLandingPage(false))}
            >
              {t('landingHeroCta')}
            </button>
            <button
              type="button"
              className="landing-cta-ghost"
              onClick={() => (onHeroSecondaryCta ? onHeroSecondaryCta() : scrollToSection('landing-features'))}
            >
              {t('landingHeroCtaSub')}
            </button>
          </div>

          {/* Trust badges */}
          <div className="landing-trust-row" aria-label="Trust signals">
            <span className="landing-trust-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Free to start
            </span>
            <span className="landing-trust-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
              No credit card required
            </span>
            <span className="landing-trust-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Cancel anytime
            </span>
          </div>

          <div className="landing-stats-row" aria-label="Opportunity radar highlights">
            <div className="landing-stat">
              <span className="landing-stat-icon" aria-hidden="true">✈</span>
              <span className="landing-stat-copy">{t('landingStatsDestinations')}</span>
            </div>
            <div className="landing-stat-divider" aria-hidden="true" />
            <div className="landing-stat">
              <span className="landing-stat-icon" aria-hidden="true">🔔</span>
              <span className="landing-stat-copy">{t('landingStatsAlert')}</span>
            </div>
            <div className="landing-stat-divider" aria-hidden="true" />
            <div className="landing-stat">
              <span className="landing-stat-icon" aria-hidden="true">🧠</span>
              <span className="landing-stat-copy">{t('landingStatsAI')}</span>
            </div>
          </div>
        </div>

        {/* RIGHT — flight card mockups (desktop only) */}
        <div className="landing-hero-visual" aria-hidden="true">
          <button
            type="button"
            className="landing-hero-card landing-hero-card-btn"
            onClick={() => (onHeroPrimaryCta ? onHeroPrimaryCta() : setShowLandingPage(false))}
            tabIndex={-1}
          >
            <div className="lhc-header">
              <span className="lhc-route">
                <span>{t('landingHeroRoute1FromCity')}</span>
                <span className="lhc-route-sep">→</span>
                <span>{t('landingHeroRoute1ToCity')}</span>
              </span>
              <span className="lhc-badge lhc-badge--green">-34%</span>
            </div>
            <div className="lhc-price">EUR 489</div>
            <div className="lhc-meta">15 Mar – 22 Mar · Economy</div>
            <div className="lhc-bar"><div className="lhc-progress" style={{ width: '62%' }} /></div>
          </button>
          <button
            type="button"
            className="landing-hero-card landing-hero-card--offset landing-hero-card-btn"
            onClick={() => (onHeroSecondaryCta ? onHeroSecondaryCta() : scrollToSection('landing-features'))}
            tabIndex={-1}
          >
            <div className="lhc-header">
              <span className="lhc-route">
                <span>{t('landingHeroRoute2FromCity')}</span>
                <span className="lhc-route-sep">→</span>
                <span>{t('landingHeroRoute2ToCity')}</span>
              </span>
              <span className="lhc-badge lhc-badge--blue">{t('landingHeroCardBadge')}</span>
            </div>
            <div className="lhc-price">EUR 312</div>
            <div className="lhc-meta">28 Mar – 4 Apr · Economy</div>
            <div className="lhc-bar"><div className="lhc-progress lhc-progress--teal" style={{ width: '44%' }} /></div>
          </button>
          <button
            type="button"
            className="landing-hero-card landing-hero-card--sm landing-hero-card-btn"
            onClick={() => (onHeroSecondaryCta ? onHeroSecondaryCta() : scrollToSection('landing-features'))}
            tabIndex={-1}
          >
            <div className="lhc-header">
              <span className="lhc-route">
                <span>{t('landingHeroRoute3FromCity')}</span>
                <span className="lhc-route-sep">→</span>
                <span>{t('landingHeroRoute3ToCity')}</span>
              </span>
              <span className="lhc-badge lhc-badge--orange">{t('landingPriceAlertBadge')}</span>
            </div>
            <div className="lhc-price">EUR 198</div>
            <div className="lhc-meta">{t('landingFromNextWeek')}</div>
          </button>
        </div>
      </section>

      {/* -- HOW IT WORKS --------------------------------- */}
      <section id="landing-features" className="landing-section">
        <div className="landing-section-header">
          <h2 className="landing-section-title">{t('landingFeaturesTitle')}</h2>
          <p className="landing-section-sub">{t('landingFeaturesSubtitle')}</p>
        </div>
        <div className="landing-features-grid">
          {landingFeatureCards.map((card) => (
            <div key={card.step} className={`landing-feature-card landing-feature-card--${card.color}`}>
              <div className="landing-feature-card-top">
                <div className={`landing-feature-icon-wrap landing-feature-icon-wrap--${card.color}`}>
                  <span className="landing-feature-icon">
                    <LandingFeatureIcon variant={card.color} />
                  </span>
                </div>
                <span className="landing-feature-step">{card.step}</span>
              </div>
              <h3 className="landing-feature-title">{card.title}</h3>
              <p className="landing-feature-desc">{card.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* -- CHI SIAMO ------------------------------------ */}
      <section id="landing-chiamo" className="landing-section">
        <div className="landing-chiamo-wrap">
          <div className="landing-chiamo-text">
            <p className="eyebrow">{t('landingChiSiamoTitle')}</p>
            <h2 className="landing-chiamo-headline">{t('landingChiSiamoHeadline')}</h2>
            <p className="landing-chiamo-desc">{t('landingChiSiamoText')}</p>
            <p className="landing-chiamo-mission">{t('landingChiSiamoMission')}</p>
            <p className="landing-chiamo-team">{t('landingChiSiamoTeam')}</p>
          </div>
          <div className="landing-values-grid">
            {landingValueCards.map((card) => (
              <div key={card.title} className="landing-value-card">
                <span className="landing-value-icon" aria-hidden="true">{card.icon}</span>
                <strong>{card.title}</strong>
                <p>{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -- PRICING -------------------------------------- */}
      <section id="landing-pricing" className="landing-section">
        <div className="landing-pricing-head">
          <div className="landing-section-header landing-section-header--pricing">
            <h2 className="landing-section-title">{t('landingPricingTitle')}</h2>
            <p className="landing-section-sub">{t('landingPricingSubtitle')}</p>
          </div>
          <div className="landing-pricing-cycle-wrap" data-testid="landing-billing-controls">
            <div className={`landing-pricing-cycle landing-pricing-cycle--${landingBillingCycle}`} role="radiogroup" aria-label="Billing cycle">
              <button
                type="button"
                role="radio"
                aria-checked={landingBillingCycle === 'monthly'}
                className={`landing-pricing-cycle-btn${landingBillingCycle === 'monthly' ? ' is-active' : ''}`}
                data-testid="landing-billing-monthly"
                onClick={() => setLandingBillingCycle('monthly')}
              >
                {billingCopy.monthly}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={landingBillingCycle === 'annual'}
                className={`landing-pricing-cycle-btn${landingBillingCycle === 'annual' ? ' is-active' : ''}`}
                data-testid="landing-billing-annual"
                onClick={() => setLandingBillingCycle('annual')}
              >
                {billingCopy.annual}
              </button>
            </div>
            <p className={`landing-pricing-cycle-note${isAnnualBilling ? ' is-annual' : ''}`}>
              {isAnnualBilling ? `${billingCopy.annualHint} · ${billingCopy.annualSave}` : billingCopy.monthlyHint}
            </p>
          </div>
        </div>

        <div className="landing-pricing-grid" data-billing={landingBillingCycle}>
          {landingPricingPlansResolved.map((plan) => (
            <div
              key={plan.id}
              className={`landing-pricing-card landing-pricing-card--${plan.id}${plan.featured ? ' landing-pricing-card-featured' : ''}${isAnnualBilling ? ' landing-pricing-card--annual' : ''}`}
            >
              {plan.featured ? <div className="landing-pricing-badge">{t('landingPricingMostPopular')}</div> : null}
              <div className="landing-pricing-card-head">
                <div className="landing-plan-name-row">
                  <p className="landing-plan-name">{plan.name}</p>
                  {plan.displayDiscountTag ? <span className="landing-plan-discount-tag">{plan.displayDiscountTag}</span> : null}
                </div>
                <div className="landing-plan-price">
                  {plan.displayAmountText ? (
                    <span className="landing-plan-amount landing-plan-amount--text">{plan.displayAmountText}</span>
                  ) : (
                    <>
                      {plan.displayOldAmount ? <span className="landing-plan-amount-old">{plan.displayOldAmount}</span> : null}
                      <span className="landing-plan-currency">{plan.displayCurrency || plan.currency}</span>
                      <span className="landing-plan-amount">{plan.displayAmount || plan.amount}</span>
                      <span className="landing-plan-period">{plan.displayPeriod || plan.period}</span>
                    </>
                  )}
                </div>
                <p className="landing-plan-desc">{plan.desc}</p>
                <p className="landing-plan-billing-note">{plan.displayBillingNote}</p>
              </div>
              <ul className="landing-plan-features">
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <PricingCheckIcon />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className={plan.ctaClassName} onClick={plan.onClick}>
                {plan.ctaLabel || plan.name}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* -- CONTACTS ------------------------------------- */}
      <section id="landing-contacts" className="landing-section">
        <div className="landing-contacts-wrap">
          <div className="landing-section-header">
            <h2 className="landing-section-title">{t('landingContactsTitle')}</h2>
            <p className="landing-section-sub">{t('landingContactText')}</p>
          </div>
          <div className={`landing-contacts-grid${landingContactCards.length <= 2 ? ' landing-contacts-grid--compact' : ''}`}>
            {landingContactCards.map((card) =>
              card.href ? (
                <a key={card.label} href={card.href} className="landing-contact-card">
                  <span className="landing-contact-icon" aria-hidden="true">{card.icon}</span>
                  <strong>{card.label}</strong>
                  <span>{card.value}</span>
                </a>
              ) : (
                <div key={card.label} className="landing-contact-card">
                  <span className="landing-contact-icon" aria-hidden="true">{card.icon}</span>
                  <strong>{card.label}</strong>
                  <span>{card.value}</span>
                </div>
              )
            )}
          </div>
        </div>
      </section>

      {/* -- FOOTER --------------------------------------- */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <svg className="landing-brand-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="currentColor"/>
            </svg>
            {t('landingTitle')}
          </div>
        </div>
        <nav className="landing-footer-legal-nav" aria-label="Legal">
          <a href="/privacy-policy" className="landing-footer-legal-link">{t('footerPrivacyPolicy') || 'Privacy policy'}</a>
          <span className="landing-footer-legal-sep" aria-hidden="true">|</span>
          <a href="/cookie-policy" className="landing-footer-legal-link">{t('footerCookiePolicy') || 'Cookie policy'}</a>
          <span className="landing-footer-legal-sep" aria-hidden="true">|</span>
          <a href="/terms" className="landing-footer-legal-link">{t('footerTerms') || 'Terms of service'}</a>
        </nav>
        <p className="landing-footer-tagline">{t('landingFooterTagline')}</p>
        <p className="landing-footer-copy">{t('landingFooterCopy')}</p>
      </footer>

    </main>
  );
}

export default LandingSection;

