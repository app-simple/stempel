import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  resource,
  signal,
} from '@angular/core';
import {
  ABSENCE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  formatHalfDays,
  formatLocalDate,
  type LeaveRequestView,
} from '@as/shared';
import { ApiError, ApiService } from '../../core/api.service';
import { ApprovalsCounter } from '../../core/approvals-counter';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { currentDaysLabel } from '../leave/leave-display';
import { ExpandableRows, RowToggle } from '../../shared-ui';
import { berlinTimestamp } from '../times/time-display';

const MIN_REASON = 10;
const OVERDUE_AFTER = 5;

/** Tage mit Einheit, z. B. „1 Tag“, „2,5 Tage“. */
export function daysLabel(halfDays: number): string {
  return `${formatHalfDays(halfDays)} ${halfDays === 2 ? 'Tag' : 'Tage'}`;
}

/** Zeitraum mit halben Rändern, z. B. „02.11. (ab Mittag) – 06.11.2026“. */
export function rangeLabel(
  r: Pick<LeaveRequestView, 'from' | 'to' | 'startHalf' | 'endHalf'>,
): string {
  const from = formatLocalDate(r.from);
  const to = formatLocalDate(r.to);
  if (r.from === r.to) return `${to}${r.startHalf || r.endHalf ? ' (halber Tag)' : ''}`;
  return `${from.slice(0, 6)}${r.startHalf ? ' (halb)' : ''} – ${to}${r.endHalf ? ' (halb)' : ''}`;
}

/**
 * Urlaubsanträge und erbetene Stornierungen in „Freigaben“ (Spezifikation Phase 3, Abschnitt 6.2,
 * 6.3, 9; `vGenehm` im Prototyp). Die Rechte prüft das Backend; angezeigt wird, was `canDecide` trägt.
 */
