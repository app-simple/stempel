import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Lädt public/sw.js mit nachgebildetem `self`, `fetch` und Benachrichtigungen. */
function loadWorker(fetchImpl: () => Promise<Response>) {
  const file = [resolve('apps/web/public/sw.js'), resolve('public/sw.js')].find(existsSync)!;
  const handlers: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn(async (title: string, options: { data: { url: string } }) => {
    void title;
    void options;
  });
  const navigate = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const windows: { focus: () => void; navigate: typeof navigate }[] = [];
  const self = {
    location: { origin: 'https://zeit.example' },
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      (handlers[type] = handler),
    registration: { showNotification },
    clients: { matchAll: async () => windows, openWindow, claim: async () => undefined },
    skipWaiting: () => undefined,
  };
  const fetch = vi.fn(fetchImpl);
  new Function('self', 'fetch', readFileSync(file, 'utf8'))(self, fetch);
  async function dispatch(type: string, event: object) {
    let pending: Promise<unknown> = Promise.resolve();
    handlers[type]!({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  }
  return { dispatch, showNotification, fetch, openWindow, navigate, windows };
}

function push(data: object) {
  return { data: { json: () => data } };
}
function click(action: string, url?: string) {
  return { action, notification: { close: vi.fn(), data: { url } } };
}

describe('Service Worker', () => {
  it.each([
    ['/', '/'],
    ['/zeiten?x=1', '/zeiten?x=1'],
    ['//outside.example/', '/'],
    ['/\\outside.example/', '/'],
    ['https://outside.example/zeiten', '/'],
    ['javascript:alert(1)', '/'],
    [42, '/'],
  ])('öffnet aus der Benachrichtigung %s nur eigene Pfade (%s)', async (url, expected) => {
    const worker = loadWorker(async () => new Response(null, { status: 204 }));
    await worker.dispatch('push', push({ title: 'Erinnerung', url }));
    expect(worker.showNotification.mock.calls[0]?.[1].data.url).toBe(expected);
    // Auch beim Klick wird geprüft, falls die Daten anders zustande kamen.
    await worker.dispatch('notificationclick', click('open', url as string));
    expect(worker.openWindow).toHaveBeenCalledWith(expected);
  });

  it('schaltet über die Benachrichtigung stumm, ohne weitere Meldung', async () => {
    const worker = loadWorker(async () => new Response(null, { status: 204 }));
    await worker.dispatch('notificationclick', click('mute', '/'));
    expect(worker.fetch).toHaveBeenCalledWith('/api/reminders/mute', {
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(worker.showNotification).not.toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it.each([
    ['abgelaufene Sitzung', async () => new Response(null, { status: 401 })],
    ['Serverfehler', async () => new Response(null, { status: 500 })],
    ['Netzwerkfehler', async () => Promise.reject(new TypeError('offline'))],
  ])('meldet fehlgeschlagenes Stummschalten sichtbar: %s', async (_, impl) => {
    const worker = loadWorker(impl);
    await worker.dispatch('notificationclick', click('mute', '/'));
    expect(worker.showNotification).toHaveBeenCalledWith(
      'Erinnerung nicht ausgeschaltet',
      expect.objectContaining({ data: { url: '/' } }),
    );
  });

  it('bietet „Heute nicht erinnern“ nur bei stummschaltbaren Erinnerungen an', async () => {
    const worker = loadWorker(async () => new Response(null, { status: 204 }));
    await worker.dispatch('push', push({ title: 'a', mutable: true }));
    await worker.dispatch('push', push({ title: 'b' }));
    const actions = worker.showNotification.mock.calls.map((c) =>
      (c[1] as unknown as { actions: { action: string }[] }).actions.map((a) => a.action),
    );
    expect(actions).toEqual([['open', 'mute'], ['open']]);
  });
});
