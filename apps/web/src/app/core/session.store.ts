import { computed, inject, Injectable, signal } from '@angular/core';
import type { Role, SessionView } from '@as/shared';
import { ApiError, ApiService } from './api.service';

/** Angemeldete Person. `undefined` heißt: noch nicht geladen. */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly api = inject(ApiService);
  private readonly state = signal<SessionView | null | undefined>(undefined);
  private loading: Promise<SessionView | null> | null = null;

  readonly session = this.state.asReadonly();
  readonly role = computed<Role | null>(() => this.state()?.role ?? null);
  readonly firstName = computed(() => this.state()?.name.split(' ')[0] ?? '');

  /** Lädt die Sitzung einmal; spätere Aufrufe nutzen den Stand. */
  ensureLoaded(): Promise<SessionView | null> {
    const current = this.state();
    if (current !== undefined) return Promise.resolve(current);
    return this.reload();
  }

  reload(): Promise<SessionView | null> {
    this.loading ??= this.api
      .session()
      .then(
        (s) => s,
        // 401 heißt abgemeldet. Ist die API nicht erreichbar, gilt das ebenso: Die Anmeldeseite
        // erscheint und meldet den Fehler beim nächsten Versuch, statt leer zu bleiben.
        (e: unknown) => {
          if (e instanceof ApiError) return null;
          throw e;
        },
      )
      .then((s) => {
        this.state.set(s);
        return s;
      })
      .finally(() => (this.loading = null));
    return this.loading;
  }

  hasRole(...roles: Role[]): boolean {
    const role = this.role();
    return role !== null && roles.includes(role);
  }

  clear(): void {
    this.state.set(null);
  }
}
