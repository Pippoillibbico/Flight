import { z } from 'zod';
import { validateProps } from '../utils/validateProps';

const OpportunityDetailSectionPropsSchema = z
  .object({
    loading: z.boolean(),
    error: z.string(),
    detail: z.any().nullable(),
    onClose: z.function(),
    onFollow: z.function(),
    onActivateAlert: z.function(),
    onOpenBooking: z.function(),
    onViewRelated: z.function()
  })
  .passthrough();

function OpportunityDetailSection(props) {
  const { loading, error, detail, onClose, onFollow, onActivateAlert, onOpenBooking, onViewRelated } = validateProps(
    OpportunityDetailSectionPropsSchema,
    props,
    'OpportunityDetailSection'
  );

  return (
    <section className="panel opportunity-detail-panel">
      <div className="panel-head">
        <h2>Dettaglio opportunita</h2>
        <button type="button" className="ghost" onClick={onClose}>
          Chiudi
        </button>
      </div>
      {loading ? <p className="muted">Caricamento dettaglio...</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && !detail ? <p className="muted">Nessun dettaglio disponibile.</p> : null}
      {detail?.item ? (
        <>
          <div className="opportunity-detail-grid">
            <p>
              <strong>Rotta:</strong> {detail.item.origin_airport} {'->'} {detail.item.destination_airport}
            </p>
            <p>
              <strong>Prezzo:</strong> {Math.round(detail.item.price)} {detail.item.currency}
            </p>
            <p>
              <strong>Date:</strong> {detail.item.depart_date} {detail.item.return_date ? `- ${detail.item.return_date}` : ''}
            </p>
            <p>
              <strong>Compagnia:</strong> {detail.item.airline}
            </p>
            <p>
              <strong>Scali:</strong> {detail.item.stops}
            </p>
            <p>
              <strong>Durata viaggio:</strong> {detail.item.trip_length_days || '-'} giorni
            </p>
          </div>
          {detail.item.why_it_matters ? (
            <div className="opportunity-why-box">
              <strong>Why this matters</strong>
              <p>{detail.item.why_it_matters}</p>
            </div>
          ) : null}
          <div className="item-actions">
            <button type="button" onClick={() => onActivateAlert(detail.item.id)}>
              Attiva alert
            </button>
            <button type="button" className="ghost" onClick={() => onFollow(detail.item.id)}>
              Segui destinazione
            </button>
            <button type="button" className="ghost" onClick={() => onOpenBooking(detail.item.booking_url)}>
              Vedi itinerario
            </button>
          </div>
          {Array.isArray(detail.related) && detail.related.length > 0 ? (
            <div className="list-stack">
              <strong>Opportunita correlate</strong>
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
