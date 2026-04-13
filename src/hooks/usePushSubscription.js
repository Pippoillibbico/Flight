/**
 * usePushSubscription
 *
 * Manages registration of the service worker and the browser PushSubscription.
 *
 * Usage:
 *   const { supported, subscribed, loading, error, subscribe, unsubscribe } = usePushSubscription(token);
 *
 * - `supported`  : browser supports Web Push
 * - `subscribed` : user has an active push subscription on this device
 * - `loading`    : operation in progress
 * - `error`      : last error message or null
 * - `subscribe`  : call to request permission and register
 * - `unsubscribe`: call to remove subscription
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const SW_PATH = '/sw.js';

export function usePushSubscription(token) {
  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [vapidKey, setVapidKey]     = useState(null);

  // Fetch VAPID public key once
  useEffect(() => {
    if (!supported) return;
    api.getVapidPublicKey()
      .then((res) => res?.publicKey && setVapidKey(res.publicKey))
      .catch(() => {}); // VAPID not configured — silently ignore
  }, [supported]);

  // Check whether this device is already subscribed
  useEffect(() => {
    if (!supported || !vapidKey) return;
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => setSubscribed(Boolean(sub)));
    }).catch(() => {});
  }, [supported, vapidKey]);

  const subscribe = useCallback(async () => {
    if (!supported || !vapidKey || !token) return;
    setLoading(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError('Notification permission denied.');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });
      const subJson = sub.toJSON();
      await api.registerPushSubscription(token, {
        endpoint: subJson.endpoint,
        keys: subJson.keys
      });
      setSubscribed(true);
    } catch (err) {
      setError(err?.message || 'Failed to enable push notifications.');
    } finally {
      setLoading(false);
    }
  }, [supported, vapidKey, token]);

  const unsubscribe = useCallback(async () => {
    if (!supported || !token) return;
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.unregisterPushSubscription(token, sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      setError(err?.message || 'Failed to disable push notifications.');
    } finally {
      setLoading(false);
    }
  }, [supported, token]);

  return { supported: supported && Boolean(vapidKey), subscribed, loading, error, subscribe, unsubscribe };
}
