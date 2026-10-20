import { computed, inject, Injectable, resource } from '@angular/core';
import { ApiService } from './api.service';
import { SessionStore } from './session.store';

/**
 * Offene Anträge, über die die angemeldete Person entscheiden darf: Korrekturanträge anderer
 * (Phase 2), Urlaubsanträge und erbetene Stornierungen (Phase 3). Vorgesetzte und Admin immer,
 * Mitarbeiter nur während einer Vertretung (Phase 3, Entscheidung 7). Für Menü und Zähler; die
 * Rechte prüft das Backend.
 */
@Injectable({ providedIn: 'root' })
export class ApprovalsCounter {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);

  /** Nur für Mitarbeiter: Vertreten sie gerade jemanden? */
  private readonly profile = resource({
    params: () => (this.store.hasRole('EMPLOYEE') ? this.store.session()?.id : undefined),
    loader: () => this.api.me(),
  });

  readonly decides = computed(
    () =>
      this.store.hasRole('LEAD', 'ADMIN') ||
      (this.profile.hasValue() && this.profile.value().representing > 0),
  );

  private readonly pending = resource({
    params: () => (this.decides() ? this.store.session()?.id : undefined),
    loader: async ({ params: self }) => {
      // Jede Quelle einzeln: ein Fehler soll die übrigen Anträge nicht unsichtbar machen.
      const [corrections, leave, cancellations] = await Promise.allSettled([
        this.api.corrections('PENDING'),
        this.api.leaveRequests({ status: 'PENDING' }),
        this.api.leaveRequests({ status: 'APPROVED' }),
      ]);
      const count =
        (corrections.status === 'fulfilled'
          ? corrections.value.filter((r) => r.employeeId !== self).length
          : 0) +
        (leave.status === 'fulfilled' ? leave.value.filter((r) => r.canDecide).length : 0) +
        (cancellations.status === 'fulfilled'
          ? cancellations.value.filter((r) => r.canDecide).length
          : 0);
      const failed = [corrections, leave, cancellations].some((r) => r.status === 'rejected');
      return { count, failed };
    },
  });

  readonly count = computed(() => (this.pending.hasValue() ? this.pending.value().count : 0));
  /** Mindestens eine Quelle ließ sich nicht laden; der Zähler ist dann unvollständig. */
  readonly failed = computed(
    () => !!this.pending.error() || (this.pending.hasValue() && this.pending.value().failed),
  );

  reload(): void {
    if (this.store.hasRole('EMPLOYEE')) this.profile.reload();
    if (this.decides()) this.pending.reload();
  }
}
