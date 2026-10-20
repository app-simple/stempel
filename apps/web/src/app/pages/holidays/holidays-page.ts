import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  resource,
  signal,
} from '@angular/core';
import {
  isoWeekday,
  localDateInBerlin,
  WEEKDAY_SHORT,
  formatLocalDate,
  schoolHolidaySuggestions,
  type SchoolHolidayView,
  type HolidayView,
} from '@as/shared';
import { ApiError, ApiService } from '../../core/api.service';
import { LocalDatePipe } from '../../core/format.pipes';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { ExpandableRows, RowToggle, PageHead } from '../../shared-ui';

@Component({
  host: { class: 'flex min-w-0 flex-col gap-5' },
  selector: 'app-holidays-page',
  imports: [RowToggle, NgTemplateOutlet, PageHead, LocalDatePipe],
  template: `
    <ng-template #holidayActions let-day>
      @if (day.editable) {
        <div class="flex flex-wrap gap-1">
          @if (editing() === day.id) {
            <button
              type="button"
              class="btn btn-sm btn-primary"
              [disabled]="busy() || !draft().trim()"
              (click)="rename(day)"
            >
              Speichern
            </button>
            <button
              type="button"
              class="btn btn-sm"
              [disabled]="busy()"
              (click)="editing.set(null)"
            >
              Abbrechen
            </button>
          } @else if (confirmDelete() === day.id) {
            <button
              type="button"
              class="btn btn-sm btn-danger"
              [disabled]="busy()"
              (click)="remove(day)"
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
            <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="toggle(day)">
              {{ day.active ? 'Abschalten' : 'Aktivieren' }}
            </button>
            <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="startRename(day)">
              Umbenennen
            </button>
            @if (day.origin === 'MANUAL') {
              <button
                type="button"
                class="btn btn-sm"
                [disabled]="busy()"
                (click)="confirmDelete.set(day.id)"
              >
                Löschen
              </button>
            }
          }
        </div>
      }
    </ng-template>
    <app-page-head
      heading="Feiertage"
      lead="Gesetzliche Feiertage in Bayern und eigene Feiertage des Betriebs."
    />
    <div class="flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="btn"
        [disabled]="busy() || year() <= 2000"
        (click)="changeYear(year() - 1)"
      >
        ← Jahr
      </button>
      <h2 aria-live="polite">{{ year() }}</h2>
      <button type="button" class="btn" [disabled]="busy()" (click)="changeYear(currentYear)">
        Heute
      </button>
      <button
        type="button"
        class="btn"
        [disabled]="busy() || year() >= 2100"
        (click)="changeYear(year() + 1)"
      >
        Jahr →
      </button>
    </div>
    <section class="card">
      @if (holidays.error()) {
        <p class="err" role="alert">Die Feiertage konnten nicht geladen werden.</p>
        <button type="button" class="btn" (click)="holidays.reload()">Erneut versuchen</button>
      } @else if (holidays.value(); as list) {
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Name</th>
                <th class="col-opt">Art</th>
                @if (admin()) {
                  <th class="col-opt"></th>
                }
                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (day of list; track day.id) {
                <tr (click)="rows.onRowClick(day.id, $event)" [class.text-muted]="!day.active">
                  <td class="font-mono sm:whitespace-nowrap">
                    {{ weekday(day.date) }} {{ day.date | localDate }}
                  </td>
                  <td>
                    @if (editing() === day.id && admin() && day.editable) {
                      <input
                        class="w-full min-w-0 sm:w-auto"
                        aria-label="Neuer Name"
                        maxlength="80"
                        [disabled]="busy()"
                        [value]="draft()"
                        (input)="draft.set(value($event))"
                      />
                    } @else {
                      {{ day.name }}
                    }
                    @if (!day.active) {
                      <span class="pill lv-mute">abgeschaltet</span>
                    }
                  </td>
                  <td class="col-opt">
                    {{ day.origin === 'STATUTORY' ? 'gesetzlich' : 'eigener' }}
                  </td>
                  @if (admin()) {
                    <td class="col-opt">
                      <ng-container
                        [ngTemplateOutlet]="holidayActions"
                        [ngTemplateOutletContext]="{ $implicit: day }"
                      />
                    </td>
                  }
                  <td class="col-narrow">
                    <app-row-toggle
                      [open]="rows.isOpen(day.id)"
                      [label]="'Details zu ' + day.name + ', ' + (day.date | localDate)"
                      (toggled)="rows.toggle(day.id)"
                    />
                  </td>
                </tr>
                @if (rows.isOpen(day.id)) {
                  <tr class="row-details">
                    <td [attr.colspan]="admin() ? 5 : 4">
                      <dl class="details">
                        <dt>Art</dt>
                        <dd>{{ day.origin === 'STATUTORY' ? 'gesetzlich' : 'eigener' }}</dd>
                        @if (admin()) {
                          <dt>Aktion</dt>
                          <dd>
                            <ng-container
                              [ngTemplateOutlet]="holidayActions"
                              [ngTemplateOutletContext]="{ $implicit: day }"
                            />
                          </dd>
                        }
                      </dl>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td [attr.colspan]="admin() ? 5 : 4" class="text-muted">
                    Keine Feiertage für dieses Jahr.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="text-muted" role="status">Feiertage werden geladen …</p>
      }
    </section>

    <ng-template #schoolActions let-holiday>
      <div class="flex flex-wrap gap-1">
        <button
          type="button"
          class="btn btn-sm"
          [disabled]="busy()"
          [attr.aria-label]="'Schulferien ' + holiday.name + ' bearbeiten'"
          (click)="editSchool(holiday)"
        >
          Bearbeiten
        </button>
        <button
          type="button"
          class="btn btn-sm"
          [disabled]="busy()"
          [attr.aria-label]="'Schulferien ' + holiday.name + ' löschen'"
          (click)="askDeleteSchool(holiday)"
        >
          Löschen
        </button>
      </div>
    </ng-template>
    <section class="card" aria-labelledby="school-heading">
      <h2 id="school-heading">Schulferien</h2>
      @if (schoolHolidays.error()) {
        <p class="err" role="alert">{{ schoolLoadError() }}</p>
        <button type="button" class="btn" (click)="schoolHolidays.reload()">
          Schulferien erneut laden
        </button>
      } @else if (schoolHolidays.value(); as list) {
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Zeitraum</th>
                <th class="col-opt">Aktiv</th>
                @if (admin()) {
                  <th class="col-opt">Aktion</th>
                }
                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (holiday of list; track holiday.id) {
                <tr
                  (click)="schoolRows.onRowClick(holiday.id, $event)"
                  [class.text-muted]="!holiday.active"
                >
                  <td class="break-words">
                    {{ holiday.name }}
                    @if (!holiday.active) {
                      <span class="pill lv-mute">abgeschaltet</span>
                    }
                  </td>
                  <td class="font-mono sm:whitespace-nowrap">{{ schoolPeriod(holiday) }}</td>
                  <td class="col-opt">{{ holiday.active ? 'Ja' : 'Nein' }}</td>
                  @if (admin()) {
                    <td class="col-opt">
                      <ng-container
                        [ngTemplateOutlet]="schoolActions"
                        [ngTemplateOutletContext]="{ $implicit: holiday }"
                      />
                    </td>
                  }
                  <td class="col-narrow">
                    <app-row-toggle
                      [open]="schoolRows.isOpen(holiday.id)"
                      [label]="'Details zu ' + holiday.name + ', ' + schoolPeriod(holiday)"
                      (toggled)="schoolRows.toggle(holiday.id)"
                    />
                  </td>
                </tr>
                @if (schoolRows.isOpen(holiday.id)) {
                  <tr class="row-details">
                    <td [attr.colspan]="admin() ? 5 : 4">
                      <dl class="details">
                        <dt>Aktiv</dt>
                        <dd>{{ holiday.active ? 'Ja' : 'Nein' }}</dd>
                        @if (admin()) {
                          <dt>Aktion</dt>
                          <dd>
                            <ng-container
                              [ngTemplateOutlet]="schoolActions"
                              [ngTemplateOutletContext]="{ $implicit: holiday }"
                            />
                          </dd>
                        }
                      </dl>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td [attr.colspan]="admin() ? 5 : 4" class="text-muted">
                    Keine Schulferien für dieses Jahr.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="text-muted" role="status">Schulferien werden geladen …</p>
      }
      @if (admin()) {
        @if (schoolDelete(); as holiday) {
          <div class="hint" role="group" aria-labelledby="school-delete-label">
            <p id="school-delete-label">Schulferien „{{ holiday.name }}“ wirklich löschen?</p>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="btn btn-danger"
                data-school-confirm
                [disabled]="busy()"
                (click)="removeSchool(holiday)"
              >
                Wirklich löschen
              </button>
              <button type="button" class="btn" [disabled]="busy()" (click)="cancelSchoolDelete()">
                Abbrechen
              </button>
            </div>
          </div>
        }
        <h3>{{ schoolEditing() ? 'Schulferien bearbeiten' : 'Schulferien anlegen' }}</h3>
        <form class="fields" (submit)="saveSchool($event)">
          <label class="field" for="school-name"
            >Name<input
              id="school-name"
              required
              maxlength="80"
              [disabled]="busy()"
              [value]="schoolDraft().name"
              (input)="changeSchool('name', value($event))"
          /></label>
          <label class="field" for="school-from"
            >Von<input
              id="school-from"
              type="date"
              required
              [disabled]="busy()"
              [value]="schoolDraft().from"
              (input)="changeSchool('from', value($event))"
          /></label>
          <label class="field" for="school-to"
            >Bis<input
              id="school-to"
              type="date"
              required
              [disabled]="busy()"
              [value]="schoolDraft().to"
              (input)="changeSchool('to', value($event))"
          /></label>
          @if (schoolEditing()) {
            <label class="flex min-h-11 items-center gap-2" for="school-active"
              ><input
                id="school-active"
                type="checkbox"
                [disabled]="busy()"
                [checked]="schoolDraft().active"
                (change)="changeSchool('active', checked($event))"
              />Aktiv</label
            >
          }
          <div class="col-span-full flex flex-wrap gap-2">
            <button type="submit" class="btn btn-primary" [disabled]="busy() || !schoolValid()">
              {{ schoolEditing() ? 'Schulferien speichern' : 'Schulferien anlegen' }}
            </button>
            @if (schoolEditing()) {
              <button type="button" class="btn" [disabled]="busy()" (click)="resetSchool(true)">
                Bearbeitung abbrechen
              </button>
            }
          </div>
        </form>
        <div>
          <button
            type="button"
            class="btn"
            [disabled]="
              busy() ||
              schoolHolidays.isLoading() ||
              !schoolHolidays.hasValue() ||
              !!schoolHolidays.error()
            "
            (click)="openSuggestions()"
          >
            Vorlage übernehmen
          </button>
        </div>
        @if (suggestionsOpen()) {
          <div data-school-suggestions tabindex="-1">
            @if (suggestions().length) {
              <fieldset class="m-0 min-w-0 border-0 p-0" [disabled]="busy()">
                <legend>Schulferien aus der Vorlage auswählen</legend>
                @for (suggestion of suggestions(); track suggestion.from) {
                  <label class="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      [checked]="selectedSuggestions().has(suggestion.from)"
                      (change)="selectSuggestion(suggestion.from, checked($event))"
                    />
                    <span>{{ suggestion.name }} · {{ schoolPeriod(suggestion) }}</span>
                  </label>
                }
                <button
                  type="button"
                  class="btn btn-primary"
                  [disabled]="busy() || !selectedSuggestions().size"
                  (click)="importSuggestions()"
                >
                  Übernehmen
                </button>
              </fieldset>
            } @else {
              <p role="status">Für {{ year() }} gibt es keine weiteren Termine in der Vorlage.</p>
            }
          </div>
        }
      }
      <p class="text-sm text-muted">
        Quelle der Vorlage: Bayerisches Kultusministerium. Bitte vor dem Übernehmen prüfen.
      </p>
      <div tabindex="-1" data-school-result>
        @if (schoolError()) {
          <p class="err" role="alert">{{ schoolError() }}</p>
        }
        @if (schoolStatus()) {
          <p role="status">{{ schoolStatus() }}</p>
        }
      </div>
    </section>
    @if (admin()) {
      @if (year() >= currentYear) {
        <section class="card">
          <h2>Eigenen Feiertag anlegen</h2>
          <form class="fields" (submit)="create($event)">
            <label class="field" for="holiday-date"
              >Datum<input
                id="holiday-date"
                type="date"
                required
                [min]="currentYear + '-01-01'"
                max="2100-12-31"
                [disabled]="busy()"
                [value]="newDate()"
                (input)="newDate.set(value($event))"
            /></label>
            <label class="field" for="holiday-name"
              >Name<input
                id="holiday-name"
                required
                maxlength="80"
                [disabled]="busy()"
                [value]="newName()"
                (input)="newName.set(value($event))"
            /></label>
            <div>
              <button
                type="submit"
                class="btn btn-primary"
                [disabled]="busy() || !newDate() || !newName().trim()"
              >
                Feiertag anlegen
              </button>
            </div>
          </form>
        </section>
      }
      <section class="card">
        <h2>Einstellungen</h2>
        @if (settings.error()) {
          <p class="err" role="alert">Die Einstellungen konnten nicht geladen werden.</p>
          <button type="button" class="btn" (click)="settings.reload()">Erneut versuchen</button>
        } @else if (settings.value(); as value) {
          <label class="flex items-start gap-2"
            ><input
              class="mt-1"
              type="checkbox"
              [checked]="value.assumptionDayIsHoliday"
              [disabled]="busy()"
              (change)="changeSetting($event)"
            />Mariä Himmelfahrt (15.08.) ist am Betriebssitz Feiertag</label
          >
        }
        <p class="m-0 text-[13px] text-muted">
          Gilt ab dem laufenden Jahr. Vergangene Jahre bleiben unverändert, damit alte Monate
          richtig bleiben.
        </p>
      </section>
    }
    @if (error()) {
      <p class="err" role="alert">{{ error() }}</p>
    }
  `,
})
export class HolidaysPage {
  protected readonly rows = new ExpandableRows();
  protected readonly schoolRows = new ExpandableRows();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly toast = inject(ToastService);
  protected readonly currentYear = Number(localDateInBerlin(new Date()).slice(0, 4));
  protected readonly year = signal(this.currentYear);
  protected readonly admin = computed(() => this.store.hasRole('ADMIN'));
  protected readonly holidays = resource({
    params: () => this.year(),
    loader: ({ params }) => this.api.holidays(params),
  });
  protected readonly schoolHolidays = resource({
    params: () => this.year(),
    loader: ({ params }) => this.api.schoolHolidays(params),
  });
  protected readonly schoolLoadError = computed(() => {
    const error = this.schoolHolidays.error();
    return error instanceof ApiError
      ? error.message
      : 'Die Schulferien konnten nicht geladen werden.';
  });
  protected readonly schoolEditing = signal<string | null>(null);
  protected readonly schoolDelete = signal<SchoolHolidayView | null>(null);
  protected readonly schoolDraft = signal({ name: '', from: '', to: '', active: true });
  protected readonly schoolValid = computed(() => {
    const draft = this.schoolDraft();
    return !!draft.name.trim() && !!draft.from && !!draft.to;
  });
  protected readonly schoolError = signal<string | null>(null);
  protected readonly schoolStatus = signal<string | null>(null);
  protected readonly suggestionsOpen = signal(false);
  protected readonly suggestions = computed(() =>
    schoolHolidaySuggestions(this.year(), this.schoolHolidays.value() ?? []),
  );
  protected readonly selectedSuggestions = signal(new Set<string>());
  protected readonly settings = resource({
    params: () => (this.admin() ? true : undefined),
    loader: () => this.api.settings(),
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly confirmDelete = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly newDate = signal('');
  protected readonly newName = signal('');
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  protected weekday(date: string): string {
    return WEEKDAY_SHORT[isoWeekday(date)];
  }
  protected changeYear(year: number): void {
    if (this.busy()) return;
    this.resetSchool();
    this.suggestionsOpen.set(false);
    this.selectedSuggestions.set(new Set());
    this.schoolError.set(null);
    this.schoolStatus.set(null);
    this.year.set(year);
    this.editing.set(null);
    this.confirmDelete.set(null);
    this.error.set(null);
  }
  protected startRename(day: HolidayView): void {
    this.draft.set(day.name);
    this.editing.set(day.id);
    this.confirmDelete.set(null);
  }
  protected async rename(day: HolidayView): Promise<void> {
    if (!day.editable || !this.draft().trim()) return;
    await this.run(async () => {
      await this.api.updateHoliday(day.id, { name: this.draft().trim() });
      this.editing.set(null);
    }, 'Feiertag umbenannt.');
  }
  protected async toggle(day: HolidayView): Promise<void> {
    if (!day.editable) return;
    await this.run(
      async () => {
        await this.api.updateHoliday(day.id, { active: !day.active });
      },
      day.active ? 'Feiertag abgeschaltet.' : 'Feiertag aktiviert.',
    );
  }
  protected async remove(day: HolidayView): Promise<void> {
    if (!day.editable || day.origin !== 'MANUAL' || this.confirmDelete() !== day.id) return;
    await this.run(async () => {
      await this.api.deleteHoliday(day.id);
      this.confirmDelete.set(null);
    }, 'Feiertag gelöscht.');
  }
  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    if (
      !this.newName().trim() ||
      !this.newDate() ||
      !(event.target as HTMLFormElement).reportValidity()
    )
      return;
    await this.run(async () => {
      const result = await this.api.createHoliday(this.newDate(), this.newName().trim());
      this.year.set(Number(result.date.slice(0, 4)));
      this.newName.set('');
      this.newDate.set('');
    }, 'Feiertag angelegt.');
  }
  protected async changeSetting(event: Event): Promise<void> {
    const checkbox = event.target as HTMLInputElement;
    const checked = checkbox.checked;
    // Den bestätigten Stand bis zur erfolgreichen Antwort beibehalten, auch bei API-Fehlern.
    checkbox.checked = !checked;
    await this.run(async () => {
      this.settings.set(await this.api.updateSettings(checked));
    }, 'Einstellungen gespeichert.');
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
  protected schoolPeriod(holiday: { from: string; to: string }): string {
    const from = formatLocalDate(holiday.from);
    const to = formatLocalDate(holiday.to);
    return `${holiday.from.slice(0, 4) === holiday.to.slice(0, 4) ? from.slice(0, 6) : from}–${to}`;
  }
  protected changeSchool<K extends keyof ReturnType<typeof this.schoolDraft>>(
    key: K,
    value: ReturnType<typeof this.schoolDraft>[K],
  ): void {
    this.schoolDraft.update((draft) => ({ ...draft, [key]: value }));
  }
  protected resetSchool(focus = false): void {
    this.schoolEditing.set(null);
    this.schoolDelete.set(null);
    this.schoolDraft.set({ name: '', from: '', to: '', active: true });
    if (focus) this.focusSchool('#school-name');
  }
  protected editSchool(holiday: SchoolHolidayView): void {
    if (this.busy() || !this.admin()) return;
    this.schoolEditing.set(holiday.id);
    this.schoolDraft.set({
      name: holiday.name,
      from: holiday.from,
      to: holiday.to,
      active: holiday.active,
    });
    this.schoolDelete.set(null);
    this.schoolError.set(null);
    this.schoolStatus.set(null);
    this.focusSchool('#school-name');
  }
  protected askDeleteSchool(holiday: SchoolHolidayView): void {
    if (this.busy() || !this.admin()) return;
    this.schoolDelete.set(holiday);
    this.focusSchool('[data-school-confirm]');
  }
  protected cancelSchoolDelete(): void {
    this.schoolDelete.set(null);
    this.focusSchool('#school-name');
  }
  protected async removeSchool(holiday: SchoolHolidayView): Promise<void> {
    if (this.schoolDelete()?.id !== holiday.id) return;
    await this.runSchool(async () => {
      await this.api.deleteSchoolHoliday(holiday.id);
      if (this.schoolEditing() === holiday.id) this.resetSchool();
      this.schoolDelete.set(null);
    }, 'Schulferien gelöscht.');
  }
  protected async saveSchool(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.schoolValid() || !(event.target as HTMLFormElement).reportValidity()) return;
    const draft = this.schoolDraft();
    const input = { name: draft.name.trim(), from: draft.from, to: draft.to };
    const id = this.schoolEditing();
    await this.runSchool(
      async () => {
        if (id) await this.api.updateSchoolHoliday(id, { ...input, active: draft.active });
        else await this.api.createSchoolHoliday(input);
        this.resetSchool();
      },
      id ? 'Schulferien gespeichert.' : 'Schulferien angelegt.',
    );
  }
  protected openSuggestions(): void {
    if (
      this.busy() ||
      !this.admin() ||
      !this.schoolHolidays.hasValue() ||
      this.schoolHolidays.error()
    )
      return;
    this.selectedSuggestions.set(new Set(this.suggestions().map((suggestion) => suggestion.from)));
    this.suggestionsOpen.set(true);
    this.focusSchool('[data-school-suggestions]');
  }
  protected selectSuggestion(from: string, checked: boolean): void {
    this.selectedSuggestions.update((selected) => {
      const next = new Set(selected);
      if (checked) next.add(from);
      else next.delete(from);
      return next;
    });
  }
  protected async importSuggestions(): Promise<void> {
    const selected = this.suggestions().filter((suggestion) =>
      this.selectedSuggestions().has(suggestion.from),
    );
    if (!selected.length || this.schoolHolidays.isLoading() || this.schoolHolidays.error()) return;
    let existing = 0;
    await this.runSchool(
      async () => {
        for (const suggestion of selected) {
          try {
            const created = await this.api.createSchoolHoliday(suggestion);
            this.schoolHolidays.set([...(this.schoolHolidays.value() ?? []), created]);
          } catch (error) {
            // 409: derselbe Zeitraum ist schon angelegt, etwa aus einem anderen Tab (Review Web, Befund 2).
            if (!(error instanceof ApiError && error.status === 409)) throw error;
            existing++;
          }
          // Erfolgreiche Einträge bleiben auch bei einem späteren Fehler aus der Auswahl entfernt.
          this.selectSuggestion(suggestion.from, false);
        }
        this.suggestionsOpen.set(false);
      },
      () =>
        existing
          ? `Ausgewählte Schulferien übernommen; ${existing} ${existing === 1 ? 'Zeitraum war' : 'Zeiträume waren'} schon angelegt.`
          : 'Ausgewählte Schulferien übernommen.',
    );
  }
  private focusSchool(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
  private async runSchool(
    action: () => Promise<void>,
    message: string | (() => string),
  ): Promise<void> {
    if (this.busy() || !this.admin()) return;
    this.busy.set(true);
    this.schoolError.set(null);
    this.schoolStatus.set(null);
    try {
      await action();
      this.schoolHolidays.reload();
      const text = typeof message === 'function' ? message() : message;
      this.schoolStatus.set(text);
      this.toast.show(text);
    } catch (error) {
      this.schoolError.set(
        error instanceof ApiError
          ? error.message
          : 'Die Schulferien konnten nicht gespeichert werden.',
      );
    } finally {
      this.busy.set(false);
      this.focusSchool('[data-school-result]');
    }
  }
  private async run(action: () => Promise<void>, message: string): Promise<void> {
    if (this.busy() || !this.admin()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.holidays.reload();
      this.toast.show(message);
    } catch (e) {
      this.error.set(
        e instanceof ApiError ? e.message : 'Die Änderung konnte nicht gespeichert werden.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
