// public/sw.js
// Single service worker that tries to be compatible with Chrome + iOS Safari payload shapes.
// Keep registration/subscription in your page script (notifications.js). This file only handles incoming pushes.

'use strict';

/* -------------------------
   Helpers / Normalizers
   ------------------------- */

// Normalize any incoming push data into { title, options }
// options contains body, data.url, icon, badge, etc.
function normalizePayload(raw) {
  // raw may be: string, {notification: {...}}, {title, body, url...}, {aps: {alert: ...}}, etc.
  let title = 'New notification';
  let body = '';
  let url = '/';
  const options = {};

  if (!raw) {
    // no data at all — fallback
    title = 'New Wi-Fi order';
    body = 'You have a new verified order';
    url = '/admin/dashboard';
    options.body = body;
    options.data = { url };
    return { title, options };
  }

  // If it's a plain string
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      // treat string as body
      body = raw;
      title = 'New notification';
      url = '/admin/dashboard';
      options.body = body;
      options.data = { url };
      return { title, options };
    }
  }

  // Chrome-style: top-level "notification" (some servers wrap like this)
  if (raw.notification && typeof raw.notification === 'object') {
    const n = raw.notification;
    title = n.title || n.heading || title;
    body = n.body || n.message || body;
    url = n.url || raw.url || '/admin/dashboard';
    if (n.icon) options.icon = n.icon;
    if (n.badge) options.badge = n.badge;
    options.body = body;
    options.data = { url, raw: raw };
    return { title, options };
  }

  // Direct fields
  if (raw.title || raw.body) {
    title = raw.title || title;
    body = raw.body || body;
    url = raw.url || (raw.data && raw.data.url) || '/admin/dashboard';
    if (raw.icon) options.icon = raw.icon;
    if (raw.badge) options.badge = raw.badge;
    options.body = body;
    options.data = { url, raw: raw };
    return { title, options };
  }

  // Apple/APNs style (when translated): { aps: { alert: { title, body } } }
  if (raw.aps && raw.aps.alert) {
    const a = raw.aps.alert;
    title = a.title || title;
    body = a.body || (typeof a === 'string' ? a : body);
    url = raw.url || '/admin/dashboard';
    options.body = body;
    options.data = { url, raw: raw };
    return { title, options };
  }

  // Fallback: use any top-level textual value as body
  try {
    body = JSON.stringify(raw).slice(0, 200);
  } catch (e) {
    body = String(raw);
  }
  options.body = body;
  options.data = { url: (raw.url || '/admin/dashboard'), raw: raw };
  return { title, options };
}

/* -------------------------
   Push event - unified handler
   ------------------------- */
self.addEventListener('push', function (event) {
  event.waitUntil((async () => {
    let raw = null;

    // try JSON first, if not try text, if not, leave null
    if (event.data) {
      try {
        raw = event.data.json();
      } catch (e1) {
        try {
          const text = event.data.text ? await event.data.text() : null;
          // maybe JSON-ish string
          try {
            raw = text ? JSON.parse(text) : text;
          } catch (e2) {
            raw = text;
          }
        } catch (e3) {
          raw = null;
        }
      }
    }

    const { title, options } = normalizePayload(raw);

    // ensure sensible defaults
    options.icon = options.icon || '/icons/notify-icon.png';
    options.badge = options.badge || '/badge-96x96.png';
    options.timestamp = Date.now();

    try {
      await self.registration.showNotification(title, options);
    } catch (err) {
      // showNotification can fail on some browsers; swallow but log
      console.error('SW: showNotification failed', err);
    }
  })());
});

/* -------------------------
   Notification click - focus or open
   ------------------------- */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification && event.notification.data && event.notification.data.url) || '/admin/dashboard';

  event.waitUntil((async () => {
    try {
      const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windowClients) {
        // If the client is already open and on the same origin, focus it and navigate if needed
        if (client.url && 'focus' in client) {
          await client.focus();
          // optionally, post message so the client can route to the url
          client.postMessage({ type: 'NAVIGATE', url });
          return;
        }
      }
      // otherwise open a new window/tab
      if (clients.openWindow) {
        await clients.openWindow(url);
      }
    } catch (err) {
      console.error('SW: notificationclick handler failed', err);
    }
  })());
});

/* -------------------------
   Notification close (optional)
   ------------------------- */
self.addEventListener('notificationclose', function (event) {
  // Optional: analytics, cleanup, etc.
  // Example: report closed notification id to server via fetch (not included)
});

/* -------------------------
   Subscription change - prompt page to re-subscribe
   ------------------------- */
self.addEventListener('pushsubscriptionchange', function (event) {
  // This event fires when subscription expires or is invalidated.
  // We can't silently re-subscribe in all browsers; notify clients to re-subscribe.
  event.waitUntil((async () => {
    try {
      const allClients = await clients.matchAll({ includeUncontrolled: true });
      for (const client of allClients) {
        client.postMessage({ type: 'RESUBSCRIBE' });
      }
    } catch (err) {
      console.error('SW: pushsubscriptionchange error', err);
    }
  })());
});

/* -------------------------
   Message listener (from page)
   - allows page to ask SW to show a debug/test notification
   ------------------------- */
self.addEventListener('message', function (event) {
  const data = event.data || {};
  if (data && data.type === 'SHOW_TEST_NOTIFICATION') {
    const title = data.title || 'Test notification';
    const options = data.options || { body: data.body || 'This is a test.' };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});

/* -------------------------
   End of file
   ------------------------- */
