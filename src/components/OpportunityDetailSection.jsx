import { z } from 'zod';
import { validateProps } from '../utils/validateProps';

const OpportunityDetailSectionPropsSchema = z
  .object({
    loading: z.boolean(),
    error: z.string(),
    detail: z.any().nullable(),
    t: z.function().optional(),
    onClose: z.function(),
    onFollow: z.function(),
    onActivateAlert: z.function(),
    onOpenBooking: z.function(),
    onViewRelated: z.function()
  })
  .passthrough();

function OpportunityDetailSection(props) {
  const { loading, error, detail, t, onClose, onFollow, onActivateAlert, onOpenBooking, onViewRelated } = validateProps(
    OpportunityDetailSectionPropsSchema,
    props,
    'OpportunityDetailSection'
  );
  const tt = (key, fallback) => (typeof t === 'function' ? t(key) : fallback) || fallback;

  return (
    <section className="panel opportunity-detail-panel">
      <div className="panel-head">
        <h2>{tt('opportunityDetailTitle', 'Opportunity detail')}</h2>
        <button type="button" className="ghost" onClick={onClose}>
          {tt('close', 'Close')}
        </button>
      </div>
      {loading ? <p className="muted">{tt('opportunityDetailLoading', 'Loading detail...')}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && !detail ? <p className="muted">{tt('opportunityDetailEmpty', 'No detail available.')}</p> : null}
      {detail?.item ? (
        <>
          <div className="opportunity-detail-grid">
            <p>
              <strong>{tt('opportunityDetailRouteLabel', 'Route')}:</strong> {detail.item.origin_airport} {'->'} {detail.item.destination_airport}
            </p>
            <p>
              <strong>{tt('opportunityDetailPriceLabel', 'Price')}:</strong> {Math.round(detail.item.price)} {detail.item.currency}
            </p>
            <p>
              <strong>{tt('opportunityDetailDatesLabel', 'Dates')}:</strong> {detail.item.depart_date} {detail.item.return_date ? `- ${detail.item.return_date}` : ''}
            </p>
            <p>
              <strong>{tt('opportunityDetailAirlineLabel', 'Airline')}:</strong> {detail.item.airline}
            </p>
            <p>
              <strong>{tt('opportunityDetailStopsLabel', 'Stops')}:</strong> {detail.item.stops}
            </p>
            <p>
              <strong>{tt('opportunityDetailTripLengthLabel', 'Trip length')}:</strong> {detail.item.trip_length_days || '-'} {tt('days', 'days')}
            </p>
          </div>
          {detail.item.why_it_matters ? (
            <div className="opportunity-why-box">
              <strong>{tt('opportunityDetailWhyMattersTitle', 'Why this matters')}</strong>
              <p>{detail.item.why_it_matters}</p>
            </div>
          ) : null}
          <div className="item-actions">
            <button type="button" onClick={() => onActivateAlert(detail.item.id)}>
              {tt('opportunityFeedActivateAlertCta', 'Activate alert')}
            </button>
            <button type="button" className="ghost" onClick={() => onFollow(detail.item.id)}>
              {tt('opportunityFeedFollowDestinationCta', 'Follow destination')}
            </button>
            <button type="button" className="ghost" onClick={() => onOpenBooking(detail.item.booking_url)}>
              {tt('opportunityFeedViewItineraryCta', 'View itinerary')}
            </button>
          </div>
          {Array.isArray(detail.related) && detail.related.length > 0 ? (
            <div className="list-stack">
              <strong>{tt('opportunityDetailRelatedTitle', 'Related opportunities')}</strong>
              {detail.related.map((item) => (
                <button type="button" key={item.id} className="watch-item opportunity-related-btn" onClick={() => onViewRelated(item.id)}>
                  <span>
                    {item.origin_airport} {'->'} {item.destination_airport}
                  </span>
                  <span>
                    {Math.round(item.price)} {item.currency}
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
