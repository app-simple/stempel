import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import {
  minijobEquationHolds,
  DAY_ABSENCE_LABELS,
  addDays,
  isoWeekKey,
  localDateInBerlin,
  mondayOf,
  type ManualEntryInput,
  type RuleFlag,
  type TimeEntryView,
  type WeekView,
} from '@as/shared';
import { NgTemplateOutlet } from '@angular/common';
import { LucideChevronLeft, LucideChevronRight, LucideFileDown } from '@lucide/angular';
import { ApiError, ApiService } from '../../core/api.service';
import { EuroPipe, HoursMinutesPipe, LocalDatePipe } from '../../core/format.pipes';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { ExpandableRows, firstVisible, PageHead, RowToggle, RuleMessages } from '../../shared-ui';
import { EntryForm } from './entry-form';
import { EntryHistory } from './entry-history';
import { berlinTimestamp, dayLabel, lateLabel, monthLabel, signedMinutes } from './time-display';

@Component({
  selector: 'app-times-page',
  host: { class: 'flex min-w-0 flex-col gap-5' },
  imports: [
    PageHead,
    RuleMessages,
    LocalDatePipe,
    HoursMinutesPipe,
    EuroPipe,
    EntryForm,
    EntryHistory,
    NgTemplateOutlet,
    RowToggle,
    LucideChevronLeft,
    LucideChevronRight,
    LucideFileDown,
  ],
  template: `
    <app-page-head
      heading="Zeiten"
      lead="Beginn, Ende und Pause je Tag. Jede Buchung wird beim Speichern gegen Arbeitszeit- und Mindestlohngesetz geprüft."
    />
    <section class="card">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-4">
          @if (canChoose()) {
            <label class="field" for="time-employee"
              >Mitarbeiter
              <select
                id="time-employee"
                [value]="employeeId()"
                [disabled]="busy()"
                (change)="employeeId.set(value($event))"
              >
                <option [value]="store.session()?.id">{{ store.session()?.name }} (du)</option>
                @for (person of team(); track person.id) {
                  <option [value]="person.id">{{ person.name }}</option>
                }
              </select>
            </label>
          }
          <div>
            <b>KW {{ weekKey().slice(-2) }}</b>
            <div class="font-mono text-sm text-muted">
              {{ monday() | localDate }} – {{ sunday() | localDate }}
            </div>
          </div>
        </div>
        <div class="flex gap-2">
          <button
            class="btn btn-sm"
            type="button"
            aria-label="Vorige Woche"
            [disabled]="busy()"
            (click)="moveWeek(-7)"
          >
            <svg lucideChevronLeft [size]="16" aria-hidden="true"></svg>
            Woche
          </button>
          <button
            class="btn btn-sm"
            type="button"
            [disabled]="busy()"
            (click)="monday.set(currentMonday)"
          >
            Heute
          </button>
          <button
            class="btn btn-sm"
            type="button"
            aria-label="Nächste Woche"
            [disabled]="busy()"
            (click)="moveWeek(7)"
          >
            Woche
            <svg lucideChevronRight [size]="16" aria-hidden="true"></svg>
          </button>
        </div>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <label class="field" for="time-export-month"
          >Monat exportieren
          <input
            id="time-export-month"
            type="month"
            [value]="exportMonth()"
            (input)="exportMonth.set(value($event))"
          />
        </label>
        @if (exportMonthValid()) {
          <a
            class="btn btn-sm"
            [href]="exportPdfUrl()"
            download
            aria-label="Monat als PDF exportieren"
            ><svg lucideFileDown [size]="16" aria-hidden="true"></svg>PDF</a
          >
          <a
            class="btn btn-sm"
            [href]="exportCsvUrl()"
            download
            aria-label="Monat als CSV exportieren"
            ><svg lucideFileDown [size]="16" aria-hidden="true"></svg>CSV</a
          >
        }
      </div>
      @if (people.error()) {
        <p class="err" role="alert">Die Mitarbeiter konnten nicht geladen werden.</p>
        <div>
          <button class="btn btn-sm" type="button" (click)="people.reload()">
            Mitarbeiter erneut laden
          </button>
        </div>
      }
      <ng-template #decision let-request>
        @if (request.decidedByName) {
          {{ request.decidedByName }}
        }
        @if (request.decisionReason) {
          <div>{{ request.decisionReason }}</div>
        }
      </ng-template>
      <ng-template #hints let-entry let-day="day" let-first="first">
        @if (entry.voided) {
          <span class="pill lv-mute">ungültig</span>
        }
        @if (entry.source === 'MANUAL') {
          <span class="pill lv-warn">{{ lateLabel(entry) }}</span>
          @if (entry.reason) {
            <div class="text-[13px] text-muted">Grund: {{ entry.reason }}</div>
          }
        }
        @if (entry.pendingCorrection) {
          <span class="pill lv-info">Korrektur beantragt</span>
        }
        @if (first) {
          @if (day.missing) {
            <span class="pill lv-warn">Keine Buchung</span>
          }
          @for (flag of day.flags; track flag.code) {
            <app-rule-messages [messages]="[flag]" [level]="flag.level" />
          }
        }
      </ng-template>
      <ng-template #actions let-entry let-day="day" let-view="view">
        <div class="flex flex-wrap gap-1">
          @if (
            !entry.voided &&
            !entry.pendingCorrection &&
            !(own() && view.closedMonths.includes(day.date.slice(0, 7)))
          ) {
            <button
              class="btn btn-sm"
              type="button"
              [disabled]="busy()"
              [attr.aria-label]="
                correctionLabel() + ' für ' + dayLabel(day.date) + ', ' + entry.startLocal
              "
              (click)="edit(entry, false)"
            >
              {{ correctionLabel() }}
            </button>
            <button
              class="btn btn-sm btn-danger"
              type="button"
              [disabled]="busy()"
              [attr.aria-label]="
                'Buchung ' + dayLabel(day.date) + ', ' + entry.startLocal + ' ungültig markieren'
              "
              (click)="edit(entry, true)"
            >
              Ungültig
            </button>
          }
          @if (own() && entry.pendingCorrection; as pending) {
            <button
              class="btn btn-sm"
              type="button"
              [disabled]="busy()"
              [attr.aria-label]="
                'Antrag für ' + dayLabel(day.date) + ', ' + entry.startLocal + ' zurückziehen'
              "
              (click)="withdraw(pending.id)"
            >
              Antrag zurückziehen
            </button>
          }
          <button
            class="btn btn-sm"
            type="button"
            [attr.data-entry-focus]="entry.id"
            [attr.aria-expanded]="historyId() === entry.id"
            [attr.aria-label]="'Verlauf für ' + dayLabel(day.date) + ', ' + entry.startLocal"
            (click)="historyId.set(historyId() === entry.id ? null : entry.id)"
          >
            Verlauf
          </button>
        </div>
      </ng-template>
      @if (week.hasValue()) {
        @let view = week.value();
        <div class="overflow-x-auto">
          <table class="data-table">
            <caption class="sr-only">
              Zeiten für
              {{
                view.employeeName
              }},
              {{
                view.from | localDate
              }}
              bis
              {{
                view.to | localDate
              }}
            </caption>
            <thead>
              <tr>
                <th>Tag</th>
                <th class="col-narrow">Zeit</th>
                <th class="num col-opt">Kommen</th>
                <th class="num col-opt">Gehen</th>
                <th class="num col-opt">Pause</th>
                <th class="num col-opt">Arbeitszeit</th>
                <th class="num col-opt">Soll</th>
                <th class="num col-opt">Saldo</th>
                <th class="col-opt">Hinweise</th>
                <th class="col-opt">Aktionen</th>
                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (day of view.days; track day.date) {
                @for (entry of day.entries; track entry.id; let first = $first) {
                  <tr
                    [class.bg-accent-soft]="day.date === today"
                    [attr.data-entry-id]="entry.id"
                    (click)="rows.onRowClick(entry.id, $event)"
                  >
                    <td class="whitespace-nowrap">
                      {{ first ? dayLabel(day.date) : '' }}
                      @if (first && day.absence) {
                        <div class="text-[13px] text-muted">
                          {{ absenceText(day.absence) }}
                        </div>
                      }
                    </td>
                    <td
                      class="num col-narrow whitespace-nowrap"
                      [class.line-through]="entry.voided"
                    >
                      <span class="whitespace-nowrap"
                        >{{ entry.startLocal }}–{{ entry.endLocal ?? 'läuft' }}</span
                      >
                      <div class="text-[13px] text-muted">{{ entry.workMinutes | hm }} Std.</div>
                      <!-- Bedeutungstragende Markierungen bleiben in der zugeklappten Zeile sichtbar (Befund 3). -->
                      <div class="flex flex-wrap gap-1">
                        @if (entry.source === 'MANUAL') {
                          <span class="pill lv-warn">Nachtrag</span>
                        }
                        @if (entry.pendingCorrection) {
                          <span class="pill lv-info">Korrektur beantragt</span>
                        }
                        @if (first && day.flags.length) {
                          <span
                            class="pill"
                            [class.lv-crit]="worstLevel(day.flags) === 'crit'"
                            [class.lv-warn]="worstLevel(day.flags) === 'warn'"
                            [class.lv-info]="worstLevel(day.flags) === 'info'"
                            >{{ day.flags.length }}
                            {{ day.flags.length === 1 ? 'Hinweis' : 'Hinweise' }}</span
                          >
                        }
                      </div>
                    </td>
                    <td
                      class="num col-opt"
                      [class.line-through]="entry.voided"
                      [class.opacity-50]="entry.voided"
                    >
                      {{ entry.startLocal }}
                    </td>
                    <td
                      class="num col-opt"
                      [class.line-through]="entry.voided"
                      [class.opacity-50]="entry.voided"
                    >
                      {{ entry.endLocal ?? 'läuft' }}
                      @if (entry.endsNextDay) {
                        <span title="Ende am Folgetag">+1</span>
                      }
                    </td>
                    <td
                      class="num col-opt"
                      [class.line-through]="entry.voided"
                      [class.opacity-50]="entry.voided"
                    >
                      {{ entry.breakMinutes }} Min.
                    </td>
                    <td
                      class="num col-opt"
                      [class.line-through]="entry.voided"
                      [class.opacity-50]="entry.voided"
                    >
                      {{ entry.workMinutes | hm }}
                    </td>
                    <td class="num col-opt">
                      {{ first ? ((view.minijob ? null : day.targetMinutes) | hm) : '' }}
                    </td>
                    <td class="num col-opt">
                      {{ first ? balance(view.minijob ? null : day.balanceMinutes) : '' }}
                    </td>
                    <td class="col-opt">
                      <ng-container
                        [ngTemplateOutlet]="hints"
                        [ngTemplateOutletContext]="{ $implicit: entry, day, first }"
                      />
                    </td>
                    <td class="col-opt">
                      <ng-container
                        [ngTemplateOutlet]="actions"
                        [ngTemplateOutletContext]="{ $implicit: entry, day, view }"
                      />
                    </td>
                    <td class="col-narrow">
                      <app-row-toggle
                        [open]="rows.isOpen(entry.id)"
                        [label]="'Details zu ' + dayLabel(day.date) + ', ' + entry.startLocal"
                        (toggled)="rows.toggle(entry.id)"
                      />
                    </td>
                  </tr>
                  @if (rows.isOpen(entry.id)) {
                    <tr class="row-details">
                      <td colspan="12">
                        <dl class="details">
                          <dt>Pause</dt>
                          <dd>{{ entry.breakMinutes }} Min.</dd>
                          @if (first && !view.minijob) {
                            <dt>Soll</dt>
                            <dd>{{ day.targetMinutes | hm }}</dd>
                            <dt>Saldo</dt>
                            <dd>{{ balance(day.balanceMinutes) }}</dd>
                          }
                        </dl>
                        <div class="mt-2">
                          <ng-container
                            [ngTemplateOutlet]="hints"
                            [ngTemplateOutletContext]="{ $implicit: entry, day, first }"
                          />
                        </div>
                        <div class="mt-2">
                          <ng-container
                            [ngTemplateOutlet]="actions"
                            [ngTemplateOutletContext]="{ $implicit: entry, day, view }"
                          />
                        </div>
                      </td>
                    </tr>
                  }
                  @if (editing()?.entry?.id === entry.id) {
                    <tr>
                      <td colspan="12">
                        <h3 class="my-2 font-semibold">
                          {{
                            editing()?.voiding
                              ? 'Buchung ungültig markieren'
                              : 'Buchung korrigieren'
                          }}
                          · {{ dayLabel(day.date) }}
                        </h3>
                        <app-entry-form
                          data-correction
                          [entry]="entry"
                          [voiding]="editing()?.voiding ?? false"
                          [request]="requestRequired()"
                          [busy]="busy()"
                          (saved)="correct($event)"
                          (cancelled)="editing.set(null)"
                        />
                      </td>
                    </tr>
                  }
                  @if (historyId() === entry.id) {
                    <tr>
                      <td colspan="12"><app-entry-history [entryId]="entry.id" /></td>
                    </tr>
                  }
                } @empty {
                  <tr
                    [class.bg-accent-soft]="day.date === today"
                    (click)="rows.onRowClick(day.date, $event)"
                  >
                    <td class="whitespace-nowrap">{{ dayLabel(day.date) }}</td>
                    <td class="col-narrow text-muted">
                      {{ dayStatus(day) }}
                      @if (day.missing) {
                        <span class="pill lv-warn">Keine Buchung</span>
                      }
                    </td>
                    <td colspan="4" class="col-opt text-muted">
                      {{ dayStatus(day) }}
                    </td>
                    <td class="num col-opt">
                      {{ (view.minijob ? null : day.targetMinutes) | hm }}
                    </td>
                    <td class="num col-opt">
                      {{ balance(view.minijob ? null : day.balanceMinutes) }}
                    </td>
                    <td class="col-opt">
                      @if (day.missing) {
                        <span class="pill lv-warn">Keine Buchung</span>
                      }
                      @for (flag of day.flags; track flag.code) {
                        <app-rule-messages [messages]="[flag]" [level]="flag.level" />
                      }
                    </td>
                    <td class="col-opt"></td>
                    <td class="col-narrow">
                      @if (!view.minijob || day.flags.length) {
                        <app-row-toggle
                          [open]="rows.isOpen(day.date)"
                          [label]="'Details zu ' + dayLabel(day.date)"
                          (toggled)="rows.toggle(day.date)"
                        />
                      }
                    </td>
                  </tr>
                  @if (rows.isOpen(day.date)) {
                    <tr class="row-details">
                      <td colspan="12">
                        @if (!view.minijob) {
                          <dl class="details">
                            <dt>Soll</dt>
                            <dd>{{ day.targetMinutes | hm }}</dd>
                            <dt>Saldo</dt>
                            <dd>{{ balance(day.balanceMinutes) }}</dd>
                          </dl>
                        }
                        @for (flag of day.flags; track flag.code) {
                          <app-rule-messages [messages]="[flag]" [level]="flag.level" />
                        }
                      </td>
                    </tr>
                  }
                }
              }
              <tr class="font-semibold">
                <td>Summe</td>
                <td class="num col-narrow">{{ view.totals.workMinutes | hm }} Std.</td>
                <td colspan="3" class="col-opt"></td>
                <td class="num col-opt">{{ view.totals.workMinutes | hm }}</td>
                <td class="num col-opt">
                  {{ (view.minijob ? null : view.totals.targetMinutes) | hm }}
                </td>
                <td class="num col-opt">
                  {{ balance(view.minijob ? null : view.totals.balanceMinutes) }}
                </td>
                <td colspan="2" class="col-opt"></td>
                <td class="col-narrow"></td>
              </tr>
            </tbody>
          </table>
        </div>
        @if (view.minijob; as mini) {
          <div class="flex flex-col gap-2 text-sm">
            <div class="flex flex-wrap justify-between gap-2">
              <span
                >{{ monthLabel(mini.month) }}:
                <span class="font-mono">{{ mini.workMinutes | hm }}</span> Std.
                @if (equation(mini)) {
                  × <span class="font-mono">{{ mini.hourlyWageCents | euro }}</span> =
                  <b class="font-mono">{{ mini.earningsCents | euro }}</b>
                } @else {
                  · Verdienst <b class="font-mono">{{ mini.earningsCents | euro }}</b> mit dem
                  jeweils geltenden Stundenlohn
                }</span
              ><span class="text-muted">Grenze {{ mini.limitCents | euro }}</span>
            </div>
            <div
              role="meter"
              aria-label="Anteil an der Minijob-Monatsgrenze"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="meterWidth(mini.ratio)"
              [attr.aria-valuetext]="percent(mini.ratio) + ' Prozent der Grenze'"
              class="h-2 overflow-hidden rounded-full bg-surface-2"
            >
              <div
                class="h-full"
                [class.bg-ok]="mini.level === 'ok'"
                [class.bg-warn]="mini.level === 'warn'"
                [class.bg-crit]="mini.level === 'crit'"
                [style.width.%]="meterWidth(mini.ratio)"
              ></div>
            </div>
            <p class="m-0">
              <span
                class="pill"
                [class.lv-ok]="mini.level === 'ok'"
                [class.lv-warn]="mini.level === 'warn'"
                [class.lv-crit]="mini.level === 'crit'"
                >{{ percent(mini.ratio) }} %</span
              >{{
                mini.level === 'crit'
                  ? 'Grenze überschritten. Nur gelegentlich und unvorhersehbar zulässig, sonst endet der Minijob-Status.'
                  : mini.level === 'warn'
                    ? 'Über 90 % der Grenze.'
                    : 'Im Rahmen.'
              }}
            </p>
          </div>
        }
        <p class="m-0 text-sm text-muted">
          Verstöße sperren die Buchung nicht, weil die tatsächliche Zeit dokumentiert sein muss. Sie
          erscheinen hier und unter „Prüfungen“.
        </p>
      } @else if (week.error()) {
        <p class="err" role="alert">
          {{ errorMessage(week.error(), 'Die Woche konnte nicht geladen werden.') }}
        </p>
        <div>
          <button class="btn" type="button" (click)="week.reload()">Woche erneut laden</button>
        </div>
      } @else {
        <p role="status">Woche wird geladen …</p>
      }
    </section>
    @if (error()) {
      <p class="err m-0" role="alert">{{ error() }}</p>
    }
    @if (own() && lateEntries.hasValue()) {
      @let view = lateEntries.value();
      @for (row of view.rows; track row.employeeId) {
        <p class="hint m-0 text-sm" data-late-summary>
          Deine Nachträge in den letzten {{ view.thresholds.weeks }} Wochen: {{ row.late }} von
          {{ row.entries }} Buchungen ({{ row.percent }} %).
          @if (row.flagged) {
            <span class="pill lv-warn">auffällig</span>
            Ab {{ view.thresholds.minCount }} Nachträgen und {{ view.thresholds.minPercent }} % gilt
            das als auffällig.
          }
        </p>
      }
    } @else if (own() && lateEntries.error()) {
      <p class="err m-0" role="alert">Deine Nachtragsquote konnte nicht geladen werden.</p>
    }
    @for (id of [employeeId()]; track id) {
      <section class="card">
        <h2>Zeit nachtragen{{ own() ? '' : ' für ' + employeeName() }}</h2>
        <app-entry-form [busy]="busy()" [disabled]="!week.hasValue()" (saved)="create($event)" />
        @for (flag of savedFlags(); track flag.code) {
          <app-rule-messages [messages]="[flag]" [level]="flag.level" />
        }
        <p class="m-0 text-sm text-muted">
          Buchungen werden nie gelöscht. Die Stempeluhr nimmt immer die aktuelle Uhrzeit. Jede von
          Hand eingetragene Zeit ist ein Nachtrag und wird mit Erfassungszeit, Grund und Person
          markiert.
          @if (isMinijob()) {
            Für Minijobber gilt: spätestens am 7. Kalendertag nach dem Arbeitstag.
          }
        </p>
      </section>
    }
    @if (own() && myRequests().length) {
      <section class="card">
        <h2>Meine Korrekturanträge</h2>
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Art</th>
                <th>Status</th>
                <th class="col-opt">Entscheidung</th>
                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (request of myRequests(); track request.id) {
                <tr (click)="rows.onRowClick(request.id, $event)">
                  <td class="font-mono whitespace-nowrap">{{ dayLabel(request.workDate) }}</td>
                  <td>{{ request.kind === 'VOID' ? 'ungültig' : 'Korrektur' }}</td>
                  <td>
                    <span
                      class="pill"
                      [class.lv-warn]="request.status === 'PENDING'"
                      [class.lv-ok]="request.status === 'APPROVED'"
                      [class.lv-crit]="request.status === 'REJECTED'"
                      [class.lv-mute]="request.status === 'WITHDRAWN'"
                      >{{ statusLabel(request.status) }}</span
                    >
                  </td>
                  <td class="col-opt text-[13px]">
                    <ng-container
                      [ngTemplateOutlet]="decision"
                      [ngTemplateOutletContext]="{ $implicit: request }"
                    />
                  </td>
                  <td class="col-narrow">
                    @if (request.decidedByName || request.decisionReason) {
                      <app-row-toggle
                        [open]="rows.isOpen(request.id)"
                        [label]="'Details zu ' + dayLabel(request.workDate)"
                        (toggled)="rows.toggle(request.id)"
                      />
                    }
                  </td>
                </tr>
                @if (rows.isOpen(request.id)) {
                  <tr class="row-details">
                    <td colspan="5">
                      <dl class="details">
                        <dt>Entscheidung</dt>
                        <dd>
                          <ng-container
                            [ngTemplateOutlet]="decision"
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
      </section>
    }
    @if (own()) {
      <section class="card">
        <h2>Monat abschließen</h2>
        <p class="hint m-0">
          Nach dem Abschluss kannst du für diesen Monat nichts mehr nachtragen oder korrigieren.
          Vorgesetzte und Admin können weiterhin Korrekturen eintragen.
        </p>
        @if (closings.hasValue()) {
          @for (month of previousMonths; track month) {
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span
                >{{ monthLabel(month) }} ·
                @if (closingDate(month); as date) {
                  abgeschlossen am <span class="font-mono">{{ timestamp(date) }}</span>
                } @else {
                  offen
                }
              </span>
              @if (!closingDate(month)) {
                @if (confirmMonth() === month) {
                  <div class="flex flex-wrap items-center gap-2">
                    <span>Willst du {{ monthLabel(month) }} wirklich abschließen?</span
                    ><button
                      class="btn btn-primary"
                      type="button"
                      [disabled]="busy()"
                      (click)="close(month)"
                    >
                      {{ monthLabel(month) }} endgültig abschließen</button
                    ><button
                      class="btn"
                      type="button"
                      [disabled]="busy()"
                      (click)="confirmMonth.set(null)"
                    >
                      Abbrechen
                    </button>
                  </div>
                } @else {
                  <button
                    class="btn"
                    type="button"
                    [disabled]="busy()"
                    (click)="confirmMonth.set(month)"
                  >
                    {{ monthLabel(month) }} abschließen
                  </button>
                }
              }
            </div>
          }
        } @else if (closings.error()) {
          <p class="err" role="alert">Die Monatsabschlüsse konnten nicht geladen werden.</p>
          <div>
            <button class="btn" type="button" (click)="closings.reload()">
              Monatsabschlüsse erneut laden
            </button>
          </div>
        } @else {
          <p role="status">Monatsabschlüsse werden geladen …</p>
        }
      </section>
    }
    @if (store.hasRole('ADMIN') && week.hasValue()) {
      @if (week.value().closedMonths.length) {
        <section class="card">
          <h2>Monat wieder öffnen</h2>
          @for (month of week.value().closedMonths; track month) {
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span>{{ monthLabel(month) }} · abgeschlossen</span
              ><button class="btn" type="button" [disabled]="busy()" (click)="reopen(month)">
                {{ monthLabel(month) }} wieder öffnen
              </button>
            </div>
          }
        </section>
      }
    }
  `,
})
export class TimesPage {
  /** Aufgeklappte Zeilen unter 640 px (Spezifikation Design, Abschnitt 4). */
  protected readonly rows = new ExpandableRows();
  /** Höchste Stufe der Regelmeldungen eines Tages für die kompakte Markierung. */
  protected worstLevel(flags: RuleFlag[]): 'crit' | 'warn' | 'info' {
    return flags.some((f) => f.level === 'crit')
      ? 'crit'
      : flags.some((f) => f.level === 'warn')
        ? 'warn'
        : 'info';
  }
  protected absenceText(absence: NonNullable<WeekView['days'][number]['absence']>): string {
    return (
      this.absenceLabels[absence.type] +
      (absence.sinceLocal ? ` seit ${absence.sinceLocal} Uhr` : '') +
      (absence.half ? ' · halber Tag' : '')
    );
  }
  /** Tag ohne Buchung: Abwesenheit, Feiertag, „frei“ oder „–“. */
  protected dayStatus(day: WeekView['days'][number]): string {
    if (day.absence) return this.absenceText(day.absence);
    return day.holidayName ?? (!day.isWorkday ? 'frei' : '–');
  }
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly store = inject(SessionStore);
  protected readonly today = localDateInBerlin(new Date());
  protected readonly currentMonday = mondayOf(this.today);
  protected readonly monday = signal(this.currentMonday);
  protected readonly sunday = computed(() => addDays(this.monday(), 6));
  protected readonly weekKey = computed(() => isoWeekKey(this.monday()));
  protected readonly employeeId = linkedSignal(() => this.store.session()?.id ?? '');
  protected readonly exportMonth = linkedSignal(() => this.monday().slice(0, 7));
  protected readonly exportMonthValid = computed(() =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(this.exportMonth()),
  );
  protected readonly exportPdfUrl = computed(() =>
    this.api.exportTimeUrl(this.exportMonth(), 'pdf', this.own() ? undefined : this.employeeId()),
  );
  protected readonly exportCsvUrl = computed(() =>
    this.api.exportTimeUrl(this.exportMonth(), 'csv', this.own() ? undefined : this.employeeId()),
  );
  protected readonly own = computed(() => this.employeeId() === this.store.session()?.id);
  protected readonly lateEntries = resource({
    params: () => this.own() || undefined,
    loader: () => this.api.lateEntries(),
  });
  protected readonly canChoose = computed(() => this.store.hasRole('ADMIN', 'LEAD'));
  protected readonly requestRequired = computed(() => this.own() && !this.store.hasRole('ADMIN'));
  protected readonly correctionLabel = computed(() =>
    this.requestRequired() ? 'Korrektur beantragen' : 'Korrigieren',
  );
  protected readonly people = resource({
    params: () => this.canChoose() || undefined,
    loader: () => this.api.employees(),
  });
  protected readonly team = computed(() =>
    this.people.hasValue()
      ? this.people.value().filter((p) => p.id !== this.store.session()?.id)
      : [],
  );
  protected readonly week = resource({
    params: () =>
      this.employeeId()
        ? { week: this.weekKey(), id: this.own() ? undefined : this.employeeId() }
        : undefined,
    loader: ({ params }) => this.api.week(params.week, params.id),
  });
  protected readonly employeeName = computed(() =>
    this.week.hasValue()
      ? this.week.value().employeeName
      : (this.team().find((p) => p.id === this.employeeId())?.name ?? '…'),
  );
  protected readonly isMinijob = computed(
    () => this.week.hasValue() && !!this.week.value().minijob,
  );
  /** Eigene Korrekturanträge mit Entscheidung und Ablehnungsgrund (Codex-Review Web Phase 2, Befund 2). */
  protected readonly requests = resource({
    params: () => this.own() || undefined,
    loader: () => this.api.corrections(),
  });
  protected readonly myRequests = computed(() =>
    this.requests.hasValue()
      ? this.requests
          .value()
          .filter((r) => r.employeeId === this.store.session()?.id)
          .slice(0, 10)
      : [],
  );
  protected statusLabel(status: string): string {
    return (
      {
        PENDING: 'offen',
        APPROVED: 'freigegeben',
        REJECTED: 'abgelehnt',
        WITHDRAWN: 'zurückgezogen',
      }[status] ?? status
    );
  }
  protected readonly closings = resource({
    params: () => this.own() || undefined,
    loader: () => this.api.monthClosings(),
  });
  protected readonly previousMonths = Array.from({ length: 3 }, (_, i) => {
    const date = new Date(`${this.today.slice(0, 7)}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - i - 1);
    return date.toISOString().slice(0, 7);
  });
  protected readonly editing = linkedSignal<{ entry: TimeEntryView; voiding: boolean } | null>(
    () => {
      this.employeeId();
      this.weekKey();
      return null;
    },
  );
  protected readonly historyId = linkedSignal<string | null>(() => {
    this.employeeId();
    this.weekKey();
    return null;
  });
  protected readonly confirmMonth = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = linkedSignal<string | null>(() => {
    this.employeeId();
    this.weekKey();
    return null;
  });
  protected readonly savedFlags = linkedSignal<RuleFlag[]>(() => {
    this.employeeId();
    return [];
  });
  protected readonly absenceLabels = DAY_ABSENCE_LABELS;
  protected readonly equation = minijobEquationHolds;
  protected readonly dayLabel = dayLabel;
  protected readonly lateLabel = lateLabel;
  protected readonly monthLabel = monthLabel;
  protected readonly timestamp = berlinTimestamp;
  protected readonly balance = signedMinutes;
  protected value(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
  protected percent(ratio: number): number {
    return Math.round(ratio * 100);
  }
  protected meterWidth(ratio: number): number {
    return Math.max(0, Math.min(100, ratio * 100));
  }
  protected moveWeek(days: number): void {
    this.monday.update((day) => addDays(day, days));
  }
  protected edit(entry: TimeEntryView, voiding: boolean): void {
    this.error.set(null);
    this.editing.set({ entry, voiding });
  }
  protected errorMessage(error: unknown, fallback: string): string {
    return error instanceof ApiError
      ? [error.message, ...error.errors.map((e) => e.text)].join(' ')
      : fallback;
  }
  protected closingDate(month: string): string | null {
    return this.closings.hasValue()
      ? (this.closings.value().find((c) => c.month === month && !c.reopenedAt)?.confirmedAt ?? null)
      : null;
  }
  protected async create(input: ManualEntryInput): Promise<void> {
    await this.run(async () => {
      const result = await this.api.createEntry({
        ...input,
        ...(!this.own() ? { employeeId: this.employeeId() } : {}),
      });
      this.savedFlags.set(result.flags.filter((flag) => flag.level !== 'info'));
      this.toast.show(
        `Nachtrag für ${dayLabel(input.date)} gespeichert und als Nachtrag markiert.`,
      );
      this.week.reload();
      if (this.own()) this.lateEntries.reload();
    });
  }
  protected async correct(input: ManualEntryInput): Promise<void> {
    const edit = this.editing();
    if (!edit) return;
    await this.run(async () => {
      const { start, end, breaks, reason } = input;
      const result = edit.voiding
        ? await this.api.voidEntry(edit.entry.id, reason)
        : await this.api.correctEntry(edit.entry.id, { start, end, breaks, reason });
      this.toast.show(result.applied ? 'Korrektur gespeichert.' : 'Korrektur beantragt.');
      this.editing.set(null);
      this.historyId.set(null);
      this.week.reload();
      if (this.own()) this.lateEntries.reload();
      this.requests.reload();
      this.focusEntry(edit.entry.id);
    });
  }
  protected async withdraw(id: string): Promise<void> {
    await this.run(async () => {
      await this.api.withdrawCorrection(id);
      this.toast.show('Korrekturantrag zurückgezogen.');
      this.week.reload();
      if (this.own()) this.lateEntries.reload();
      this.requests.reload();
    });
  }
  protected async close(month: string): Promise<void> {
    if (this.confirmMonth() !== month) return;
    await this.run(async () => {
      await this.api.closeMonth(month);
      this.confirmMonth.set(null);
      this.closings.reload();
      this.week.reload();
      this.toast.show(`${monthLabel(month)} abgeschlossen.`);
    });
  }
  protected async reopen(month: string): Promise<void> {
    await this.run(async () => {
      await this.api.reopenMonth(this.employeeId(), month);
      this.week.reload();
      this.toast.show(`${monthLabel(month)} wieder geöffnet.`);
    });
  }
  /** Nach dem Neuladen den Verlauf-Button der bearbeiteten Buchung fokussieren (Befund 7). */
  private focusEntry(entryId: string): void {
    const ref = effect(
      () => {
        if (this.week.isLoading() || !this.week.hasValue()) return;
        ref.destroy();
        afterNextRender(
          () =>
            // Unter 640 px liegt der Knopf in der Detailzeile; den sichtbaren wählen (Befund 4).
            firstVisible([
              ...this.host.nativeElement.querySelectorAll<HTMLElement>(
                `[data-entry-focus="${entryId}"], tr[data-entry-id="${entryId}"] app-row-toggle button`,
              ),
            ])?.focus(),
          { injector: this.injector },
        );
      },
      { injector: this.injector },
    );
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Die Änderung konnte nicht gespeichert werden.'));
    } finally {
      this.busy.set(false);
    }
  }
}
