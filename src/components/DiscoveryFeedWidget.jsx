import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { localizeCountryName, resolveAirportCityName } from '../utils/localizePlace';

const COPY = {
  en: {
    categories: { cheap_flight: 'Cheap', unusual_route: 'Hidden gem', high_value_deal: 'Top value' },
    tags: {
      direct: 'Direct',
      long_haul: 'Long haul',
      short_haul: 'Short haul',
      shoulder_season: 'Shoulder season',
      low_season: 'Low season',
      hidden_gem: 'Hidden gem',
      budget: 'Budget'
    },
    flexible: 'Flexible',
    explore: 'Open deal',
    preview: 'Explore',
    title: 'Discover flights',
    subtitle: 'Cached opportunities, updated daily',
    loading: 'Loading discovery feed...',
    error: 'Could not load the discovery feed. Showing cached opportunities.',
    empty: 'No opportunities found for this origin yet.',
    retry: 'Retry',
    aria: 'Flight discovery'
  },
  it: {
    categories: { cheap_flight: 'Conveniente', unusual_route: 'Occasione nascosta', high_value_deal: 'Miglior valore' },
    tags: {
      direct: 'Diretto',
      long_haul: 'Lungo raggio',
      short_haul: 'Corto raggio',
      shoulder_season: 'Media stagione',
      low_season: 'Bassa stagione',
      hidden_gem: 'Occasione nascosta',
      budget: 'Budget'
    },
    flexible: 'Flessibile',
    explore: 'Apri offerta',
    preview: 'Esplora',
    title: 'Scopri voli',
    subtitle: 'Opportunita da cache, aggiornate ogni giorno',
    loading: 'Caricamento feed discovery...',
    error: 'Impossibile caricare il feed discovery. Mostriamo opportunita da cache.',
    empty: 'Nessuna opportunita trovata per questo aeroporto di partenza.',
    retry: 'Riprova',
    aria: 'Discovery voli'
  },
  es: {
    categories: { cheap_flight: 'Barato', unusual_route: 'Joya oculta', high_value_deal: 'Mejor valor' },
    tags: {
      direct: 'Directo',
      long_haul: 'Largo radio',
      short_haul: 'Corto radio',
      shoulder_season: 'Temporada media',
      low_season: 'Temporada baja',
      hidden_gem: 'Joya oculta',
      budget: 'Presupuesto'
    },
    flexible: 'Flexible',
    explore: 'Ver oferta',
    preview: 'Explorar',
    title: 'Descubre vuelos',
    subtitle: 'Oportunidades en cache, actualizadas a diario',
    loading: 'Cargando feed de discovery...',
    error: 'No se pudo cargar el feed de discovery. Mostramos oportunidades en cache.',
    empty: 'Aun no hay oportunidades para este origen.',
    retry: 'Reintentar',
    aria: 'Discovery de vuelos'
  },
  fr: {
    categories: { cheap_flight: 'Bon prix', unusual_route: 'Perle cachee', high_value_deal: 'Meilleure valeur' },
    tags: {
      direct: 'Direct',
      long_haul: 'Long-courrier',
      short_haul: 'Court-courrier',
      shoulder_season: 'Moyenne saison',
      low_season: 'Basse saison',
      hidden_gem: 'Perle cachee',
      budget: 'Budget'
    },
    flexible: 'Flexible',
    explore: 'Voir l offre',
    preview: 'Explorer',
    title: 'Decouvrir des vols',
    subtitle: 'Opportunites en cache, mises a jour chaque jour',
    loading: 'Chargement du feed discovery...',
    error: 'Impossible de charger le feed discovery. Affichage des opportunites en cache.',
    empty: 'Aucune opportunite trouvee pour ce depart.',
    retry: 'Reessayer',
    aria: 'Discovery vols'
  },
  de: {
    categories: { cheap_flight: 'Guenstig', unusual_route: 'Geheimtipp', high_value_deal: 'Top-Wert' },
    tags: {
      direct: 'Direkt',
      long_haul: 'Langstrecke',
      short_haul: 'Kurzstrecke',
      shoulder_season: 'Nebensaison',
      low_season: 'Niedrige Saison',
      hidden_gem: 'Geheimtipp',
      budget: 'Budget'
    },
    flexible: 'Flexibel',
    explore: 'Angebot ansehen',
    preview: 'Entdecken',
    title: 'Fluege entdecken',
    subtitle: 'Gecachte Chancen, taeglich aktualisiert',
    loading: 'Discovery-Feed wird geladen...',
    error: 'Der Discovery-Feed konnte nicht geladen werden. Es werden gecachte Chancen angezeigt.',
    empty: 'Fuer diesen Abflugort gibt es noch keine Chancen.',
    retry: 'Erneut versuchen',
    aria: 'Flug-Discovery'
  },
  pt: {
    categories: { cheap_flight: 'Barato', unusual_route: 'Joia escondida', high_value_deal: 'Melhor valor' },
    tags: {
      direct: 'Direto',
      long_haul: 'Longo curso',
      short_haul: 'Curto curso',
      shoulder_season: 'Meia estacao',
      low_season: 'Baixa temporada',
      hidden_gem: 'Joia escondida',
      budget: 'Orcamento'
    },
    flexible: 'Flexivel',
    explore: 'Ver oferta',
    preview: 'Explorar',
    title: 'Descobrir voos',
    subtitle: 'Oportunidades em cache, atualizadas diariamente',
    loading: 'Carregando feed de discovery...',
    error: 'Nao foi possivel carregar o feed de discovery. Mostrando oportunidades em cache.',
    empty: 'Ainda nao ha oportunidades para esta origem.',
    retry: 'Tentar novamente',
    aria: 'Discovery de voos'
  }
};

