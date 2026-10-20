import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../config/app-config';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const CHALLENGE_TTL_MS = 5 * 60_000;

/** `__Host-` verlangt Secure; ohne Secure (nur Entwicklung) fällt das Präfix weg. */
export function sessionCookieName(config: AppConfig): string {
  return config.cookieSecure ? '__Host-asos_session' : 'asos_session';
}

export function challengeCookieName(config: AppConfig): string {
  return config.cookieSecure ? '__Host-asos_challenge' : 'asos_challenge';
}

function baseOptions(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/' };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(sessionCookieName(config), token, { ...baseOptions(config), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
  res.clearCookie(sessionCookieName(config), baseOptions(config));
}

export function setChallengeCookie(res: Response, config: AppConfig, challengeId: string): void {
  res.cookie(challengeCookieName(config), challengeId, {
    ...baseOptions(config),
    maxAge: CHALLENGE_TTL_MS,
  });
}

export function clearChallengeCookie(res: Response, config: AppConfig): void {
  res.clearCookie(challengeCookieName(config), baseOptions(config));
}
