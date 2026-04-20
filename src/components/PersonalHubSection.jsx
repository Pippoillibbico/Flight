import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { validateProps } from '../utils/validateProps';
import { localizeClusterDisplayName } from '../utils/localizePlace';
import QuotaUsageBar from './QuotaUsageBar';
import {
  clearLocalTravelData,
  readSavedItineraries,
  readTrackedRouteSlugs,
  removeSavedItinerary,
  removeTrackedRouteSlug,
  subscribeToPersonalHubStorage
} from '../features/personal-hub/storage';

const PersonalHubSectionPropsSchema = z
  .object({
    clusters: z.array(z.any()).optional().default([]),
    language: z.string().optional().default('it'),
    planType: z.enum(['free', 'pro', 'elite']).optional().default('free'),
    quota: z.any().optional().default(null),
    trackedRoutesLimit: z.number().nullable().optional().default(null),
    savedItinerariesLimit: z.number().nullable().optional().default(null),
    radarMessagingTier: z.enum(['basic', 'advanced', 'priority']).optional().default('basic'),
    radarSessionActivated: z.boolean().optional().default(false),
    onViewDeals: z.function(),
    onOpenItinerary: z.function(),
    onActivateRadar: z.function(),
    onUntrackRoute: z.function().optional(),
    onClearLocalData: z.function().optional(),
    onUpgradePro: z.function().optional(),
    onUpgradeElite: z.function().optional()
  })
  .passthrough();

