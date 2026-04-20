import { useState, useRef, useCallback } from 'react';

const STORAGE_NS = 'flight:conv';
const MIN_INTERVAL_MS = 3 * 60 * 1000; // 3 min between non-critical triggers

function readTimestamp(key) {
  try {
    return Number(sessionStorage.getItem(`${STORAGE_NS}:${key}`)) || 0;
  } catch {
    return 0;
  }
}

function writeTimestamp(key) {
  try {
    sessionStorage.setItem(`${STORAGE_NS}:${key}`, String(Date.now()));
  } catch {}
}

function wasShownRecently(key) {
  return Date.now() - readTimestamp(key) < MIN_INTERVAL_MS;
}

// Dispatch a bare upgrade tracking event without going through a shared tracker
// instance — avoids import cycle. The useAdminTelemetryBridge picks it up.
function dispatchUpgradeTrackingEvent(eventType, planType, source, extra = {}) {
  try {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('flight_upgrade_event', {
        detail: {
          eventType,
          planType,
          source,
          at: new Date().toISOString(),
          sourceContext: 'web_app',
          schemaVersion: 2,
          eventVersion: 1,
          ...extra
        }
      })
    );
  } catch {}
}

export function useConversionTriggers({ userPlanType }) {
  const isFree = userPlanType === 'free';
  const searchCountRef = useRef(0);
  const dealCountRef = useRef(0);
  const [showLimitedResultsBanner, setShowLimitedResultsBanner] = useState(false);
  const [showLimitReachedBanner, setShowLimitReachedBanner] = useState(false);
  const limitReachedLastShownRef = useRef(0);

  // ── Internal check ────────────────────────────────────────────────────────
  const maybeShowLimitedResults = useCallback(() => {
    if (!isFree) return;
    if (showLimitedResultsBanner) return;
    if (wasShownRecently('limited_results')) return;
    const threshold = searchCountRef.current >= 2 || dealCountRef.current >= 1;
    if (!threshold) return;
    writeTimestamp('limited_results');
    setShowLimitedResultsBanner(true);
    dispatchUpgradeTrackingEvent('upgrade_prompt_shown', 'pro', 'limited_results');
  }, [isFree, showLimitedResultsBanner]);

  // ── Public callbacks ──────────────────────────────────────────────────────
  const onSearchCompleted = useCallback(() => {
    searchCountRef.current += 1;
    maybeShowLimitedResults();
  }, [maybeShowLimitedResults]);

  const onDealOpened = useCallback(() => {
    dealCountRef.current += 1;
    maybeShowLimitedResults();
  }, [maybeShowLimitedResults]);

  const dismissLimitedResultsBanner = useCallback(() => {
    setShowLimitedResultsBanner(false);
    dispatchUpgradeTrackingEvent('upgrade_prompt_dismissed', 'pro', 'limited_results');
  }, []);

  const onLimitedResultsCtaClicked = useCallback(() => {
    setShowLimitedResultsBanner(false);
    dispatchUpgradeTrackingEvent('upgrade_cta_clicked', 'pro', 'limited_results');
  }, []);

  // ── Limit reached gate (Trigger 3) ──────────────────────────────────────
  // Shows inline card on 429. Frequency-capped to once per 3 min; suppresses
  // limited_results banner (limit_reached takes priority).
  const onLimitReached = useCallback(() => {
    if (!isFree) return;
    if (Date.now() - limitReachedLastShownRef.current < MIN_INTERVAL_MS) return;
    limitReachedLastShownRef.current = Date.now();
    setShowLimitedResultsBanner(false);
    setShowLimitReachedBanner(true);
    dispatchUpgradeTrackingEvent('upgrade_prompt_shown', 'pro', 'limit_reached');
  }, [isFree]);

  const dismissLimitReachedBanner = useCallback(() => {
    setShowLimitReachedBanner(false);
    dispatchUpgradeTrackingEvent('upgrade_prompt_dismissed', 'pro', 'limit_reached');
  }, []);

  // ── Urgency gate (Trigger 2) ──────────────────────────────────────────────
  // Returns true once per session for FREE users, with a min interval guard.
  // Caller is responsible for showing the deal-level upgrade prompt.
  const shouldShowUrgencyPrompt = useCallback(() => {
    if (!isFree) return false;
    if (wasShownRecently('deal_urgency')) return false;
    writeTimestamp('deal_urgency');
    dispatchUpgradeTrackingEvent('upgrade_prompt_shown', 'pro', 'deal_urgency');
    return true;
  }, [isFree]);

  return {
    showLimitedResultsBanner,
    onSearchCompleted,
    onDealOpened,
    dismissLimitedResultsBanner,
    onLimitedResultsCtaClicked,
    shouldShowUrgencyPrompt,
    showLimitReachedBanner,
    onLimitReached,
    dismissLimitReachedBanner
  };
}
