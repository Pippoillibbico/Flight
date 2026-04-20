import { useCallback, useEffect, useState } from 'react';
import { isConsentGiven } from '../../../utils/cookieConsent';
import { readLocalStorageItem, removeLocalStorageItem, writeLocalStorageItem } from '../../../utils/browserStorage';
import { RADAR_SESSION_ACTIVE_STORAGE_KEY } from '../../../utils/storageKeys.js';

function readInitialRadarSessionState() {
  if (!isConsentGiven('functional')) return false;
  return readLocalStorageItem(RADAR_SESSION_ACTIVE_STORAGE_KEY) === '1';
}

export function useRadarSessionController({ setActiveMainSection }) {
  const [radarSessionActivated, setRadarSessionActivated] = useState(() => readInitialRadarSessionState());
  const syncRadarSessionFromStorage = useCallback(() => {
    if (!isConsentGiven('functional')) {
      setRadarSessionActivated(false);
      return;
    }
    setRadarSessionActivated(readLocalStorageItem(RADAR_SESSION_ACTIVE_STORAGE_KEY) === '1');
  }, []);

  // Sync storage when the activation flag changes.
  useEffect(() => {
    if (!isConsentGiven('functional')) {
      removeLocalStorageItem(RADAR_SESSION_ACTIVE_STORAGE_KEY);
      return;
    }
    if (radarSessionActivated) {
      writeLocalStorageItem(RADAR_SESSION_ACTIVE_STORAGE_KEY, '1');
    } else {
      removeLocalStorageItem(RADAR_SESSION_ACTIVE_STORAGE_KEY);
    }
  }, [radarSessionActivated]);

  // When functional consent is withdrawn, clear the in-memory flag immediately
  // so the UI doesn't show "session active" after storage has been purged.
  useEffect(() => {
    function handleConsentChange() {
      syncRadarSessionFromStorage();
    }
    window.addEventListener('flight_consent_changed', handleConsentChange);
    return () => window.removeEventListener('flight_consent_changed', handleConsentChange);
  }, [syncRadarSessionFromStorage]);

  // Cross-tab sync: keep the in-memory flag aligned when another tab updates
  // the radar session key.
  useEffect(() => {
    function handleStorage(event) {
      const key = String(event?.key || '');
      if (key && key !== RADAR_SESSION_ACTIVE_STORAGE_KEY) return;
      syncRadarSessionFromStorage();
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [syncRadarSessionFromStorage]);

  const activateRadarSessionFlag = useCallback(() => {
    setRadarSessionActivated(true);
  }, []);

  const activateRadarFromFeedSession = useCallback(() => {
    activateRadarSessionFlag();
    setActiveMainSection('radar');
  }, [activateRadarSessionFlag, setActiveMainSection]);

  return {
    radarSessionActivated,
    setRadarSessionActivated,
    activateRadarSessionFlag,
    activateRadarFromFeedSession
  };
}
