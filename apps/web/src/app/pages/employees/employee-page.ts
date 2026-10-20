import {
  afterNextRender,
  Injector,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  localDateInBerlin,
  addDays,
  isLocalDate,
  formatHalfDays,
  formatHoursMinutes,
  formatLocalDate,
  ROLES,
  ROLE_LABELS,
  type AdminEmployeeView,
  type EmployeeCreateInput,
  type EmployeeUpdateInput,
  type ApiMessage,
  type Role,
  type TermsInput,
} from '@as/shared';
import { isYouthOn } from '@as/time-rules';
import { ApiError, ApiService } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { ExpandableRows, RowToggle, PageHead, RuleMessages } from '../../shared-ui';
import { EmployeeErrors } from './employee-errors';
import { TermsForm } from './terms-form';
import { TermsHistory } from './terms-history';
import { LeaveLedger } from './leave-ledger';

type MasterData = Omit<EmployeeCreateInput, 'terms' | 'carryOverDays'>;

/** Eigenständiger Zusatz zum Mitarbeiterformular; Stammdaten bleiben davon unabhängig. */
/** AU-Einstellung separat speichern, ohne ungespeicherte Stammdaten zu verwerfen. */
@Component({
  selector: 'app-certificate-requirement',
  template: `
    <form (submit)="save($event)">
      <label class="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          [checked]="value() === true"
          [indeterminate]="value() === null"
          [disabled]="busy()"
          (change)="value.set(checked($event))"
        />
        AU ab dem 1. Krankheitstag verlangen
      </label>
      <p class="text-sm text-muted">§ 5 Abs. 1 Satz 3 EFZG</p>
      @if (confirmed() === null) {
        <p class="hint">
          Die aktuelle AU-Pflicht ist nicht verfügbar. Du kannst sie hier neu festlegen.
        </p>
      }
      <button class="btn" [disabled]="busy() || value() === null || value() === confirmed()">
        AU-Pflicht speichern
      </button>
      <div tabindex="-1" data-result>
        @if (error()) {
          <p class="err" role="alert">{{ error() }}</p>
        }
        @if (status()) {
          <p role="status">{{ status() }}</p>
        }
      </div>
    </form>
  `,
})
export class CertificateRequirement {
  readonly employeeId = input.required<string>();
  readonly initialValue = input<boolean | null>(null);
  private readonly api = inject(ApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly confirmed = linkedSignal(() => {
    this.employeeId();
    return this.initialValue();
  });
  protected readonly value = linkedSignal(() => this.confirmed());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);
  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const value = this.value();
    if (this.busy() || value === null || value === this.confirmed()) return;
    this.busy.set(true);
    this.error.set(null);
    this.status.set(null);
    try {
      const result = await this.api.setCertificateFromDay1(this.employeeId(), value);
      this.confirmed.set(result.value);
      this.value.set(result.value);
      this.status.set('AU-Pflicht gespeichert.');
    } catch (error) {
      this.error.set(
        error instanceof ApiError
          ? error.message
          : 'Die AU-Pflicht konnte nicht gespeichert werden.',
      );
    } finally {
      this.busy.set(false);
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('[data-result]')?.focus(),
        { injector: this.injector },
      );
    }
  }
}

