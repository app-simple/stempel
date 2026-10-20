import { Component, computed, ElementRef, inject, resource, signal } from '@angular/core';
import {
  ABSENCE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  localDateInBerlin,
  type LeaveStatus,
} from '@as/shared';
import { ApiError, ApiService } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { ExpandableRows, RowToggle, PageHead } from '../../shared-ui';
import { currentDaysLabel, daysText, leaveDate, statusClass } from '../leave/leave-display';
import { SickList } from '../sick/sick-list';
import { SickReport } from '../sick/sick-report';
import { LeaveForm } from '../leave/leave-form';
import { LeaveAccounts } from './leave-accounts';
import { LeaveCalendar } from './leave-calendar';

type Tab = 'calendar' | 'list' | 'accounts';
@Component({
  selector: 'app-leave-overview-page',
  imports: [SickList, SickReport, RowToggle, PageHead, LeaveForm, LeaveAccounts, LeaveCalendar],
  template: `
    <app-page-head heading="Urlaubsübersicht" [lead]="lead()" />
    <section class="card">
      <div role="tablist" aria-label="Urlaubsübersicht" class="flex flex-wrap gap-2">
        @for (item of tabs; track item.id) {
          <button
            class="btn"
            [class.btn-primary]="tab() === item.id"
            type="button"
            role="tab"
            [id]="'tab-' + item.id"
            [attr.aria-controls]="'panel-' + item.id"
            [attr.aria-selected]="tab() === item.id"
            [tabIndex]="tab() === item.id ? 0 : -1"
            (click)="tab.set(item.id)"
            (keydown)="tabKey($event, item.id)"
          >
            {{ item.label }}
          </button>
        }
      </div>
      @if (tab() !== 'calendar') {
        <label class="field max-w-48" for="leave-year"
          >Jahr<select id="leave-year" [value]="year()" (change)="year.set(+value($event))">
            <option [value]="currentYear">{{ currentYear }}</option>
            <option [value]="currentYear + 1">{{ currentYear + 1 }}</option>
          </select></label
        >
      }
      <div
        id="panel-calendar"
        role="tabpanel"
        aria-labelledby="tab-calendar"
        [hidden]="tab() !== 'calendar'"
        tabindex="0"
      >
        @if (tab() === 'calendar') {
          <app-leave-calendar />
        }
      </div>
      <div
        id="panel-list"
        role="tabpanel"
        aria-labelledby="tab-list"
        [hidden]="tab() !== 'list'"
        tabindex="0"
      >
        @if (tab() === 'list') {
          @if (manager()) {
            @if (employees.hasValue()) {
              <section class="mb-5">
                <app-leave-form
                  [forOthers]="true"
                  [people]="otherPeople()"
                  (saved)="requests.reload()"
                />
                <app-sick-report
                  [forOthers]="true"
                  [people]="otherPeople()"
                  (saved)="sick.reload(); requests.reload()"
                />
              </section>
            } @else if (employees.error()) {
              <p class="err" role="alert">Die Mitarbeiter konnten nicht geladen werden.</p>
              <button class="btn" (click)="employees.reload()">Mitarbeiter erneut laden</button>
            } @else {
              <p class="text-muted">Mitarbeiter werden geladen …</p>
            }
          }
          <div class="fields mb-3">
            <label class="field" for="leave-status"
              >Status<select id="leave-status" [value]="status()" (change)="setStatus($event)">
                <option value="">Alle</option>
                <option value="PENDING">Beantragt</option>
                <option value="APPROVED">Genehmigt</option>
                <option value="REJECTED">Abgelehnt</option>
                <option value="WITHDRAWN">Zurückgezogen</option>
                <option value="CANCELLED">Storniert</option>
              </select></label
            >
            @if (manager()) {
              <label class="field" for="leave-filter-person"
                >Mitarbeiter<select
                  id="leave-filter-person"
                  [value]="person()"
                  (change)="person.set(value($event))"
                >
                  <option value="">Alle</option>
                  @if (employees.hasValue()) {
                    @for (employee of employees.value(); track employee.id) {
                      <option [value]="employee.id">{{ employee.name }}</option>
                    }
                  }
                </select></label
              >
            }
          </div>
          @if (requests.hasValue()) {
            <div class="overflow-x-auto">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Mitarbeiter</th>
                    <th class="col-narrow">Von–Bis</th>
                    <th class="col-opt">Art</th>
                    <th class="col-opt">Von</th>
                    <th class="col-opt">Bis</th>
                    <th class="col-opt">Tage</th>
                    <th>Status</th>
                    <th class="col-opt">Entschieden von</th>

                    <th class="col-narrow"><span class="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (request of sortedRequests(); track request.id) {
                    <tr
                      (click)="rows.onRowClick(request.id, $event)"
                      [class.opacity-60]="request.to < today"
                    >
                      <td>
                        {{ request.employeeName }}
                        @if (request.enteredByName) {
                          <div class="text-[13px] text-muted">
                            eingetragen durch {{ request.enteredByName }}
                          </div>
                        }
                      </td>
                      <td class="col-narrow">
                        {{ leaveDate(request.from, request.startHalf) }}–<wbr />{{
                          leaveDate(request.to, request.endHalf)
                        }}
                      </td>
                      <td class="col-opt">{{ types[request.type] }}</td>
                      <td class="col-opt whitespace-nowrap">
                        {{ leaveDate(request.from, request.startHalf) }}
                      </td>
                      <td class="col-opt whitespace-nowrap">
                        {{ leaveDate(request.to, request.endHalf) }}
                      </td>
                      <td class="col-opt">{{ currentDays(request) }}</td>
                      <td>
                        <span class="pill" [class]="statusClass(request.status)">{{
                          statuses[request.status]
                        }}</span>
                        @if (request.cancelRequestedAt && request.status === 'APPROVED') {
                          <span class="pill lv-warn">Stornierung erbeten</span>
                        }
                      </td>
                      <td class="col-opt">{{ request.decidedByName || '–' }}</td>

                      <td class="col-narrow">
                        <app-row-toggle
                          [open]="rows.isOpen(request.id)"
                          [label]="
                            'Details zu ' +
                            request.employeeName +
                            ', ' +
                            leaveDate(request.from, request.startHalf) +
                            '–' +
                            leaveDate(request.to, request.endHalf)
                          "
                          (toggled)="rows.toggle(request.id)"
                        />
                      </td>
                    </tr>
                    @if (rows.isOpen(request.id)) {
                      <tr class="row-details">
                        <td colspan="9">
                          <dl class="details">
                            <dt>Art</dt>
                            <dd>{{ types[request.type] }}</dd>
                            <dt>Tage</dt>
                            <dd>{{ currentDays(request) }}</dd>
                            <dt>Entschieden von</dt>
                            <dd>{{ request.decidedByName || '–' }}</dd>
                          </dl>
                        </td>
                      </tr>
                    }
                  } @empty {
                    <tr>
                      <td colspan="9" class="text-muted">Keine Einträge für diesen Filter.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else if (requests.error()) {
            <p class="err" role="alert">Die Anträge konnten nicht geladen werden.</p>
            <button class="btn" (click)="requests.reload()">Liste erneut laden</button>
          } @else {
            <p class="text-muted">Anträge werden geladen …</p>
          }
          @if (manager()) {
            <section class="mt-5" aria-labelledby="team-sick-heading">
              <h2 id="team-sick-heading">Krankmeldungen im Team</h2>
              @if (sick.hasValue()) {
                <app-sick-list
                  [items]="sick.value()"
                  [showPerson]="true"
                  (saved)="sick.reload(); requests.reload()"
                />
              } @else if (sick.error()) {
                <p class="err" role="alert">{{ sickError() }}</p>
                <button type="button" class="btn" (click)="sick.reload()">
                  Krankmeldungen erneut laden
                </button>
              } @else {
                <p role="status">Krankmeldungen werden geladen …</p>
              }
            </section>
          }
        }
      </div>
      <div
        id="panel-accounts"
        role="tabpanel"
        aria-labelledby="tab-accounts"
        [hidden]="tab() !== 'accounts'"
        tabindex="0"
      >
        @if (tab() === 'accounts') {
          <app-leave-accounts [year]="year()" [manager]="manager()" />
        }
      </div>
    </section>
  `,
})
export class LeaveOverviewPage {
  protected readonly rows = new ExpandableRows();
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly today = localDateInBerlin(new Date());
  protected readonly currentYear = Number(this.today.slice(0, 4));
  protected readonly year = signal(this.currentYear);
  protected readonly tab = signal<Tab>('calendar');
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'calendar', label: 'Kalender' },
    { id: 'list', label: 'Liste' },
    { id: 'accounts', label: 'Urlaubskonten' },
  ];
  protected readonly manager = computed(() => this.store.hasRole('LEAD', 'ADMIN'));
  protected readonly lead = computed(() =>
    this.store.role() === 'EMPLOYEE'
      ? 'Deine Urlaubstage und wie viele Kollegen aus deinem Team an einem Tag schon fehlen. Namen werden nicht angezeigt.'
      : this.store.role() === 'LEAD'
        ? 'Wer aus deinem Team wann nicht da ist. Im Kalender steht nur die Abwesenheit, kein Grund.'
        : 'Wer wann nicht da ist. Im Kalender steht nur die Abwesenheit, kein Grund.',
  );
  protected readonly status = signal<LeaveStatus | ''>('');
  protected readonly person = signal('');
  protected readonly employees = resource({
    params: () => (this.manager() && this.tab() === 'list' ? true : undefined),
    loader: () => this.api.employees(),
  });
  protected readonly otherPeople = computed(() =>
    this.employees.hasValue()
      ? this.employees.value().filter((person) => person.id !== this.store.session()?.id)
      : [],
  );
  protected readonly requests = resource({
    params: () => {
      if (this.tab() !== 'list') return undefined;
      const status = this.status();
      const employeeId = this.manager() ? this.person() : this.store.session()?.id;
      return {
        year: this.year(),
        ...(status ? { status } : {}),
        ...(employeeId ? { employeeId } : {}),
      };
    },
    loader: ({ params }) => this.api.leaveRequests(params),
  });
  protected readonly sick = resource({
    params: () =>
      this.manager() && this.tab() === 'list'
        ? {
            ...(this.person() ? { employeeId: this.person() } : {}),
            from: `${this.year()}-01-01`,
            to: `${this.year()}-12-31`,
          }
        : undefined,
    loader: ({ params }) => this.api.sickLeaves(params),
  });
  protected sickError(): string {
    const error = this.sick.error();
    return error instanceof ApiError
      ? error.message
      : 'Die Krankmeldungen konnten nicht geladen werden.';
  }
  protected readonly sortedRequests = computed(() =>
    this.requests.hasValue()
      ? [...this.requests.value()].sort((a, b) => a.from.localeCompare(b.from))
      : [],
  );
  protected readonly types = ABSENCE_TYPE_LABELS;
  protected readonly statuses = LEAVE_STATUS_LABELS;
  protected readonly statusClass = statusClass;
  protected readonly daysText = daysText;
  protected readonly currentDays = currentDaysLabel;
  protected readonly leaveDate = leaveDate;
  protected value(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
  protected setStatus(event: Event): void {
    this.status.set(this.value(event) as LeaveStatus | '');
  }
  protected tabKey(event: KeyboardEvent, current: Tab): void {
    const index = this.tabs.findIndex((t) => t.id === current);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % 3
        : event.key === 'ArrowLeft'
          ? (index + 2) % 3
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 2
              : null;
    if (next === null) return;
    event.preventDefault();
    const target = this.tabs[next];
    if (!target) return;
    const id = target.id;
    this.tab.set(id);
    this.host.nativeElement.querySelector<HTMLElement>(`#tab-${id}`)?.focus();
  }
}
