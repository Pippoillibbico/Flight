import { z } from 'zod';
import { useRef, useState } from 'react';
import { validateProps } from '../utils/validateProps';
import { localizeCityName, localizeCountryName } from '../utils/localizePlace';
import AirportAutocomplete from './AirportAutocomplete';
import { formatAirlineLabel } from './opportunity-feed-helpers';

const WORLD_MAP_WIDTH = 840;
const WORLD_MAP_HEIGHT = 380;
const EXPLORE_MAP_VISIBLE_POINT_LIMIT = 6;

const WORLD_MAP_LANDMASSES = [
  {
    id: 'north-america',
    region: 'america',
    d: 'M42 96 C68 62 124 50 176 62 C215 71 238 95 241 121 C244 150 217 165 181 161 C153 158 133 145 101 146 C66 147 36 128 42 96 Z'
  },
  {
    id: 'south-america',
    region: 'south_america',
    d: 'M220 168 C247 166 278 196 279 229 C280 252 260 268 258 291 C256 317 239 346 218 343 C199 340 198 311 193 290 C188 268 176 249 180 226 C185 197 198 172 220 168 Z'
  },
  {
    id: 'europe',
    region: 'eu',
    d: 'M383 82 C398 64 435 55 461 67 C490 80 500 109 482 130 C466 148 433 139 413 151 C392 163 366 151 362 127 C359 108 369 95 383 82 Z'
  },
  {
    id: 'africa',
    region: 'africa',
    d: 'M417 162 C452 147 492 166 507 203 C522 238 494 271 482 306 C470 339 445 353 426 327 C406 300 411 269 396 242 C379 211 387 175 417 162 Z'
  },
  {
    id: 'asia',
    region: 'asia',
    d: 'M505 92 C543 61 623 47 681 66 C735 83 771 129 760 169 C751 203 714 196 680 184 C641 170 609 180 574 164 C538 148 489 143 505 92 Z'
  },
  {
    id: 'oceania',
    region: 'oceania',
    d: 'M644 264 C666 243 718 241 750 261 C777 279 769 306 733 313 C709 318 688 307 661 313 C635 319 625 282 644 264 Z'
  }
];

const WORLD_MAP_CONTINENTS = [
  {
    id: 'north-america',
    label: 'N. America',
    region: 'america',
    labelX: 148,
    labelY: 108
  },
  {
    id: 'south-america',
    label: 'S. America',
    region: 'south_america',
    labelX: 232,
    labelY: 242
  },
  {
    id: 'europe',
    label: 'Europe',
    region: 'eu',
    labelX: 422,
    labelY: 100
  },
  {
    id: 'africa',
    label: 'Africa',
    region: 'africa',
    labelX: 452,
    labelY: 218
  },
  {
    id: 'asia',
    label: 'Asia',
    region: 'asia',
    labelX: 618,
    labelY: 112
  },
  {
    id: 'oceania',
    label: 'Oceania',
    region: 'oceania',
    labelX: 704,
    labelY: 286
  }
];

const EUROPE_ORIGIN_CODES = new Set(['FCO', 'MXP', 'BLQ', 'VCE', 'NAP']);