@Component({
  selector: 'app-leave-decisions',
  imports: [RowToggle],
  host: { class: 'flex min-w-0 flex-col gap-5' },
  template: `
    <section class="card">
      <h2 tabindex="-1" data-leave-heading>
        Offene Abwesenheitsanträge{{ pending.hasValue() ? ' (' + open().length + ')' : '' }}
      </h2>
      @if (pending.hasValue()) {
        @for (r of open(); track r.id) {
          <article
            class="flex flex-col gap-2 rounded-ui border border-line p-3"
            [attr.aria-label]="r.employeeName + ', ' + range(r)"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 class="m-0 font-semibold">
                  {{ r.employeeName }}
                  @if (r.jobTitle) {
                    <span class="text-sm font-normal text-muted">{{ r.jobTitle }}</span>
                  }
                </h3>
                <div class="font-mono">
                  {{ range(r) }} · {{ types[r.type] }} · {{ currentDays(r) }}
                </div>
              </div>
              <span class="text-sm text-muted"
                >gestellt am {{ date(r.requestedAt) }}
                @if ((r.decision?.openBusinessDays ?? 0) > overdueAfter) {
                  <span class="pill lv-warn"
                    >seit {{ r.decision?.openBusinessDays }} Arbeitstagen offen</span
                  >
                }
              </span>
            </div>
            @if (r.note) {
              <p class="m-0 text-sm">Notiz: {{ r.note }}</p>
            }
            @if (r.decision?.restAfter; as rest) {
              @for (y of rest; track y.year) {
                <p class="m-0 text-sm">
                  Urlaubskonto {{ y.year }} nach Genehmigung:
                  <b class="font-mono" [class.neg]="y.rest < 0">{{ restLabel(y.rest) }}</b> Rest
                  @if (y.rest < 0) {
                    <span class="pill lv-warn">übersteigt das Urlaubskonto</span>
                  }
                </p>
              }
            }
            @let d = r.decision;
            <p class="m-0 text-sm">
              @if (d && (d.overlaps.length || d.otherOverlaps)) {
                Gleichzeitig abwesend:
                @for (o of d.overlaps; track $index; let last = $last) {
                  {{ o.employeeName }} ({{ o.status === 'PENDING' ? 'beantragt' : 'genehmigt' }},
                  {{ shortRange(o.from, o.to) }}){{ last ? '' : ', ' }}
                }
                @if (d.otherOverlaps; as others) {
                  {{ d.overlaps.length ? ' sowie ' : '' }}{{ others }}
                  {{ others === 1 ? 'weitere Person' : 'weitere Personen' }} im Team
                }
              } @else {
                <span class="text-muted">Keine Überschneidung mit anderen Abwesenheiten.</span>
              }
            </p>
            @if (rejecting() === r.id) {
              <form class="flex flex-col gap-2" (submit)="reject($event, r)">
                <label class="field" [for]="'leave-reject-' + r.id"
                  >Begründung der Ablehnung (sieht {{ r.employeeName }})<textarea
                    [id]="'leave-reject-' + r.id"
                    maxlength="500"
                    [value]="reason()"
                    [disabled]="busy()"
                    (input)="reason.set(text($event))"
                  ></textarea>
                </label>
                <div class="flex flex-wrap gap-2">
                  <button class="btn btn-danger" type="submit" [disabled]="busy()">
                    Ablehnung senden
                  </button>
                  <button class="btn" type="button" [disabled]="busy()" (click)="cancelReject(r)">
                    Abbrechen
                  </button>
                </div>
              </form>
            } @else {
              <div class="flex flex-wrap gap-2">
                <button
                  class="btn btn-primary"
                  type="button"
                  [disabled]="busy()"
                  [attr.aria-label]="
                    'Antrag von ' + r.employeeName + ', ' + range(r) + ' genehmigen'
                  "
                  (click)="approve(r)"
                >
                  Genehmigen
                </button>
                <button
                  class="btn btn-danger"
                  type="button"
                  [disabled]="busy()"
                  [attr.aria-label]="'Antrag von ' + r.employeeName + ', ' + range(r) + ' ablehnen'"
                  [attr.data-reject]="r.id"
                  (click)="startReject(r)"
                >
                  Ablehnen
                </button>
              </div>
            }
          </article>
        } @empty {
          <p class="m-0 text-muted">Keine offenen Anträge.</p>
        }
      } @else if (pending.error()) {
        <p class="err" role="alert">Die offenen Anträge konnten nicht geladen werden.</p>
        <div>
          <button class="btn" type="button" (click)="pending.reload()">
            Offene Abwesenheitsanträge erneut laden
          </button>
        </div>
      } @else {
        <p role="status">Anträge werden geladen …</p>
      }
      @if (error()) {
        <p class="err" role="alert">{{ error() }}</p>
      }
    </section>

    @if (approved.error()) {
      <section class="card">
        <h2>Erbetene Stornierungen</h2>
        <p class="err" role="alert">Die erbetenen Stornierungen konnten nicht geladen werden.</p>
        <div>
          <button class="btn" type="button" (click)="approved.reload()">
            Erbetene Stornierungen erneut laden
          </button>
        </div>
      </section>
    } @else if (cancellations().length) {
      <section class="card">
        <h2>Erbetene Stornierungen</h2>
        @for (r of cancellations(); track r.id) {
          <article
            class="flex flex-col gap-2 rounded-ui border border-line p-3"
            [attr.aria-label]="'Stornierung ' + r.employeeName + ', ' + range(r)"
          >
            <p class="m-0">
              <b>{{ r.employeeName }}</b> bittet um Stornierung:
              <span class="font-mono"
                >{{ range(r) }} · {{ types[r.type] }} · {{ currentDays(r) }}</span
              >
            </p>
            <div class="flex flex-wrap gap-2">
              <button
                class="btn btn-primary"
                type="button"
                [disabled]="busy()"
                [attr.aria-label]="
                  'Stornierung für ' + r.employeeName + ', ' + range(r) + ' bestätigen'
                "
                (click)="cancellation(r, true)"
              >
                Stornierung bestätigen
              </button>
              <button
                class="btn"
                type="button"
                [disabled]="busy()"
                [attr.aria-label]="
                  'Stornierung für ' + r.employeeName + ', ' + range(r) + ' ablehnen'
                "
                (click)="cancellation(r, false)"
              >
                Stornierung ablehnen
              </button>
            </div>
          </article>
        }
      </section>
    }

    @if (decidedList.error()) {
      <section class="card">
        <h2>Zuletzt entschieden</h2>
        <p class="err" role="alert">Die letzten Entscheidungen konnten nicht geladen werden.</p>
        <div>
          <button class="btn" type="button" (click)="decidedList.reload()">
            Letzte Entscheidungen erneut laden
          </button>
        </div>
      </section>
    } @else if (recent().length) {
      <section class="card">
        <h2>Zuletzt entschieden</h2>
        <div class="overflow-x-auto">
          <table class="data-table">
            <tbody>
              @for (r of recent(); track r.id) {
                <tr (click)="rows.onRowClick(r.id, $event)">
                  <td>{{ r.employeeName }}</td>
                  <td class="font-mono whitespace-nowrap max-sm:whitespace-normal">
                    {{ range(r) }}
                  </td>
                  <td>
                    <span
                      class="pill"
                      [class.lv-ok]="r.status === 'APPROVED'"
                      [class.lv-crit]="r.status === 'REJECTED'"
                      [class.lv-mute]="r.status === 'CANCELLED'"
                      >{{ statuses[r.status] }}</span
                    >
                  </td>
                  <td class="col-opt text-[13px]">{{ r.decisionReason }}</td>
                  <td class="col-narrow">
                    @if (r.decisionReason) {
                      <app-row-toggle
                        [open]="rows.isOpen(r.id)"
                        [label]="'Details zu ' + r.employeeName + ', ' + range(r)"
                        (toggled)="rows.toggle(r.id)"
                      />
                    }
                  </td>
                </tr>
                @if (rows.isOpen(r.id)) {
                  <tr class="row-details">
                    <td colspan="5">
                      <dl class="details">
                        <dt>Begründung</dt>
                        <dd>{{ r.decisionReason }}</dd>
                      </dl>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
})
export class LeaveDecisions {
  /** Aufgeklappte Zeilen unter 640 px (Spezifikation Design, Abschnitt 4). */
  protected readonly rows = new ExpandableRows();
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly counter = inject(ApprovalsCounter);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly pending = resource({
    loader: () => this.api.leaveRequests({ status: 'PENDING' }),
  });
  protected readonly approved = resource({
    loader: () => this.api.leaveRequests({ status: 'APPROVED' }),
  });
  protected readonly decidedList = resource({ loader: () => this.api.leaveRequests() });

  protected readonly open = computed(() =>
    this.pending.hasValue() ? this.pending.value().filter((r) => r.canDecide) : [],
  );
  protected readonly cancellations = computed(() =>
    this.approved.hasValue()
      ? this.approved.value().filter((r) => r.canDecide && r.cancelRequestedAt)
      : [],
  );
  /** Die letzten fünf eigenen Entscheidungen über Anträge anderer (`vGenehm` im Prototyp). */
  protected readonly recent = computed(() => {
    const me = this.store.session();
    if (!me || !this.decidedList.hasValue()) return [];
    return this.decidedList
      .value()
      .filter(
        (r) =>
          r.employeeId !== me.id &&
          r.enteredByName === null &&
          r.decidedByName === me.name &&
          (r.status === 'APPROVED' || r.status === 'REJECTED'),
      )
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
      .slice(0, 5);
  });

  protected readonly rejecting = signal<string | null>(null);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly types = ABSENCE_TYPE_LABELS;
  protected readonly statuses = LEAVE_STATUS_LABELS;
  protected readonly overdueAfter = OVERDUE_AFTER;
  protected readonly days = daysLabel;
  protected readonly currentDays = currentDaysLabel;
  protected readonly range = rangeLabel;

  protected date(iso: string): string {
    return berlinTimestamp(iso).slice(0, 10);
  }
  protected shortRange(from: string, to: string): string {
    return `${formatLocalDate(from).slice(0, 6)}–${formatLocalDate(to).slice(0, 6)}`;
  }
  protected restLabel(rest: number): string {
    return `${formatHalfDays(rest)} ${rest === 2 ? 'Tag' : 'Tage'}`;
  }
  protected text(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected startReject(r: LeaveRequestView): void {
    this.rejecting.set(r.id);
    this.reason.set('');
    this.error.set(null);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`#leave-reject-${r.id}`)?.focus(),
      { injector: this.injector },
    );
  }

  protected cancelReject(r: LeaveRequestView): void {
    this.rejecting.set(null);
    this.error.set(null);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`[data-reject="${r.id}"]`)?.focus(),
      { injector: this.injector },
    );
  }

  protected approve(r: LeaveRequestView): Promise<void> {
    return this.run(
      () => this.api.approveLeave(r.id),
      r.type === 'VACATION'
        ? `Urlaub von ${r.employeeName} genehmigt. Die Tage sind abgebucht und im Kalender eingetragen.`
        : `${ABSENCE_TYPE_LABELS[r.type]} von ${r.employeeName} genehmigt.`,
    );
  }

  protected reject(event: Event, r: LeaveRequestView): Promise<void> {
    event.preventDefault();
    const reason = this.reason().trim();
    if (reason.length < MIN_REASON) {
      this.error.set('Bitte den betrieblichen Grund nennen (mindestens ein Satz).');
      return Promise.resolve();
    }
    return this.run(
      () => this.api.rejectLeave(r.id, reason),
      `Antrag von ${r.employeeName} abgelehnt. Die Begründung ist beim Antrag sichtbar.`,
    );
  }

  protected cancellation(r: LeaveRequestView, approve: boolean): Promise<void> {
    return this.run(
      () => this.api.decideLeaveCancellation(r.id, approve),
      approve
        ? `Abwesenheit von ${r.employeeName} storniert. Die Tage sind zurückgebucht.`
        : `Stornierung für ${r.employeeName} abgelehnt. Die Abwesenheit bleibt bestehen.`,
    );
  }

  private async run(action: () => Promise<unknown>, success: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.rejecting.set(null);
      this.reason.set('');
      this.pending.reload();
      this.approved.reload();
      this.decidedList.reload();
      this.counter.reload();
      this.toast.show(success);
      // Der entschiedene Antrag verschwindet; Fokus auf die Liste.
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('[data-leave-heading]')?.focus(),
        { injector: this.injector },
      );
    } catch (e) {
      this.error.set(
        e instanceof ApiError ? e.message : 'Die Entscheidung konnte nicht gespeichert werden.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
