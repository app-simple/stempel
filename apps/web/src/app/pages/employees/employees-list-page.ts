import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDecimal, formatHalfDays, localDateInBerlin } from '@as/shared';
import { ApiService } from '../../core/api.service';
import {
  EmploymentTypeLabelPipe,
  EuroPipe,
  RoleLabelPipe,
  WeekdaysPipe,
} from '../../core/format.pipes';
import { ExpandableRows, RowToggle, PageHead, RuleMessages } from '../../shared-ui';

@Component({
  host: { class: 'flex min-w-0 flex-col gap-5' },
  selector: 'app-employees-list-page',
  imports: [
    RowToggle,
    NgTemplateOutlet,
    PageHead,
    RuleMessages,
    RouterLink,
    EmploymentTypeLabelPipe,
    EuroPipe,
    RoleLabelPipe,
    WeekdaysPipe,
  ],
  template: `
    <ng-template #employeeAction let-e>
      <a
        [routerLink]="['/mitarbeiter', e.id]"
        class="btn btn-sm no-underline"
        [attr.aria-label]="e.name + ' bearbeiten'"
        >Bearbeiten</a
      >
    </ng-template>
    <ng-template #employeeHints let-e
      ><app-rule-messages [messages]="e.warnings" level="warn"
    /></ng-template>
    <ng-template #employeeVacation let-e>
      {{ e.currentTerms ? e.currentTerms.annualLeaveDays + e.currentTerms.extraLeaveDays : '–' }}
      @if (e.carryOver?.days) {
        <span class="text-muted">+{{ e.carryOver.days }}</span>
      }
    </ng-template>
    <ng-template #employeeType let-e>
      @if (e.currentTerms; as t) {
        {{ t.type | typeLabel }}
        @if (t.type === 'MINIJOB') {
          <div class="font-mono text-[13px] text-muted">{{ t.hourlyWageCents | euro }}/Std.</div>
        }
      } @else {
        –
      }
    </ng-template>
    <app-page-head
      heading="Mitarbeiter"
      lead="Vertragsdaten je Person. Daraus rechnet das Tool Soll-Zeiten, Mindesturlaub und die Minijob-Grenze."
    >
      <a routerLink="/mitarbeiter/neu" class="btn btn-primary no-underline">Mitarbeiter anlegen</a>
    </app-page-head>
    <section class="card">
      @if (employees.error()) {
        <p class="err" role="alert">Die Mitarbeiter konnten nicht geladen werden.</p>
        <button type="button" class="btn" (click)="employees.reload()">Erneut versuchen</button>
      } @else if (employees.value(); as list) {
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th class="col-opt">Art</th>
                <th class="col-opt num">Std./Woche</th>
                <th class="col-opt">Arbeitstage</th>
                <th class="col-opt num">Urlaub/Jahr</th>
                <th class="num">Rest</th>
                <th>Status</th>
                <th class="col-opt">Vorgesetzte/r</th>
                <th class="col-opt">Hinweise</th>
                <th class="col-opt"></th>
                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (e of list; track e.id) {
                <tr (click)="rows.onRowClick(e.id, $event)">
                  <td>
                    <b>{{ e.name }}</b>
                    @if (e.warnings.length) {
                      <span class="col-narrow pill lv-warn">Hinweis</span>
                    }
                    <div class="text-[13px] text-muted">
                      {{ e.jobTitle ? e.jobTitle + ' · ' : '' }}{{ e.role | roleLabel }}
                    </div>
                  </td>
                  <td class="col-opt">
                    <ng-container
                      [ngTemplateOutlet]="employeeType"
                      [ngTemplateOutletContext]="{ $implicit: e }"
                    />
                  </td>
                  <td class="col-opt num">
                    {{ e.currentTerms ? hours(e.currentTerms.weeklyMinutes) : '–' }}
                  </td>
                  <td class="col-opt">{{ e.currentTerms?.workDays | weekdays }}</td>
                  <td class="col-opt num">
                    <ng-container
                      [ngTemplateOutlet]="employeeVacation"
                      [ngTemplateOutletContext]="{ $implicit: e }"
                    />
                  </td>
                  @let rest = rests().get(e.id);
                  <td class="num" [class.text-crit]="rest !== undefined && rest < 0">
                    {{ rest === undefined ? '–' : halfDays(rest) }}
                  </td>
                  <td>
                    <span
                      class="pill"
                      [class.lv-ok]="e.status === 'ACTIVE'"
                      [class.lv-crit]="e.status === 'LOCKED'"
                      [class.lv-mute]="e.status === 'EXITED'"
                      >{{ statuses[e.status] }}</span
                    >
                  </td>
                  <td class="col-opt">{{ e.leadName ?? '–' }}</td>
                  <td class="col-opt">
                    <ng-container
                      [ngTemplateOutlet]="employeeHints"
                      [ngTemplateOutletContext]="{ $implicit: e }"
                    />
                  </td>
                  <td class="col-opt">
                    <ng-container
                      [ngTemplateOutlet]="employeeAction"
                      [ngTemplateOutletContext]="{ $implicit: e }"
                    />
                  </td>
                  <td class="col-narrow">
                    <app-row-toggle
                      [open]="rows.isOpen(e.id)"
                      [label]="'Details zu ' + e.name"
                      (toggled)="rows.toggle(e.id)"
                    />
                  </td>
                </tr>
                @if (rows.isOpen(e.id)) {
                  <tr class="row-details">
                    <td colspan="11">
                      <dl class="details">
                        <dt>Art</dt>
                        <dd>
                          <ng-container
                            [ngTemplateOutlet]="employeeType"
                            [ngTemplateOutletContext]="{ $implicit: e }"
                          />
                        </dd>
                        <dt>Std./Woche</dt>
                        <dd>
                          {{ e.currentTerms ? hours(e.currentTerms.weeklyMinutes) : '–' }}
                        </dd>
                        <dt>Arbeitstage</dt>
                        <dd>{{ e.currentTerms?.workDays | weekdays }}</dd>
                        <dt>Urlaub/Jahr</dt>
                        <dd>
                          <ng-container
                            [ngTemplateOutlet]="employeeVacation"
                            [ngTemplateOutletContext]="{ $implicit: e }"
                          />
                        </dd>
                        <dt>Vorgesetzte/r</dt>
                        <dd>{{ e.leadName ?? '–' }}</dd>
                        <dt>Hinweise</dt>
                        <dd>
                          <ng-container
                            [ngTemplateOutlet]="employeeHints"
                            [ngTemplateOutletContext]="{ $implicit: e }"
                          />
                        </dd>
                        <dt>Aktion</dt>
                        <dd>
                          <ng-container
                            [ngTemplateOutlet]="employeeAction"
                            [ngTemplateOutletContext]="{ $implicit: e }"
                          />
                        </dd>
                      </dl>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td colspan="11" class="text-muted">Noch keine Mitarbeiter angelegt.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="text-muted" role="status">Mitarbeiter werden geladen …</p>
      }
    </section>
  `,
})
export class EmployeesListPage {
  protected readonly rows = new ExpandableRows();
  private readonly api = inject(ApiService);
  protected readonly employees = resource({ loader: () => this.api.employees() });
  protected readonly accounts = resource({
    loader: () => this.api.leaveAccounts(Number(localDateInBerlin(new Date()).slice(0, 4))),
  });
  protected readonly rests = computed(
    () =>
      new Map(
        this.accounts.hasValue() && !this.accounts.error()
          ? this.accounts.value().map((account) => [account.employeeId, account.rest])
          : [],
      ),
  );
  protected readonly halfDays = formatHalfDays;
  protected readonly statuses = { ACTIVE: 'Aktiv', LOCKED: 'Gesperrt', EXITED: 'Ausgetreten' };
  protected hours(minutes: number): string {
    return formatDecimal(minutes / 60, 2).replace(/,?0+$/, '');
  }
}
