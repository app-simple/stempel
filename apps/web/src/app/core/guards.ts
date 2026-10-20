import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import type { Role } from '@as/shared';
import { ApiService } from './api.service';
import { SessionStore } from './session.store';

// Alle Injektionen vor dem ersten await: danach besteht kein Injection-Kontext mehr.

/** Nur für die Bedienung; die Rechteprüfung liegt im Backend. */
export const signedInGuard: CanActivateFn = async () => {
  const store = inject(SessionStore);
  const router = inject(Router);
  return (await store.ensureLoaded()) ? true : router.parseUrl('/anmelden');
};

export const signedOutGuard: CanActivateFn = async () => {
  const store = inject(SessionStore);
  const router = inject(Router);
  return (await store.ensureLoaded()) ? router.parseUrl('/') : true;
};

export const roleGuard =
  (...roles: Role[]): CanActivateFn =>
  async () => {
    const store = inject(SessionStore);
    const router = inject(Router);
    const session = await store.ensureLoaded();
    return session && roles.includes(session.role) ? true : router.parseUrl('/');
  };

/** „Freigaben“: Vorgesetzte, Admin und Mitarbeiter während einer Vertretung (Phase 3, Entscheidung 7). */
export const approvalsGuard: CanActivateFn = async () => {
  const store = inject(SessionStore);
  const router = inject(Router);
  const api = inject(ApiService);
  const session = await store.ensureLoaded();
  if (!session) return router.parseUrl('/anmelden');
  if (session.role !== 'EMPLOYEE') return true;
  const profile = await api.me().catch(() => null);
  return profile && profile.representing > 0 ? true : router.parseUrl('/');
};