@Component({
  selector: 'app-overtime-account',
  imports: [RowToggle, EmployeeErrors],
  template: `
    <section class="card">
      <h2>Überstundenkonto</h2>
      @if (minijob()) {
        <p class="hint m-0">Für Minijobs gibt es kein Überstundenkonto.</p>
      } @else if (account.hasValue()) {
        @let current = account.value();
        <p class="m-0">
          @if (current) {
            seit <span class="font-mono">{{ dateLabel(current.since) }}</span
            >, Saldo <span class="font-mono">{{ balance(current.balanceMinutes) }} Std.</span>
          } @else {
            nicht aktiviert
          }
        </p>
        <form class="fields" (submit)="activate($event)">
          <label class="field" for="overtime-since"
            >Konto führen ab<input
              id="overtime-since"
              type="date"
              required
              [disabled]="busy() || !!current"
              [value]="since()"
              (input)="since.set(value($event))"
          /></label>
          <div>
            @if (current) {
              <button class="btn btn-danger" type="button" [disabled]="busy()" (click)="end()">
                Beenden
              </button>
            } @else {
              <button
                class="btn btn-primary"
                type="submit"
                [disabled]="busy() || !validDate(since())"
              >
                Aktivieren
              </button>
            }
          </div>
        </form>
        @if (current) {
          <h3 class="m-0 font-semibold">Korrekturbuchung</h3>
          <form id="overtime-adjustment-form" class="fields" (submit)="adjust($event)">
            <label class="field" for="overtime-minutes"
              >Stunden und Minuten<input
                id="overtime-minutes"
                class="font-mono"
                required
                placeholder="+1:30 oder -0:45"
                [disabled]="busy()"
                [value]="amount()"
                (input)="amount.set(value($event))"
                aria-describedby="overtime-format"
              /><span id="overtime-format">Mit Vorzeichen, z. B. +1:30 oder -0:45.</span></label
            >
            <label class="field" for="overtime-date"
              >Stichtag<input
                id="overtime-date"
                type="date"
                required
                [disabled]="busy()"
                [value]="effectiveOn()"
                (input)="effectiveOn.set(value($event))"
            /></label>
            <label class="field col-span-full" for="overtime-reason"
              >Begründung (Pflicht)<textarea
                id="overtime-reason"
                required
                maxlength="2000"
                [disabled]="busy()"
                [value]="reason()"
                (input)="reason.set(value($event))"
              ></textarea>
            </label>
            <div class="col-span-full">
              <button
                class="btn btn-primary"
                type="submit"
                [disabled]="busy() || !adjustmentValid()"
              >
                Korrekturbuchung speichern
              </button>
            </div>
          </form>
          <div class="overflow-x-auto">
            <table class="data-table">
              <caption class="sr-only">
                Korrekturbuchungen des Überstundenkontos
              </caption>
              <thead>
                <tr>
                  <th>Stichtag</th>
                  <th>Stunden</th>
                  <th class="col-opt">Begründung</th>
                  <th class="col-narrow"><span class="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                @for (adjustment of current.adjustments; track adjustment.id) {
                  <tr (click)="rows.onRowClick(adjustment.id, $event)">
                    <td class="font-mono">{{ dateLabel(adjustment.effectiveOn) }}</td>
                    <td class="font-mono">{{ balance(adjustment.minutes) }}</td>
                    <td class="col-opt">{{ adjustment.reason }}</td>
                    <td class="col-narrow">
                      <app-row-toggle
                        [open]="rows.isOpen(adjustment.id)"
                        [label]="
                          'Details zu ' +
                          dateLabel(adjustment.effectiveOn) +
                          ', ' +
                          balance(adjustment.minutes)
                        "
                        (toggled)="rows.toggle(adjustment.id)"
                      />
                    </td>
                  </tr>
                  @if (rows.isOpen(adjustment.id)) {
                    <tr class="row-details">
                      <td colspan="4">
                        <dl class="details">
                          <dt>Begründung</dt>
                          <dd>{{ adjustment.reason }}</dd>
                        </dl>
                      </td>
                    </tr>
                  }
                } @empty {
                  <tr>
                    <td colspan="4" class="text-muted">Noch keine Korrekturbuchungen.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      } @else if (account.error()) {
        <app-employee-errors [error]="account.error()" />
        <div>
          <button class="btn" type="button" (click)="account.reload()">
            Überstundenkonto erneut laden
          </button>
        </div>
      } @else {
        <p class="m-0 text-muted" role="status">Überstundenkonto wird geladen …</p>
      }
      <app-employee-errors [error]="error()" />
    </section>
  `,
})
export class OvertimeAccount {
  protected readonly rows = new ExpandableRows();
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly employeeId = input.required<string>();
  readonly minijob = input(false);
  protected readonly account = resource({
    params: () => (this.minijob() ? undefined : this.employeeId()),
    loader: ({ params }) => this.api.overtime(params),
  });
  protected readonly today = localDateInBerlin(new Date());
  protected readonly since = linkedSignal(() =>
    this.account.hasValue() ? (this.account.value()?.since ?? this.today) : this.today,
  );
  protected readonly amount = signal('');
  protected readonly effectiveOn = signal(this.today);
  protected readonly reason = signal('');
  protected readonly minutes = computed(() => {
    const match = /^([+-]?)(\d+):([0-5]\d)$/.exec(this.amount().trim());
    if (!match) return null;
    const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1);
    return Number.isSafeInteger(minutes) && Math.abs(minutes) <= 2147483647 ? minutes : null;
  });
  protected readonly adjustmentValid = computed(
    () =>
      this.minutes() !== null &&
      this.minutes() !== 0 &&
      isLocalDate(this.effectiveOn()) &&
      !!this.reason().trim(),
  );
  protected readonly busy = signal(false);
  protected readonly error = signal<unknown>(null);
  protected readonly validDate = isLocalDate;
  protected readonly dateLabel = formatLocalDate;
  protected balance(minutes: number): string {
    return (minutes > 0 ? '+' : '') + formatHoursMinutes(minutes);
  }
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  protected async activate(event: Event): Promise<void> {
    event.preventDefault();
    if (!isLocalDate(this.since()) || !this.account.hasValue() || this.account.value()) return;
    await this.run(async () => {
      this.account.set(await this.api.setOvertimeAccount(this.employeeId(), this.since()));
      this.toast.show('Überstundenkonto aktiviert.');
    });
  }
  protected async end(): Promise<void> {
    await this.run(async () => {
      this.account.set(await this.api.setOvertimeAccount(this.employeeId(), null));
      this.toast.show('Überstundenkonto beendet.');
    });
  }
  protected async adjust(event: Event): Promise<void> {
    event.preventDefault();
    const minutes = this.minutes();
    if (
      !this.adjustmentValid() ||
      minutes === null ||
      !this.account.hasValue() ||
      !this.account.value()
    )
      return;
    await this.run(async () => {
      this.account.set(
        await this.api.addOvertimeAdjustment(this.employeeId(), {
          minutes,
          effectiveOn: this.effectiveOn(),
          reason: this.reason().trim(),
        }),
      );
      this.amount.set('');
      this.reason.set('');
      this.toast.show('Korrekturbuchung gespeichert.');
    });
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy() || this.minijob()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(error);
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  host: { class: 'flex min-w-0 flex-col gap-5' },
  selector: 'app-employee-page',
  imports: [
    CertificateRequirement,
    RuleMessages,
    PageHead,
    RouterLink,
    TermsForm,
    TermsHistory,
    EmployeeErrors,
    OvertimeAccount,
    LeaveLedger,
  ],
  template: `
    <app-page-head
      [heading]="id() ? 'Mitarbeiter bearbeiten' : 'Mitarbeiter anlegen'"
      lead="Stammdaten und Vertragsstände verwalten."
    >
      <a routerLink="/mitarbeiter" class="btn no-underline">Zur Liste</a>
    </app-page-head>
    @if (employee.error()) {
      <app-employee-errors [error]="employee.error()" />
    } @else if (!id() || employee.hasValue()) {
      <app-rule-messages [messages]="warnings()" level="warn" />
      <section class="card">
        <h2>Stammdaten</h2>
        <form #masterForm novalidate (submit)="saveMaster($event)">
          <fieldset class="fields m-0 min-w-0 border-0 p-0" [disabled]="busy()">
            <label class="field" for="employee-name"
              >Name<input
                id="employee-name"
                maxlength="120"
                required
                [value]="draft().name"
                (input)="change('name', value($event))"
            /></label>
            <label class="field" for="employee-job"
              >Funktion<input
                id="employee-job"
                maxlength="120"
                [value]="draft().jobTitle ?? ''"
                (input)="change('jobTitle', value($event) || null)"
            /></label>
            <label class="field col-span-full" for="employee-email"
              >Anmeldeadresse<input
                id="employee-email"
                type="email"
                maxlength="254"
                required
                [value]="draft().loginEmail"
                (input)="change('loginEmail', value($event))"
              /><span
                >Darf eine private Adresse sein. Nur für Anmeldung und Benachrichtigungen, nur für
                den Admin sichtbar.</span
              ></label
            >
            <label class="field" for="employee-role"
              >Rolle<select id="employee-role" [value]="draft().role" (change)="changeRole($event)">
                @for (role of roles; track role) {
                  <option [value]="role">{{ roleLabels[role] }}</option>
                }
              </select></label
            >
            <label class="field" for="employee-lead"
              >Vorgesetzte/r<select
                id="employee-lead"
                [value]="draft().leadId ?? ''"
                [required]="draft().role !== 'ADMIN'"
                (change)="change('leadId', value($event) || null)"
              >
                <option value="" [disabled]="draft().role !== 'ADMIN'">
                  {{ draft().role === 'ADMIN' ? 'keine' : 'Bitte wählen' }}
                </option>
                @for (person of managers(); track person.id) {
                  <option [value]="person.id">{{ person.name }}</option>
                }
              </select></label
            >
            <label class="field" for="employee-deputy"
              >Vertretung (optional)<select
                id="employee-deputy"
                [value]="draft().deputyId ?? ''"
                (change)="change('deputyId', value($event) || null)"
              >
                <option value="">keine</option>
                @for (person of managers(); track person.id) {
                  <option [value]="person.id">{{ person.name }}</option>
                }
              </select></label
            >
            <label class="field" for="employee-entry"
              >Eintritt<input
                id="employee-entry"
                type="date"
                required
                [value]="draft().entryDate"
                (input)="change('entryDate', value($event))"
            /></label>
            <label class="field" for="employee-exit"
              >Austritt (optional)<input
                id="employee-exit"
                type="date"
                [min]="draft().entryDate"
                [value]="draft().exitDate ?? ''"
                (input)="change('exitDate', value($event) || null)"
            /></label>
            <label class="field" for="employee-birth"
              >Geburtsdatum<input
                id="employee-birth"
                type="date"
                [value]="draft().birthDate ?? ''"
                (input)="change('birthDate', value($event) || null)"
            /></label>
            <label class="field" for="employee-school"
              >Vollzeitschulpflichtig bis<input
                id="employee-school"
                type="date"
                [value]="draft().fullTimeSchoolUntil ?? ''"
                (input)="change('fullTimeSchoolUntil', value($event) || null)"
            /></label>
            <p class="col-span-full text-sm text-muted">
              Nur für den Admin sichtbar. Für Personen unter 18 gelten die Regeln des
              Jugendarbeitsschutzgesetzes; bei Vollzeitschulpflicht ist Arbeit nur in den
              Schulferien erlaubt, höchstens 20 Arbeitstage im Jahr.
            </p>
            @if (youthUntil(); as until) {
              <p class="hint col-span-full" role="status">
                Jugendarbeitsschutz gilt bis {{ until }}
              </p>
            }
            @if (!id()) {
              <label class="field" for="employee-carry"
                >Übertrag Vorjahr (Tage)<input
                  id="employee-carry"
                  type="number"
                  min="0"
                  max="60"
                  step="1"
                  required
                  [value]="carryOver()"
                  (input)="carryOver.set(number($event))"
              /></label>
            }
            @if (id()) {
              <div class="col-span-full">
                <button type="submit" class="btn btn-primary" [disabled]="busy() || !masterValid()">
                  Speichern
                </button>
              </div>
            }
          </fieldset>
        </form>
        @if (people.error()) {
          <p class="err" role="alert">Vorgesetzte und Vertretungen konnten nicht geladen werden.</p>
          <button type="button" class="btn" (click)="people.reload()">Erneut versuchen</button>
        }
        @if (id()) {
          <app-employee-errors [error]="error()" />
        }
      </section>
      @if (!id()) {
        <section class="card">
          <h2>Vertragsstand</h2>
          <app-terms-form
            [defaultDate]="draft().entryDate"
            [birthDate]="draft().birthDate ?? null"
            [busy]="busy()"
            [disabled]="!masterValid() || !carryValid()"
            (saved)="create($event)"
          /><app-employee-errors [error]="error()" />
        </section>
      } @else if (current(); as person) {
        @if (overtimeAllowed()) {
          <section class="card">
            <h2>Arbeitsunfähigkeitsbescheinigung</h2>
            <app-certificate-requirement
              [employeeId]="person.id"
              [initialValue]="certificateInitial(person)"
            />
          </section>
        }
        <section class="card">
          <h2>
            Status
            <span
              class="pill"
              [class.lv-ok]="person.status === 'ACTIVE'"
              [class.lv-crit]="person.status === 'LOCKED'"
              [class.lv-mute]="person.status === 'EXITED'"
              >{{ statuses[person.status] }}</span
            >
          </h2>
          <p class="m-0 text-[13px] text-muted">
            Sperren beendet alle Anmeldungen sofort. Nach dem Austritt ist die Anmeldung ab dem
            Folgetag automatisch gesperrt.
          </p>
          @if (person.status !== 'EXITED') {
            <div>
              <button
                type="button"
                class="btn"
                [class.btn-danger]="person.status === 'ACTIVE'"
                [disabled]="busy()"
                (click)="toggleLock(person)"
              >
                {{ person.status === 'LOCKED' ? 'Entsperren' : 'Sperren' }}
              </button>
            </div>
          } @else {
            <p class="hint m-0">
              Für eine erneute Anmeldung muss das Austrittsdatum angepasst werden.
            </p>
          }
        </section>
        <section class="card">
          <h2>Übertrag aus {{ carryYear() - 1 }} ins Jahr {{ carryYear() }}</h2>
          <form class="fields" (submit)="saveCarry($event)">
            <label class="field" for="employee-carry-year"
              >Übertragsjahr
              <select
                id="employee-carry-year"
                [value]="carryYear()"
                [disabled]="busy()"
                (change)="carryYear.set(+value($event))"
              >
                <option [value]="year">{{ year }}</option>
                <option [value]="year + 1">{{ year + 1 }}</option>
              </select>
            </label>
            <label class="field" for="employee-carry"
              >Übertrag (Tage)<input
                id="employee-carry"
                type="number"
                min="0"
                max="60"
                step="1"
                required
                [disabled]="busy() || !carryLoaded()"
                [value]="carryOver()"
                (input)="carryOver.set(number($event))"
            /></label>
            <div>
              <button type="submit" class="btn btn-primary" [disabled]="busy() || !carryValid()">
                Übertrag speichern
              </button>
            </div>
          </form>
          @if (carryNoticeWarning()) {
            <p class="hint m-0" role="status">
              Ohne rechtzeitigen Urlaubshinweis darf Resturlaub nicht verfallen. Übertrage den
              vollen Rest oder sende zuerst einen Hinweis.
            </p>
          }
          @if (carryNotices.error()) {
            <p class="err m-0" role="alert">
              Der rechtzeitige Urlaubshinweis konnte nicht geprüft werden.
            </p>
            <div>
              <button type="button" class="btn" (click)="carryNotices.reload()">
                Urlaubshinweise erneut laden
              </button>
            </div>
          } @else if (carryNotices.isLoading()) {
            <p class="text-muted m-0" role="status">Urlaubshinweise werden geprüft …</p>
          }
          @if (carryYear() !== year && futureCarry.error()) {
            <p class="err m-0" role="alert">Der Übertrag konnte nicht geladen werden.</p>
            <div>
              <button type="button" class="btn" (click)="futureCarry.reload()">
                Erneut versuchen
              </button>
            </div>
          }
          @if (carrySuggestion.error()) {
            <p class="text-muted m-0">Der Übertragsvorschlag konnte nicht geladen werden.</p>
            <div>
              <button type="button" class="btn" (click)="carrySuggestion.reload()">
                Vorschlag erneut laden
              </button>
            </div>
          } @else if (carrySuggestion.hasValue()) {
            @let previous = carrySuggestion.value();
            <p class="hint m-0">
              Rechnerischer Rest {{ previous.year }}: {{ halfDays(previous.rest) }} Tage. Es werden
              nur ganze, nicht negative Tage übernommen.
              @if (previous.rest % 2 !== 0) {
                Ein halber Tag wird nicht übernommen (auf ganze Tage abgerundet).
              }
            </p>
            <div>
              <button
                type="button"
                class="btn"
                [disabled]="busy() || !carryLoaded()"
                (click)="applyCarrySuggestion()"
              >
                Übernehmen
              </button>
            </div>
          } @else {
            <p class="text-muted m-0" role="status">Übertragsvorschlag wird geladen …</p>
          }
        </section>
        <app-leave-ledger
          [employeeId]="person.id"
          [refresh]="leaveRefresh()"
          (booked)="carrySuggestion.reload()"
        />
        <app-terms-history
          [employeeId]="person.id"
          [entryDate]="person.entryDate"
          [birthDate]="person.birthDate"
          (changed)="termsChanged()"
        />
        @if (overtimeAllowed()) {
          <app-overtime-account
            [employeeId]="person.id"
            [minijob]="person.currentTerms?.type === 'MINIJOB'"
          />
        }
      }
    } @else {
      <p class="text-muted" role="status">Mitarbeiter wird geladen …</p>
    }
  `,
})
export class EmployeePage {
  protected certificateInitial(person: AdminEmployeeView): boolean {
    return person.certificateFromDay1;
  }
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly store = inject(SessionStore);
  protected readonly overtimeAllowed = computed(() => this.store.hasRole('ADMIN'));
  private readonly params = toSignal(inject(ActivatedRoute).paramMap);
  protected readonly id = computed(() => this.params()?.get('id') ?? null);
  protected readonly employee = resource({
    params: () => this.id() ?? undefined,
    loader: ({ params }) => this.api.employee(params),
  });
  protected readonly current = computed(() =>
    this.employee.hasValue() ? this.employee.value() : null,
  );
  /**
   * Warnungen der Mitarbeiteransicht. Nach Vertragsänderungen nur sie neu laden, damit ein ungespeicherter
   * Entwurf der Stammdaten erhalten bleibt (Review Web Phase 7, Befund 1).
   */
  protected readonly warnings = linkedSignal<ApiMessage[]>(() => this.current()?.warnings ?? []);
  protected readonly people = resource({ loader: () => this.api.employees() });
  protected readonly managers = computed(() =>
    this.people.hasValue()
      ? this.people
          .value()
          .filter((p) => p.id !== this.id() && (p.role === 'ADMIN' || p.role === 'LEAD'))
      : [],
  );
  protected readonly today = localDateInBerlin(new Date());
  protected readonly year = Number(this.today.slice(0, 4));
  protected readonly draft = linkedSignal<MasterData>(() => {
    const person = this.current();
    return person
      ? this.masterData(person)
      : {
          name: '',
          jobTitle: null,
          loginEmail: '',
          role: 'EMPLOYEE',
          leadId: this.store.session()?.id ?? null,
          deputyId: null,
          entryDate: this.today,
          exitDate: null,
          birthDate: null,
          fullTimeSchoolUntil: null,
        };
  });
  protected readonly youthUntil = computed(() => {
    const birthDate = this.draft().birthDate;
    if (!birthDate || !isLocalDate(birthDate) || !isYouthOn(birthDate, this.today)) return null;
    // 18. Geburtstag; am 29.02. geboren → im Nichtschaltjahr der 01.03. (wie `ageOn`).
    const year = Number(birthDate.slice(0, 4)) + 18;
    const candidate = `${year}${birthDate.slice(4)}`;
    const birthday = isLocalDate(candidate) ? candidate : `${year}-03-01`;
    return formatLocalDate(addDays(birthday, -1));
  });
  protected readonly carryYear = signal(this.year);
  protected readonly leaveRefresh = signal(0);
  protected readonly halfDays = formatHalfDays;
  protected readonly carrySuggestion = resource({
    params: () => {
      const id = this.id();
      return id ? { id, year: this.carryYear() - 1 } : undefined;
    },
    loader: ({ params }) => this.api.leaveAccount(params.year, params.id),
  });
  protected readonly carryNotices = resource({
    params: () => {
      const employeeId = this.id();
      return employeeId ? { employeeId, year: this.carryYear() - 1 } : undefined;
    },
    loader: ({ params }) => this.api.leaveNotices(params),
  });
  protected readonly decisiveNotice = computed(() => {
    if (!this.carryNotices.hasValue()) return null;
    const forfeitsOn = `${this.carryYear() - 1}-12-31`;
    return (
      [...this.carryNotices.value()]
        .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
        .find((n) => localDateInBerlin(new Date(n.sentAt)) <= forfeitsOn) ?? null
    );
  });
  protected readonly carryNoticeWarning = computed(
    () =>
      this.carryLoaded() &&
      this.carrySuggestion.hasValue() &&
      this.carryNotices.hasValue() &&
      Number.isFinite(this.carryOver()) &&
      this.carryOver() * 2 < this.carrySuggestion.value().rest &&
      // Maßgeblich ist der letzte Hinweis vor dem Verfallstag 31.12. (wie im Backend, Befund 1).
      !this.decisiveNotice()?.timelyForYearEnd,
  );
  protected readonly futureCarry = resource({
    params: () => {
      const id = this.id();
      return id && this.carryYear() !== this.year ? { id, year: this.carryYear() } : undefined;
    },
    loader: ({ params }) => this.api.leaveAccount(params.year, params.id),
  });
  protected readonly carryLoaded = computed(
    () =>
      this.carryYear() === this.year || (this.futureCarry.hasValue() && !this.futureCarry.error()),
  );
  protected readonly carryOver = linkedSignal(() => {
    if (this.carryYear() !== this.year)
      return this.futureCarry.hasValue() ? this.futureCarry.value().carryOver / 2 : 0;
    const carry = this.current()?.carryOver;
    return carry?.year === this.year ? carry.days : 0;
  });
  protected readonly carryValid = computed(
    () =>
      this.carryLoaded() &&
      Number.isInteger(this.carryOver()) &&
      this.carryOver() >= 0 &&
      this.carryOver() <= 60,
  );
  protected readonly masterValid = computed(() => {
    const d = this.draft();
    return (
      !!d.name.trim() &&
      !!d.loginEmail.trim() &&
      !!d.entryDate &&
      (d.role === 'ADMIN' || !!d.leadId) &&
      (!d.exitDate || d.exitDate >= d.entryDate)
    );
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<unknown>(null);
  protected readonly roles = ROLES;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly statuses = { ACTIVE: 'Aktiv', LOCKED: 'Gesperrt', EXITED: 'Ausgetreten' };
  private readonly masterForm = viewChild<ElementRef<HTMLFormElement>>('masterForm');
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  protected number(event: Event): number {
    return (event.target as HTMLInputElement).valueAsNumber;
  }
  protected change<K extends keyof MasterData>(key: K, value: MasterData[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }
  protected changeRole(event: Event): void {
    this.change('role', this.value(event) as Role);
  }
  private masterData(person: MasterData): MasterData {
    return {
      name: person.name.trim(),
      jobTitle: person.jobTitle?.trim() || null,
      loginEmail: person.loginEmail.trim().toLowerCase(),
      role: person.role,
      leadId: person.leadId,
      deputyId: person.deputyId,
      entryDate: person.entryDate,
      exitDate: person.exitDate,
      birthDate: person.birthDate ?? null,
      fullTimeSchoolUntil: person.fullTimeSchoolUntil ?? null,
    };
  }
  protected async create(terms: TermsInput): Promise<void> {
    if (
      this.busy() ||
      !this.masterValid() ||
      !this.carryValid() ||
      !this.masterForm()?.nativeElement.reportValidity()
    )
      return;
    await this.run(async () => {
      const result = await this.api.createEmployee({
        ...this.masterData(this.draft()),
        terms,
        carryOverDays: this.carryOver(),
      });
      this.toast.show(`${result.name} gespeichert.`);
      await this.router.navigateByUrl('/mitarbeiter');
    });
  }
  protected async saveMaster(event: Event): Promise<void> {
    event.preventDefault();
    const person = this.current();
    if (
      !person ||
      this.busy() ||
      !this.masterValid() ||
      !this.masterForm()?.nativeElement.reportValidity()
    )
      return;
    const data = this.masterData(this.draft());
    const changes: EmployeeUpdateInput = Object.fromEntries(
      Object.entries(data).filter(
        ([key, value]) => value !== (person[key as keyof MasterData] ?? null),
      ),
    );
    if (!Object.keys(changes).length) return;
    await this.run(async () => {
      const carryDraft = this.carryOver();
      const result = await this.api.updateEmployee(person.id, changes);
      this.employee.set(result);
      this.carryOver.set(carryDraft);
      this.people.reload();
      // Ein- und Austritt sowie das Geburtsdatum ändern den Urlaubsanspruch.
      if ('entryDate' in changes || 'exitDate' in changes || 'birthDate' in changes)
        this.leaveChanged();
      this.toast.show(`${result.name} gespeichert.`);
    });
  }
  protected async toggleLock(person: AdminEmployeeView): Promise<void> {
    await this.run(async () => {
      const masterDraft = this.draft();
      const carryDraft = this.carryOver();
      const result =
        person.status === 'LOCKED'
          ? await this.api.unlockEmployee(person.id)
          : await this.api.lockEmployee(person.id);
      this.employee.set(result);
      this.draft.set(masterDraft);
      this.carryOver.set(carryDraft);
      this.toast.show(
        person.status === 'LOCKED' ? 'Mitarbeiter entsperrt.' : 'Mitarbeiter gesperrt.',
      );
    });
  }
  protected async termsChanged(): Promise<void> {
    this.leaveChanged();
    const id = this.id();
    if (!id) return;
    try {
      const fresh = await this.api.employee(id);
      if (this.id() === id) this.warnings.set(fresh.warnings);
    } catch {
      // Die Warnungen bleiben bis zum nächsten Laden stehen; der Vertragsstand ist gespeichert.
    }
  }
  /** Urlaubskonto und Übertragsvorschlag nach urlaubsrelevanten Änderungen neu laden. */
  protected leaveChanged(): void {
    this.leaveRefresh.update((value) => value + 1);
    this.carrySuggestion.reload();
    this.futureCarry.reload();
  }
  protected applyCarrySuggestion(): void {
    if (
      this.busy() ||
      !this.carryLoaded() ||
      !this.carrySuggestion.hasValue() ||
      this.carrySuggestion.error()
    )
      return;
    this.carryOver.set(Math.max(0, Math.floor(this.carrySuggestion.value().rest / 2)));
  }
  protected async saveCarry(event: Event): Promise<void> {
    event.preventDefault();
    const person = this.current();
    if (!person || !this.carryValid()) return;
    await this.run(async () => {
      const masterDraft = this.draft();
      const carryOver = await this.api.setCarryOver(person.id, this.carryYear(), this.carryOver());
      if (this.carryYear() === this.year) this.employee.set({ ...person, carryOver });
      else if (this.futureCarry.hasValue())
        this.futureCarry.set({ ...this.futureCarry.value(), carryOver: carryOver.days * 2 });
      this.leaveRefresh.update((value) => value + 1);
      this.draft.set(masterDraft);
      this.toast.show('Übertrag gespeichert.');
    });
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (e) {
      this.error.set(e);
    } finally {
      this.busy.set(false);
    }
  }
}