function titleizeSlug(slug) {
  const text = String(slug || '').trim().toLowerCase();
  if (!text) return 'Route';
  return text
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatPrice(value, currency = 'EUR') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  const code = String(currency || 'EUR').trim().toUpperCase() || 'EUR';
  return code === 'EUR' ? `${Math.round(amount)} EUR` : `${Math.round(amount)} ${code}`;
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function PersonalHubSection(props) {
  const {
    clusters,
    language,
    planType,
    quota,
    trackedRoutesLimit,
    savedItinerariesLimit,
    radarMessagingTier,
    radarSessionActivated,
    onViewDeals,
    onOpenItinerary,
    onActivateRadar,
    onUntrackRoute,
    onClearLocalData,
    onUpgradePro,
    onUpgradeElite
  } = validateProps(PersonalHubSectionPropsSchema, props, 'PersonalHubSection');
  const [trackedRouteSlugs, setTrackedRouteSlugs] = useState(() => readTrackedRouteSlugs());
  const [savedItineraries, setSavedItineraries] = useState(() => readSavedItineraries());
  const [clearMessage, setClearMessage] = useState('');
  const normalizedLanguage = String(language || 'it');

  const clusterNameBySlug = useMemo(() => {
    const map = new Map();
    for (const cluster of clusters) {
      const slug = normalizeSlug(cluster?.slug);
      if (!slug) continue;
      const localized = localizeClusterDisplayName(cluster, normalizedLanguage);
      const label = String(localized || cluster?.cluster_name || titleizeSlug(slug)).trim();
      map.set(slug, label);
    }
    return map;
  }, [clusters, normalizedLanguage]);

  useEffect(() => {
    return subscribeToPersonalHubStorage(() => {
      setTrackedRouteSlugs(readTrackedRouteSlugs());
      setSavedItineraries(readSavedItineraries());
    });
  }, []);

  function viewDealsForRoute(slug) {
    const normalized = normalizeSlug(slug);
    if (!normalized) return;
    onViewDeals(normalized);
  }

  function untrackRoute(slug) {
    const normalized = normalizeSlug(slug);
    if (!normalized) return;
    const next = removeTrackedRouteSlug(normalized);
    setTrackedRouteSlugs(next);
    if (typeof onUntrackRoute === 'function') onUntrackRoute(normalized);
  }

  function openSavedItinerary(itinerary) {
    const itineraryId = String(itinerary?.itineraryId || '').trim();
    if (!itineraryId) return;
    onOpenItinerary(itineraryId);
  }

  function removeItinerary(key) {
    const next = removeSavedItinerary(key);
    setSavedItineraries(next);
  }

  async function clearLocalData() {
    setClearMessage('');
    try {
      if (typeof onClearLocalData === 'function') {
        await onClearLocalData();
      } else {
        clearLocalTravelData({ includeAccountHints: true });
      }
      setTrackedRouteSlugs(readTrackedRouteSlugs());
      setSavedItineraries(readSavedItineraries());
      setClearMessage('Local travel data cleared on this device.');
    } catch {
      setClearMessage('Unable to clear local data in this browser.');
    }
  }

  const normalizedTrackedLimit = Number.isFinite(Number(trackedRoutesLimit)) && Number(trackedRoutesLimit) > 0 ? Math.round(Number(trackedRoutesLimit)) : null;
  const normalizedSavedLimit = Number.isFinite(Number(savedItinerariesLimit)) && Number(savedItinerariesLimit) > 0 ? Math.round(Number(savedItinerariesLimit)) : null;
  const trackedLimitReached = normalizedTrackedLimit !== null && trackedRouteSlugs.length >= normalizedTrackedLimit;
  const savedLimitReached = normalizedSavedLimit !== null && savedItineraries.length >= normalizedSavedLimit;
  const shouldShowUpgradeBanner = planType !== 'elite' && (trackedLimitReached || savedLimitReached || planType === 'free');
  const radarTierLabel = radarMessagingTier === 'priority' ? 'Priority radar' : radarMessagingTier === 'advanced' ? 'Advanced radar' : 'Basic radar';
  const upgradeMessage = trackedLimitReached
    ? `You\u2019re tracking ${trackedRouteSlugs.length}/${normalizedTrackedLimit} routes. Track more routes and never miss a drop.`
    : savedLimitReached
      ? `You saved ${savedItineraries.length}/${normalizedSavedLimit} itineraries. Unlock more saves and keep every opportunity in view.`
      : 'Unlock priority deals before others and get stronger radar intelligence.';

  return (
    <section className="panel personal-hub-panel" data-testid="personal-hub-panel">
      <div className="panel-head">
        <h2>My Travel Intelligence</h2>
      </div>
      <p className="muted personal-hub-intro">Your control center for tracked routes, recent itineraries, and radar status.</p>
      <article className="personal-hub-plan-banner" data-testid="personal-hub-plan-banner">
        <div className="personal-hub-plan-main">
          <p className="personal-hub-plan-label">Active plan</p>
          <h3 data-testid="personal-hub-plan-type">{String(planType || 'free').toUpperCase()}</h3>
          <p className="muted">{radarTierLabel}</p>
        </div>
        <div className="personal-hub-plan-usage">
          <p className="personal-hub-plan-usage-line">
            Tracked routes: {trackedRouteSlugs.length}
            {normalizedTrackedLimit !== null ? `/${normalizedTrackedLimit}` : ''}
          </p>
          <p className="personal-hub-plan-usage-line">
            Saved itineraries: {savedItineraries.length}
            {normalizedSavedLimit !== null ? `/${normalizedSavedLimit}` : ''}
          </p>
          {quota ? (
            <QuotaUsageBar
              quota={quota}
              planId={planType}
              onUpgrade={onUpgradePro}
              compact
            />
          ) : null}
        </div>
        <div className="item-actions personal-hub-actions personal-hub-privacy-actions">
          <button type="button" className="ghost" onClick={clearLocalData} data-testid="personal-hub-clear-local-data">
            Clear local travel data
          </button>
        </div>
        {clearMessage ? <p className="muted personal-hub-clear-message">{clearMessage}</p> : null}
        {shouldShowUpgradeBanner ? (
          <div className="personal-hub-plan-upgrade" data-testid="personal-hub-upgrade-prompt">
            <p className="muted">{upgradeMessage}</p>
            <div className="item-actions personal-hub-actions">
              <button type="button" onClick={() => onUpgradePro?.()} data-testid="personal-hub-upgrade-pro">
                Upgrade to PRO
              </button>
              <button type="button" className="ghost" onClick={() => onUpgradeElite?.()} data-testid="personal-hub-upgrade-elite">
                Go ELITE
              </button>
            </div>
          </div>
        ) : null}
      </article>

      <div className="personal-hub-grid">
        <section className="personal-hub-card" data-testid="personal-hub-tracked-routes">
          <h3>Tracked routes</h3>
          {trackedRouteSlugs.length === 0 ? (
            <p className="muted" data-testid="personal-hub-tracked-empty">No routes tracked yet. Open any opportunity and tap &ldquo;Track this route&rdquo; to monitor it here.</p>
          ) : (
            <ul className="personal-hub-list">
              {trackedRouteSlugs.map((slug) => {
                const routeName = clusterNameBySlug.get(slug) || titleizeSlug(slug);
                return (
                  <li key={slug} className="personal-hub-item" data-testid={`personal-hub-tracked-route-${slug}`}>
                    <div className="personal-hub-item-main">
                      <strong>{routeName}</strong>
                      <span className="personal-hub-pill">Tracking active</span>
                    </div>
                    <div className="item-actions personal-hub-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => viewDealsForRoute(slug)}
                        data-testid={`personal-hub-view-deals-${slug}`}
                      >
                        View deals
                      </button>
                      <button
                        type="button"
                        className="ghost personal-hub-untrack"
                        onClick={() => untrackRoute(slug)}
                        data-testid={`personal-hub-untrack-${slug}`}
                      >
                        Untrack
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="personal-hub-card" data-testid="personal-hub-saved-itineraries">
          <h3>Saved itineraries</h3>
          {savedItineraries.length === 0 ? (
            <p className="muted" data-testid="personal-hub-saved-empty">No saved itineraries yet. Generate an itinerary from any opportunity to keep it here.</p>
          ) : (
            <ul className="personal-hub-list">
              {savedItineraries.map((itinerary) => (
                <li key={itinerary.key} className="personal-hub-item" data-testid={`personal-hub-saved-itinerary-${itinerary.key}`}>
                  <div className="personal-hub-item-main">
                    <strong>{itinerary.routeLabel}</strong>
                    <p className="personal-hub-price">{formatPrice(itinerary.price, itinerary.currency)}</p>
                    <span className="personal-hub-pill">{itinerary.label || 'Recently viewed'}</span>
                  </div>
                  <div className="item-actions personal-hub-actions">
                    <button
                      type="button"
                      className="ghost"
                      disabled={!itinerary.itineraryId}
                      onClick={() => openSavedItinerary(itinerary)}
                      data-testid={`personal-hub-open-itinerary-${itinerary.key}`}
                    >
                      Open itinerary
                    </button>
                    <button
                      type="button"
                      className="ghost personal-hub-remove"
                      onClick={() => removeItinerary(itinerary.key)}
                      data-testid={`personal-hub-remove-itinerary-${itinerary.key}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="personal-hub-card personal-hub-radar-card" data-testid="personal-hub-radar-status">
          <h3>Radar status</h3>
          {radarSessionActivated ? (
            <>
              <p className="personal-hub-radar-title" data-testid="personal-hub-radar-active">Radar is active</p>
              <p className="muted">We&apos;re scanning for opportunities based on your activity.</p>
            </>
          ) : (
            <>
              <p className="personal-hub-radar-title" data-testid="personal-hub-radar-inactive">Radar not active</p>
              <p className="muted">Activate radar to keep monitoring high-signal opportunities in this session.</p>
              <div className="item-actions personal-hub-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={onActivateRadar}
                  data-testid="personal-hub-activate-radar"
                >
                  Activate radar
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

export default PersonalHubSection;
