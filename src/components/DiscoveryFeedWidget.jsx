import { useEffect, useState } from 'react';
import { api } from '../api';

const CATEGORY_LABEL = {
  cheap_flight: 'Cheap',
  unusual_route: 'Hidden Gem',
  high_value_deal: 'Top Value'
};

const TAG_LABEL = {
  direct: 'Direct',
  long_haul: 'Long Haul',
  short_haul: 'Short Haul',
  shoulder_season: 'Shoulder Season',
  low_season: 'Low Season',
  hidden_gem: 'Hidden Gem',
  budget: 'Budget'
};

const FALLBACK_DISCOVERY_ITEMS = [
  {
    id: 'fallback-fco-prg',
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

function formatPrice(amount, currency = 'EUR') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '-';
  return currency === 'EUR' ? `${Math.round(n)} \u20AC` : `${Math.round(n)} ${currency}`;
}

function formatMonth(dateStr) {
  try {
    return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(dateStr));
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

function DiscoveryCard({ item }) {
  const savingsPct = Number(item.savings_pct_vs_avg);
  const hasSavings = Number.isFinite(savingsPct) && savingsPct > 0;
  const categoryLabel = CATEGORY_LABEL[item.category] || item.category;
  const visibleTags = (item.tags || []).filter((t) => t !== 'hidden_gem' || item.category !== 'unusual_route').slice(0, 2);

  return (
    <article className="disc-feed-card" data-category={item.category}>
      <div className="disc-feed-card-head">
        <div className="disc-feed-card-route">
          <strong className="disc-feed-card-dest">{item.destination_name}</strong>
          <span className="disc-feed-card-country">{item.country}</span>
        </div>
        <span className="disc-feed-card-badge" data-category={item.category}>
          {categoryLabel}
        </span>
      </div>

      <p className="disc-feed-card-price">
        {formatPrice(item.price_low, item.currency)}
        {hasSavings && (
          <span className="disc-feed-card-saving">{`\u2212${Math.round(savingsPct)}%`}</span>
        )}
      </p>

      <p className="disc-feed-card-period">
        {item.departure_date ? formatMonth(item.departure_date) : 'Flexible'}
        {item.return_date ? ` \u2013 ${formatMonth(item.return_date)}` : ''}
      </p>

      {visibleTags.length > 0 && (
        <div className="disc-feed-card-tags">
          {visibleTags.map((tag) => (
            <span key={tag} className="disc-feed-card-tag">{TAG_LABEL[tag] || tag}</span>
          ))}
        </div>
      )}

      {item.booking_link ? (
        <a
          className="disc-feed-card-cta"
          href={item.booking_link}
          target="_blank"
          rel="noopener noreferrer"
        >
          Explore
        </a>
      ) : (
        <span className="disc-feed-card-cta disc-feed-card-cta--disabled">Explore</span>
      )}
    </article>
  );
}

export default function DiscoveryFeedWidget({ origin, limit = 12, language = 'it' }) {
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
          setError('Could not load live discovery feed. Showing fallback opportunities.');
          setItems(FALLBACK_DISCOVERY_ITEMS.slice(0, limit));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [origin, limit, retryCount]);

  if (loading) {
    return (
      <section className="disc-feed-section" aria-label="Flight discovery">
        <div className="disc-feed-loading" aria-busy="true">Loading discovery feed…</div>
      </section>
    );
  }

  // Network error — show inline retry rather than silently disappearing.
  if (error) {
    return (
      <section className="disc-feed-section" aria-label="Flight discovery">
        <p className="disc-feed-error">
          {error}{' '}
          <button type="button" className="disc-feed-retry-btn" onClick={() => setRetryCount((n) => n + 1)}>
            Retry
          </button>
        </p>
        {items.length > 0 ? (
          <div className="disc-feed-grid">
            {items.map((item) => (
              <DiscoveryCard key={item.id} item={item} language={language} />
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="disc-feed-section" aria-label="Flight discovery">
        <p className="disc-feed-error">
          No opportunities found for this origin yet.{' '}
          <button type="button" className="disc-feed-retry-btn" onClick={() => setRetryCount((n) => n + 1)}>
            Retry
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="disc-feed-section" aria-label="Flight discovery">
      <header className="disc-feed-header">
        <h2 className="disc-feed-title">Discover Flights</h2>
        <p className="disc-feed-subtitle">Heuristic opportunities — updated daily</p>
      </header>
      <div className="disc-feed-grid">
        {items.map((item) => (
          <DiscoveryCard key={item.id} item={item} language={language} />
        ))}
      </div>
    </section>
  );
}
