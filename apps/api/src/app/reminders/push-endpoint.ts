import { ECDH } from 'node:crypto';

/**
 * Push-Dienste der Browserhersteller (Spezifikation Phase 5, Entscheidung 2). Nur an diese Hosts
 * sendet der Server; beliebige Adressen würden Anfragen an interne Dienste erlauben (SSRF).
 */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge (Chromium), Android
  'updates.push.services.mozilla.com', // Firefox
  'push.apple.com', // Safari (web.push.apple.com)
  'notify.windows.com', // Edge über Windows Push Notification Services
] as const;

export function isPushServiceEndpoint(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 1000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function base64UrlBytes(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length > 200)
    return null;
  return Buffer.from(value, 'base64url');
}

/** Öffentlicher Schlüssel des Browsers: unkomprimierter P-256-Punkt (65 Byte), auf der Kurve (Befund 10). */
export function isP256dhKey(value: unknown): boolean {
  const bytes = base64UrlBytes(value);
  if (!bytes || bytes.length !== 65 || bytes[0] !== 0x04) return false;
  try {
    ECDH.convertKey(bytes, 'prime256v1', undefined, undefined, 'uncompressed');
    return true;
  } catch {
    return false;
  }
}

/** Authentifizierungsgeheimnis des Browsers: 16 Byte. */
export function isAuthSecret(value: unknown): boolean {
  return base64UrlBytes(value)?.length === 16;
}
