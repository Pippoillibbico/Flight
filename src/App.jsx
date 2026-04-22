import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
// ... (unchanged imports omitted for brevity)
import LandingSection from './components/LandingSection';
import AuthSection from './components/AuthSection';
import SearchSection from './components/SearchSection';
import LanguageMenu from './components/LanguageMenu';

// ... (rest of file unchanged until helper section)

function App() {
  const [language, setLanguage] = useState('en');

  // ... (existing code unchanged)

  function smartDepartureText(best) {
    if (!best) return '';
    return language === 'it'
      ? `💡 Da ${best.originIata} risparmi ~${best.savingAbs}€`
      : `💡 From ${best.originIata} save ~€${best.savingAbs}`;
  }

  function renderSmartDeparture(flight) {
    const sd = flight.smartDeparture;
    if (!sd || !sd.enabled) return null;

    return (
      <div className="smart-departure-block" style={{ marginTop: 8 }}>
        <p style={{ fontWeight: 600 }}>{language === 'it' ? 'Partenza intelligente' : 'Smart Departure'}</p>
        {sd.bestAlternative ? (
          <p className="muted">{smartDepartureText(sd.bestAlternative)}</p>
        ) : null}
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {(sd.alternatives || []).map((alt) => (
            <li key={alt.originIata}>
              {alt.originIata} → €{alt.price} ({language === 'it' ? 'risparmi' : 'save'} €{alt.savingAbs})
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <AppProvider value={appContextValue}>
      {showLandingPage ? (
        <LandingSection
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          landingNavItems={landingNavItems}
          scrollToSection={scrollToSection}
          setShowLandingPage={setShowLandingPage}
          setShowAccountPanel={setShowAccountPanel}
          landingFeatureCards={landingFeatureCards}
          landingValueCards={landingValueCards}
          landingPricingPlans={landingPricingPlans}
          landingContactCards={landingContactCards}
          onHeroPrimaryCta={handleLandingPrimaryCta}
          onHeroSecondaryCta={handleLandingSecondaryCta}
        />
      ) : (
        <main className={`page app-shell${darkMode ? ' app-dark' : ''}`}>

          {/* ... unchanged code */}

          <section className="panel">
            <div className="results-grid">
              {visibleFlights.map((flight) => (
                <article key={flight.id} className="result-card">
                  <div>
                    <strong>
                      {flight.origin} {t('to')} {flight.destination} ({flight.destinationIata})
                    </strong>
                    <p>
                      EUR {flight.price} | {flight.stopLabel}
                    </p>

                    {/* SMART DEPARTURE HERE */}
                    {renderSmartDeparture(flight)}

                  </div>
                  <div className="item-actions">
                    <a href={buildOutboundHref(flight, 'results')} target="_blank" rel="noreferrer">
                      {t('partnerCta')}
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </section>

        </main>
      )}
    </AppProvider>
  );
}

export default App;
