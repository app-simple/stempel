import { NgTemplateOutlet } from '@angular/common';
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
  formatHalfDays,
  formatLocalDate,
  LEAVE_STATUS_LABELS,
  localDateInBerlin,
  WEEKDAY_SHORT,
  type LeaveRequestView,
  type LeaveNoticeView,
} from '@as/shared';
import { ApiError, ApiService } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { ExpandableRows, RowToggle, PageHead } from '../../shared-ui';
import { daysText, leaveDate, statusClass } from './leave-display';
import { SickList } from '../sick/sick-list';
import { SickReport } from '../sick/sick-report';
import { LeaveForm } from './leave-form';

@Component({
  selector: 'app-leave-page',
  imports: [SickList, SickReport, RowToggle, NgTemplateOutlet, PageHead, LeaveForm],
  template: `
    <ng-template #leaveActions let-request>
      @if (request.status === 'PENDING') {
        <button
          type="button"
          class="btn btn-sm"
          [disabled]="busy()"
          [attr.aria-label]="'Antrag ' + period(request) + ' zurückziehen'"
          (click)="act(request, false)"
        >
          Zurückziehen
        </button>
      }
      @if (request.status === 'APPROVED' && request.from > today && !request.cancelRequestedAt) {
        @if (confirmCancel() === request.id) {
          <p>
            {{
              isAdmin()
                ? 'Stornieren? Die Tage gehen sofort zurück aufs Konto.'
                : 'Stornierung erbitten? Deine Vorgesetzte bzw. dein Vorgesetzter muss zustimmen.'
            }}
          </p>
          <button
            type="button"
            class="btn btn-sm btn-danger"
            data-confirm-cancel
            [disabled]="busy()"
            [attr.aria-label]="'Stornierung ' + period(request) + ' bestätigen'"
            (click)="act(request, true)"
          >
            Stornierung bestätigen
          </button>
          <button
            type="button"
            class="btn btn-sm"
            [disabled]="busy()"
            (click)="closeConfirm($event)"
          >
            Abbrechen
          </button>
        } @else {
          <button
            type="button"
            class="btn btn-sm"
            [disabled]="busy()"
            [attr.aria-label]="'Stornierung ' + period(request) + ' erbitten'"
            (click)="startConfirm(request, $event)"
          >
            Stornierung erbitten
          </button>
        }
      }
    </ng-template>
    <ng-template #leaveDecision let-request>
      @if (request.status === 'PENDING') {
        offen
      }
      @if (request.decidedByName) {
        <div>{{ request.decidedByName }}</div>
      }
      @if (request.decisionReason) {
        <div>{{ request.decisionReason }}</div>
      }
      @if (request.enteredByName) {
        <div class="text-[13px] text-muted">eingetragen durch {{ request.enteredByName }}</div>
      }
    </ng-template>
    <app-page-head heading="Mein Urlaub" [lead]="lead()" />
    @if (profile.error()) {
      <p class="err" role="alert">Deine Arbeitstage konnten nicht geladen werden.</p>
      <button class="btn" (click)="profile.reload()">Profil erneut laden</button>
    }
    @if (account.hasValue()) {
      @let a = account.value();
      <div class="tiles">
        <div class="tile">
          <small>Anspruch {{ year }}</small
          ><b>{{ daysText(a.entitlement) }}</b>
        </div>
        <div class="tile">
          <small>Übertrag {{ year - 1 }}</small
          ><b>{{ daysText(a.carryOver) }}</b>
        </div>
        @if (a.corrections !== 0) {
          <div class="tile">
            <small>Korrekturen</small><b>{{ daysText(a.corrections) }}</b>
          </div>
        }
        <div class="tile">
          <small>Genehmigt</small><b>{{ daysText(a.approved) }}</b>
        </div>
        <div class="tile">
          <small>Beantragt</small><b>{{ daysText(a.pending) }}</b>
        </div>
        <div class="tile">
          <small>Rest</small><b [class.text-crit]="a.rest < 0">{{ daysText(a.rest) }}</b>
        </div>
      </div>
      @if (a.entitlementBasis === 'STATUTORY_MINIMUM') {
        <p class="text-[13px] text-muted">Anspruch nach gesetzlichem Mindesturlaub</p>
      }
    } @else if (account.error()) {
      <p class="err" role="alert">Dein Urlaubskonto konnte nicht geladen werden.</p>
      <button class="btn" (click)="account.reload()">Konto erneut laden</button>
    } @else {
      <p class="text-muted">Urlaubskonto wird geladen …</p>
    }
    @if (notices.hasValue()) {
      @if (sortedNotices().length) {
        <section class="card" aria-labelledby="leave-notice-heading">
          <h2 id="leave-notice-heading">Urlaubshinweise</h2>
          @if (noticeError()) {
            <p class="err" role="alert">{{ noticeError() }}</p>
          }
          @for (notice of sortedNotices(); track notice.id) {
            <article
              class="rounded-lg p-3"
              [class.bg-accent-soft]="!notice.readAt"
              [attr.data-notice]="notice.id"
              tabindex="-1"
            >
              <h3 class="font-semibold">
                {{ notice.year }} · erhalten am {{ noticeDate(notice.sentAt) }}
              </h3>
              @if (!notice.readAt) {
                <span class="pill lv-warn">ungelesen</span>
              }
              <p class="whitespace-pre-wrap">{{ notice.text }}</p>
              @if (notice.readAt) {
                <p>gelesen am {{ noticeDate(notice.readAt) }}</p>
              } @else {
                <button
                  type="button"
                  class="btn btn-sm"
                  [disabled]="noticeBusy()"
                  [attr.aria-label]="
                    'Hinweis ' +
                    notice.year +
                    ' vom ' +
                    noticeDate(notice.sentAt) +
                    ' als gelesen markieren'
                  "
                  (click)="readNotice(notice)"
                >
                  Gelesen
                </button>
              }
            </article>
          }
        </section>
      }
    } @else if (notices.error()) {
      <section class="card">
        <p class="err" role="alert">Deine Urlaubshinweise konnten nicht geladen werden.</p>
        <div>
          <button type="button" class="btn" (click)="notices.reload()">
            Urlaubshinweise erneut laden
          </button>
        </div>
      </section>
    } @else {
      <p class="text-muted" role="status">Urlaubshinweise werden geladen …</p>
    }
    <section class="card" aria-labelledby="my-sick-heading">
      <h2 id="my-sick-heading">Krankmeldungen</h2>
      <p>
        Bitte keine Gründe oder Diagnosen angeben. Die AU vermerkt deine Vorgesetzte oder der Admin.
      </p>
      <app-sick-report (saved)="reloadSick()" />
      @if (sick.hasValue()) {
        <app-sick-list [items]="sick.value()" (saved)="reloadSick()" />
      } @else if (sick.error()) {
        <p class="err" role="alert">{{ sickError() }}</p>
        <button type="button" class="btn" (click)="sick.reload()">
          Krankmeldungen erneut laden
        </button>
      } @else {
        <p role="status">Krankmeldungen werden geladen …</p>
      }
    </section>
    <section class="card"><app-leave-form (saved)="reload()" /></section>
    <section class="card">
      <h2 id="my-leave-requests" tabindex="-1">Meine Anträge</h2>
      @if (error()) {
        <p class="err m-0" role="alert">{{ error() }}</p>
      }
      @if (requests.hasValue()) {
        @if (sortedRequests().length) {
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Zeitraum</th>
                  <th class="col-opt">Art</th>
                  <th>Tage</th>
                  <th>Status</th>
                  <th class="col-opt">Entscheidung</th>
                  <th class="col-opt">Aktionen</th>
                  <th class="col-narrow"><span class="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                @for (request of sortedRequests(); track request.id) {
                  <tr
                    (click)="rows.onRowClick(request.id, $event)"
                    [attr.data-request]="request.id"
                    tabindex="-1"
                  >
                    <td class="sm:whitespace-nowrap">{{ period(request) }}</td>
                    <td class="col-opt">{{ types[request.type] }}</td>
                    <td>
                      {{ daysText(request.halfDays) }}
                      @if (request.currentHalfDays !== request.halfDays) {
                        <div class="text-[13px] text-muted">
                          neu berechnet: {{ number(request.currentHalfDays) }} statt
                          {{ daysText(request.halfDays) }}
                        </div>
                      }
                    </td>
                    <td>
                      <span class="pill" [class]="statusClass(request.status)">{{
                        statuses[request.status]
                      }}</span>
                      @if (request.cancelRequestedAt && request.status === 'APPROVED') {
                        <span class="pill lv-warn">Stornierung erbeten</span>
                      }
                    </td>
                    <td class="col-opt">
                      <ng-container
                        [ngTemplateOutlet]="leaveDecision"
                        [ngTemplateOutletContext]="{ $implicit: request }"
                      />
                    </td>
                    <td class="col-opt">
                      <ng-container
                        [ngTemplateOutlet]="leaveActions"
                        [ngTemplateOutletContext]="{ $implicit: request }"
                      />
                    </td>
                    <td class="col-narrow">
                      <app-row-toggle
                        [open]="rows.isOpen(request.id)"
                        [label]="'Details zu ' + period(request)"
                        (toggled)="rows.toggle(request.id)"
                      />
                    </td>
                  </tr>
                  @if (rows.isOpen(request.id)) {
                    <tr class="row-details">
                      <td colspan="7">
                        <dl class="details">
                          <dt>Art</dt>
                          <dd>{{ types[request.type] }}</dd>
                          <dt>Entscheidung</dt>
                          <dd>
                            <ng-container
                              [ngTemplateOutlet]="leaveDecision"
                              [ngTemplateOutletContext]="{ $implicit: request }"
                            />
                          </dd>
                          <dt>Aktionen</dt>
                          <dd>
                            <ng-container
                              [ngTemplateOutlet]="leaveActions"
                              [ngTemplateOutletContext]="{ $implicit: request }"
                            />
                          </dd>
                        </dl>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="text-muted">Noch keine Anträge.</p>
        }
      } @else if (requests.error()) {
        <p class="err" role="alert">Deine Anträge konnten nicht geladen werden.</p>
        <button class="btn" (click)="requests.reload()">Anträge erneut laden</button>
      } @else {
        <p class="text-muted">Anträge werden geladen …</p>
      }
    </section>
  `,
})
export class LeavePage {
  protected readonly sick = resource({
    params: () => this.store.session()?.id,
    loader: ({ params }) => this.api.sickLeaves({ employeeId: params }),
  });
  protected sickError(): string {
    const error = this.sick.error();
    return error instanceof ApiError
      ? error.message
      : 'Deine Krankmeldungen konnten nicht geladen werden.';
  }
  protected reloadSick(): void {
    this.sick.reload();
    this.reload();
  }
  protected readonly rows = new ExpandableRows();
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  /** Der Admin storniert eigene Abwesenheiten sofort (Entscheidung 8). */
  protected readonly isAdmin = computed(() => this.store.hasRole('ADMIN'));
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly today = localDateInBerlin(new Date());
  protected readonly year = Number(this.today.slice(0, 4));
  protected readonly profile = resource({ loader: () => this.api.me() });
  protected readonly account = resource({ loader: () => this.api.leaveAccount(this.year) });
  protected readonly notices = resource({
    params: () => this.store.session()?.id,
    loader: ({ params }) => this.api.leaveNotices({ employeeId: params }),
  });
  protected readonly sortedNotices = computed(() =>
    this.notices.hasValue()
      ? [...this.notices.value()].sort(
          (a, b) => Number(!!a.readAt) - Number(!!b.readAt) || b.sentAt.localeCompare(a.sentAt),
        )
      : [],
  );
  protected readonly noticeBusy = signal(false);
  protected readonly noticeError = signal<string | null>(null);
  protected noticeDate(value: string): string {
    return formatLocalDate(localDateInBerlin(new Date(value)));
  }
  protected async readNotice(notice: LeaveNoticeView): Promise<void> {
    if (this.noticeBusy() || notice.readAt) return;
    this.noticeBusy.set(true);
    this.noticeError.set(null);
    try {
      const updated = await this.api.readLeaveNotice(notice.id);
      this.notices.update((list) => list?.map((item) => (item.id === updated.id ? updated : item)));
      this.focus(`[data-notice="${notice.id}"]`);
    } catch (error) {
      this.noticeError.set(
        error instanceof ApiError
          ? error.message
          : 'Der Hinweis konnte nicht als gelesen markiert werden.',
      );
      this.focus(`[data-notice="${notice.id}"]`);
    } finally {
      this.noticeBusy.set(false);
    }
  }
  protected readonly requests = resource({
    params: () => this.store.session()?.id,
    loader: ({ params }) => this.api.leaveRequests({ employeeId: params }),
  });
  protected readonly sortedRequests = computed(() =>
    this.requests.hasValue()
      ? [...this.requests.value()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      : [],
  );
  protected readonly lead = computed(() => {
    const days = this.profile.hasValue()
      ? this.profile
          .value()
          .currentTerms?.workDays.map((d) => WEEKDAY_SHORT[d])
          .join(', ')
      : '';
    return `Gezählt werden nur deine Arbeitstage${days ? ' (' + days + ')' : ''}, ohne Feiertage.`;
  });
  protected readonly types = ABSENCE_TYPE_LABELS;
  protected readonly statuses = LEAVE_STATUS_LABELS;
  protected readonly statusClass = statusClass;
  protected readonly daysText = daysText;
  protected readonly number = formatHalfDays;
  protected readonly period = (r: LeaveRequestView) =>
    `${leaveDate(r.from, r.startHalf)} – ${leaveDate(r.to, r.endHalf)}`;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmCancel = signal<string | null>(null);
  protected reload(): void {
    this.account.reload();
    this.requests.reload();
  }
  private focus(selector: string, scope: ParentNode = this.host.nativeElement): void {
    afterNextRender(() => scope.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
  protected startConfirm(r: LeaveRequestView, event: Event): void {
    const scope = (event.currentTarget as HTMLElement).closest('td, dd') ?? undefined;
    this.confirmCancel.set(r.id);
    this.focus('[data-confirm-cancel]', scope);
  }
  protected closeConfirm(event: Event): void {
    const scope = (event.currentTarget as HTMLElement).closest('td, dd') ?? undefined;
    this.confirmCancel.set(null);
    this.focus('button', scope);
  }
  protected async act(r: LeaveRequestView, cancellation: boolean): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const updated = await (cancellation
        ? this.api.requestLeaveCancellation(r.id)
        : this.api.withdrawLeave(r.id));
      this.requests.update((list) => list?.map((item) => (item.id === r.id ? updated : item)));
      this.account.reload();
      this.confirmCancel.set(null);
      this.toast.show(
        !cancellation
          ? 'Antrag zurückgezogen.'
          : updated.status === 'CANCELLED'
            ? 'Abwesenheit storniert.'
            : 'Stornierung erbeten.',
      );
      this.focus(`[data-request="${r.id}"]`);
    } catch (error) {
      this.error.set(
        error instanceof ApiError ? error.message : 'Die Aktion konnte nicht gespeichert werden.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
