import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 als Hex. Für Anmeldecodes und Rate-Limit-Schlüssel, nie umkehrbar ohne Pepper. */
export function hmacHex(pepper: string, value: string): string {
  return createHmac('sha256', pepper).update(value, 'utf8').digest('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Zufälliges Token mit 32 Bytes, base64url. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Sechsstelliger Code aus einem kryptografisch sicheren Zufallsgenerator. */
export function randomSixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Vergleich in konstanter Zeit für gleich lange Hex-Strings. */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