const FALLBACK_DISCOVERY_ITEMS = [
  {
    id: 'fallback-fco-prg',
    destination_iata: 'PRG',
    destination_name: 'Prague',
    country: 'Czech Republic',
    category: 'cheap_flight',
    price_low: 149,
    currency: 'EUR',
    departure_date: '2026-06-01',
    return_date: '2026-06-08',
    tags: ['short_haul', 'budget'],
    savings_pct_vs_avg: 19,
    booking_link: null
  },
  {
    id: 'fallback-fco-tyo',
    destination_iata: 'TYO',
    destination_name: 'Tokyo',
    country: 'Japan',
    category: 'unusual_route',
    price_low: 629,
    currency: 'EUR',
    departure_date: '2026-05-01',
    return_date: '2026-05-08',
    tags: ['long_haul', 'shoulder_season', 'hidden_gem'],
    savings_pct_vs_avg: 14,
    booking_link: null
  },
  {
    id: 'fallback-fco-bkk',
    destination_iata: 'BKK',
    destination_name: 'Bangkok',
    country: 'Thailand',
    category: 'high_value_deal',
    price_low: 589,
    currency: 'EUR',
    departure_date: '2026-04-01',
    return_date: '2026-04-08',
    tags: ['long_haul', 'low_season'],
    savings_pct_vs_avg: 22,
    booking_link: null
  }
];

function resolveCopy(language) {
  const key = String(language || 'en').toLowerCase().slice(0, 2);
  return COPY[key] || COPY.en;
}

function formatPrice(amount, currency = 'EUR') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '-';
  return currency === 'EUR' ? `${Math.round(n)} EUR` : `${Math.round(n)} ${currency}`;
}

