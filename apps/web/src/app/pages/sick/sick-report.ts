import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  resource,
  signal,
} from '@angular/core';
import {
  addDays,
  isoWeekKey,
  localDateInBerlin,
  SICK_KIND_LABELS,
  type EmployeeView,
  type SickKind,
  type SickLeaveView,
  type TodayView,
} from '@as/shared';
import { ApiError, ApiService } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-sick-report',
  host: { class: 'block min-w-0' },
  template: `
    <button type="button" class="btn" data-open [disabled]="opened()" (click)="open()">
      {{ forOthers() ? 'Krankmeldung eintragen' : 'Krank melden' }}
    </button>
    @if (opened()) {
      <form class="mt-3 flex min-w-0 flex-col gap-3" (submit)="submit($event)">
        <fieldset class="m-0 min-w-0 border-0 p-0" [disabled]="busy()">
          <legend class="mb-3 font-semibold">Krankmeldung</legend>
          @if (forOthers() && !employeeId()) {
            <label class="field"
              >Person
              <select required [value]="selected()" (change)="selectPerson($event)">
                <option value="">Bitte wählen</option>
                @for (person of people(); track person.id) {
                  <option [value]="person.id">{{ person.name }}</option>
                }
              </select>
            </label>
          }
          <fieldset class="my-3 min-w-0 border-0 p-0">
            <legend>Art</legend>
            <div class="flex flex-wrap gap-4">
              @for (kind of kinds; track kind) {
                <label class="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="sick-kind"
                    [value]="kind"
                    [checked]="kind === type()"
                    (change)="type.set(kind)"
                  />{{ labels[kind] }}
                </label>
              }
            </div>
          </fieldset>
          <div class="fields">
            <label class="field"
              >Ab
              <input
                data-from
                type="date"
                required
                [value]="from()"
                [min]="unrestricted() ? '' : earliest()"
                [max]="unrestricted() ? '' : today()"
                (input)="from.set(value($event)); sinceNow.set(false)"
              />
            </label>
            <label class="field"
              >Voraussichtlich bis
              <input
                type="date"
                required
                [value]="to()"
                [min]="from()"
                [max]="unrestricted() ? '' : latest()"
                (input)="to.set(value($event))"
              />
            </label>
          </div>
          @if (canSinceNow()) {
            <label class="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                [checked]="sinceNow()"
                (change)="sinceNow.set(checked($event))"
              />Ab jetzt
            </label>
            @if (sinceNow()) {
              <p class="hint" role="status">
                Die Krankmeldung beendet keine laufende Buchung.
                {{
                  forOthers() ? 'Die Person muss selbst ausstempeln.' : 'Bitte stemple selbst aus.'
                }}
              </p>
            }
          }
        </fieldset>
        <p class="text-sm text-muted">
          Bitte keine Gründe oder Diagnosen angeben. Die AU vermerkt deine Vorgesetzte oder der
          Admin.
        </p>
        @if (day.error() || teamWeek.error()) {
          <p class="err" role="alert">{{ stampError() }}</p>
          <button type="button" class="btn" (click)="day.reload(); teamWeek.reload()">
            Stempelstatus erneut laden
          </button>
        }
        @if (error()) {
          <p class="err" role="alert" tabindex="-1" data-error>{{ error() }}</p>
        }
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-primary" [disabled]="busy()">Krankmeldung speichern</button>
          <button type="button" class="btn" [disabled]="busy()" (click)="close()">Abbrechen</button>
        </div>
      </form>
    }
  `,
})
export class SickReport {
  readonly forOthers = input(false);
  readonly employeeId = input<string>();
  readonly people = input<readonly Pick<EmployeeView, 'id' | 'name'>[]>([]);
  readonly currentDay = input<TodayView>();
  readonly saved = output<SickLeaveView>();
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** Beim Öffnen neu bestimmt: das Formular kann über Mitternacht geöffnet bleiben (Review Web, Befund 1). */
  protected readonly today = signal(localDateInBerlin(new Date()));
  protected readonly earliest = computed(() => addDays(this.today(), -7));
  protected readonly latest = computed(() => addDays(this.today(), 14));
  protected readonly kinds: Exclude<SickKind, 'NEUTRAL'>[] = ['SICK', 'CHILD_SICK'];
  protected readonly labels = SICK_KIND_LABELS;
  protected readonly opened = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly selected = signal('');
  private readonly person = computed(() => this.employeeId() || this.selected());
  protected readonly unrestricted = computed(
    () =>
      this.store.hasRole('ADMIN') ||
      (this.store.hasRole('LEAD') && !!this.person() && this.person() !== this.store.session()?.id),
  );
  protected readonly type = signal<Exclude<SickKind, 'NEUTRAL'>>('SICK');
  protected readonly from = signal(this.today());
  protected readonly to = signal(this.today());
  protected readonly sinceNow = signal(false);
  protected readonly day = resource({
    params: () =>
      (this.opened() && !this.forOthers() && !this.employeeId() && !this.currentDay()) || undefined,
    loader: () => this.api.today(),
  });
  protected readonly teamWeek = resource({
    params: () => (this.opened() && this.person() ? this.person() : undefined),
    loader: ({ params }) => this.api.week(isoWeekKey(this.today()), params),
  });
  protected readonly canSinceNow = computed(() => {
    if (this.from() !== this.today()) return false;
    if (this.person())
      return (
        this.teamWeek.hasValue() &&
        !!this.teamWeek
          .value()
          .days.find((d) => d.date === this.today())
          ?.entries.some((e) => !e.voided)
      );
    if (this.forOthers()) return false;
    const day = this.currentDay() ?? (this.day.hasValue() ? this.day.value() : undefined);
    return day?.date === this.today() && day.entries.some((e) => !e.voided);
  });
  protected stampError(): string {
    const error = this.day.error() ?? this.teamWeek.error();
    return error instanceof ApiError
      ? error.message
      : 'Der Stempelstatus konnte nicht geladen werden.';
  }
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
  protected selectPerson(event: Event): void {
    this.selected.set(this.value(event));
    this.sinceNow.set(false);
  }
  protected open(): void {
    const today = localDateInBerlin(new Date());
    if (today !== this.today()) {
      this.today.set(today);
      this.from.set(today);
      this.to.set(today);
      this.sinceNow.set(false);
    }
    this.opened.set(true);
    this.error.set(null);
    this.focus('select, input');
  }
  protected close(): void {
    this.opened.set(false);
    this.focus('[data-open]');
  }
  private focus(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || !(event.target as HTMLFormElement).reportValidity()) return;
    if (this.forOthers() && !this.person()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.reportSick({
        ...(this.person() ? { employeeId: this.person() } : {}),
        kind: this.type(),
        from: this.from(),
        to: this.to(),
        ...(this.canSinceNow() && this.sinceNow() ? { sinceNow: true } : {}),
      });
      this.toast.show('Krankmeldung gespeichert.');
      this.saved.emit(result);
      this.sinceNow.set(false);
      this.close();
    } catch (error) {
      this.error.set(
        error instanceof ApiError
          ? error.message
          : 'Die Krankmeldung konnte nicht gespeichert werden.',
      );
      this.focus('[data-error]');
    } finally {
      this.busy.set(false);
    }
  }
}
