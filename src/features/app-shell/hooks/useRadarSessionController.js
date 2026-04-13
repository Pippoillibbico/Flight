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
