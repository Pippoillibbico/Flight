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
    onHeroSecondaryCta: z.function().optional()
  })
  .passthrough();

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
    onHeroSecondaryCta
  } = validateProps(LandingSectionPropsSchema, props, 'LandingSection');
  return (
<main className={`landing-shell${darkMode ? ' landing-dark' : ''}`}>

        {/* -- HEADER --------------------------------------- */}
        <header className="landing-header">
          <div className="landing-brand">
            <svg className="landing-brand-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="currentColor"/>
            </svg>
            {t('landingTitle')}
          </div>
          <nav className="landing-nav">
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

            {/* Theme toggle */}
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

            {/* Language selector */}
            <LanguageMenu
              language={language}
              setLanguage={setLanguage}
              options={LANGUAGE_OPTIONS}
              title={t('language')}
            />
            <button
              type="button"
              className="landing-accedi-btn"
              onClick={() => { setShowLandingPage(false); setShowAccountPanel(true); }}
            >
              {t('navSignIn')}
            </button>
          </nav>
        </header>

        {/* -- HERO ----------------------------------------- */}
        <section className="landing-hero">

          {/* Decorative BG shape — behind everything (z-index: 0) */}
          <div className="landing-hero-deco" aria-hidden="true">
            <svg viewBox="0 0 520 320" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="400" cy="80" r="180" fill="rgba(15,111,255,0.06)" />
              <circle cx="460" cy="200" r="100" fill="rgba(15,111,255,0.04)" />
              <path d="M340 60 L480 140 L340 180 L280 140Z" fill="rgba(15,111,255,0.05)" />
            </svg>
          </div>

          {/* LEFT — text content (z-index: 1) */}
          <div className="landing-hero-body">
            <p className="eyebrow">{t('landingHeroEyebrow')}</p>
            <h1 className="landing-hero-title">{t('landingHeroTitle')}</h1>
            <p className="hero-sub">{t('landingHeroSub')}</p>
            <div className="landing-hero-cta">
              <button type="button" className="landing-cta-primary" onClick={() => (onHeroPrimaryCta ? onHeroPrimaryCta() : setShowLandingPage(false))}>
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
            <div className="landing-stats-row" aria-label="Opportunity radar highlights">
              <div className="landing-stat">
                <span className="landing-stat-icon">{'\u2708'}</span>
                <span className="landing-stat-copy">{t('landingStatsDestinations')}</span>
              </div>
              <div className="landing-stat-divider" aria-hidden="true" />
              <div className="landing-stat">
                <span className="landing-stat-icon">{'\u{1F514}'}</span>
                <span className="landing-stat-copy">{t('landingStatsAlert')}</span>
              </div>
              <div className="landing-stat-divider" aria-hidden="true" />
              <div className="landing-stat">
                <span className="landing-stat-icon">{'\u{1F9E0}'}</span>
                <span className="landing-stat-copy">{t('landingStatsAI')}</span>
              </div>
            </div>
          </div>

          {/* RIGHT - flight card mockups (desktop only) */}
          <div className="landing-hero-visual" aria-hidden="true">
            <div className="landing-hero-card">
              <div className="lhc-header">
                <span className="lhc-route">
                  <span>FCO</span>
                  <span className="lhc-route-sep">{t('landingRouteTo')}</span>
                  <span>TYO</span>
                </span>
                <span className="lhc-badge lhc-badge--green">-34%</span>
              </div>
              <div className="lhc-price">EUR 489</div>
              <div className="lhc-meta">15 Mar - 22 Mar | Economy</div>
              <div className="lhc-bar"><div className="lhc-progress" style={{ width: '62%' }} /></div>
            </div>
            <div className="landing-hero-card landing-hero-card--offset">
              <div className="lhc-header">
                <span className="lhc-route">
                  <span>MXP</span>
                  <span className="lhc-route-sep">{t('landingRouteTo')}</span>
                  <span>NYC</span>
                </span>
                <span className="lhc-badge lhc-badge--blue">{t('landingHeroCardBadge')}</span>
              </div>
              <div className="lhc-price">EUR 312</div>
              <div className="lhc-meta">28 Mar - 4 Apr | Economy</div>
              <div className="lhc-bar"><div className="lhc-progress lhc-progress--teal" style={{ width: '44%' }} /></div>
            </div>
            <div className="landing-hero-card landing-hero-card--sm">
              <div className="lhc-header">
                <span className="lhc-route">
                  <span>BGY</span>
                  <span className="lhc-route-sep">{t('landingRouteTo')}</span>
                  <span>DXB</span>
                </span>
                <span className="lhc-badge lhc-badge--orange">{t('landingPriceAlertBadge')}</span>
              </div>
              <div className="lhc-price">EUR 198</div>
              <div className="lhc-meta">{t('landingFromNextWeek')}</div>
            </div>
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
                    <span className="landing-feature-icon">{card.icon}</span>
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
                  <span className="landing-value-icon">{card.icon}</span>
                  <strong>{card.title}</strong>
                  <p>{card.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* -- PRICING -------------------------------------- */}
        <section id="landing-pricing" className="landing-section">
          <div className="landing-section-header">
            <h2 className="landing-section-title">{t('landingPricingTitle')}</h2>
            <p className="landing-section-sub">{t('landingPricingSubtitle')}</p>
          </div>
          <div className="landing-pricing-grid">
            {landingPricingPlans.map((plan) => (
              <div key={plan.id} className={`landing-pricing-card${plan.featured ? ' landing-pricing-card-featured' : ''}`}>
                {plan.featured ? <div className="landing-pricing-badge">{t('landingPricingMostPopular')}</div> : null}
                <div className="landing-pricing-card-head">
                  <p className="landing-plan-name">{plan.name}</p>
                  <div className="landing-plan-price">
                    {plan.amountText ? (
                      <span className="landing-plan-amount">{plan.amountText}</span>
                    ) : (
                      <>
                        <span className="landing-plan-currency">{plan.currency}</span>
                        <span className="landing-plan-amount">{plan.amount}</span>
                        <span className="landing-plan-period">{plan.period}</span>
                      </>
                    )}
                  </div>
                  <p className="landing-plan-desc">{plan.desc}</p>
                </div>
                <ul className="landing-plan-features">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
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
            <div className="landing-contacts-grid">
              {landingContactCards.map((card) =>
                card.href ? (
                  <a key={card.label} href={card.href} className="landing-contact-card">
                    <span className="landing-contact-icon">{card.icon}</span>
                    <strong>{card.label}</strong>
                    <span>{card.value}</span>
                  </a>
                ) : (
                  <div key={card.label} className="landing-contact-card">
                    <span className="landing-contact-icon">{card.icon}</span>
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
          <div className="landing-footer-brand">
            <svg className="landing-brand-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="currentColor"/>
            </svg>
            {t('landingTitle')}
          </div>
          <p className="landing-footer-tagline">{t('landingFooterTagline')}</p>
          <p className="landing-footer-copy">{t('landingFooterCopy')}</p>
        </footer>

      </main>
  );
}

export default LandingSection;
