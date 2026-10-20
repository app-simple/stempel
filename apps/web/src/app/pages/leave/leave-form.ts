import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import {
  ABSENCE_TYPE_LABELS,
  formatHalfDays,
  formatLocalDate,
  localDateInBerlin,
  type AbsenceType,
  type EmployeeView,
  type LeaveInput,
} from '@as/shared';
import { ApiError, ApiService } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { daysText } from './leave-display';

@Component({
  selector: 'app-leave-form',
  template: `
    <form class="flex flex-col gap-3.5" (submit)="submit($event)">
      <fieldset class="m-0 flex min-w-0 flex-col gap-3.5 border-0 p-0" [disabled]="busy()">
        <legend class="mb-3.5 text-base font-semibold">
          {{ forOthers() ? 'Abwesenheit eintragen' : 'Abwesenheit beantragen' }}
        </legend>
        @if (forOthers()) {
          <label class="field" for="leave-person"
            >Mitarbeiter
            <select
              id="leave-person"
              [value]="employeeId()"
              (change)="employeeId.set(value($event))"
              required
            >
              <option value="">Bitte wählen</option>
              @for (person of people(); track person.id) {
                <option [value]="person.id">{{ person.name }}</option>
              }
            </select>
          </label>
          <p class="hint m-0">Wird sofort als genehmigt eingetragen und ist markiert.</p>
        }
        <div class="fields">
          <label class="field" for="leave-type"
            >Art
            <select id="leave-type" [value]="type()" (change)="setType($event)">
              <option value="VACATION">Urlaub</option>
              <option value="SPECIAL_LEAVE">Sonderurlaub</option>
              @if (hasOvertime()) {
                <option value="OVERTIME_OFF">Überstundenabbau</option>
              }
            </select>
          </label>
          <label class="field" for="leave-from"
            >Erster Tag
            <input
              #firstDate
              id="leave-from"
              type="date"
              required
              [min]="retroAllowed() ? '' : today"
              [value]="from()"
              (input)="from.set(value($event))"
            />
          </label>
          <label class="field" for="leave-to"
            >Letzter Tag
            <input
              id="leave-to"
              type="date"
              required
              [min]="minimumEnd()"
              [value]="to()"
              (input)="to.set(value($event))"
            />
          </label>
        </div>
        <div class="flex flex-wrap gap-4">
          <label
            ><input
              id="leave-start-half"
              type="checkbox"
              [checked]="startHalf()"
              (change)="startHalf.set(checked($event))"
            />
            {{ singleDay() ? 'Nur ein halber Tag' : 'Erster Tag nur halb' }}</label
          >
          @if (!singleDay()) {
            <label
              ><input
                id="leave-end-half"
                type="checkbox"
                [checked]="endHalf()"
                (change)="endHalf.set(checked($event))"
              />
              Letzter Tag nur halb</label
            >
          }
        </div>
        <label class="field" for="leave-note"
          >{{ noteLabel() }}
          <textarea
            id="leave-note"
            maxlength="140"
            rows="2"
            aria-describedby="leave-note-hint"
            [value]="note()"
            (input)="note.set(value($event))"
          ></textarea>
        </label>
        <p id="leave-note-hint" class="m-0 text-[13px] text-muted">
          Bitte keine Gesundheitsangaben.
        </p>
      </fieldset>
      @if (overtime.error()) {
        <p class="err m-0" role="alert">Das Überstundenkonto konnte nicht geladen werden.</p>
        <button class="btn" type="button" (click)="overtime.reload()">
          Überstundenkonto erneut laden
        </button>
      }
      <div aria-live="polite" aria-atomic="true">
        @if (preview.isLoading()) {
          <p class="hint m-0">Vorschau wird berechnet …</p>
        } @else if (preview.error()) {
          <p class="err m-0" role="alert">{{ previewError() }}</p>
          <button class="btn" type="button" (click)="preview.reload()">
            Vorschau erneut laden
          </button>
        } @else if (preview.hasValue()) {
          @let result = preview.value();
          <p class="hint m-0">
            {{ formatHalfDays(result.halfDays) }}
            {{ result.halfDays === 2 ? 'Arbeitstag' : 'Arbeitstage' }} {{ labels[type()] }}.
            @for (year of result.years; track year.year) {
              @if (result.years.length > 1) {
                {{ year.year }}: {{ daysText(year.halfDays) }}.
              }
              @if (year.restAfter !== null) {
                Rest danach: {{ daysText(year.restAfter) }}.
              }
            }
            @if (result.skippedHolidays.length) {
              Nicht gezählt:
              @for (holiday of result.skippedHolidays; track holiday.date; let last = $last) {
                {{ holiday.name }} ({{ shortDate(holiday.date) }}){{ last ? '.' : ',' }}
              }
            }
          </p>
          @for (warning of result.warnings; track $index) {
            <p class="hint lv-warn" role="status">{{ warning }}</p>
          }
          @for (error of result.errors; track $index) {
            <p class="err" role="alert">{{ error }}</p>
          }
          @if (result.immediate) {
            <p class="hint">Wird sofort eingetragen.</p>
          }
        } @else {
          <p class="hint m-0">
            Bitte wähle einen gültigen Zeitraum{{ forOthers() ? ' und eine Person' : '' }}.
          </p>
        }
      </div>
      @if (error()) {
        <p class="err m-0" role="alert">{{ error() }}</p>
      }
      <div>
        <button type="submit" class="btn btn-primary" [disabled]="!canSubmit()">
          {{ forOthers() ? 'Abwesenheit eintragen' : 'Antrag stellen' }}
        </button>
      </div>
    </form>
  `,
})
export class LeaveForm {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly firstDate = viewChild<ElementRef<HTMLInputElement>>('firstDate');
  readonly forOthers = input(false);
  private readonly store = inject(SessionStore);
  /** Rückwirkend: beim Eintragen für andere und für den Admin selbst (Entscheidungen 6 und 8). */
  protected readonly retroAllowed = computed(() => this.forOthers() || this.store.hasRole('ADMIN'));
  readonly people = input<EmployeeView[]>([]);
  readonly saved = output<void>();
  protected readonly today = localDateInBerlin(new Date());
  protected readonly employeeId = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly minimumEnd = computed(() =>
    this.retroAllowed() ? this.from() : this.from() > this.today ? this.from() : this.today,
  );
  protected readonly singleDay = computed(() => this.from() !== '' && this.from() === this.to());
  protected readonly startHalf = signal(false);
  protected readonly endHalf = linkedSignal({ source: this.singleDay, computation: () => false });
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly labels = ABSENCE_TYPE_LABELS;
  protected readonly formatHalfDays = formatHalfDays;
  protected readonly daysText = daysText;
  protected readonly shortDate = (date: string) => formatLocalDate(date).slice(0, 6);
  protected readonly overtime = resource({
    params: () => (this.forOthers() ? this.employeeId() || undefined : ''),
    loader: ({ params }) => this.api.overtime(params || undefined),
  });
  protected readonly hasOvertime = computed(
    () => this.overtime.hasValue() && this.overtime.value() !== null && !this.overtime.isLoading(),
  );
  protected readonly type = linkedSignal({
    source: () => ({ employeeId: this.employeeId(), hasOvertime: this.hasOvertime() }),
    computation: (source, previous): AbsenceType => {
      if (
        previous?.source.employeeId === source.employeeId &&
        (previous.value !== 'OVERTIME_OFF' || source.hasOvertime)
      )
        return previous.value;
      return 'VACATION';
    },
  });
  private readonly draft = computed<LeaveInput | undefined>(() => {
    if (
      !this.from() ||
      !this.to() ||
      this.to() < this.from() ||
      (!this.retroAllowed() && this.from() < this.today) ||
      (this.forOthers() && !this.employeeId())
    )
      return undefined;
    return {
      type: this.type(),
      from: this.from(),
      to: this.to(),
      startHalf: this.startHalf(),
      endHalf: this.singleDay() ? false : this.endHalf(),
      note: this.note().trim() || null,
      ...(this.forOthers() ? { employeeId: this.employeeId() } : {}),
    };
  });
  protected readonly preview = resource({
    params: this.draft,
    loader: async ({ params, abortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
          abortSignal.removeEventListener('abort', abort);
          resolve();
        }, 300);
        abortSignal.addEventListener('abort', abort, { once: true });
      });
      return this.api.leavePreview(params);
    },
  });
  protected readonly noteLabel = computed(() => {
    const name =
      this.preview.hasValue() && !this.preview.isLoading()
        ? this.preview.value().deciderName
        : null;
    return name ? `Notiz für ${name} (freiwillig)` : 'Notiz (freiwillig)';
  });
  protected readonly canSubmit = computed(
    () =>
      !!this.draft() &&
      !this.busy() &&
      !this.preview.isLoading() &&
      this.preview.hasValue() &&
      !this.preview.value().errors.length &&
      (this.type() !== 'OVERTIME_OFF' || this.hasOvertime()),
  );
  protected previewError(): string {
    const error = this.preview.error();
    return error instanceof ApiError ? error.message : 'Die Vorschau konnte nicht geladen werden.';
  }
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
  protected setType(event: Event): void {
    this.type.set(this.value(event) as AbsenceType);
  }
  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSubmit() || !this.preview.hasValue()) return;
    const draft = this.draft();
    if (!draft) return;
    const preview = this.preview.value();
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.createLeave(draft);
      this.toast.show(
        result.status === 'APPROVED'
          ? 'Abwesenheit eingetragen.'
          : `Antrag über ${daysText(result.halfDays)}${preview.deciderName ? ' an ' + preview.deciderName : ''} gesendet.`,
      );
      this.from.set('');
      this.to.set('');
      this.startHalf.set(false);
      this.endHalf.set(false);
      this.note.set('');
      this.saved.emit();
      afterNextRender(() => this.firstDate()?.nativeElement.focus(), { injector: this.injector });
    } catch (error) {
      this.error.set(
        error instanceof ApiError ? error.message : 'Der Antrag konnte nicht gespeichert werden.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
