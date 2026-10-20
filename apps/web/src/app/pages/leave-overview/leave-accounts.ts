import { ExpandableRows, RowToggle } from '../../shared-ui';
import { Component, inject, input, resource } from '@angular/core';
import { EMPLOYMENT_TYPE_LABELS, type EmploymentType } from '@as/shared';
import { ApiService } from '../../core/api.service';
import { daysText } from '../leave/leave-display';

@Component({
  selector: 'app-leave-accounts',
  imports: [RowToggle],
  template: `
    @if (!manager()) {
      <p class="text-muted">Du siehst nur dein eigenes Konto.</p>
    }
    @if (accounts.hasValue()) {
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Mitarbeiter</th>
              <th class="col-opt num">Anspruch</th>
              <th class="col-opt num">Übertrag</th>
              <th class="col-opt num">Korrekturen</th>
              <th class="col-opt num">Genehmigt</th>
              <th class="col-opt num">Beantragt</th>
              <th class="num">Rest</th>
              <th class="col-narrow"><span class="sr-only">Details</span></th>
            </tr>
          </thead>
          <tbody>
            @for (account of accounts.value(); track account.employeeId) {
              <tr (click)="rows.onRowClick(account.employeeId, $event)">
                <td>
                  {{ account.employeeName }}
                  <div class="text-[13px] text-muted">
                    {{ employment(account.employmentType) }},
                    {{ daysText(account.workDaysPerWeek * 2) }}/Woche
                  </div>
                  @if (account.entitlementBasis === 'STATUTORY_MINIMUM') {
                    <div class="text-[13px] text-muted">
                      Anspruch nach gesetzlichem Mindesturlaub
                    </div>
                  }
                </td>
                <td class="col-opt num">{{ daysText(account.entitlement) }}</td>
                <td class="col-opt num">{{ daysText(account.carryOver) }}</td>
                <td class="col-opt num">{{ daysText(account.corrections) }}</td>
                <td class="col-opt num">{{ daysText(account.approved) }}</td>
                <td class="col-opt num">{{ daysText(account.pending) }}</td>
                <td class="num">
                  <b [class.text-crit]="account.rest < 0">{{ daysText(account.rest) }}</b>
                </td>
                <td class="col-narrow">
                  <app-row-toggle
                    [open]="rows.isOpen(account.employeeId)"
                    [label]="'Details zu ' + account.employeeName"
                    (toggled)="rows.toggle(account.employeeId)"
                  />
                </td>
              </tr>
              @if (rows.isOpen(account.employeeId)) {
                <tr class="row-details">
                  <td colspan="8">
                    <dl class="details">
                      <dt>Anspruch</dt>
                      <dd>{{ daysText(account.entitlement) }}</dd>
                      <dt>Übertrag</dt>
                      <dd>{{ daysText(account.carryOver) }}</dd>
                      <dt>Korrekturen</dt>
                      <dd>{{ daysText(account.corrections) }}</dd>
                      <dt>Genehmigt</dt>
                      <dd>{{ daysText(account.approved) }}</dd>
                      <dt>Beantragt</dt>
                      <dd>{{ daysText(account.pending) }}</dd>
                    </dl>
                  </td>
                </tr>
              }
            } @empty {
              <tr>
                <td colspan="8">Keine Urlaubskonten vorhanden.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else if (accounts.error()) {
      <p class="err" role="alert">Die Urlaubskonten konnten nicht geladen werden.</p>
      <button class="btn" type="button" (click)="accounts.reload()">Konten erneut laden</button>
    } @else {
      <p class="text-muted">Urlaubskonten werden geladen …</p>
    }
  `,
})
export class LeaveAccounts {
  protected readonly rows = new ExpandableRows();
  private readonly api = inject(ApiService);
  readonly year = input.required<number>();
  readonly manager = input(false);
  protected readonly daysText = daysText;
  protected readonly employment = (type: string | null) =>
    EMPLOYMENT_TYPE_LABELS[type as EmploymentType] ?? '–';
  protected readonly accounts = resource({
    params: () => ({ year: this.year(), manager: this.manager() }),
    loader: ({ params }) =>
      params.manager
        ? this.api.leaveAccounts(params.year)
        : this.api.leaveAccount(params.year).then((account) => [account]),
  });
}
