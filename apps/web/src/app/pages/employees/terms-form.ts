import { Component, computed, inject, input, linkedSignal, output, resource } from '@angular/core';
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  formatLocalDate,
  legalValuesAt,
  WEEKDAY_SHORT,
  type EmploymentType,
  type IsoWeekday,
  type LocalDate,
  type TermsInput,
} from '@as/shared';
import { validateEmploymentTerms, youthVacationError, type TermsValidation } from '@as/time-rules';
import { ApiService } from '../../core/api.service';
import { RuleMessages } from '../../shared-ui';

@Component({
  selector: 'app-terms-form',
  imports: [RuleMessages],
  template: `
    <form novalidate (submit)="submit($event)">
      <fieldset class="m-0 min-w-0 border-0 p-0" [disabled]="busy()">
        <div class="fields">
          <label class="field" for="terms-date"
            >Stichtag<input
              id="terms-date"
              type="date"
              required
              [value]="validFrom()"
              (input)="validFrom.set(value($event))"
          /></label>
          <label class="field" for="terms-type"
            >Beschäftigungsart<select
              id="terms-type"
              [value]="type()"
              (change)="changeType($event)"
            >
              @for (t of types; track t) {
                <option [value]="t">{{ typeLabels[t] }}</option>
              }
            </select></label
          >
          <label class="field" for="terms-hours"
            >Wochenarbeitszeit (Std.)<input
              id="terms-hours"
              type="number"
              min="0.5"
              max="48"
              step="0.5"
              required
              [value]="weeklyHours()"
              (input)="weeklyHours.set(number($event))"
          /></label>
          <fieldset class="col-span-full m-0 border-0 p-0">
            <legend class="field mb-1">Arbeitstage</legend>
            <div class="flex flex-wrap gap-4">
              @for (day of days; track day) {
                <label class="flex items-center gap-1.5"
                  ><input
                    type="checkbox"
                    [checked]="workDays().includes(day)"
                    (change)="toggleDay(day, $event)"
                  />{{ weekdayLabels[day] }}</label
                >
              }
            </div>
          </fieldset>
          <label class="field" for="terms-annual"
            >Jahresurlaub (Tage)<input
              id="terms-annual"
              type="number"
              min="0"
              max="365"
              step="1"
              required
              [value]="annualLeave()"
              (input)="annualLeave.set(number($event))"
          /></label>
          <label class="field" for="terms-extra"
            >Zusatzurlaub (Tage)<input
              id="terms-extra"
              type="number"
              min="0"
              max="365"
              step="1"
              required
              [value]="extraLeave()"
              (input)="extraLeave.set(number($event))"
            /><span>Nur die Zahl, ohne Grund.</span></label
          >
          @if (type() === 'MINIJOB') {
            <label class="field" for="terms-wage"
              >Stundenlohn (€)<input
                id="terms-wage"
                type="number"
                min="0"
                max="1000"
                step="0.05"
                required
                [value]="hourlyWage()"
                (input)="hourlyWage.set(number($event))"
            /></label>
          }
          <div class="hint col-span-full" aria-live="polite">
            @for (info of validation().infos; track info.code) {
              <div>{{ info.text }}</div>
            }
            <app-rule-messages [messages]="validation().warnings" level="warn" />
            @for (error of validation().errors; track error.code) {
              <div class="err">{{ error.text }}</div>
            }
          </div>
          <div class="col-span-full flex flex-wrap gap-2">
            <button type="submit" class="btn btn-primary" [disabled]="!canSave()">Speichern</button>
            @if (canCancel()) {
              <button type="button" class="btn" (click)="cancelled.emit()">Abbrechen</button>
            }
          </div>
        </div>
      </fieldset>
    </form>
  `,
})
export class TermsForm {
  private readonly api = inject(ApiService);
  readonly initial = input<TermsInput | null>(null);
  readonly defaultDate = input('');
  readonly birthDate = input<LocalDate | null>(null);
  readonly busy = input(false);
  readonly disabled = input(false);
  readonly canCancel = input(false);
  readonly saved = output<TermsInput>();
  readonly cancelled = output<void>();
  private readonly legal = resource({ loader: () => this.api.legalParameters() });
  protected readonly validFrom = linkedSignal(
    () => this.initial()?.validFrom ?? this.defaultDate(),
  );
  protected readonly type = linkedSignal<EmploymentType>(() => this.initial()?.type ?? 'FULL_TIME');
  protected readonly weeklyHours = linkedSignal(() => (this.initial()?.weeklyMinutes ?? 2400) / 60);
  protected readonly workDays = linkedSignal<IsoWeekday[]>(() => [
    ...(this.initial()?.workDays ?? [1, 2, 3, 4, 5]),
  ]);
  protected readonly annualLeave = linkedSignal(() => this.initial()?.annualLeaveDays ?? 30);
  protected readonly extraLeave = linkedSignal(() => this.initial()?.extraLeaveDays ?? 0);
  protected readonly hourlyWage = linkedSignal(() => {
    const cents = this.initial()?.hourlyWageCents;
    return cents == null ? null : cents / 100;
  });
  protected readonly types = EMPLOYMENT_TYPES;
  protected readonly typeLabels = EMPLOYMENT_TYPE_LABELS;
  protected readonly days: IsoWeekday[] = [1, 2, 3, 4, 5, 6];
  protected readonly weekdayLabels = WEEKDAY_SHORT;
  private readonly terms = computed<TermsInput>(() => {
    const wage = this.hourlyWage();
    return {
      validFrom: this.validFrom(),
      type: this.type(),
      weeklyMinutes: Math.round(this.weeklyHours() * 60),
      workDays: this.workDays(),
      annualLeaveDays: this.annualLeave(),
      extraLeaveDays: this.extraLeave(),
      hourlyWageCents: this.type() === 'MINIJOB' && wage !== null ? Math.round(wage * 100) : null,
    };
  });
  protected readonly validation = computed<TermsValidation>(() => {
    const error = (text: string): TermsValidation => ({
      errors: [{ code: 'FORM', text }],
      warnings: [],
      infos: [],
    });
    if (!this.validFrom()) return error('Bitte einen Stichtag wählen.');
    if (this.legal.error())
      return error(
        'Die gesetzlichen Werte konnten nicht geladen werden. Bitte lade die Seite erneut.',
      );
    const rows = this.legal.value();
    if (!rows) return error('Gesetzliche Werte werden geladen …');
    const legal = legalValuesAt(rows, this.validFrom());
    if (!legal.current)
      return error(
        `Für den Stichtag ${formatLocalDate(this.validFrom())} sind keine gesetzlichen Werte hinterlegt.`,
      );
    const result = validateEmploymentTerms(this.terms(), legal.current, legal.upcoming);
    const youthError = youthVacationError(this.terms(), this.birthDate());
    if (youthError) result.errors.push(youthError);
    if (
      this.type() === 'MINIJOB' &&
      this.hourlyWage() !== null &&
      !Number.isFinite(this.hourlyWage())
    )
      result.errors.push({
        code: 'INVALID_WAGE',
        text: 'Bitte einen gültigen Stundenlohn eingeben.',
      });
    return result;
  });
  protected readonly canSave = computed(
    () => !this.busy() && !this.disabled() && !this.validation().errors.length,
  );
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  protected number(event: Event): number {
    return (event.target as HTMLInputElement).valueAsNumber;
  }
  protected changeType(event: Event): void {
    this.type.set(this.value(event) as EmploymentType);
  }
  protected toggleDay(day: IsoWeekday, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.workDays.update((days) =>
      checked ? [...days, day].sort((a, b) => a - b) : days.filter((d) => d !== day),
    );
  }
  protected submit(event: Event): void {
    event.preventDefault();
    if (this.canSave() && (event.target as HTMLFormElement).reportValidity())
      this.saved.emit(this.terms());
  }
}
