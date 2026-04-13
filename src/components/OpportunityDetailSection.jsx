import { z } from 'zod';
import { validateProps } from '../utils/validateProps';
import UpgradePrompt from './UpgradePrompt';

const OpportunityDetailSectionPropsSchema = z
  .object({
    loading: z.boolean(),
    error: z.string(),
    bookingError: z.string().optional().default(''),
    detail: z.any().nullable(),
    language: z.string().optional().default('it'),
    t: z.function().optional(),
    onClose: z.function(),
    onFollow: z.function(),
    onActivateAlert: z.function(),
    onOpenBooking: z.function(),
    onViewRelated: z.function(),
    upgradePrompt: z
      .object({
        title: z.string(),
        message: z.string(),
        primaryLabel: z.string().optional().default('Upgrade to PRO'),
        secondaryLabel: z.string().optional().default('Go ELITE')
      })
      .nullable()
      .optional()
      .default(null),
    onUpgradePro: z.function().optional(),
    onUpgradeElite: z.function().optional()
  })
  .passthrough();

function OpportunityDetailSection(props) {
  const { loading, error, bookingError, detail, language, t, onClose, onFollow, onActivateAlert, onOpenBooking, onViewRelated, upgradePrompt, onUpgradePro, onUpgradeElite } = validateProps(
    OpportunityDetailSectionPropsSchema,
    props,
    'OpportunityDetailSection'
  );
  const tt = (key, fallback) => (typeof t === 'function' ? t(key) : fallback) || fallback;
  const isEnglish = String(language || 'it').toLowerCase().startsWith('en');
  const formatPrice = (value, currency = 'EUR') => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '-';
    return String(currency).toUpperCase() === 'EUR' ? `${Math.round(amount)} \u20AC` : `${Math.round(amount)} ${currency}`;
  };
  const normalizeWhyItMatters = (value) => {
    const raw = String(value || '').trim();
    if (!raw || !isEnglish) return raw;
    const lower = raw.toLowerCase();
    const looksItalian =
      lower.includes('opportunit') ||
      lower.includes('prezzo competitivo') ||
      lower.includes('rotta') ||
      lower.includes('finestra viaggio');
    if (!looksItalian) return raw;
    const period = detail?.item?.depart_date && detail?.item?.return_date ? `${detail.item.depart_date} - ${detail.item.return_date}` : tt('opportunityFeedFlexibleDates', 'Flexible dates');
    const stops = Number(detail?.item?.stops || 0);
    const route = stops === 0 ? 'a direct route' : `a route with ${stops} stop${stops === 1 ? '' : 's'}`;
    return `This opportunity combines a competitive price, ${route}, and travel window ${period}.`;
  };
  const item = detail?.item || null;
  const stops = Number(item?.stops);
  const normalizedStops = Number.isFinite(stops) ? stops : null;
  const stopsLabel =
    normalizedStops === null
      ? '-'
      : normalizedStops === 0
        ? tt('opportunityFeedDirect', 'Direct')
        : `${normalizedStops} ${tt('opportunityFeedStopsSuffix', 'stops')}`;
  const tripLengthDays = Number(item?.trip_length_days);
  const hasTripLength = Number.isFinite(tripLengthDays) && tripLengthDays > 0;
  const tripLengthLabel = hasTripLength ? `${tripLengthDays} ${tt('days', 'days')}` : '-';
  const travelWindow =
    item?.depart_date && item?.return_date
      ? `${item.depart_date} - ${item.return_date}`
      : item?.depart_date || tt('opportunityFeedFlexibleDates', 'Flexible dates');
  const detailFacts = [
    { key: 'dates', label: tt('opportunityDetailDatesLabel', 'Dates'), value: travelWindow },
    { key: 'airline', label: tt('opportunityDetailAirlineLabel', 'Airline'), value: String(item?.airline || '-') },
    { key: 'stops', label: tt('opportunityDetailStopsLabel', 'Stops'), value: stopsLabel },
    { key: 'length', label: tt('opportunityDetailTripLengthLabel', 'Trip length'), value: tripLengthLabel }
  ];
  const routeLabel = `${String(item?.origin_airport || '-')} -> ${String(item?.destination_airport || '-')}`;

  return (
    <section className="panel opportunity-detail-panel">
      <div className="panel-head">
        <h2>{tt('opportunityDetailTitle', 'Opportunity detail')}</h2>
        <button type="button" className="ghost" onClick={onClose} data-testid="opportunity-detail-close">
          {tt('close', 'Close')}
        </button>
      </div>
      {loading ? <p className="muted">{tt('opportunityDetailLoading', 'Loading detail...')}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && !detail ? <p className="muted">{tt('opportunityDetailEmpty', 'No detail available.')}</p> : null}
      {item ? (
        <>
          <div className="opportunity-detail-hero">
            <div className="opportunity-detail-hero-main">
              <p className="opportunity-detail-label">{tt('opportunityDetailRouteLabel', 'Route')}</p>
              <h3 className="opportunity-detail-route" data-testid="opportunity-detail-route">{routeLabel}</h3>
              <p className="opportunity-detail-price">{formatPrice(item.price, item.currency)}</p>
            </div>
            <div className="opportunity-detail-context">
              <span className="opportunity-detail-context-chip">{stopsLabel}</span>
              <span className="opportunity-detail-context-chip">{travelWindow}</span>
              {hasTripLength ? <span className="opportunity-detail-context-chip">{tripLengthLabel}</span> : null}
            </div>
          </div>
          <div className="opportunity-detail-meta-grid">
            {detailFacts.map((fact) => (
              <article key={fact.key} className="opportunity-detail-meta-item">
                <p className="opportunity-detail-meta-label">{fact.label}</p>
                <p className="opportunity-detail-meta-value">{fact.value}</p>
              </article>
            ))}
          </div>
          {item.why_it_matters ? (
            <div className="opportunity-why-box">
              <strong className="opportunity-why-title">{tt('opportunityDetailWhyMattersTitle', 'Why this matters')}</strong>
              <p className="opportunity-why-copy">{normalizeWhyItMatters(item.why_it_matters)}</p>
            </div>
          ) : null}
          <div className="item-actions opportunity-detail-actions">
            <button type="button" data-testid="book-opportunity-detail" className="opportunity-view-itinerary-cta opportunity-detail-book-cta" onClick={() => onOpenBooking(item)}>
              {tt('partnerCta', 'Book this opportunity')}
            </button>
            <button type="button" className="ghost opportunity-activate-alert-cta" onClick={() => onActivateAlert(item.id)}>
              {tt('opportunityFeedActivateAlertCta', 'Activate alert')}
            </button>
            <button type="button" className="ghost opportunity-follow-destination-cta" onClick={() => onFollow(item.id)}>
              {tt('opportunityFeedFollowDestinationCta', 'Follow destination')}
            </button>
          </div>
          {bookingError ? (
            <div className="item-actions">
              <p className="error" data-testid="opportunity-booking-error">{bookingError}</p>
              <button type="button" className="ghost" data-testid="retry-book-opportunity-detail" onClick={() => onOpenBooking(item)}>
                {tt('retryActionLabel', 'Retry')}
              </button>
            </div>
          ) : null}
          {upgradePrompt ? (
            <UpgradePrompt
              title={upgradePrompt.title}
              message={upgradePrompt.message}
              primaryLabel={upgradePrompt.primaryLabel}
              secondaryLabel={upgradePrompt.secondaryLabel}
              onUpgradePro={() => onUpgradePro?.()}
              onUpgradeElite={() => onUpgradeElite?.()}
            />
          ) : null}
          {Array.isArray(detail.related) && detail.related.length > 0 ? (
            <div className="list-stack opportunity-detail-related-list">
              <strong>{tt('opportunityDetailRelatedTitle', 'Related opportunities')}</strong>
              {detail.related.map((relatedItem) => (
                <button
                  type="button"
                  key={relatedItem.id}
                  className="watch-item opportunity-related-btn"
                  data-testid={`related-opportunity-${relatedItem.id}`}
                  onClick={() => onViewRelated(relatedItem.id)}
                >
                  <span className="opportunity-related-route">
                    {relatedItem.origin_airport} {'→'} {relatedItem.destination_airport}
                  </span>
                  <span className="opportunity-related-price">
                    {formatPrice(relatedItem.price, relatedItem.currency)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default OpportunityDetailSection;
