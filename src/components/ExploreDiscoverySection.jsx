import { z } from 'zod';
import { validateProps } from '../utils/validateProps';

const WORLD_MAP_WIDTH = 840;
const WORLD_MAP_HEIGHT = 380;

const ExploreDiscoverySectionPropsSchema = z
  .object({
    t: z.function().optional(),
    language: z.string().optional().default('it'),
    origins: z.array(z.any()),
    value: z
      .object({
        origin: z.string(),
        budgetMax: z.union([z.string(), z.number()])
      })
      .passthrough(),
    onChange: z.function(),
    onSubmit: z.function(),
    loading: z.boolean(),
    error: z.string(),
    budgetItems: z.array(z.any()),
    mapPoints: z.array(z.any()),
    mapLoading: z.boolean(),
    mapError: z.string(),
    selectedDestination: z.string().optional().default(''),
    onSelectDestination: z.function(),
    onApplyDestination: z.function()
  })
  .passthrough();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function projectPoint(coords) {
  const lat = Number(coords?.lat);
  const lng = Number(coords?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const x = ((lng + 180) / 360) * WORLD_MAP_WIDTH;
  const y = ((90 - lat) / 180) * WORLD_MAP_HEIGHT;
  return {
    x: clamp(x, 0, WORLD_MAP_WIDTH),
    y: clamp(y, 0, WORLD_MAP_HEIGHT)
  };
}

function fallbackCoordsFromSeed(seed) {
  const text = String(seed || '').trim().toUpperCase() || 'UNK';
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const lat = ((hash % 1300) / 10) - 65; // [-65, 65]
  const lng = (((Math.floor(hash / 1300) % 3400) / 10) - 170); // [-170, 170]
  return { lat, lng };
}

function normalizeMapPoint(item) {
  const destinationCoords = item?.destination_coords || fallbackCoordsFromSeed(item?.destination_airport);
  const destination = projectPoint(destinationCoords);
  const origin = projectPoint(item?.origin_coords);
  if (!destination) return null;
  return {
    id: String(item?.destination_airport || '').toUpperCase(),
    destination,
    origin,
    price: Number(item?.min_price || 0),
    city: item?.destination_city || item?.destination_airport || 'N/A',
    country: item?.destination_country || '',
    tripType: item?.trip_type || 'round_trip',
    departDate: item?.depart_date || null,
    returnDate: item?.return_date || null,
    stops: Number(item?.stops || 0),
    airline: item?.airline || 'unknown',
    opportunityCount: Number(item?.opportunity_count || 1)
  };
}

function formatPrice(value, locale) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

function formatTripType(value, labels) {
  return String(value || '').toLowerCase() === 'one_way' ? labels.oneWay : labels.roundTrip;
}

function formatStops(stops, labels) {
  const parsed = Number(stops || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return labels.direct;
  return `${parsed} ${labels.stops}`;
}

function formatTravelWindow(item, labels) {
  if (item?.depart_date && item?.return_date) return `${item.depart_date} - ${item.return_date}`;
  if (item?.depart_date) return `${labels.departure} ${item.depart_date}`;
  return labels.flexible;
}

function ExploreDiscoverySection(props) {
  const {
    t,
    language,
    origins,
    value,
    onChange,
    onSubmit,
    loading,
    error,
    budgetItems,
    mapPoints,
    mapLoading,
    mapError,
    selectedDestination,
    onSelectDestination,
    onApplyDestination
  } = validateProps(ExploreDiscoverySectionPropsSchema, props, 'ExploreDiscoverySection');

  const tt = (key, fallback) => (typeof t === 'function' ? t(key) : fallback) || fallback;
  const locale = String(language || 'it').toLowerCase().startsWith('en') ? 'en-US' : 'it-IT';
  const labels = {
    title: tt('exploreDiscoveryTitle', 'Dove puoi andare spendendo poco'),
    subtitle: tt('exploreDiscoverySubtitle', 'Inserisci aeroporto e budget massimo per trovare subito le destinazioni migliori.'),
    origin: tt('exploreDiscoveryOriginLabel', 'Partenza'),
    budget: tt('exploreDiscoveryBudgetLabel', 'Budget massimo (EUR)'),
    cta: tt('exploreDiscoveryCta', 'Trova destinazioni'),
    loading: tt('exploreDiscoveryLoading', 'Ricerca opportunita in corso...'),
    noItems: tt('exploreDiscoveryNoItems', 'Nessuna destinazione trovata con questi criteri.'),
    budgetResults: tt('exploreDiscoveryResultsTitle', 'Migliori destinazioni nel budget'),
    mapTitle: tt('exploreDiscoveryMapTitle', 'Mappa opportunita'),
    mapLoading: tt('exploreDiscoveryMapLoading', 'Caricamento mappa opportunita...'),
    noMap: tt('exploreDiscoveryNoMap', 'Coordinate non disponibili per i risultati correnti.'),
    direct: tt('opportunityFeedDirect', 'Diretto'),
    stops: tt('opportunityFeedStopsSuffix', 'scali'),
    oneWay: tt('opportunityFeedOneWay', 'Solo andata'),
    roundTrip: tt('opportunityFeedRoundTrip', 'Andata e ritorno'),
    departure: tt('opportunityFeedDeparturePrefix', 'Partenza'),
    flexible: tt('opportunityFeedFlexibleDates', 'Date flessibili'),
    apply: tt('exploreDiscoveryApplyCta', 'Usa questa destinazione'),
    unknownAirline: tt('radarUnknownLabel', 'sconosciuto'),
    mapHint: tt('exploreDiscoveryMapHint', 'Clicca un punto per selezionare la destinazione piu interessante.')
  };

  const normalizedPoints = mapPoints.map(normalizeMapPoint).filter(Boolean);
  const originMarker = normalizedPoints.find((point) => point.origin)?.origin || null;
  const selectedPoint = normalizedPoints.find((point) => point.id === String(selectedDestination || '').toUpperCase()) || null;

  return (
    <section className="panel explore-discovery-panel">
      <div className="panel-head">
        <h2>{labels.title}</h2>
      </div>
      <p className="muted">{labels.subtitle}</p>
      <form
        className="explore-discovery-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label>
          {labels.origin}
          <select
            value={String(value?.origin || '').toUpperCase()}
            onChange={(event) => onChange({ origin: String(event.target.value || '').toUpperCase() })}
          >
            {origins.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} - {String(item.label || '').replace(` (${item.code})`, '')}
              </option>
            ))}
          </select>
        </label>
        <label>
          {labels.budget}
          <input
            type="number"
            min={50}
            step={10}
            value={value?.budgetMax ?? ''}
            onChange={(event) => onChange({ budgetMax: event.target.value })}
          />
        </label>
        <button type="submit" className="ghost" disabled={loading || mapLoading}>
          {labels.cta}
        </button>
      </form>

      {error ? <p className="error">{error}</p> : null}
      {mapError ? <p className="error">{mapError}</p> : null}
      {loading ? <p className="muted">{labels.loading}</p> : null}

      <div className="explore-discovery-grid">
        <article className="explore-budget-card">
          <div className="panel-head">
            <h3>{labels.budgetResults}</h3>
          </div>
          {!loading && budgetItems.length === 0 ? <p className="muted">{labels.noItems}</p> : null}
          <div className="explore-budget-list">
            {budgetItems.map((item) => {
              const destinationCode = String(item.destination_airport || '').toUpperCase();
              const active = destinationCode === String(selectedDestination || '').toUpperCase();
              return (
                <article
                  key={`${destinationCode}-${item.min_price}`}
                  className={`explore-budget-item${active ? ' active' : ''}`}
                >
                  <button
                    type="button"
                    className="ghost explore-budget-main"
                    onClick={() => onSelectDestination(destinationCode)}
                  >
                    <strong>
                      {item.destination_city || destinationCode}
                      {item.destination_country ? ` (${item.destination_country})` : ''}
                    </strong>
                    <p>
                      {formatPrice(item.min_price, locale)} | {formatTripType(item.trip_type, labels)} | {formatStops(item.stops, labels)}
                    </p>
                    <p>
                      {formatTravelWindow(item, labels)} | {item.airline || labels.unknownAirline}
                    </p>
                  </button>
                  <button type="button" className="ghost" onClick={() => onApplyDestination(item)}>
                    {labels.apply}
                  </button>
                </article>
              );
            })}
          </div>
        </article>

        <article className="explore-map-card">
          <div className="panel-head">
            <h3>{labels.mapTitle}</h3>
          </div>
          <p className="muted">{labels.mapHint}</p>
          {mapLoading ? <p className="muted">{labels.mapLoading}</p> : null}
          {!mapLoading && normalizedPoints.length === 0 ? <p className="muted">{labels.noMap}</p> : null}
          {normalizedPoints.length > 0 ? (
            <div className="explore-map-svg-wrap" role="img" aria-label={labels.mapTitle}>
              <svg viewBox={`0 0 ${WORLD_MAP_WIDTH} ${WORLD_MAP_HEIGHT}`} className="explore-map-svg">
                <defs>
                  <linearGradient id="exploreMapBg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgba(15,111,255,0.08)" />
                    <stop offset="100%" stopColor="rgba(15,111,255,0.02)" />
                  </linearGradient>
                </defs>
                <rect x="0" y="0" width={WORLD_MAP_WIDTH} height={WORLD_MAP_HEIGHT} rx="16" fill="url(#exploreMapBg)" />
                {[1, 2, 3, 4, 5].map((step) => (
                  <line
                    key={`h-${step}`}
                    x1="0"
                    x2={WORLD_MAP_WIDTH}
                    y1={(WORLD_MAP_HEIGHT / 6) * step}
                    y2={(WORLD_MAP_HEIGHT / 6) * step}
                    className="explore-map-grid-line"
                  />
                ))}
                {[1, 2, 3, 4, 5].map((step) => (
                  <line
                    key={`v-${step}`}
                    y1="0"
                    y2={WORLD_MAP_HEIGHT}
                    x1={(WORLD_MAP_WIDTH / 6) * step}
                    x2={(WORLD_MAP_WIDTH / 6) * step}
                    className="explore-map-grid-line"
                  />
                ))}

                {normalizedPoints.map((point) =>
                  point.origin ? (
                    <line
                      key={`route-${point.id}`}
                      x1={point.origin.x}
                      y1={point.origin.y}
                      x2={point.destination.x}
                      y2={point.destination.y}
                      className="explore-map-route-line"
                    />
                  ) : null
                )}

                {originMarker ? (
                  <circle
                    cx={originMarker.x}
                    cy={originMarker.y}
                    r="8"
                    className="explore-map-origin-dot"
                  />
                ) : null}

                {normalizedPoints.map((point) => {
                  const isActive = selectedPoint?.id === point.id;
                  return (
                    <g key={`point-${point.id}`}>
                      <circle
                        cx={point.destination.x}
                        cy={point.destination.y}
                        r={isActive ? 8 : 6}
                        className={isActive ? 'explore-map-destination-dot active' : 'explore-map-destination-dot'}
                        onClick={() => onSelectDestination(point.id)}
                      >
                        <title>
                          {point.city} - {formatPrice(point.price, locale)}
                        </title>
                      </circle>
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}

export default ExploreDiscoverySection;
