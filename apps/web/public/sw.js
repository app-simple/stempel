/*
 * Service Worker für Erinnerungen (Spezifikation Phase 5, Abschnitte 6.2 und 9).
 * Nur Push und Klick auf Benachrichtigungen; kein Offline-Cache, keine externen Skripte.
 * Es wird nie automatisch gestempelt: „Jetzt stempeln“ öffnet nur die Stempeluhr.
 */
/** Nur Pfade dieser Anwendung öffnen; „//host“, „/\\host“ oder fremde Origins führen zur Startseite (Befund 9). */
function samePath(value) {
  if (typeof value !== 'string') return '/';
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' ? data.title : 'Zeit & Urlaub';
  const url = samePath(data.url);
  const actions = data.mutable
    ? [
        { action: 'open', title: 'Jetzt stempeln' },
        { action: 'mute', title: 'Heute nicht erinnern' },
      ]
    : [{ action: 'open', title: 'Öffnen' }];
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      tag: typeof data.tag === 'string' ? data.tag : 'reminder',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'de',
      data: { url },
      actions,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'mute') {
    // Stummschalten für heute; die Sitzung reist als Cookie mit. Bei Fehler (z. B. abgelaufene
    // Sitzung) sichtbar melden, statt die Erinnerung unbemerkt aktiv zu lassen (Befund 4).
    event.waitUntil(
      fetch('/api/reminders/mute', { method: 'POST', credentials: 'same-origin' })
        .then((response) => response.ok)
        .catch(() => false)
        .then((ok) =>
          ok
            ? undefined
            : self.registration.showNotification('Erinnerung nicht ausgeschaltet', {
                body: 'Bitte öffne die App und wähle dort „Heute nicht erinnern“.',
                tag: 'reminder-mute-failed',
                icon: '/icons/icon-192.png',
                lang: 'de',
                data: { url: '/' },
                actions: [{ action: 'open', title: 'Öffnen' }],
              }),
        ),
    );
    return;
  }
  const url = samePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          client.navigate(url).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