const ExploreDiscoverySectionPropsSchema = z
  .object({
    t: z.function().optional(),
    language: z.string().optional().default('it'),
    dataSource: z.enum(['live', 'synthetic', 'internal', 'cached']).optional().default('synthetic'),
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

function svgPointFromPointer(event) {
  const svg = event.currentTarget.ownerSVGElement || event.currentTarget;
  const bounds = svg.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  return {
    x: clamp(((event.clientX - bounds.left) / bounds.width) * WORLD_MAP_WIDTH, 0, WORLD_MAP_WIDTH),
    y: clamp(((event.clientY - bounds.top) / bounds.height) * WORLD_MAP_HEIGHT, 0, WORLD_MAP_HEIGHT)
  };
}

function distanceBetweenPoints(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function lineBetweenCircleEdges(start, end, startRadius = 9, endRadius = 9) {
  const distance = distanceBetweenPoints(start, end);
  if (!start || !end || !Number.isFinite(distance) || distance <= startRadius + endRadius) {
    return null;
  }
  const dx = (end.x - start.x) / distance;
  const dy = (end.y - start.y) / distance;
  return {
    x1: start.x + dx * startRadius,
    y1: start.y + dy * startRadius,
    x2: end.x - dx * endRadius,
    y2: end.y - dy * endRadius
  };
}

function nearestMapPoint(points, target) {
  if (!target || points.length === 0) return null;
  return points.reduce((nearest, point) => {
    if (!nearest) return point;
    return distanceBetweenPoints(point.destination, target) < distanceBetweenPoints(nearest.destination, target) ? point : nearest;
  }, null);
}

function nearestMapRegion(target) {
  if (!target) return '';
  const nearest = WORLD_MAP_CONTINENTS.reduce((best, continent) => {
    const distance = distanceBetweenPoints({ x: continent.labelX, y: continent.labelY }, target);
    if (!best || distance < best.distance) return { continent, distance };
    return best;
  }, null);
  return nearest?.continent?.region || '';
}

function continentAnchorPoint(id) {
  const continent = WORLD_MAP_CONTINENTS.find((item) => item.id === id);
  if (!continent) return null;
  return { x: continent.labelX + 26, y: continent.labelY - 3 };
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

function selectMapDisplayPoints(points) {
  const byCountryOrDestination = new Map();
  for (const point of points || []) {
    const country = String(point?.country || '').trim().toLowerCase();
    const fallbackKey = String(point?.id || '').trim().toUpperCase();
    const key = country || fallbackKey;
    if (!key) continue;
    const existing = byCountryOrDestination.get(key);
    if (!existing || Number(point?.price || 0) < Number(existing?.price || 0)) {
      byCountryOrDestination.set(key, point);
    }
  }
  return [...byCountryOrDestination.values()]
    .sort((left, right) => Number(left.price || 0) - Number(right.price || 0) || Number(right.opportunityCount || 1) - Number(left.opportunityCount || 1))
    .slice(0, EXPLORE_MAP_VISIBLE_POINT_LIMIT);
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
    dataSource,
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
  const isLiveData = dataSource === 'live';
  const labels = {
    title: tt('exploreDiscoveryTitle', 'Dove puoi andare spendendo poco'),
    subtitle: tt('exploreDiscoverySubtitle', 'Inserisci aeroporto e budget massimo per trovare subito le destinazioni migliori.'),
    dataSourceLive: tt(
      'exploreDiscoveryDataSourceLive',
      'Prezzi aggiornati: controlla sempre il totale finale prima di prenotare.'
    ),
    dataSourceSynthetic: tt(
      'exploreDiscoveryDataSourceSynthetic',
      'Modalita storico/demo: usa i risultati per orientarti e verifica sempre la tariffa finale prima di prenotare.'
    ),
    origin: tt('exploreDiscoveryOriginLabel', 'Partenza'),
    originPlaceholder: tt('airportAutocompletePlaceholder', 'Scrivi una citta, ad esempio Milano'),
    originEmpty: tt('airportAutocompleteEmpty', 'Nessun aeroporto trovato'),
    budget: tt('exploreDiscoveryBudgetLabel', 'Budget massimo (EUR)'),
    cta: tt('exploreDiscoveryCta', 'Trova destinazioni'),
    loading: tt('exploreDiscoveryLoading', 'Ricerca opportunità in corso...'),
    noItems: tt('exploreDiscoveryNoItems', 'Nessuna destinazione trovata con questi criteri.'),
    budgetResults: tt('exploreDiscoveryResultsTitle', 'Migliori destinazioni nel budget'),
    mapTitle: tt('exploreDiscoveryMapTitle', 'Mappa opportunità'),
    mapLoading: tt('exploreDiscoveryMapLoading', 'Caricamento mappa opportunità...'),
    noMap: tt('exploreDiscoveryNoMap', 'Coordinate non disponibili per i risultati correnti.'),
    direct: tt('opportunityFeedDirect', 'Diretto'),
    stops: tt('opportunityFeedStopsSuffix', 'scali'),
    oneWay: tt('opportunityFeedOneWay', 'Solo andata'),
    roundTrip: tt('opportunityFeedRoundTrip', 'Andata e ritorno'),
    departure: tt('opportunityFeedDeparturePrefix', 'Partenza'),
    flexible: tt('opportunityFeedFlexibleDates', 'Date flessibili'),
    apply: tt('exploreDiscoveryApplyCta', 'Usa questa destinazione'),
    unknownAirline: tt('radarUnknownLabel', 'sconosciuto'),
    mapHint: tt('exploreDiscoveryMapHint', 'Clicca un punto per selezionare la destinazione più interessante.')
  };

  const budgetMapPoints = budgetItems.map(normalizeMapPoint).filter(Boolean);
  const normalizedPoints = mapPoints.map(normalizeMapPoint).filter(Boolean);
  const interactivePoints = normalizedPoints.length > 0 ? normalizedPoints : budgetMapPoints;
  const displayedMapPoints = selectMapDisplayPoints(interactivePoints);
  const projectedOriginMarker = interactivePoints.find((point) => point.origin)?.origin || null;
  const originMarker = EUROPE_ORIGIN_CODES.has(String(value?.origin || '').trim().toUpperCase())
    ? continentAnchorPoint('europe') || projectedOriginMarker
    : projectedOriginMarker;
  const selectedPoint = interactivePoints.find((point) => point.id === String(selectedDestination || '').toUpperCase()) || null;
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [mapPreviewPoint, setMapPreviewPoint] = useState(null);
  const mapDraggingRef = useRef(false);
  const showDiscoveryResults = hasSubmitted || budgetItems.length > 0 || interactivePoints.length > 0;
  const visibleErrors = hasSubmitted
    ? [...new Set([error, mapError].map((message) => String(message || '').trim()).filter(Boolean))]
    : [];
  const visibleMapSelection = mapPreviewPoint || selectedPoint?.destination || null;
  const displayedBudgetItems = [...budgetItems].sort((left, right) => {
    const selected = String(selectedDestination || '').toUpperCase();
    const focusPoint = mapPreviewPoint || selectedPoint?.destination || null;
    if (focusPoint) {
      const leftPoint = normalizeMapPoint(left);
      const rightPoint = normalizeMapPoint(right);
      const leftDistance = distanceBetweenPoints(leftPoint?.destination, focusPoint);
      const rightDistance = distanceBetweenPoints(rightPoint?.destination, focusPoint);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    }
    const leftActive = String(left?.destination_airport || '').toUpperCase() === selected;
    const rightActive = String(right?.destination_airport || '').toUpperCase() === selected;
    if (leftActive === rightActive) return 0;
    return leftActive ? -1 : 1;
  });

  function selectMapDestination(destinationCode) {
    mapDraggingRef.current = false;
    setMapPreviewPoint(null);
    onSelectDestination(destinationCode);
  }

  function updateMapPreview(event) {
    const nextPoint = svgPointFromPointer(event);
    if (!nextPoint) return;
    setMapPreviewPoint(nextPoint);
    const nearestPoint = nearestMapPoint(displayedMapPoints, nextPoint);
    const nearestDestination = String(nearestPoint?.id || '').toUpperCase();
    if (nearestDestination && nearestDestination !== String(selectedDestination || '').toUpperCase()) {
      onSelectDestination(nearestDestination);
    }
  }

  function startMapDrag(event) {
    mapDraggingRef.current = true;
    const captureTarget = event.currentTarget.ownerSVGElement || event.currentTarget;
    captureTarget.setPointerCapture?.(event.pointerId);
    updateMapPreview(event);
  }

  function moveMapDrag(event) {
    if (!mapDraggingRef.current) return;
    updateMapPreview(event);
  }

  function stopMapDrag(event) {
    const wasDragging = mapDraggingRef.current;
    const releasePoint = svgPointFromPointer(event);
    mapDraggingRef.current = false;
    const captureTarget = event.currentTarget.ownerSVGElement || event.currentTarget;
    captureTarget.releasePointerCapture?.(event.pointerId);
    if (!wasDragging) return;
    const nextRegion = nearestMapRegion(releasePoint || mapPreviewPoint);
    const currentRegion = String(value?.region || 'all').trim().toLowerCase() || 'all';
    if (nextRegion && nextRegion !== currentRegion) {
      setHasSubmitted(true);
      onChange({ region: nextRegion });
      onSubmit({ region: nextRegion });
    }
  }

  return (
    <section className="panel explore-discovery-panel" aria-label={labels.title}>
      <div className="explore-discovery-header">
        <strong>{labels.title}</strong>
        <span className="muted">{labels.subtitle}</span>
      </div>
      <p className={`explore-data-source-note${isLiveData ? ' live' : ' synthetic'}`}>
        {isLiveData ? labels.dataSourceLive : labels.dataSourceSynthetic}
      </p>
      <form
        className="explore-discovery-form"
        onSubmit={(event) => {
          event.preventDefault();
          setHasSubmitted(true);
          onSubmit();
        }}
      >
        <label>
          {labels.origin}
          <AirportAutocomplete
            ariaLabel={labels.origin}
            emptyLabel={labels.originEmpty}
            language={language}
            placeholder={labels.originPlaceholder}
            value={String(value?.origin || '').toUpperCase()}
            onChange={(nextOrigin) => {
              setHasSubmitted(false);
              onChange({ origin: String(nextOrigin || '').toUpperCase() });
            }}
          />
        </label>
        <label>
          {labels.budget}
          <input
            type="number"
            inputMode="numeric"
            min={50}
            step={10}
            value={value?.budgetMax ?? ''}
            onChange={(event) => {
              setHasSubmitted(false);
              onChange({ budgetMax: event.target.value });
            }}
          />
        </label>
        <div className="explore-discovery-actions">
          <button type="submit" className="explore-discovery-submit" disabled={loading || mapLoading}>
            {labels.cta}
          </button>
        </div>
      </form>

      <div className={`explore-discovery-status${hasSubmitted ? ' active' : ''}`} role="status" aria-live="polite">
        {visibleErrors.map((message) => <p key={message} className="error">{message}</p>)}
        {loading ? <p className="muted">{labels.loading}</p> : null}
      </div>

      {showDiscoveryResults ? <div className="explore-discovery-grid">
        <article className="explore-budget-card">
          <div className="panel-head">
            <h3>{labels.budgetResults}</h3>
          </div>
          {!loading && budgetItems.length === 0 ? <p className="muted">{labels.noItems}</p> : null}
          <div className="explore-budget-list">
            {displayedBudgetItems.map((item) => {
              const destinationCode = String(item.destination_airport || '').toUpperCase();
              const active = destinationCode === String(selectedDestination || '').toUpperCase();
              const localizedCountry = localizeCountryName(item.destination_country, language);
              return (
                <article
                  key={`${destinationCode}-${item.min_price}`}
                  className={`explore-budget-item${active ? ' active' : ''}`}
                >
                  <button
                    type="button"
                    className="ghost explore-budget-main"
                    onClick={() => selectMapDestination(destinationCode)}
                  >
                    <strong>
                      {localizeCityName(item.destination_city, language) || destinationCode}
                      {localizedCountry ? ` (${localizedCountry})` : ''}
                    </strong>
                    <p>
                      {formatPrice(item.min_price, locale)} | {formatTripType(item.trip_type, labels)} | {formatStops(item.stops, labels)}
                    </p>
                    <p>
                      {formatTravelWindow(item, labels)} | {formatAirlineLabel(item.airline, labels.unknownAirline)}
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
          {!mapLoading && interactivePoints.length === 0 ? <p className="muted">{labels.noMap}</p> : null}
          {interactivePoints.length > 0 ? (
            <div className="explore-map-svg-wrap" role="img" aria-label={labels.mapTitle}>
              <svg
                viewBox={`0 0 ${WORLD_MAP_WIDTH} ${WORLD_MAP_HEIGHT}`}
                className="explore-map-svg"
                onPointerDown={startMapDrag}
                onPointerMove={moveMapDrag}
                onPointerUp={stopMapDrag}
                onPointerCancel={stopMapDrag}
                onPointerLeave={stopMapDrag}
              >
                <defs>
                  <linearGradient id="exploreMapBg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgba(15,111,255,0.08)" />
                    <stop offset="100%" stopColor="rgba(15,111,255,0.02)" />
                  </linearGradient>
                  <linearGradient id="exploreLandmassFill" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgba(89,160,255,0.18)" />
                    <stop offset="100%" stopColor="rgba(89,160,255,0.06)" />
                  </linearGradient>
                  <linearGradient id="exploreLandmassActiveFill" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgba(105,183,255,0.32)" />
                    <stop offset="100%" stopColor="rgba(47,128,255,0.16)" />
                  </linearGradient>
                </defs>
                <rect x="0" y="0" width={WORLD_MAP_WIDTH} height={WORLD_MAP_HEIGHT} rx="16" fill="url(#exploreMapBg)" />
                <g className="explore-map-landmass-layer" aria-hidden="true">
                  {WORLD_MAP_LANDMASSES.map((landmass) => {
                    const currentRegion = String(value?.region || 'all').trim().toLowerCase();
                    const isActiveRegion = currentRegion !== 'all' && landmass.region === currentRegion;
                    return (
                      <path
                        key={landmass.id}
                        d={landmass.d}
                        className={isActiveRegion ? 'explore-map-landmass active' : 'explore-map-landmass'}
                      />
                    );
                  })}
                </g>
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

                {/* Equator and tropics reference lines */}
                <line x1="0" x2={WORLD_MAP_WIDTH} y1="190" y2="190" className="explore-map-equator-line" />
                <line x1="0" x2={WORLD_MAP_WIDTH} y1="140" y2="140" className="explore-map-tropic-line" />
                <line x1="0" x2={WORLD_MAP_WIDTH} y1="240" y2="240" className="explore-map-tropic-line" />

                {/* Continent labels for geographic context */}
                {WORLD_MAP_CONTINENTS.map(({ id, label, labelX, labelY }) => (
                  <g key={id} className="explore-map-continent-marker" aria-hidden="true">
                    <text x={labelX} y={labelY} className="explore-map-continent-label">{label}</text>
                  </g>
                ))}

                {!mapPreviewPoint && originMarker && selectedPoint ? (() => {
                  const routeLine = lineBetweenCircleEdges(originMarker, selectedPoint.destination, 10, 10);
                  return routeLine ? (
                    <line
                      x1={routeLine.x1}
                      y1={routeLine.y1}
                      x2={routeLine.x2}
                      y2={routeLine.y2}
                      className="explore-map-route-line active"
                    />
                  ) : null;
                })() : null}

                {originMarker ? (
                  <circle
                    cx={originMarker.x}
                    cy={originMarker.y}
                    r="8"
                    className="explore-map-origin-dot"
                  />
                ) : null}

                {originMarker && mapPreviewPoint ? (() => {
                  const previewLine = lineBetweenCircleEdges(originMarker, mapPreviewPoint, 10, 10);
                  return previewLine ? (
                    <line
                      x1={previewLine.x1}
                      y1={previewLine.y1}
                      x2={previewLine.x2}
                      y2={previewLine.y2}
                      className="explore-map-route-line preview"
                    />
                  ) : null;
                })() : null}

                {visibleMapSelection ? (
                  <circle
                    cx={visibleMapSelection.x}
                    cy={visibleMapSelection.y}
                    r="9"
                    className="explore-map-selection-dot"
                  />
                ) : null}

                {!mapPreviewPoint && displayedMapPoints.map((point) => {
                  const isActive = !mapPreviewPoint && selectedPoint?.id === point.id;
                  return (
                    <g
                      key={`point-${point.id}`}
                      className="explore-map-destination-target"
                      role="button"
                      tabIndex={0}
                      aria-label={`${localizeCityName(point.city, language)} ${formatPrice(point.price, locale)}`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (isActive) {
                          startMapDrag(event);
                          return;
                        }
                        selectMapDestination(point.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          selectMapDestination(point.id);
                        }
                      }}
                    >
                      <circle
                        cx={point.destination.x}
                        cy={point.destination.y}
                        r="18"
                        className="explore-map-destination-hit-area"
                      />
                      <circle
                        cx={point.destination.x}
                        cy={point.destination.y}
                        r={isActive ? 8 : 6}
                        className={isActive ? 'explore-map-destination-dot active' : 'explore-map-destination-dot'}
                      >
                        <title>
                          {localizeCityName(point.city, language)} - {formatPrice(point.price, locale)}
                        </title>
                      </circle>
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : null}
        </article>
      </div> : null}
    </section>
  );
}

export default ExploreDiscoverySection;
