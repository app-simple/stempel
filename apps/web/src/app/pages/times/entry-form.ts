import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import {
  isLocalDate,
  isTimeInput,
  localDateInBerlin,
  type ManualEntryInput,
  type TimeEntryView,
} from '@as/shared';
import { TimeField } from './time-field';

@Component({
  selector: 'app-entry-form',
  imports: [TimeField],
  template: `
    <form (submit)="submit($event)">
      <fieldset class="fields m-0 min-w-0 border-0 p-0" [disabled]="busy() || disabled()">
        @if (!entry()) {
          <label class="field"
            >Datum<input
              name="date"
              type="date"
              required
              [max]="today()"
              [value]="date()"
              (input)="date.set(value($event))"
          /></label>
        }
        @if (!voiding()) {
          <app-time-field
            label="Kommen"
            name="start"
            [date]="date()"
            [required]="true"
            [value]="start()"
            (valueChange)="start.set($event)"
          />
          <app-time-field
            label="Gehen (heute: leer, wenn noch da)"
            name="end"
            [date]="date()"
            [required]="date() !== today()"
            [value]="end()"
            (valueChange)="end.set($event)"
          />
          <div class="col-span-full flex flex-col gap-2">
            @for (pause of breaks(); track $index; let i = $index) {
              <div class="flex flex-wrap items-end gap-2">
                <app-time-field
                  label="Pause von"
                  [name]="'break-start-' + i"
                  [date]="date()"
                  [required]="true"
                  [value]="pause.start"
                  [ariaLabel]="'Pause ' + (i + 1) + ' von'"
                  (valueChange)="changeBreak(i, 'start', $event)"
                />
                <app-time-field
                  label="bis"
                  [name]="'break-end-' + i"
                  [date]="date()"
                  [required]="true"
                  [value]="pause.end"
                  [ariaLabel]="'Pause ' + (i + 1) + ' bis'"
                  (valueChange)="changeBreak(i, 'end', $event)"
                />
                <button
                  type="button"
                  class="btn btn-sm"
                  (click)="removeBreak(i)"
                  [attr.aria-label]="'Pause ' + (i + 1) + ' entfernen'"
                >
                  entfernen
                </button>
              </div>
            }
            <div>
              <button type="button" class="btn btn-sm" (click)="addBreak()">
                Pause hinzufügen
              </button>
            </div>
          </div>
        }
        <label class="field col-span-full"
          >Begründung (Pflicht)<textarea
            name="reason"
            required
            maxlength="2000"
            [value]="reason()"
            (input)="reason.set(value($event))"
          ></textarea>
        </label>
        @if (request()) {
          <p class="hint col-span-full m-0">
            Die Änderung gilt erst nach Freigabe durch deine Vorgesetzte bzw. deinen Vorgesetzten.
          </p>
        }
        <div class="col-span-full flex flex-wrap gap-2">
          <button
            type="submit"
            class="btn btn-primary"
            [disabled]="busy() || disabled() || !valid()"
          >
            {{ submitLabel() }}
          </button>
          @if (entry()) {
            <button type="button" class="btn" (click)="cancelled.emit()">Abbrechen</button>
          }
        </div>
      </fieldset>
    </form>
  `,
})
export class EntryForm {
  readonly entry = input<TimeEntryView | null>(null);
  readonly voiding = input(false);
  readonly request = input(false);
  readonly busy = input(false);
  readonly disabled = input(false);
  readonly saved = output<ManualEntryInput>();
  readonly cancelled = output<void>();
  /** Heute in Europe/Berlin; wechselt über Mitternacht (Befund 4). */
  protected readonly today = signal(localDateInBerlin(new Date()));
  protected readonly date = linkedSignal(() => this.entry()?.workDate ?? this.today());
  protected readonly start = linkedSignal(() => this.entry()?.startInput ?? '08:00');
  protected readonly end = linkedSignal(() => this.entry()?.endInput ?? '');
  protected readonly breaks = linkedSignal(
    () => this.entry()?.breaks.map((b) => ({ start: b.startInput, end: b.endInput ?? '' })) ?? [],
  );

  constructor() {
    const timer = setInterval(() => this.today.set(localDateInBerlin(new Date())), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
  protected readonly reason = linkedSignal(() => {
    this.entry();
    this.voiding();
    return '';
  });
  protected readonly valid = computed(
    () =>
      !!this.reason().trim() &&
      (this.voiding() ||
        (isLocalDate(this.date()) &&
          this.date() <= this.today() &&
          isTimeInput(this.start()) &&
          (isTimeInput(this.end()) || (!this.end() && this.date() === this.today())) &&
          this.breaks().every((b) => isTimeInput(b.start) && isTimeInput(b.end)))),
  );
  protected readonly submitLabel = computed(() =>
    !this.entry()
      ? 'Nachtrag speichern'
      : this.request()
        ? 'Korrektur beantragen'
        : this.voiding()
          ? 'Ungültig markieren'
          : 'Korrigieren',
  );
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  protected addBreak(): void {
    this.breaks.update((list) => [...list, { start: '', end: '' }]);
  }
  protected removeBreak(index: number): void {
    this.breaks.update((list) => list.filter((_, i) => i !== index));
  }
  protected changeBreak(index: number, key: 'start' | 'end', value: string): void {
    this.breaks.update((list) => list.map((b, i) => (i === index ? { ...b, [key]: value } : b)));
  }
  protected submit(event: Event): void {
    event.preventDefault();
    if (this.busy() || this.disabled() || !this.valid()) return;
    this.saved.emit({
      date: this.date(),
      start: this.start(),
      end: this.end() || null,
      breaks: this.breaks(),
      reason: this.reason().trim(),
    });
  }
}
