import { TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { ApiService } from './api.service';
import { guessDeviceName, PushDevice, sha256Hex } from './push-device';

describe('guessDeviceName', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Safari auf Mac',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      'Edge auf Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari auf iPhone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      'Chrome auf Android',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox auf Gerät'],
  ])('benennt %s', (ua, name) => {
    expect(guessDeviceName(ua)).toBe(name);
  });
});

describe('PushDevice mit Browser-Attrappen', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
  let subscription: { endpoint: string; toJSON: () => object; unsubscribe: Mock } | null;
  let permission: NotificationPermission;
  let api: {
    pushPublicKey: Mock;
    pushDevices: Mock;
    addPushDevice: Mock;
    removePushDevice: Mock;
  };
  const pushManager = {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn(async () => {
      subscription = newSubscription();
      return subscription;
    }),
  };
  function newSubscription() {
    return {
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: vi.fn(async () => {
        subscription = null;
        return true;
      }),
    };
  }
  function setup(publicKey: string | null = 'BAAA') {
    api = {
      pushPublicKey: vi.fn(async () => ({ publicKey })),
      pushDevices: vi.fn(async () => []),
      addPushDevice: vi.fn(async () => []),
      removePushDevice: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    return TestBed.inject(PushDevice);
  }
  beforeEach(() => {
    subscription = null;
    permission = 'default';
    vi.stubGlobal('PushManager', class {});
    // Getter statt Wert, damit Tests die Erlaubnis nachträglich ändern können.
    const notification = Object.defineProperties(class {}, {
      permission: { get: () => permission },
      requestPermission: { value: vi.fn(async () => (permission = 'granted')) },
    });
    vi.stubGlobal('Notification', notification);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({ pushManager })),
        register: vi.fn(async () => ({ pushManager })),
        ready: Promise.resolve(),
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('meldet fehlende Browser-Unterstützung', async () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    expect(await setup().refresh()).toBe('unsupported');
  });
  it('meldet einen Server ohne VAPID-Schlüssel', async () => {
    expect(await setup(null).refresh()).toBe('disabled');
  });
  it('meldet blockierte Benachrichtigungen', async () => {
    permission = 'denied';
    expect(await setup().refresh()).toBe('denied');
  });
  it('ist nur an, wenn das aktuelle Konto diesen Browser kennt', async () => {
    subscription = newSubscription();
    const device = setup();
    expect(await device.refresh()).toBe('off');
    api.pushDevices.mockResolvedValue([{ id: 'd1', endpointHash: await sha256Hex(endpoint) }]);
    expect(await device.refresh()).toBe('on');
    expect(device.state()).toBe('on');
  });
  it('schaltet ein: Erlaubnis, Service Worker, Anmeldung beim Server', async () => {
    const device = setup();
    expect(await device.enable()).toBe('on');
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(api.addPushDevice).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    );
  });
  it('bleibt aus, wenn die Erlaubnis verweigert wird', async () => {
    (Notification.requestPermission as Mock).mockImplementation(
      async () => (permission = 'denied'),
    );
    const device = setup();
    expect(await device.enable()).toBe('denied');
    expect(api.addPushDevice).not.toHaveBeenCalled();
  });
  it('schaltet aus: erst beim Server abmelden, dann im Browser', async () => {
    subscription = newSubscription();
    const local = subscription;
    const device = setup();
    api.pushDevices.mockResolvedValue([
      { id: 'other', endpointHash: 'x' },
      { id: 'mine', endpointHash: await sha256Hex(endpoint) },
    ]);
    expect(await device.disable()).toBe('off');
    expect(api.removePushDevice).toHaveBeenCalledExactlyOnceWith('mine');
    expect(local.unsubscribe).toHaveBeenCalledOnce();
  });
  it('behält die lokale Anmeldung, wenn das Abmelden beim Server scheitert', async () => {
    subscription = newSubscription();
    const local = subscription;
    const device = setup();
    api.pushDevices.mockResolvedValue([{ id: 'mine', endpointHash: await sha256Hex(endpoint) }]);
    api.removePushDevice.mockRejectedValue(new Error('offline'));
    await expect(device.disable()).rejects.toThrow('offline');
    expect(local.unsubscribe).not.toHaveBeenCalled();
  });
});