function formatMonth(dateStr, language = 'en') {
  try {
    return new Intl.DateTimeFormat(language || 'en', { month: 'short', year: 'numeric' }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function flattenCategoryItems(feed) {
  const categories = feed?.categories || {};
  const rows = [
    ...(Array.isArray(categories.cheap_flights) ? categories.cheap_flights : []),
    ...(Array.isArray(categories.unusual_routes) ? categories.unusual_routes : []),
    ...(Array.isArray(categories.high_value_deals) ? categories.high_value_deals : [])
  ];
  const seen = new Set();
  const unique = [];
  for (const item of rows) {
    const key = String(item?.id || `${item?.destination_iata || ''}:${item?.departure_date || ''}`).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function isValidIata(value) {
  return /^[A-Z]{3}$/.test(String(value || '').trim().toUpperCase());
}

function readIata(...values) {
  for (const value of values) {
    const candidate = String(value || '').trim().toUpperCase();
    if (isValidIata(candidate)) return candidate;
  }
  return '';
}

function resolveCityLabel({ city, name, code, fallback }, language) {
  const explicitCity = String(city || '').trim();
  if (explicitCity && !isValidIata(explicitCity)) return resolveAirportCityName(explicitCity, language);
  const explicitName = String(name || '').trim();
  if (explicitName && !isValidIata(explicitName)) return resolveAirportCityName(explicitName, language);
  const codeLabel = resolveAirportCityName(code, language);
  if (codeLabel && codeLabel !== code) return codeLabel;
  const fallbackLabel = resolveAirportCityName(fallback, language);
  return fallbackLabel || fallback || code || '';
}

function formatAirportPlace(city, code) {
  if (city && code) return `${city} ${code}`;
  return city || code || '';
}

function buildDiscoveryFallbackLink({ originCode, destinationCode, departureDate, returnDate }) {
  const queryParts = [
    'flights',
    originCode,
    destinationCode,
    departureDate,
    returnDate
  ].filter(Boolean);
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(queryParts.join(' '))}`;
}

function DiscoveryCard({ item, origin, copy, language }) {
  const savingsPct = Number(item.savings_pct_vs_avg);
  const hasSavings = Number.isFinite(savingsPct) && savingsPct > 0;
  const categoryLabel = copy.categories[item.category] || item.category;
  const visibleTags = (item.tags || []).filter((tag) => tag !== 'hidden_gem' || item.category !== 'unusual_route').slice(0, 2);
  const originCode = readIata(item.origin_iata, item.origin_airport, item.origin, origin);
  const destinationCode = readIata(item.destination_iata, item.destination_airport, item.destination);
  const bookingLink = String(item.booking_link || '').trim() || buildDiscoveryFallbackLink({
    originCode,
    destinationCode,
    departureDate: item.departure_date,
    returnDate: item.return_date
  });
  const originCity = resolveCityLabel({
    city: item.origin_city,
    name: item.origin_name,
    code: originCode,
    fallback: origin
  }, language);
  const destinationCity = resolveCityLabel({
    city: item.destination_city,
    name: item.destination_name,
    code: destinationCode,
    fallback: item.destination_name
  }, language);
  const routeLabel = originCity && destinationCity
    ? `${originCity} -> ${destinationCity}`
    : destinationCity || item.destination_name;
  const airportRouteLabel = [
    formatAirportPlace(originCity, originCode),
    formatAirportPlace(destinationCity, destinationCode)
  ].filter(Boolean).join(' -> ');
  const countryLabel = localizeCountryName(item.country, language) || item.country;
  const isInteractive = Boolean(bookingLink);

  function openBookingLink(event) {
    if (!bookingLink) return;
    if (event.target.closest('a')) return;
    window.open(bookingLink, '_blank', 'noopener,noreferrer');
  }

  return (
    <article
      className={`disc-feed-card${isInteractive ? ' disc-feed-card--interactive' : ''}`}
      data-category={item.category}
      role={isInteractive ? 'link' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `${copy.explore}: ${routeLabel}` : undefined}
      onClick={openBookingLink}
      onKeyDown={(event) => {
        if (!isInteractive) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          window.open(bookingLink, '_blank', 'noopener,noreferrer');
        }
      }}
    >
      <div className="disc-feed-card-head">
        <div className="disc-feed-card-route">
          <strong className="disc-feed-card-route-main">{routeLabel}</strong>
          <span className="disc-feed-card-country">{countryLabel}</span>
          {airportRouteLabel ? <span className="disc-feed-card-airports">{airportRouteLabel}</span> : null}
        </div>
        <span className="disc-feed-card-badge" data-category={item.category}>
          {categoryLabel}
        </span>
      </div>

      <p className="disc-feed-card-price">
        {formatPrice(item.price_low, item.currency)}
        {hasSavings ? <span className="disc-feed-card-saving">{`-${Math.round(savingsPct)}%`}</span> : null}
      </p>

      <p className="disc-feed-card-period">
        {item.departure_date ? formatMonth(item.departure_date, language) : copy.flexible}
        {item.return_date ? ` - ${formatMonth(item.return_date, language)}` : ''}
      </p>

      {visibleTags.length > 0 ? (
        <div className="disc-feed-card-tags">
          {visibleTags.map((tag) => (
            <span key={tag} className="disc-feed-card-tag">{copy.tags[tag] || tag}</span>
          ))}
        </div>
      ) : null}

      {bookingLink ? (
        <a className="disc-feed-card-cta" href={bookingLink} target="_blank" rel="noopener noreferrer">
          {copy.explore}
        </a>
      ) : (
        <span className="disc-feed-card-cta disc-feed-card-cta--disabled">{copy.preview}</span>
      )}
    </article>
  );
}

export default function DiscoveryFeedWidget({ origin, limit = 12, language = 'it' }) {
  const copy = useMemo(() => resolveCopy(language), [language]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    api
      .discoveryOpportunitiesFeed({ origin, limit })
      .then((feed) => {
        if (cancelled) return;
        const top = Array.isArray(feed?.top) ? feed.top : [];
        const fallbackFromCategories = flattenCategoryItems(feed);
        const resolved = (top.length > 0 ? top : fallbackFromCategories).slice(0, limit);
        setItems(resolved.length > 0 ? resolved : FALLBACK_DISCOVERY_ITEMS.slice(0, limit));
      })
      .catch(() => {
        if (!cancelled) {
          setError(copy.error);
          setItems(FALLBACK_DISCOVERY_ITEMS.slice(0, limit));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [origin, limit, retryCount, copy.error]);

  if (loading) {
    return (
      <section className="disc-feed-section" aria-label={copy.aria}>
        <div className="disc-feed-loading" aria-busy="true">{copy.loading}</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="disc-feed-section" aria-label={copy.aria}>
        <p className="disc-feed-error">
          {error}{' '}
          <button type="button" className="disc-feed-retry-btn" onClick={() => setRetryCount((n) => n + 1)}>
            {copy.retry}
          </button>
        </p>
        {items.length > 0 ? (
          <div className="disc-feed-grid">
            {items.map((item) => (
              <DiscoveryCard key={item.id} item={item} origin={origin} language={language} copy={copy} />
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="disc-feed-section" aria-label={copy.aria}>
        <p className="disc-feed-error">
          {copy.empty}{' '}
          <button type="button" className="disc-feed-retry-btn" onClick={() => setRetryCount((n) => n + 1)}>
            {copy.retry}
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="disc-feed-section" aria-label={copy.aria}>
      <header className="disc-feed-header">
        <h2 className="disc-feed-title">{copy.title}</h2>
        <p className="disc-feed-subtitle">{copy.subtitle}</p>
      </header>
      <div className="disc-feed-grid">
        {items.map((item) => (
          <DiscoveryCard key={item.id} item={item} origin={origin} language={language} copy={copy} />
        ))}
      </div>
    </section>
  );
}
