import { inject, Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';

/** Zustand von Web Push auf diesem Gerät (Spezifikation Phase 5, Abschnitt 9). */
export type PushState =
  | 'unsupported' // Browser ohne Service Worker oder Push (z. B. iPhone ohne installierte App)
  | 'disabled' // Server ohne VAPID-Schlüssel: nur Banner und E-Mail
  | 'denied' // Benachrichtigungen im Browser blockiert
  | 'off'
  | 'on';

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** SHA-256 als Hex, wie der Server ihn für `endpointHash` bildet. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Gerätename für die Liste im Profil, ohne Fingerprinting. */
export function guessDeviceName(ua = navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'Gerät';
  return `${browser} auf ${os}`;
}

/**
 * Anmeldung dieses Geräts für Erinnerungen per Web Push. Freiwillig je Gerät (Entscheidung 2); die
 * Erlaubnis fragt der Browser erst nach einem Klick der Person ab.
 */
@Injectable({ providedIn: 'root' })
export class PushDevice {
  private readonly api = inject(ApiService);
  readonly state = signal<PushState>('off');

  private supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  /** Zustand ermitteln, ohne nach einer Erlaubnis zu fragen. */
  async refresh(): Promise<PushState> {
    if (!this.supported()) return this.set('unsupported');
    const { publicKey } = await this.api.pushPublicKey();
    if (!publicKey) return this.set('disabled');
    if (Notification.permission === 'denied') return this.set('denied');
    const subscription = await this.subscription();
    if (!subscription) return this.set('off');
    // „An“ nur, wenn dieser Browser auch beim aktuellen Konto angemeldet ist: nach Entfernen auf einem
    // anderen Gerät, fehlgeschlagener Anmeldung oder Kontowechsel wieder einschaltbar (Review Web Phase 5, Befund 1).
    const hash = await sha256Hex(subscription.endpoint);
    const devices = await this.api.pushDevices();
    return this.set(devices.some((d) => d.endpointHash === hash) ? 'on' : 'off');
  }

  /** Hash des Endpunkts dieses Browsers, um ihn in der Geräteliste wiederzuerkennen. */
  async currentEndpointHash(): Promise<string | null> {
    if (!this.supported()) return null;
    const subscription = await this.subscription();
    return subscription ? sha256Hex(subscription.endpoint) : null;
  }

  /** Einschalten: Service Worker registrieren, Erlaubnis einholen, beim Server anmelden. */
  async enable(): Promise<PushState> {
    if (!this.supported()) return this.set('unsupported');
    const { publicKey } = await this.api.pushPublicKey();
    if (!publicKey) return this.set('disabled');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return this.set(permission === 'denied' ? 'denied' : 'off');
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      }));
    const json = subscription.toJSON();
    await this.api.addPushDevice({
      endpoint: subscription.endpoint,
      keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
      deviceName: guessDeviceName(),
    });
    return this.set('on');
  }

  /** Ausschalten auf diesem Gerät: zuerst beim Server abmelden, dann im Browser. */
  async disable(): Promise<PushState> {
    const subscription = await this.subscription();
    if (subscription) {
      const hash = await sha256Hex(subscription.endpoint);
      const device = (await this.api.pushDevices()).find((d) => d.endpointHash === hash);
      if (device) await this.api.removePushDevice(device.id);
      await subscription.unsubscribe();
    }
    return this.set('off');
  }

  private async subscription(): Promise<PushSubscription | null> {
    if (!this.supported()) return null;
    const registration = await navigator.serviceWorker.getRegistration('/');
    return (await registration?.pushManager.getSubscription()) ?? null;
  }

  private set(state: PushState): PushState {
    this.state.set(state);
    return state;
  }
}
