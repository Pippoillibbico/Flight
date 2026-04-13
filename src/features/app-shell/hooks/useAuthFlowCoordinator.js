import { useCallback } from 'react';
import { readLocalStorageItem, removeLocalStorageItem, writeLocalStorageItem } from '../../../utils/browserStorage';
import {
  POST_AUTH_ACTION_STORAGE_KEY,
  POST_AUTH_MODE_STORAGE_KEY,
  POST_AUTH_SECTION_STORAGE_KEY,
  POST_AUTH_VIEW_STORAGE_KEY
} from '../../personal-hub/storage';

export function readStoredPostAuthContext() {
  return {
    pendingAction: readLocalStorageItem(POST_AUTH_ACTION_STORAGE_KEY),
    authMode: readLocalStorageItem(POST_AUTH_MODE_STORAGE_KEY),
    authView: readLocalStorageItem(POST_AUTH_VIEW_STORAGE_KEY),
    section: readLocalStorageItem(POST_AUTH_SECTION_STORAGE_KEY)
  };
}

export function useAuthFlowCoordinator({
  activeMainSection,
  setShowLandingPage,
  setShowAccountPanel,
  setAuthMode,
  setAuthView,
  setAuthError,
  setPendingPostAuthAction,
  setPendingPostAuthSection
}) {
  const persistPostAuthAction = useCallback(
    (action) => {
      setPendingPostAuthAction(action || null);
      if (action) writeLocalStorageItem(POST_AUTH_ACTION_STORAGE_KEY, String(action));
      else removeLocalStorageItem(POST_AUTH_ACTION_STORAGE_KEY);
    },
    [setPendingPostAuthAction]
  );

  const persistPostAuthSection = useCallback(
    (section) => {
      const normalized = String(section || '').trim().toLowerCase();
      const next = normalized || null;
      setPendingPostAuthSection(next);
      if (next) writeLocalStorageItem(POST_AUTH_SECTION_STORAGE_KEY, next);
      else removeLocalStorageItem(POST_AUTH_SECTION_STORAGE_KEY);
    },
    [setPendingPostAuthSection]
  );

  const persistAuthFunnelState = useCallback(({ authMode: nextAuthMode, authView: nextAuthView }) => {
    if (nextAuthMode) writeLocalStorageItem(POST_AUTH_MODE_STORAGE_KEY, String(nextAuthMode));
    if (nextAuthView) writeLocalStorageItem(POST_AUTH_VIEW_STORAGE_KEY, String(nextAuthView));
  }, []);

  const clearAuthFunnelState = useCallback(() => {
    removeLocalStorageItem(POST_AUTH_MODE_STORAGE_KEY);
    removeLocalStorageItem(POST_AUTH_VIEW_STORAGE_KEY);
    removeLocalStorageItem(POST_AUTH_SECTION_STORAGE_KEY);
  }, []);

  const beginAuthFlow = useCallback(
    ({
      action,
      authMode: nextAuthMode = 'login',
      authView: nextAuthView = 'options',
      keepLandingVisible = true,
      targetSection = null
    } = {}) => {
      setShowLandingPage(keepLandingVisible);
      setShowAccountPanel(true);
      setAuthMode(nextAuthMode);
      setAuthView(nextAuthView);
      setAuthError('');
      persistPostAuthAction(action || null);
      persistPostAuthSection(targetSection);
      persistAuthFunnelState({ authMode: nextAuthMode, authView: nextAuthView });
    },
    [
      persistAuthFunnelState,
      persistPostAuthAction,
      persistPostAuthSection,
      setAuthError,
      setAuthMode,
      setAuthView,
      setShowAccountPanel,
      setShowLandingPage
    ]
  );

  const beginSetAlertAuthFlow = useCallback(
    ({ keepLandingVisible = true } = {}) => {
      beginAuthFlow({
        action: 'set_alert',
        authMode: 'register',
        authView: 'options',
        keepLandingVisible,
        targetSection: activeMainSection
      });
    },
    [activeMainSection, beginAuthFlow]
  );

  return {
    persistPostAuthAction,
    persistPostAuthSection,
    persistAuthFunnelState,
    clearAuthFunnelState,
    beginAuthFlow,
    beginSetAlertAuthFlow
  };
}
