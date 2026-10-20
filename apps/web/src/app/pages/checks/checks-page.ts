import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import {
  minijobEquationHolds,
  addDays,
  formatEuro,
  formatHalfDays,
  formatHoursMinutes,
  formatLocalDate,
  localDateInBerlin,
  type ForfeitureSuggestion,
  type RetentionSettingsView,
  type ReminderSettingsView,
} from '@as/shared';
import { ApiError, ApiService } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { SickList } from '../sick/sick-list';
import { ExpandableRows, RowToggle, PageHead, RuleMessages } from '../../shared-ui';

@Component({
  selector: 'app-checks-page',
  host: { class: 'flex min-w-0 flex-col gap-5' },
  imports: [SickList, RowToggle, NgTemplateOutlet, PageHead, RuleMessages],
  template: `
    <ng-template #noticeActions let-row let-year="year">
      <button
        class="btn btn-sm"
        type="button"
        [disabled]="busy() || checks.isLoading()"
        [attr.aria-label]="'Hinweis senden an ' + row.employeeName"
        (click)="send(year, row.employeeId)"
      >
        Hinweis senden
      </button>
    </ng-template>
    <ng-template #noticeText let-row>
      @if (row.latest; as latest) {
        <details>
          <summary [attr.aria-label]="'Text anzeigen für ' + row.employeeName">
            Text anzeigen
          </summary>
          <p class="whitespace-pre-wrap">{{ latest.text }}</p>
        </details>
      }
    </ng-template>
    <app-page-head
      heading="Prüfungen"
      lead="Alles, was gegen eine Regel verstößt oder eine Frist hat."
    />
    <section class="card">
      <form class="flex flex-wrap items-end gap-3" (submit)="applyRange($event)">
        <label class="field" for="checks-from"
          >Von
          <input
            id="checks-from"
            type="date"
            [value]="from()"
            [max]="to()"
            [disabled]="busy()"
            (input)="from.set(value($event))"
          />
        </label>
        <label class="field" for="checks-to"
          >Bis
          <input
            id="checks-to"
            type="date"
            [value]="to()"
            [min]="from()"
            [disabled]="busy()"
            (input)="to.set(value($event))"
          />
        </label>
        <button class="btn" [disabled]="busy()">Zeitraum anzeigen</button>
        <button class="btn" type="button" [disabled]="busy()" (click)="quickRange(0)">
          6 Wochen
        </button>
        <button class="btn" type="button" [disabled]="busy()" (click)="quickRange(3)">
          3 Monate
        </button>
        <button class="btn" type="button" [disabled]="busy()" (click)="quickRange(12)">
          12 Monate
        </button>
      </form>
      @if (checks.hasValue()) {
        <p class="m-0 text-muted">
          Zeitraum: {{ date(checks.value().from) }} – {{ date(checks.value().to) }}
        </p>
      }
    </section>
    <div id="checks-status" tabindex="-1" aria-live="polite">
      @if (error()) {
        <p class="err m-0" role="alert">{{ error() }}</p>
      }
      @if (status()) {
        <p class="m-0">{{ status() }}</p>
      }
    </div>
    @if (confirmation(); as confirm) {
      <section
        class="card"
        role="group"
        aria-labelledby="checks-confirm-title"
        aria-describedby="checks-confirm-text"
      >
        <h2 id="checks-confirm-title">
          {{ confirm.kind === 'send' ? 'Hinweise versenden?' : 'Verfall buchen?' }}
        </h2>
        <p id="checks-confirm-text">
          {{
            confirm.kind === 'send'
              ? 'Allen Mitarbeitern ohne Hinweis für ' +
                confirm.year +
                ' einen Urlaubshinweis senden?'
              : days(confirm.row.halfDays) +
                ' Tage für ' +
                confirm.row.employeeName +
                ' aus ' +
                confirm.row.year +
                ' zum ' +
                date(confirm.row.forfeitsOn) +
                ' als Verfall buchen?'
          }}
        </p>
        <div class="flex gap-2">
          <button
            class="btn btn-primary"
            type="button"
            data-confirm
            aria-describedby="checks-confirm-text"
            [disabled]="busy()"
            (click)="confirmAction()"
          >
            {{ confirm.kind === 'send' ? 'Versand bestätigen' : 'Verfall bestätigen' }}
          </button>
          <button class="btn" type="button" [disabled]="busy()" (click)="cancelConfirmation()">
            Abbrechen
          </button>
        </div>
      </section>
    }
    @if (checks.hasValue()) {
      @let view = checks.value();
      <div class="tiles">
        <div class="tile">
          <small>Verstöße ArbZG / MiLoG</small
          ><b [class.text-crit]="criticalCount() > 0">{{ criticalCount() }}</b>
        </div>
        <div class="tile">
          <small>Hinweise</small><b>{{ warningCount() }}</b>
        </div>
        <div class="tile">
          <small>Minijob über 90 %</small><b>{{ minijobCount() }}</b>
        </div>
        <div class="tile">
          <small>Urlaubshinweis fehlt</small
          ><b [class.text-crit]="missingCount() > 0">{{ missingCount() }}</b>
        </div>
      </div>
      <section class="card" id="findings">
        <h2>Arbeitszeit</h2>
        <label class="field" for="finding-person"
          >Mitarbeiter
          <select id="finding-person" [value]="person()" (change)="person.set(value($event))">
            <option value="">Alle Mitarbeiter</option>
            @for (p of people(); track p.id) {
              <option [value]="p.id">{{ p.name }}</option>
            }
          </select>
        </label>
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th class="col-narrow">Datum / Mitarbeiter</th>
                <th class="col-opt">Datum</th>
                <th class="col-opt">Mitarbeiter</th>
                <th>Feststellung</th>

                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (finding of findings(); track $index) {
                <tr>
                  <td class="col-narrow">
                    {{ date(finding.date) }}
                    <div>{{ finding.employeeName }}</div>
                  </td>
                  <td class="col-opt whitespace-nowrap">{{ date(finding.date) }}</td>
                  <td class="col-opt">{{ finding.employeeName }}</td>
                  <td>
                    <app-rule-messages
                      [messages]="[
                        {
                          code: finding.code,
                          text: finding.text,
                          paragraph: finding.paragraph ?? '',
                          level: finding.level,
                        },
                      ]"
                    />
                  </td>

                  <td class="col-narrow"></td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5">Keine Feststellungen.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
      <section class="card" id="compensation">
        <h2>Ausgleich nach § 3 ArbZG</h2>
        <p class="m-0 text-sm text-muted">
          Bis zu 10 Std. am Tag sind erlaubt, wenn der Durchschnitt über 24 Wochen 8 Std. je Werktag
          nicht übersteigt. Werktage sind Montag bis Samstag ohne Feiertage; Urlaubs- und andere
          Abwesenheitstage zählen nicht mit.
        </p>
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th class="col-opt">Zeitraum</th>
                <th class="col-opt">Werktage</th>
                <th class="col-opt">Ø je Werktag (h:mm)</th>
                <th>Status</th>
                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (row of view.compensation; track row.employeeId) {
                <tr (click)="rows.onRowClick('compensation:' + row.employeeId, $event)">
                  <td>{{ row.employeeName }}</td>
                  <td class="col-opt">{{ date(row.from) }} – {{ date(row.to) }}</td>
                  <td class="col-opt">{{ row.workdays }}</td>
                  <td class="col-opt font-mono">
                    {{ row.averageMinutes === null ? '–' : hours(row.averageMinutes) }}
                  </td>
                  <td>
                    @if (row.exceeds) {
                      <span class="pill lv-warn">über 8 Std.</span>
                    }
                  </td>
                  <td class="col-narrow">
                    <app-row-toggle
                      [open]="rows.isOpen('compensation:' + row.employeeId)"
                      [label]="'Details zu ' + row.employeeName"
                      (toggled)="rows.toggle('compensation:' + row.employeeId)"
                    />
                  </td>
                </tr>
                @if (rows.isOpen('compensation:' + row.employeeId)) {
                  <tr class="row-details">
                    <td colspan="6">
                      <dl class="details">
                        <dt>Zeitraum</dt>
                        <dd>{{ date(row.from) }} – {{ date(row.to) }}</dd>
                        <dt>Werktage</dt>
                        <dd>{{ row.workdays }}</dd>
                        <dt>Ø je Werktag (h:mm)</dt>
                        <dd>
                          {{ row.averageMinutes === null ? '–' : hours(row.averageMinutes) }}
                        </dd>
                      </dl>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td colspan="6">Keine Ausgleichsdaten.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
      @if (view.minijob.length) {
        <section class="card">
          <h2>Minijob-Grenze</h2>
          @for (row of view.minijob; track row.employeeId) {
            <div class="flex flex-col gap-3">
              <h3 class="font-semibold">
                {{ row.employeeName }} <span class="text-sm text-muted">{{ row.jobTitle }}</span>
              </h3>
              @for (mini of row.months; track mini.month) {
                <div class="flex flex-col gap-2 text-sm">
                  <div class="flex flex-wrap justify-between gap-2">
                    <span
                      >{{ monthLabel(mini.month) }}:
                      <span class="font-mono">{{ hours(mini.workMinutes) }}</span> Std.
                      @if (equation(mini)) {
                        × {{ euro(mini.hourlyWageCents) }} = <b>{{ euro(mini.earningsCents) }}</b>
                      } @else {
                        · Verdienst <b>{{ euro(mini.earningsCents) }}</b> mit dem jeweils geltenden
                        Stundenlohn
                      }</span
                    ><span class="text-muted">Grenze {{ euro(mini.limitCents) }}</span>
                  </div>
                  <div
                    role="meter"
                    [attr.aria-label]="
                      'Minijob-Grenze ' + row.employeeName + ', ' + monthLabel(mini.month)
                    "
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
                    <span class="pill" [class]="'lv-' + mini.level"
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
            </div>
          }
        </section>
      }
      <section class="card">
        <h2 id="notice-heading" tabindex="-1">Urlaubshinweis {{ view.notices.year }}</h2>
        <p class="m-0 text-sm text-muted">
          Resturlaub verfällt nur, wenn der Arbeitgeber jeden Mitarbeiter konkret über seine
          Resttage und den Verfall informiert hat (BAG 9 AZR 423/16). Der Versand wird mit Datum
          protokolliert.
        </p>
        @if (view.notices.reminder && missingCount() && !view.notices.yearEndDeadlinePassed) {
          <p class="hint m-0">
            Hinweise bis 30.09.{{ view.notices.year }} versenden: Nur dann kann Resturlaub zum
            31.12.{{ view.notices.year }} verfallen. Ohne rechtzeitigen Hinweis verfällt kein
            Urlaub.
          </p>
        }
        @if (view.notices.reminder && missingCount() && view.notices.yearEndDeadlinePassed) {
          <p class="hint m-0">
            Die Frist für den Verfall zum 31.12.{{ view.notices.year }} (Hinweis bis 30.09.) ist
            verstrichen; ohne rechtzeitigen Hinweis verfällt dieser Resturlaub nicht. Ein jetzt
            versendeter Hinweis wirkt noch für übertragene Tage zum 31.03.{{
              view.notices.year + 1
            }}.
          </p>
        }
        @if (isAdmin() && missingCount()) {
          <div>
            <button
              id="send-all"
              class="btn btn-primary"
              type="button"
              [disabled]="busy() || checks.isLoading()"
              (click)="askSendAll(view.notices.year)"
            >
              Allen ohne Hinweis senden
            </button>
          </div>
        }
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th>Rest (Tage)</th>
                <th>Status</th>
                <th class="col-opt">Wortlaut</th>
                @if (isAdmin()) {
                  <th class="col-opt">Aktionen</th>
                }
                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (row of view.notices.rows; track row.employeeId) {
                <tr
                  (click)="
                    (row.latest || isAdmin()) && rows.onRowClick('notice:' + row.employeeId, $event)
                  "
                >
                  <td>{{ row.employeeName }}</td>
                  <td>{{ days(row.rest) }}</td>
                  <td>
                    @if (row.latest; as latest) {
                      <div>versendet am {{ timestamp(latest.sentAt) }}</div>
                      @if (latest.readAt) {
                        <div>gelesen am {{ timestamp(latest.readAt) }}</div>
                      }
                      @if (!latest.timelyForYearEnd) {
                        <span class="pill lv-warn">verspätet</span>
                      }
                      @if (!latest.emailSentAt) {
                        <span
                          class="pill lv-warn"
                          title="Der Hinweis steht in der Anwendung bereit."
                          >E-Mail nicht zugestellt</span
                        >
                      }
                    } @else {
                      <span class="pill lv-crit">fehlt</span>
                    }
                  </td>
                  <td class="col-opt">
                    <ng-container
                      [ngTemplateOutlet]="noticeText"
                      [ngTemplateOutletContext]="{ $implicit: row }"
                    />
                  </td>
                  @if (isAdmin()) {
                    <td class="col-opt">
                      <ng-container
                        [ngTemplateOutlet]="noticeActions"
                        [ngTemplateOutletContext]="{ $implicit: row, year: view.notices.year }"
                      />
                    </td>
                  }
                  <td class="col-narrow">
                    @if (row.latest || isAdmin()) {
                      <app-row-toggle
                        [open]="rows.isOpen('notice:' + row.employeeId)"
                        [label]="'Details zu ' + row.employeeName"
                        (toggled)="rows.toggle('notice:' + row.employeeId)"
                      />
                    }
                  </td>
                </tr>
                @if ((row.latest || isAdmin()) && rows.isOpen('notice:' + row.employeeId)) {
                  <tr class="row-details">
                    <td [attr.colspan]="isAdmin() ? 6 : 5">
                      <dl class="details">
                        @if (row.latest) {
                          <dt>Wortlaut</dt>
                          <dd>
                            <ng-container
                              [ngTemplateOutlet]="noticeText"
                              [ngTemplateOutletContext]="{ $implicit: row }"
                            />
                          </dd>
                        }
                        @if (isAdmin()) {
                          <dt>Aktionen</dt>
                          <dd>
                            <ng-container
                              [ngTemplateOutlet]="noticeActions"
                              [ngTemplateOutletContext]="{
                                $implicit: row,
                                year: view.notices.year,
                              }"
                            />
                          </dd>
                        }
                      </dl>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td [attr.colspan]="isAdmin() ? 6 : 5">Keine Urlaubshinweise erforderlich.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
      @if (isAdmin() && view.forfeitures.length) {
        <section class="card" id="forfeitures">
          <h2>Verfall</h2>
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Mitarbeiter</th>
                  <th class="col-opt">Jahr</th>
                  <th class="col-opt">Verfallstag</th>
                  <th>Tage</th>
                  <th>Status</th>
                  <th class="col-narrow"><span class="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                @for (
                  row of view.forfeitures;
                  track row.employeeId + row.year + row.kind;
                  let i = $index
                ) {
                  <tr
                    (click)="
                      rows.onRowClick(
                        'forfeiture:' + row.employeeId + ':' + row.year + ':' + row.kind,
                        $event
                      )
                    "
                  >
                    <td>{{ row.employeeName }}</td>
                    <td class="col-opt">{{ row.year }}</td>
                    <td class="col-opt">{{ date(row.forfeitsOn) }}</td>
                    <td>{{ days(row.halfDays) }}</td>
                    <td>
                      @if (row.noticeTimely) {
                        <button
                          class="btn btn-sm"
                          type="button"
                          [id]="'forfeit-' + i"
                          [disabled]="busy() || checks.isLoading()"
                          [attr.aria-label]="
                            'Verfall buchen für ' +
                            row.employeeName +
                            ', ' +
                            row.year +
                            ', ' +
                            date(row.forfeitsOn)
                          "
                          (click)="askForfeiture(row, i)"
                        >
                          Verfall buchen
                        </button>
                      } @else {
                        <span class="pill lv-warn">kein rechtzeitiger Hinweis – kein Verfall</span>
                      }
                    </td>
                    <td class="col-narrow">
                      <app-row-toggle
                        [open]="
                          rows.isOpen(
                            'forfeiture:' + row.employeeId + ':' + row.year + ':' + row.kind
                          )
                        "
                        [label]="
                          'Details zu ' +
                          row.employeeName +
                          ', ' +
                          row.year +
                          ', ' +
                          date(row.forfeitsOn)
                        "
                        (toggled)="
                          rows.toggle(
                            'forfeiture:' + row.employeeId + ':' + row.year + ':' + row.kind
                          )
                        "
                      />
                    </td>
                  </tr>
                  @if (
                    rows.isOpen('forfeiture:' + row.employeeId + ':' + row.year + ':' + row.kind)
                  ) {
                    <tr class="row-details">
                      <td colspan="6">
                        <dl class="details">
                          <dt>Jahr</dt>
                          <dd>{{ row.year }}</dd>
                          <dt>Verfallstag</dt>
                          <dd>{{ date(row.forfeitsOn) }}</dd>
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
    } @else if (checks.error()) {
      <section class="card">
        <p class="err" role="alert">
          {{ message(checks.error(), 'Die Prüfungen konnten nicht geladen werden.') }}
        </p>
        <div>
          <button class="btn" type="button" (click)="checks.reload()">
            Prüfungen erneut laden
          </button>
        </div>
      </section>
    } @else {
      <p role="status">Prüfungen werden geladen …</p>
    }
    <section class="card" id="late-entries">
      <h2>Nachträge</h2>
      @if (lateEntries.hasValue()) {
        @let view = lateEntries.value();
        <p class="m-0 text-sm text-muted">
          Die Stempeluhr nimmt immer die aktuelle Uhrzeit. Wer Zeiten von Hand einträgt, etwa um 10
          Uhr einen Beginn um 8 Uhr, erzeugt einen markierten Nachtrag. Einzelne Nachträge sind
          normal. Auffällig ist, wenn mindestens {{ view.thresholds.minCount }} Buchungen und
          {{ view.thresholds.minPercent }} % nachgetragen sind.
        </p>
        <!-- Eigener Zeitraum der Auswertung; ohne Auswahl gilt die Einstellung in Wochen (Befund 5). -->
        <p class="m-0 text-muted" data-late-range>
          Zeitraum: {{ date(view.from) }} – {{ date(view.to) }}
          @if (!range().from && !range().to) {
            (Standard der Nachtrags-Auswertung: {{ view.thresholds.weeks }} Wochen)
          }
        </p>
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th class="col-opt">Buchungen</th>
                <th class="col-opt">Nachgetragen</th>
                <th>Anteil (%)</th>
                <th class="col-opt">Ø später erfasst</th>
                <th>Status</th>
                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (row of lateRows(); track row.employeeId) {
                <tr (click)="rows.onRowClick('late:' + row.employeeId, $event)">
                  <td>{{ row.employeeName }}</td>
                  <td class="col-opt">{{ row.entries }}</td>
                  <td class="col-opt">{{ row.late }}</td>
                  <td>{{ row.percent }} %</td>
                  <td class="col-opt">
                    {{
                      row.averageDelayMinutes === null
                        ? 'an späterem Tag'
                        : hours(row.averageDelayMinutes) + ' Std.'
                    }}
                  </td>
                  <td>
                    @if (row.flagged) {
                      <span class="pill lv-warn">auffällig</span>
                    }
                  </td>
                  <td class="col-narrow">
                    <app-row-toggle
                      [open]="rows.isOpen('late:' + row.employeeId)"
                      [label]="'Details zu ' + row.employeeName"
                      (toggled)="rows.toggle('late:' + row.employeeId)"
                    />
                  </td>
                </tr>
                @if (rows.isOpen('late:' + row.employeeId)) {
                  <tr class="row-details">
                    <td colspan="7">
                      <dl class="details">
                        <dt>Buchungen</dt>
                        <dd>{{ row.entries }}</dd>
                        <dt>Nachgetragen</dt>
                        <dd>{{ row.late }}</dd>
                        <dt>Ø später erfasst</dt>
                        <dd>
                          {{
                            row.averageDelayMinutes === null
                              ? 'an späterem Tag'
                              : hours(row.averageDelayMinutes) + ' Std.'
                          }}
                        </dd>
                      </dl>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td colspan="7">Keine Nachträge im Zeitraum.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (lateEntries.error()) {
        <p class="err m-0" role="alert">Die Nachträge konnten nicht geladen werden.</p>
        <div>
          <button class="btn" type="button" (click)="lateEntries.reload()">
            Nachträge erneut laden
          </button>
        </div>
      } @else {
        <p class="m-0" role="status">Nachträge werden geladen …</p>
      }
    </section>
    @if (isAdmin()) {
      <section class="card">
        <h2 id="reminder-heading" tabindex="-1">Erinnerungen und Auswertung</h2>
        @if (reminderSettings.hasValue()) {
          <form (submit)="saveReminders($event)">
            <fieldset class="fields m-0 min-w-0 border-0 p-0" [disabled]="busy()">
              <label class="field" for="reminder-defaultStart"
                >Standardzeit
                <input
                  id="reminder-defaultStart"
                  type="time"
                  required
                  [value]="reminderDraft().defaultStart"
                  (input)="changeReminderStart($event)"
                />
              </label>
              @for (field of reminderFields; track field.key) {
                <label class="field" [for]="'reminder-' + field.key"
                  >{{ field.label }}
                  <input
                    [id]="'reminder-' + field.key"
                    type="number"
                    min="1"
                    [max]="field.max"
                    step="1"
                    required
                    [value]="reminderDraft()[field.key]"
                    (input)="changeReminderNumber(field.key, $event)"
                  />
                </label>
              }
              <div>
                <button class="btn btn-primary" [disabled]="busy() || !remindersValid()">
                  Erinnerungen speichern
                </button>
              </div>
            </fieldset>
          </form>
        } @else if (reminderSettings.error()) {
          <p class="err m-0" role="alert">
            Die Erinnerungseinstellungen konnten nicht geladen werden.
          </p>
          <div>
            <button class="btn" type="button" (click)="reminderSettings.reload()">
              Erinnerungseinstellungen erneut laden
            </button>
          </div>
        } @else {
          <p class="m-0" role="status">Erinnerungseinstellungen werden geladen …</p>
        }
      </section>
      <section class="card">
        <h2 id="retention-heading" tabindex="-1">Aufbewahrung und Löschung</h2>
        <p class="hint m-0">
          Fristen laufen ab Ende des Kalenderjahres. Vor dem Einschalten mit dem Steuerberater
          abstimmen. Ausgeschiedene werden nach Ablauf aller Fristen anonymisiert.
        </p>
        @if (retention.hasValue()) {
          <form (submit)="saveRetention($event)">
            <fieldset class="fields m-0 min-w-0 border-0 p-0" [disabled]="busy()">
              <label class="col-span-full" for="retention-enabled"
                ><input
                  id="retention-enabled"
                  type="checkbox"
                  role="switch"
                  [checked]="retentionDraft().enabled"
                  (change)="changeEnabled($event)"
                />
                Löschjob eingeschaltet</label
              >
              @for (field of retentionFields; track field.key) {
                <label class="field" [for]="'retention-' + field.key"
                  >{{ field.label }} (Jahre)<input
                    [id]="'retention-' + field.key"
                    type="number"
                    min="2"
                    max="30"
                    step="1"
                    required
                    [value]="retentionDraft()[field.key]"
                    (input)="changeYears(field.key, $event)"
                /></label>
              }
              <div>
                <button class="btn btn-primary" [disabled]="busy() || !retentionValid()">
                  Aufbewahrung speichern
                </button>
              </div>
            </fieldset>
          </form>
        } @else if (retention.error()) {
          <p class="err" role="alert">
            {{ message(retention.error(), 'Die Aufbewahrung konnte nicht geladen werden.') }}
          </p>
          <div>
            <button class="btn" type="button" (click)="retention.reload()">
              Aufbewahrung erneut laden
            </button>
          </div>
        } @else {
          <p role="status">Aufbewahrung wird geladen …</p>
        }
      </section>
      <section class="card">
        <h2>Monatsübersicht exportieren</h2>
        <label class="field" for="checks-export-month"
          >Monat<input
            id="checks-export-month"
            type="month"
            [value]="exportMonth()"
            (input)="exportMonth.set(value($event))"
        /></label>
        @if (validMonth()) {
          <div>
            <a class="btn" [href]="exportMonthUrl()" download>Monatsübersicht exportieren (CSV)</a>
          </div>
        }
      </section>
    }
    <section class="card" data-sick-checks aria-labelledby="sick-checks-heading">
      <h2 id="sick-checks-heading">Krankmeldungen</h2>
      @if (sickChecks.hasValue()) {
        @let sick = sickChecks.value();
        <h3>AU fehlt</h3>
        <app-sick-list
          [items]="sick.certificateMissing"
          [showPerson]="true"
          [checks]="true"
          (saved)="sickChecks.reload()"
        />
        <h3>Krank im Urlaub ohne AU</h3>
        <app-sick-list
          [items]="sick.vacationWithoutCertificate"
          [showPerson]="true"
          [checks]="true"
          (saved)="sickChecks.reload()"
        />
        @if (isAdmin()) {
          <h3>Überstundenabbau während Krankheit</h3>
          <p class="text-sm text-muted">
            Krankheit mit AU an Tagen mit genehmigtem Überstundenabbau. Die App bucht hier nichts
            zurück; prüfe, ob die Stunden dem Konto wieder gutgeschrieben werden sollen.
          </p>
          <app-sick-list
            [items]="sick.overtimeOffDuringSickness ?? []"
            [showPerson]="true"
            [checks]="true"
            (saved)="sickChecks.reload()"
          />
          <h3>Sechs Wochen erreicht</h3>
          <p>
            Entgeltfortzahlung endet nach sechs Wochen (§ 3 EFZG). Ob es dieselbe Krankheit ist,
            klärst du mit der Krankenkasse bzw. dem Lohnbüro.
          </p>
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th class="col-opt">Seit</th>
                  <th>Erreicht am</th>
                  <th class="col-narrow"><span class="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                @for (row of sick.sixWeeks ?? []; track row.employeeId + ':' + row.from) {
                  @let key = 'six-weeks:' + row.employeeId + ':' + row.from;
                  <tr (click)="rows.onRowClick(key, $event)">
                    <td>{{ row.employeeName }}</td>
                    <td class="col-opt">{{ date(row.from) }}</td>
                    <td>{{ date(row.reachedOn) }}</td>
                    <td class="col-narrow">
                      <app-row-toggle
                        [open]="rows.isOpen(key)"
                        [label]="
                          'Sechs Wochen: Details zu ' +
                          row.employeeName +
                          ', seit ' +
                          date(row.from)
                        "
                        (toggled)="rows.toggle(key)"
                      />
                    </td>
                  </tr>
                  @if (rows.isOpen(key)) {
                    <tr class="row-details">
                      <td colspan="4">
                        <dl class="details">
                          <dt>Seit</dt>
                          <dd>{{ date(row.from) }}</dd>
                        </dl>
                      </td>
                    </tr>
                  }
                } @empty {
                  <tr>
                    <td colspan="4">Keine Meldungen.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <h3>Krankheitstage der letzten 12 Monate</h3>
          <p class="text-sm text-muted">Gezählt werden Kalendertage.</p>
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>krank</th>
                  <th class="col-opt">Kind krank</th>
                  <th class="col-narrow"><span class="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                @for (row of sick.lastYear ?? []; track row.employeeId) {
                  @let key = 'sick-year:' + row.employeeId;
                  <tr (click)="rows.onRowClick(key, $event)">
                    <td>{{ row.employeeName }}</td>
                    <td>{{ row.sickDays }}</td>
                    <td class="col-opt">{{ row.childSickDays }}</td>
                    <td class="col-narrow">
                      <app-row-toggle
                        [open]="rows.isOpen(key)"
                        [label]="'Krankheitstage: Details zu ' + row.employeeName"
                        (toggled)="rows.toggle(key)"
                      />
                    </td>
                  </tr>
                  @if (rows.isOpen(key)) {
                    <tr class="row-details">
                      <td colspan="4">
                        <dl class="details">
                          <dt>Kind krank</dt>
                          <dd>{{ row.childSickDays }}</dd>
                        </dl>
                      </td>
                    </tr>
                  }
                } @empty {
                  <tr>
                    <td colspan="4">Keine Krankheitstage.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      } @else if (sickChecks.error()) {
        <p class="err" role="alert">
          {{ message(sickChecks.error(), 'Die Krankmeldungen konnten nicht geladen werden.') }}
        </p>
        <button type="button" class="btn" (click)="sickChecks.reload()">
          Krankmeldungen erneut laden
        </button>
      } @else {
        <p role="status">Krankmeldungen werden geladen …</p>
      }
    </section>
  `,
})
export class ChecksPage {
  protected readonly rows = new ExpandableRows();
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly isAdmin = computed(() => this.store.hasRole('ADMIN'));
  protected readonly sickChecks = resource({
    params: () => this.store.hasRole('LEAD', 'ADMIN') || undefined,
    loader: () => this.api.sickChecks(),
  });
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly range = signal<{ from?: string; to?: string }>({});
  protected readonly checks = resource({
    params: () => this.range(),
    loader: ({ params }) => this.api.checks(params),
  });
  protected readonly lateEntries = resource({
    params: () => this.range(),
    loader: ({ params }) => this.api.teamLateEntries(params),
  });
  protected readonly lateRows = computed(() =>
    this.lateEntries.hasValue()
      ? this.lateEntries
          .value()
          .rows.filter((row) => row.late > 0)
          .sort((a, b) => b.percent - a.percent)
      : [],
  );
  protected readonly reminderSettings = resource({
    params: () => this.isAdmin() || undefined,
    loader: () => this.api.reminderSettings(),
  });
  protected readonly reminderDraft = linkedSignal<ReminderSettingsView>(() =>
    this.reminderSettings.hasValue()
      ? { ...this.reminderSettings.value() }
      : { defaultStart: '', lateFlagMinCount: 3, lateFlagMinPercent: 20, lateFlagWeeks: 6 },
  );
  protected readonly reminderFields = [
    { key: 'lateFlagMinCount', label: 'Mindestanzahl', max: 100 },
    { key: 'lateFlagMinPercent', label: 'Mindestanteil (%)', max: 100 },
    { key: 'lateFlagWeeks', label: 'Zeitraum (Wochen)', max: 52 },
  ] as const;
  protected readonly remindersValid = computed(
    () =>
      /^([01]\d|2[0-3]):[0-5]\d$/.test(this.reminderDraft().defaultStart) &&
      this.reminderFields.every(
        (field) =>
          Number.isInteger(this.reminderDraft()[field.key]) &&
          this.reminderDraft()[field.key] >= 1 &&
          this.reminderDraft()[field.key] <= field.max,
      ),
  );
  protected readonly people = computed(() => {
    const names = new Map<string, string>();
    if (this.checks.hasValue())
      for (const f of this.checks.value().findings) names.set(f.employeeId, f.employeeName);
    return [...names]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  });
  protected readonly person = linkedSignal({
    source: this.people,
    computation: (people, previous) =>
      previous && people.some((p) => p.id === previous.value) ? previous.value : '',
  });
  protected readonly findings = computed(() =>
    this.checks.hasValue()
      ? [...this.checks.value().findings]
          .filter((f) => !this.person() || f.employeeId === this.person())
          .sort((a, b) => b.date.localeCompare(a.date))
      : [],
  );
  protected readonly criticalCount = computed(() =>
    this.checks.hasValue()
      ? this.checks.value().findings.filter((f) => f.level === 'crit').length
      : 0,
  );
  protected readonly warningCount = computed(() =>
    this.checks.hasValue()
      ? this.checks.value().findings.filter((f) => f.level === 'warn').length
      : 0,
  );
  protected readonly minijobCount = computed(() =>
    this.checks.hasValue()
      ? this.checks.value().minijob.filter((p) => p.months.some((m) => m.ratio >= 0.9)).length
      : 0,
  );
  protected readonly missingCount = computed(() =>
    this.checks.hasValue() ? this.checks.value().notices.rows.filter((r) => !r.latest).length : 0,
  );
  protected readonly retention = resource({
    params: () => this.isAdmin() || undefined,
    loader: () => this.api.retentionSettings(),
  });
  protected readonly retentionFields = [
    { key: 'timeYears', label: 'Zeitbuchungen' },
    { key: 'payrollYears', label: 'Minijob-Zeiten (Lohnunterlagen)' },
    { key: 'leaveYears', label: 'Urlaubsdaten' },
    { key: 'auditYears', label: 'Protokoll' },
  ] as const;
  protected readonly retentionDraft = linkedSignal<RetentionSettingsView>(() =>
    this.retention.hasValue()
      ? { ...this.retention.value() }
      : { enabled: false, timeYears: 2, payrollYears: 8, leaveYears: 3, auditYears: 3 },
  );
  protected readonly retentionValid = computed(() =>
    this.retentionFields.every(
      (f) =>
        Number.isInteger(this.retentionDraft()[f.key]) &&
        this.retentionDraft()[f.key] >= 2 &&
        this.retentionDraft()[f.key] <= 30,
    ),
  );
  protected readonly exportMonth = signal(localDateInBerlin(new Date()).slice(0, 7));
  protected readonly validMonth = computed(() =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(this.exportMonth()),
  );
  protected readonly exportMonthUrl = computed(() => this.api.exportMonthUrl(this.exportMonth()));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);
  protected readonly confirmation = signal<
    | { kind: 'send'; year: number; origin: string }
    | { kind: 'forfeit'; row: ForfeitureSuggestion; origin: string }
    | null
  >(null);
  protected readonly date = formatLocalDate;
  protected readonly days = formatHalfDays;
  protected readonly hours = formatHoursMinutes;
  protected readonly euro = formatEuro;
  protected readonly equation = minijobEquationHolds;
  protected timestamp(value: string): string {
    return formatLocalDate(localDateInBerlin(new Date(value)));
  }
  protected monthLabel(value: string): string {
    return new Intl.DateTimeFormat('de-DE', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Berlin',
    }).format(new Date(value + '-01T12:00:00Z'));
  }
  protected percent(ratio: number): number {
    return Math.round(ratio * 100);
  }
  protected meterWidth(ratio: number): number {
    return Math.max(0, Math.min(100, this.percent(ratio)));
  }
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  protected message(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.message : fallback;
  }
  protected applyRange(event?: Event): void {
    event?.preventDefault();
    if (this.busy()) return;
    this.confirmation.set(null);
    this.range.set({
      ...(this.from() ? { from: this.from() } : {}),
      ...(this.to() ? { to: this.to() } : {}),
    });
  }
  protected quickRange(months: number): void {
    if (this.busy()) return;
    const today = localDateInBerlin(new Date());
    if (!months) {
      this.from.set('');
      this.to.set('');
    } else {
      const start = new Date(today + 'T12:00:00Z');
      const day = start.getUTCDate();
      start.setUTCDate(1);
      start.setUTCMonth(start.getUTCMonth() - months);
      const endOfMonth = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
      ).getUTCDate();
      start.setUTCDate(Math.min(day, endOfMonth));
      // Inklusive beider Randtage: höchstens zwölf Monate (auch im Schaltjahr).
      this.from.set(addDays(start.toISOString().slice(0, 10), 1));
      this.to.set(today);
    }
    this.applyRange();
  }
  protected askSendAll(year: number): void {
    if (!this.isAdmin() || this.busy()) return;
    this.confirmation.set({ kind: 'send', year, origin: '#send-all' });
    this.focus('[data-confirm]');
  }
  protected askForfeiture(row: ForfeitureSuggestion, index: number): void {
    if (!this.isAdmin() || this.busy() || !row.noticeTimely) return;
    this.confirmation.set({ kind: 'forfeit', row, origin: '#forfeit-' + index });
    this.focus('[data-confirm]');
  }
  protected cancelConfirmation(): void {
    const origin = this.confirmation()?.origin;
    this.confirmation.set(null);
    if (origin) this.focus(origin);
  }
  protected async confirmAction(): Promise<void> {
    const confirm = this.confirmation();
    if (!confirm) return;
    if (confirm.kind === 'send') await this.send(confirm.year);
    else if (confirm.row.noticeTimely)
      await this.run(async () => {
        const row = confirm.row;
        await this.api.bookForfeiture(row.employeeId, row.year, row.kind);
        this.confirmation.set(null);
        this.checks.reload();
        this.status.set('Verfall gebucht.');
        this.toast.show('Verfall gebucht.');
      });
  }
  protected async send(year: number, employeeId?: string): Promise<void> {
    await this.run(async () => {
      const sent = await this.api.sendLeaveNotices(year, employeeId ? [employeeId] : undefined);
      this.confirmation.set(null);
      this.checks.reload();
      // Bereitstellung und E-Mail getrennt melden (Befund 3).
      const failed = sent.filter((n) => !n.emailSentAt).length;
      const message =
        `${sent.length} Hinweise bereitgestellt und protokolliert` +
        (failed
          ? `; ${failed} ${failed === 1 ? 'E-Mail wurde' : 'E-Mails wurden'} nicht zugestellt.`
          : ', alle per E-Mail versendet.');
      this.status.set(message);
      this.toast.show(message);
    }, '#notice-heading');
  }
  protected changeReminderStart(event: Event): void {
    this.reminderDraft.update((draft) => ({ ...draft, defaultStart: this.value(event) }));
  }
  protected changeReminderNumber(
    key: Exclude<keyof ReminderSettingsView, 'defaultStart'>,
    event: Event,
  ): void {
    this.reminderDraft.update((draft) => ({
      ...draft,
      [key]: (event.target as HTMLInputElement).valueAsNumber,
    }));
  }
  protected async saveReminders(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.reminderSettings.hasValue() || !this.remindersValid()) return;
    await this.run(async () => {
      this.reminderSettings.set(await this.api.updateReminderSettings({ ...this.reminderDraft() }));
      this.lateEntries.reload();
      this.status.set('Erinnerungen gespeichert.');
      this.toast.show('Erinnerungen gespeichert.');
    }, '#reminder-heading');
  }
  protected changeEnabled(event: Event): void {
    this.retentionDraft.update((d) => ({
      ...d,
      enabled: (event.target as HTMLInputElement).checked,
    }));
  }
  protected changeYears(key: Exclude<keyof RetentionSettingsView, 'enabled'>, event: Event): void {
    this.retentionDraft.update((d) => ({
      ...d,
      [key]: (event.target as HTMLInputElement).valueAsNumber,
    }));
  }
  protected async saveRetention(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.retention.hasValue() || !this.retentionValid()) return;
    await this.run(async () => {
      this.retention.set(await this.api.updateRetentionSettings({ ...this.retentionDraft() }));
      this.status.set('Aufbewahrung gespeichert.');
      this.toast.show('Aufbewahrung gespeichert.');
    }, '#retention-heading');
  }
  private async run(action: () => Promise<void>, focus = '#checks-status'): Promise<void> {
    if (this.busy() || !this.isAdmin()) return;
    this.busy.set(true);
    this.error.set(null);
    this.status.set(null);
    try {
      await action();
      this.focus(focus);
    } catch (error) {
      this.error.set(this.message(error, 'Die Aktion konnte nicht gespeichert werden.'));
      this.focus('#checks-status');
    } finally {
      this.busy.set(false);
    }
  }
  private focus(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
}
