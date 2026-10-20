import { Component, computed, input, output } from '@angular/core';
import { addDays, berlinInstants, isLocalDate, isTimeOfDay } from '@as/shared';

/**
 * Uhrzeitfeld. In der doppelten Stunde der Rückstellung (Oktober) erscheint zusätzlich die Wahl
 * „zweite Stunde (Winterzeit)“; der Wert lautet dann „HH:MMW“ (Codex-Review Web Phase 2, Befund 1).
 */
@Component({
  selector: 'app-time-field',
  template: `
    <label class="field"
      >{{ label()
      }}<input
        class="font-mono"
        type="time"
        [name]="name()"
        [required]="required()"
        [value]="clock()"
        [attr.aria-label]="ariaLabel() ?? null"
        (input)="emit(inputValue($event), second())"
    /></label>
    @if (ambiguous()) {
      <label class="flex items-center gap-1.5 text-[13px] text-muted">
        <input type="checkbox" [checked]="second()" (change)="emit(clock(), checked($event))" />
        {{ clock() }} ist doppelt: zweite Stunde (Winterzeit)
      </label>
    }
  `,
  host: { class: 'flex flex-col gap-1' },
})
export class TimeField {
  readonly label = input.required<string>();
  readonly name = input.required<string>();
  readonly date = input.required<string>();
  readonly value = input.required<string>();
  readonly required = input(false);
  readonly ariaLabel = input<string>();
  readonly valueChange = output<string>();

  protected readonly clock = computed(() => this.value().slice(0, 5));
  protected readonly second = computed(() => this.value().endsWith('W'));
  /** Doppelt am Tag selbst oder am Folgetag (Ende und Pausen nach Mitternacht). */
  protected readonly ambiguous = computed(() => {
    const clock = this.clock();
    const date = this.date();
    if (!isTimeOfDay(clock) || !isLocalDate(date)) return false;
    return (
      berlinInstants(date, clock).length > 1 || berlinInstants(addDays(date, 1), clock).length > 1
    );
  });

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected emit(clock: string, second: boolean): void {
    const ambiguous =
      isTimeOfDay(clock) && isLocalDate(this.date())
        ? berlinInstants(this.date(), clock).length > 1 ||
          berlinInstants(addDays(this.date(), 1), clock).length > 1
        : false;
    this.valueChange.emit(second && ambiguous ? `${clock}W` : clock);
  }
}
