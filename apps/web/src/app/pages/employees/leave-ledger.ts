import { ExpandableRows, RowToggle } from '../../shared-ui';
import {
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  resource,
  signal,
} from '@angular/core';
import { formatHalfDays, localDateInBerlin } from '@as/shared';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { EmployeeErrors } from './employee-errors';

@Component({
  selector: 'app-leave-ledger',
  imports: [RowToggle, EmployeeErrors],
  template: `
    <section class="card">
      <h2>Urlaubskonto {{ currentYear }}</h2>
      @if (account.error()) {
        <p class="err m-0" role="alert">Das Urlaubskonto konnte nicht geladen werden.</p>
        <div>
          <button type="button" class="btn" (click)="account.reload()">Erneut versuchen</button>
        </div>
      } @else if (account.hasValue()) {
        @let a = account.value();
        <div class="tiles">
          <div class="tile">
            <small class="lbl">Anspruch</small><b>{{ days(a.entitlement) }}</b>
          </div>
          <div class="tile">
            <small class="lbl">Übertrag</small><b>{{ days(a.carryOver) }}</b>
          </div>
          <div class="tile">
            <small class="lbl">Korrekturen</small><b>{{ days(a.corrections) }}</b>
          </div>
          <div class="tile">
            <small class="lbl">Genehmigt</small><b>{{ days(a.approved) }}</b>
          </div>
          <div class="tile">
            <small class="lbl">Beantragt</small><b>{{ days(a.pending) }}</b>
          </div>
          <div class="tile">
            <small class="lbl">Rest</small><b [class.text-crit]="a.rest < 0">{{ days(a.rest) }}</b>
          </div>
        </div>
        <p class="m-0 text-[13px] text-muted">Alle Angaben in Tagen.</p>
      } @else {
        <p class="m-0 text-muted" role="status">Urlaubskonto wird geladen …</p>
      }
      <h3 class="m-0 font-semibold">Korrekturbuchung</h3>
      <form (submit)="save($event)">
        <fieldset class="fields m-0 min-w-0 border-0 p-0" [disabled]="busy()">
          <label class="field" for="leave-year"
            >Jahr
            <select id="leave-year" [value]="year()" (change)="year.set(+value($event))">
              @for (option of years; track option) {
                <option [value]="option">{{ option }}</option>
              }
            </select>
          </label>
          <label class="field" for="leave-days"
            >Tage mit Vorzeichen
            <input
              id="leave-days"
              type="text"
              inputmode="decimal"
              required
              [value]="amount()"
              (input)="amount.set(value($event))"
              aria-describedby="leave-days-hint"
            />
            <span id="leave-days-hint">Halbe Schritte, z. B. 1,5 oder −0,5.</span>
          </label>
          <label class="field col-span-full" for="leave-note"
            >Vermerk
            <input
              id="leave-note"
              required
              maxlength="200"
              [value]="note()"
              (input)="note.set(value($event))"
              aria-describedby="leave-note-hint"
            />
            <span id="leave-note-hint"
              >Bitte keine Gesundheitsangaben, z. B. „Rückbuchung nach § 9 BUrlG“.</span
            >
          </label>
          <div class="col-span-full">
            <button type="submit" class="btn btn-primary" [disabled]="busy() || !valid()">
              Korrekturbuchung speichern
            </button>
          </div>
        </fieldset>
      </form>
      <app-employee-errors [error]="error()" />
      <h3 class="m-0 font-semibold">Korrekturbuchungen</h3>
      @if (ledger.error()) {
        <p class="err m-0" role="alert">Die Korrekturbuchungen konnten nicht geladen werden.</p>
        <div>
          <button type="button" class="btn" (click)="ledger.reload()">Erneut versuchen</button>
        </div>
      } @else if (ledger.hasValue()) {
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Jahr</th>
                <th class="num">Tage</th>
                <th class="col-opt">Vermerk</th>
                <th class="col-opt">Zeitpunkt</th>
                <th class="col-opt">Person</th>
                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (entry of ledger.value(); track entry.id) {
                <tr (click)="rows.onRowClick(entry.id, $event)">
                  <td>{{ entry.year }}</td>
                  <td class="num">{{ entry.halfDays > 0 ? '+' : '' }}{{ days(entry.halfDays) }}</td>
                  <td class="col-opt">{{ entry.note }}</td>
                  <td class="col-opt font-mono whitespace-nowrap">
                    {{ timestamp(entry.createdAt) }}
                  </td>
                  <td class="col-opt">{{ entry.createdByName ?? '–' }}</td>
                  <td class="col-narrow">
                    <app-row-toggle
                      [open]="rows.isOpen(entry.id)"
                      [label]="'Details zu ' + entry.year + ', ' + timestamp(entry.createdAt)"
                      (toggled)="rows.toggle(entry.id)"
                    />
                  </td>
                </tr>
                @if (rows.isOpen(entry.id)) {
                  <tr class="row-details">
                    <td colspan="6">
                      <dl class="details">
                        <dt>Vermerk</dt>
                        <dd>{{ entry.note }}</dd>
                        <dt>Zeitpunkt</dt>
                        <dd>{{ timestamp(entry.createdAt) }}</dd>
                        <dt>Person</dt>
                        <dd>{{ entry.createdByName ?? '–' }}</dd>
                      </dl>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td colspan="6" class="text-muted">Noch keine Korrekturbuchungen.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="m-0 text-muted" role="status">Korrekturbuchungen werden geladen …</p>
      }
    </section>
  `,
})
export class LeaveLedger {
  protected readonly rows = new ExpandableRows();
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly employeeId = input.required<string>();
  readonly refresh = input(0);
  readonly booked = output<void>();
  protected readonly currentYear = Number(localDateInBerlin(new Date()).slice(0, 4));
  protected readonly years = [this.currentYear, this.currentYear - 1, this.currentYear + 1];
  protected readonly year = linkedSignal(() => {
    this.employeeId();
    return this.currentYear;
  });
  protected readonly amount = linkedSignal(() => {
    this.employeeId();
    return '';
  });
  protected readonly note = linkedSignal(() => {
    this.employeeId();
    return '';
  });
  protected readonly error = linkedSignal<unknown>(() => {
    this.employeeId();
    return null;
  });
  protected readonly busy = signal(false);
  protected readonly account = resource({
    params: () => ({ id: this.employeeId(), refresh: this.refresh() }),
    loader: ({ params }) => this.api.leaveAccount(this.currentYear, params.id),
  });
  protected readonly ledger = resource({
    params: () => this.employeeId(),
    loader: ({ params }) => this.api.leaveLedger(params),
  });
  protected readonly halfDays = computed(() => {
    const value = this.amount().trim().replace('−', '-').replace(',', '.');
    if (!/^[+-]?\d+(?:\.[05])?$/.test(value)) return null;
    const halfDays = Number(value) * 2;
    return Number.isSafeInteger(halfDays) && halfDays !== 0 ? halfDays : null;
  });
  protected readonly valid = computed(
    () =>
      this.halfDays() !== null &&
      this.years.includes(this.year()) &&
      !!this.note().trim() &&
      this.note().length <= 200,
  );
  protected readonly days = formatHalfDays;
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  protected timestamp(value: string): string {
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }
  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const halfDays = this.halfDays();
    if (this.busy() || !this.valid() || halfDays === null) return;
    const employeeId = this.employeeId();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.addLeaveLedger(employeeId, {
        year: this.year(),
        halfDays,
        note: this.note().trim(),
      });
      if (this.employeeId() !== employeeId) return;
      this.amount.set('');
      this.note.set('');
      this.ledger.reload();
      this.account.reload();
      this.booked.emit();
      this.toast.show('Korrekturbuchung gespeichert.');
    } catch (error) {
      if (this.employeeId() === employeeId) this.error.set(error);
    } finally {
      this.busy.set(false);
    }
  }
}
