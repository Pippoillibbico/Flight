/**
 * Flight Suite — Service Worker
 *
 * Handles incoming Web Push notifications (VAPID) and displays them
 * as browser notifications.  Clicking a notification navigates the user
 * to the app.
 */

const APP_URL = self.location.origin;

// ── Push event ────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Flight Suite', body: event.data ? event.data.text() : '' };
  }

  const title   = String(data.title || 'Flight Suite');
  const body    = String(data.body  || data.message || '');
  const payload = data.data || {};

  const options = {
    body,
    icon:  '/favicon.ico',
    badge: '/favicon.ico',
    data:  { url: APP_URL, ...payload },
    vibrate: [200, 100, 200]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ────────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || APP_URL;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus an existing tab pointing to the app if one is open
      for (const client of windowClients) {
        if (client.url.startsWith(APP_URL) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── Activate: claim clients immediately ──────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
