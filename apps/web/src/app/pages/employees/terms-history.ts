import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, resource, signal } from '@angular/core';
import {
  formatDecimal,
  localDateInBerlin,
  type ApiMessage,
  type TermsInput,
  type TermsView,
  type LocalDate,
} from '@as/shared';
import { ApiService } from '../../core/api.service';
import {
  EmploymentTypeLabelPipe,
  EuroPipe,
  HoursMinutesPipe,
  LocalDatePipe,
  WeekdaysPipe,
} from '../../core/format.pipes';
import { ToastService } from '../../core/toast.service';
import { ExpandableRows, RowToggle, RuleMessages } from '../../shared-ui';
import { EmployeeErrors } from './employee-errors';
import { TermsForm } from './terms-form';

@Component({
  selector: 'app-terms-history',
  imports: [
    RowToggle,
    NgTemplateOutlet,
    TermsForm,
    EmployeeErrors,
    RuleMessages,
    EmploymentTypeLabelPipe,
    EuroPipe,
    HoursMinutesPipe,
    LocalDatePipe,
    WeekdaysPipe,
  ],
  template: `
    <ng-template #termsActions let-t>
      @if (t.editable) {
        <div class="flex flex-wrap gap-1">
          @if (confirmDelete() === t.id) {
            <button
              type="button"
              class="btn btn-sm btn-danger"
              [disabled]="busy()"
              (click)="remove(t)"
            >
              Wirklich löschen
            </button>
            <button
              type="button"
              class="btn btn-sm"
              [disabled]="busy()"
              (click)="confirmDelete.set(null)"
            >
              Abbrechen
            </button>
          } @else {
            <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="edit(t)">
              Bearbeiten
            </button>
            <button
              type="button"
              class="btn btn-sm"
              [disabled]="busy()"
              (click)="confirmDelete.set(t.id)"
            >
              Löschen
            </button>
          }
        </div>
      }
    </ng-template>
    <section class="card">
      <h2>Vertragsstände</h2>
      @if (terms.error()) {
        <app-employee-errors [error]="terms.error()" /><button
          type="button"
          class="btn"
          (click)="terms.reload()"
        >
          Erneut versuchen
        </button>
      } @else if (terms.value(); as list) {
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Gültig ab</th>
                <th>Art</th>
                <th class="num">Std./Woche</th>
                <th class="col-opt">Arbeitstage</th>
                <th class="col-opt num">Urlaub</th>
                <th class="col-opt num">Stundenlohn</th>
                <th class="col-opt num">Soll/Tag</th>
                <th class="col-opt"></th>
                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (t of list; track t.id) {
                <tr (click)="rows.onRowClick(t.id, $event)">
                  <td class="font-mono sm:whitespace-nowrap">{{ t.validFrom | localDate }}</td>
                  <td>{{ t.type | typeLabel }}</td>
                  <td class="num">{{ hours(t.weeklyMinutes) }}</td>
                  <td class="col-opt">{{ t.workDays | weekdays }}</td>
                  <td class="col-opt num">{{ t.annualLeaveDays + t.extraLeaveDays }}</td>
                  <td class="col-opt num">{{ t.hourlyWageCents | euro }}</td>
                  <td class="col-opt num">{{ t.dailyTargetMinutes | hm }}</td>
                  <td class="col-opt">
                    <ng-container
                      [ngTemplateOutlet]="termsActions"
                      [ngTemplateOutletContext]="{ $implicit: t }"
                    />
                  </td>
                  <td class="col-narrow">
                    <app-row-toggle
                      [open]="rows.isOpen(t.id)"
                      [label]="'Details zu ' + (t.validFrom | localDate)"
                      (toggled)="rows.toggle(t.id)"
                    />
                  </td>
                </tr>
                @if (rows.isOpen(t.id)) {
                  <tr class="row-details">
                    <td colspan="9">
                      <dl class="details">
                        <dt>Arbeitstage</dt>
                        <dd>{{ t.workDays | weekdays }}</dd>
                        <dt>Urlaub</dt>
                        <dd>{{ t.annualLeaveDays + t.extraLeaveDays }}</dd>
                        <dt>Stundenlohn</dt>
                        <dd>{{ t.hourlyWageCents | euro }}</dd>
                        <dt>Soll/Tag</dt>
                        <dd>{{ t.dailyTargetMinutes | hm }}</dd>
                        <dt>Aktion</dt>
                        <dd>
                          <ng-container
                            [ngTemplateOutlet]="termsActions"
                            [ngTemplateOutletContext]="{ $implicit: t }"
                          />
                        </dd>
                      </dl>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td colspan="9" class="text-muted">Noch kein Vertragsstand hinterlegt.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="text-muted" role="status">Vertragsstände werden geladen …</p>
      }
      <p class="m-0 text-[13px] text-muted">
        Geltende und vergangene Stände sind unveränderlich. Korrekturen laufen über einen neuen
        Stand mit Stichtag.
      </p>
      <h2>{{ editing() ? 'Vertragsstand bearbeiten' : 'Neuer Vertragsstand' }}</h2>
      <app-terms-form
        [initial]="editing()"
        [defaultDate]="defaultDate()"
        [birthDate]="birthDate()"
        [busy]="busy()"
        [canCancel]="editing() !== null"
        (cancelled)="editing.set(null)"
        (saved)="save($event)"
      />
      <app-rule-messages [messages]="warnings()" level="warn" />
      <app-employee-errors [error]="error()" />
    </section>
  `,
})
export class TermsHistory {
  protected readonly rows = new ExpandableRows();
  /** Vertragsstände geändert; Urlaubsanspruch und Konto rechnen neu. */
  readonly changed = output<void>();
  readonly employeeId = input.required<string>();
  readonly entryDate = input.required<string>();
  readonly birthDate = input<LocalDate | null>(null);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly terms = resource({
    params: () => this.employeeId(),
    loader: ({ params }) => this.api.terms(params),
  });
  protected readonly defaultDate = computed(() => {
    const today = localDateInBerlin(new Date());
    return this.entryDate() > today ? this.entryDate() : today;
  });
  protected readonly editing = signal<TermsView | null>(null);
  protected readonly confirmDelete = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<unknown>(null);
  protected readonly warnings = signal<ApiMessage[]>([]);
  protected hours(minutes: number): string {
    return formatDecimal(minutes / 60, 2).replace(/,?0+$/, '');
  }
  protected edit(terms: TermsView): void {
    if (!terms.editable || this.busy()) return;
    this.editing.set(terms);
    this.confirmDelete.set(null);
    this.error.set(null);
    this.warnings.set([]);
  }
  protected async save(input: TermsInput): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.warnings.set([]);
    try {
      const editing = this.editing();
      const result = editing
        ? await this.api.updateTerms(this.employeeId(), editing.id, input)
        : await this.api.createTerms(this.employeeId(), input);
      this.editing.set(null);
      this.terms.reload();
      this.warnings.set(result.warnings);
      this.toast.show('Vertragsstand gespeichert.');
      this.changed.emit();
    } catch (e) {
      this.error.set(e);
    } finally {
      this.busy.set(false);
    }
  }
  protected async remove(terms: TermsView): Promise<void> {
    if (this.busy() || !terms.editable || this.confirmDelete() !== terms.id) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.deleteTerms(this.employeeId(), terms.id);
      if (this.editing()?.id === terms.id) this.editing.set(null);
      this.confirmDelete.set(null);
      this.terms.reload();
      this.toast.show('Vertragsstand gelöscht.');
      this.changed.emit();
    } catch (e) {
      this.error.set(e);
    } finally {
      this.busy.set(false);
    }
  }
}
