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
import type { CorrectionRequestView } from '@as/shared';
import { ApiError, ApiService } from '../../core/api.service';
import { ApprovalsCounter } from '../../core/approvals-counter';
import { LocalDatePipe } from '../../core/format.pipes';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { PageHead } from '../../shared-ui';
import { berlinTimestamp } from '../times/time-display';
import { LeaveDecisions } from './leave-decisions';

@Component({
  selector: 'app-approvals-page',
  host: { class: 'flex min-w-0 flex-col gap-5' },
  imports: [PageHead, LocalDatePipe, LeaveDecisions],
  template: `
    <app-page-head
      heading="Freigaben"
      lead="Urlaubswünsche sind zu berücksichtigen. Ablehnen geht nur mit Begründung: dringende betriebliche Belange oder vorrangige Wünsche anderer (§ 7 Abs. 1 BUrlG). Darunter die Korrekturanträge der Zeiterfassung."
    />
    @if (allowed()) {
      <app-leave-decisions />
      <section class="card">
        <h2 tabindex="-1" data-approvals-heading>Offene Korrekturanträge</h2>
        @if (pending.hasValue()) {
          @for (request of actionable(); track request.id) {
            <article
              class="flex flex-col gap-3 rounded-ui border border-line p-3"
              [attr.aria-label]="request.employeeName + ', ' + request.workDate"
            >
              <h3 class="m-0 font-semibold">
                {{ request.employeeName }} ·
                <span class="font-mono">{{ request.workDate | localDate }}</span>
                <span class="pill lv-warn">{{
                  request.kind === 'VOID' ? 'ungültig' : 'Korrektur'
                }}</span>
              </h3>
              <dl class="fields m-0">
                <div>
                  <dt class="text-sm text-muted">Bisher</dt>
                  <dd class="m-0 font-mono">
                    {{ request.current.start }}–{{ request.current.end ?? 'offen' }}, Pause
                    {{ request.current.breakMinutes }} Min.
                  </dd>
                </div>
                <div>
                  <dt class="text-sm text-muted">Beantragt</dt>
                  <dd class="m-0 font-mono">{{ proposal(request) }}</dd>
                </div>
              </dl>
              <p class="m-0">Begründung: {{ request.reason }}</p>
              <p class="m-0 text-sm text-muted">
                Beantragt am <span class="font-mono">{{ timestamp(request.requestedAt) }}</span>
              </p>
              <label class="field" [for]="'rejection-' + request.id"
                >Begründung der Ablehnung (Pflicht bei Ablehnen)<textarea
                  [id]="'rejection-' + request.id"
                  maxlength="2000"
                  [value]="reasons()[request.id] ?? ''"
                  [disabled]="busy()"
                  (input)="setReason(request.id, $event)"
                ></textarea>
              </label>
              <div class="flex flex-wrap gap-2">
                <button
                  class="btn btn-primary"
                  type="button"
                  [disabled]="busy()"
                  [attr.aria-label]="
                    'Antrag von ' + request.employeeName + ' für ' + request.workDate + ' freigeben'
                  "
                  (click)="decide(request, true)"
                >
                  Freigeben
                </button>
                <button
                  class="btn btn-danger"
                  type="button"
                  [disabled]="busy() || !reasons()[request.id]?.trim()"
                  [attr.aria-label]="
                    'Antrag von ' + request.employeeName + ' für ' + request.workDate + ' ablehnen'
                  "
                  (click)="decide(request, false)"
                >
                  Ablehnen
                </button>
              </div>
            </article>
          } @empty {
            <p class="m-0 text-muted">Keine offenen Korrekturanträge.</p>
          }
        } @else if (pending.error()) {
          <p class="err" role="alert">Die offenen Anträge konnten nicht geladen werden.</p>
          <div>
            <button class="btn" type="button" (click)="pending.reload()">
              Offene Anträge erneut laden
            </button>
          </div>
        } @else {
          <p role="status">Anträge werden geladen …</p>
        }
        @if (error()) {
          <p class="err" role="alert">{{ error() }}</p>
        }
      </section>
      <section class="card">
        <h2>Zuletzt entschieden</h2>
        @if (all.hasValue()) {
          @for (request of decided(); track request.id) {
            <article class="rounded-ui border border-line p-3">
              <h3 class="m-0 font-semibold">
                {{ request.employeeName }} ·
                <span class="font-mono">{{ request.workDate | localDate }}</span>
                <span
                  class="pill"
                  [class.lv-ok]="request.status === 'APPROVED'"
                  [class.lv-crit]="request.status === 'REJECTED'"
                  [class.lv-mute]="request.status === 'WITHDRAWN'"
                  >{{ statuses[request.status] }}</span
                >
              </h3>
              <p class="my-1">
                {{ request.kind === 'VOID' ? 'Ungültig-Markierung' : 'Korrektur' }} ·
                {{ request.reason }}
              </p>
              <p class="my-1 font-mono text-sm">Beantragt: {{ proposal(request) }}</p>
              <p class="my-1 text-sm text-muted">
                <span class="font-mono">{{
                  timestamp(request.decidedAt ?? request.requestedAt)
                }}</span>
                @if (request.decidedByName) {
                  · {{ request.decidedByName }}
                }
              </p>
              @if (request.decisionReason) {
                <p class="mb-0">Begründung der Entscheidung: {{ request.decisionReason }}</p>
              }
            </article>
          } @empty {
            <p class="m-0 text-muted">Noch keine entschiedenen Anträge.</p>
          }
        } @else if (all.error()) {
          <p class="err" role="alert">Die entschiedenen Anträge konnten nicht geladen werden.</p>
          <div>
            <button class="btn" type="button" (click)="all.reload()">
              Entschiedene Anträge erneut laden
            </button>
          </div>
        } @else {
          <p role="status">Entscheidungen werden geladen …</p>
        }
      </section>
    } @else {
      <p class="hint">Freigaben stehen Vorgesetzten, dem Admin und Vertretungen zur Verfügung.</p>
    }
  `,
})
export class ApprovalsPage {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly counter = inject(ApprovalsCounter);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly toast = inject(ToastService);
  /** Vorgesetzte, Admin und aktive Vertretungen (Phase 3, Entscheidung 7). */
  protected readonly allowed = computed(() => this.counter.decides());
  protected readonly pending = resource({
    params: () => this.allowed() || undefined,
    loader: () => this.api.corrections('PENDING'),
  });
  protected readonly all = resource({
    params: () => this.allowed() || undefined,
    loader: () => this.api.corrections(),
  });
  protected readonly actionable = computed(() =>
    this.pending.hasValue()
      ? this.pending
          .value()
          .filter((r) => r.status === 'PENDING' && r.employeeId !== this.store.session()?.id)
      : [],
  );
  protected readonly decided = computed(() =>
    this.all.hasValue()
      ? this.all
          .value()
          .filter((r) => r.status !== 'PENDING')
          .sort((a, b) =>
            (b.decidedAt ?? b.requestedAt).localeCompare(a.decidedAt ?? a.requestedAt),
          )
          .slice(0, 10)
      : [],
  );
  protected readonly reasons = signal<Record<string, string>>({});
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly timestamp = berlinTimestamp;
  protected readonly statuses = {
    PENDING: 'Offen',
    APPROVED: 'Freigegeben',
    REJECTED: 'Abgelehnt',
    WITHDRAWN: 'Zurückgezogen',
  };
  protected proposal(request: CorrectionRequestView): string {
    const proposed = request.proposed;
    if (request.kind === 'VOID') return 'Buchung ungültig markieren';
    if (!proposed) return 'Keine Angaben';
    const pauses = proposed.breaks.map((b) => `${b.start}–${b.end}`).join(', ') || 'keine';
    return `${proposed.start}–${proposed.end ?? 'offen'}${proposed.end && proposed.end < proposed.start ? ' +1' : ''}, Pausen: ${pauses}`;
  }
  protected setReason(id: string, event: Event): void {
    this.reasons.update((values) => ({
      ...values,
      [id]: (event.target as HTMLTextAreaElement).value,
    }));
  }
  protected async decide(request: CorrectionRequestView, approve: boolean): Promise<void> {
    const reason = this.reasons()[request.id]?.trim() ?? '';
    if (
      this.busy() ||
      !this.allowed() ||
      request.employeeId === this.store.session()?.id ||
      (!approve && !reason)
    )
      return;
    this.busy.set(true);
    this.error.set(null);
    try {
      if (approve) await this.api.approveCorrection(request.id);
      else await this.api.rejectCorrection(request.id, reason);
      this.reasons.update((values) => {
        const next = { ...values };
        delete next[request.id];
        return next;
      });
      this.pending.reload();
      this.all.reload();
      this.counter.reload();
      this.toast.show(approve ? 'Korrektur freigegeben.' : 'Korrektur abgelehnt.');
      // Der entschiedene Antrag verschwindet; Fokus auf die Liste (Codex-Review Web Phase 2, Befund 7).
      afterNextRender(
        () =>
          this.host.nativeElement.querySelector<HTMLElement>('[data-approvals-heading]')?.focus(),
        { injector: this.injector },
      );
    } catch (error) {
      this.error.set(
        error instanceof ApiError
          ? error.message
          : 'Die Entscheidung konnte nicht gespeichert werden.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
