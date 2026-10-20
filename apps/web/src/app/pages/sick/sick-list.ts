import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
} from '@angular/core';
import {
  addDays,
  formatLocalDate,
  localDateInBerlin,
  SICK_KIND_LABELS,
  type SickLeaveView,
} from '@as/shared';
import { ApiError, ApiService } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { ExpandableRows, RowToggle } from '../../shared-ui';

type Action = 'extend' | 'certificate' | 'delete';

/** Gemeinsame Aktionen für Heute, Listen und AU-Prüfungen. */
@Component({
  selector: 'app-sick-actions',
  template: `
    <div class="flex flex-wrap gap-2" tabindex="-1" data-actions>
      @if (editable() && !certifyOnly()) {
        <button
          type="button"
          class="btn btn-sm"
          [disabled]="busy()"
          [attr.aria-label]="label('Verlängern')"
          (click)="edit('extend')"
        >
          Verlängern
        </button>
        @if (sick().from <= today() && sick().to >= today()) {
          <button
            type="button"
            class="btn btn-sm"
            [disabled]="busy()"
            [attr.aria-label]="label('Wieder gesund')"
            (click)="recover()"
          >
            Wieder gesund
          </button>
        }
      }
      @if (sick().canCertify) {
        <button
          type="button"
          class="btn btn-sm"
          [disabled]="busy()"
          [attr.aria-label]="label('AU vermerken')"
          (click)="edit('certificate')"
        >
          AU vermerken
        </button>
      }
      @if (admin() && !certifyOnly()) {
        <button
          type="button"
          class="btn btn-sm"
          [disabled]="busy()"
          [attr.aria-label]="label('Löschen')"
          (click)="edit('delete')"
        >
          Löschen
        </button>
      }
    </div>
    @if (action(); as mode) {
      <form class="mt-3 flex min-w-0 flex-col gap-3" (submit)="submit($event)">
        <fieldset class="fields m-0 min-w-0 border-0 p-0" [disabled]="busy()">
          <legend class="mb-2 font-semibold">
            {{
              label(
                mode === 'extend'
                  ? 'Ende ändern'
                  : mode === 'certificate'
                    ? 'AU vermerken'
                    : 'Löschen'
              )
            }}
          </legend>
          @if (mode === 'delete') {
            <label class="field"
              >Begründung für den Fehleintrag
              <textarea
                required
                minlength="3"
                maxlength="200"
                rows="2"
                [value]="reason()"
                (input)="reason.set(value($event))"
              ></textarea>
            </label>
            <p class="hint">
              Bitte keine Gründe oder Diagnosen zur Krankheit angeben. Die Krankmeldung wird
              gelöscht; zugehörige Urlaubsgutschriften werden zurückgenommen.
            </p>
          } @else {
            <label class="field"
              >{{ mode === 'certificate' ? 'AU liegt vor bis' : 'Voraussichtlich bis' }}
              <input
                type="date"
                required
                [value]="until()"
                [min]="mode === 'certificate' ? sick().from : minimumEnd()"
                [max]="mode === 'extend' && !unrestricted() ? maximumEnd() : ''"
                (input)="until.set(value($event))"
              />
            </label>
          }
        </fieldset>
        <div class="flex flex-wrap gap-2">
          <button
            class="btn"
            [class.btn-danger]="mode === 'delete'"
            [disabled]="busy()"
            [attr.aria-label]="
              label(
                mode === 'delete'
                  ? 'Löschen bestätigen'
                  : mode === 'certificate'
                    ? 'AU speichern'
                    : 'Ende speichern'
              )
            "
          >
            {{ mode === 'delete' ? 'Löschen bestätigen' : 'Speichern' }}
          </button>
          @if (mode === 'certificate' && sick().certificateUntil) {
            <button
              type="button"
              class="btn"
              [disabled]="busy()"
              [attr.aria-label]="label('AU-Vermerk entfernen')"
              (click)="clearCertificate()"
            >
              AU-Vermerk entfernen
            </button>
          }
          <button
            type="button"
            class="btn"
            [disabled]="busy()"
            [attr.aria-label]="label('Bearbeitung abbrechen')"
            (click)="cancel()"
          >
            Abbrechen
          </button>
        </div>
      </form>
    }
    @if (error()) {
      <p class="err" role="alert" tabindex="-1" data-error>{{ error() }}</p>
    }
  `,
})
export class SickActions {
  readonly sick = input.required<SickLeaveView>();
  readonly today = input(localDateInBerlin(new Date()));
  readonly certifyOnly = input(false);
  readonly saved = output<void>();
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly admin = computed(() => this.store.hasRole('ADMIN'));
  protected readonly unrestricted = computed(
    () =>
      this.admin() ||
      (this.store.hasRole('LEAD') && this.sick().employeeId !== this.store.session()?.id),
  );
  protected readonly editable = computed(
    () =>
      this.unrestricted() ||
      (this.sick().employeeId === this.store.session()?.id && this.sick().to >= this.today()),
  );
  protected readonly minimumEnd = computed(() =>
    this.unrestricted()
      ? this.sick().from
      : this.sick().from > addDays(this.today(), -1)
        ? this.sick().from
        : addDays(this.today(), -1),
  );
  /**
   * Selbst höchstens 14 Tage voraus verlängern; ein von Vorgesetzten weiter gesetztes Ende darf die
   * Person verkürzen (Review Web, Befund 3; die API prüft die Grenze nur beim Verlängern).
   */
  protected maximumEnd(): string {
    const limit = addDays(this.today(), 14);
    return this.sick().to > limit ? this.sick().to : limit;
  }
  protected readonly action = signal<Action | null>(null);
  protected readonly until = signal('');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected label(action: string): string {
    return `${action}: ${this.sick().employeeName}, ${formatLocalDate(this.sick().from)} – ${formatLocalDate(this.sick().to)}`;
  }
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  protected edit(action: Action): void {
    this.action.set(action);
    this.until.set(
      action === 'certificate' ? (this.sick().certificateUntil ?? this.sick().to) : this.sick().to,
    );
    this.reason.set('');
    this.error.set(null);
    this.focus('form input, form textarea');
  }
  protected cancel(): void {
    this.action.set(null);
    this.error.set(null);
    this.focus('[data-actions] button');
  }
  private focus(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
  protected async recover(): Promise<void> {
    if (!this.editable()) return;
    await this.run(
      () => this.api.updateSick(this.sick().id, { endToday: true }),
      'Wieder gesund gemeldet.',
    );
  }
  protected async clearCertificate(): Promise<void> {
    if (!this.sick().canCertify) return;
    await this.run(() => this.api.certifySick(this.sick().id, null), 'AU-Vermerk entfernt.');
  }
  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || !(event.target as HTMLFormElement).reportValidity()) return;
    const action = this.action();
    if (action === 'delete' && this.admin() && this.reason().trim().length >= 3)
      await this.run(
        () => this.api.deleteSick(this.sick().id, this.reason().trim()),
        'Krankmeldung gelöscht.',
      );
    if (action === 'certificate' && this.sick().canCertify)
      await this.run(() => this.api.certifySick(this.sick().id, this.until()), 'AU vermerkt.');
    if (action === 'extend' && this.editable())
      await this.run(
        () => this.api.updateSick(this.sick().id, { to: this.until() }),
        'Krankmeldung geändert.',
      );
  }
  private async run(action: () => Promise<unknown>, message: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.action.set(null);
      this.toast.show(message);
      this.focus('[data-actions]');
      this.saved.emit();
    } catch (error) {
      this.error.set(
        error instanceof ApiError ? error.message : 'Die Änderung konnte nicht gespeichert werden.',
      );
      this.focus('[data-error]');
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'app-sick-list',
  imports: [NgTemplateOutlet, RowToggle, SickActions],
  host: { class: 'block min-w-0' },
  template: `
    <p tabindex="-1" role="status" data-list-status>{{ status() }}</p>
    <ng-template #actions let-row>
      <app-sick-actions
        [sick]="row"
        [today]="today()"
        [certifyOnly]="checks()"
        (saved)="changed()"
      />
    </ng-template>
    <div class="overflow-x-auto">
      <table class="data-table">
        <thead>
          <tr>
            @if (showPerson()) {
              <th>Person</th>
            }
            <th>Zeitraum</th>
            <th class="col-opt">Art</th>
            <th class="col-opt">AU-Status</th>
            @if (checks()) {
              <th class="col-opt">Fällig seit</th>
            }
            <th class="col-opt">Aktionen</th>
            <th class="col-narrow"><span class="sr-only">Details</span></th>
          </tr>
        </thead>
        <tbody>
          @for (row of items(); track row.id) {
            <tr (click)="rows.onRowClick(row.id, $event)">
              @if (showPerson()) {
                <td>{{ row.employeeName }}</td>
              }
              <td>{{ date(row.from) }} –<wbr /> {{ date(row.to) }}</td>
              <td class="col-opt">
                {{ labels[row.kind] }}
                @if (row.sinceLocal) {
                  <div>seit {{ row.sinceLocal }} Uhr</div>
                }
              </td>
              <td class="col-opt">{{ certificate(row) }}</td>
              @if (checks()) {
                <td class="col-opt">{{ row.certificateDue ? date(row.certificateDue) : '–' }}</td>
              }
              <td class="col-opt">
                <ng-container
                  [ngTemplateOutlet]="actions"
                  [ngTemplateOutletContext]="{ $implicit: row }"
                />
              </td>
              <td class="col-narrow">
                <app-row-toggle
                  [open]="rows.isOpen(row.id)"
                  [label]="
                    'Details zu ' + row.employeeName + ', ' + date(row.from) + ' – ' + date(row.to)
                  "
                  (toggled)="rows.toggle(row.id)"
                />
              </td>
            </tr>
            @if (rows.isOpen(row.id)) {
              <tr class="row-details">
                <td [attr.colspan]="5 + (showPerson() ? 1 : 0) + (checks() ? 1 : 0)">
                  <dl class="details">
                    <dt>Art</dt>
                    <dd>
                      {{ labels[row.kind] }}
                      @if (row.sinceLocal) {
                        <span> seit {{ row.sinceLocal }} Uhr</span>
                      }
                    </dd>
                    <dt>AU-Status</dt>
                    <dd>{{ certificate(row) }}</dd>
                    @if (checks()) {
                      <dt>Fällig seit</dt>
                      <dd>{{ row.certificateDue ? date(row.certificateDue) : '–' }}</dd>
                    }
                    <dt>Aktionen</dt>
                    <dd>
                      <ng-container
                        [ngTemplateOutlet]="actions"
                        [ngTemplateOutletContext]="{ $implicit: row }"
                      />
                    </dd>
                  </dl>
                </td>
              </tr>
            }
          } @empty {
            <tr>
              <td [attr.colspan]="5 + (showPerson() ? 1 : 0) + (checks() ? 1 : 0)">
                Keine Krankmeldungen.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class SickList {
  readonly items = input.required<readonly SickLeaveView[]>();
  readonly showPerson = input(false);
  readonly checks = input(false);
  readonly today = input(localDateInBerlin(new Date()));
  readonly saved = output<void>();
  protected readonly rows = new ExpandableRows();
  protected readonly date = formatLocalDate;
  protected readonly labels = SICK_KIND_LABELS;
  protected readonly status = signal('');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected certificate(row: SickLeaveView): string {
    const until = row.certificateUntil
      ? `AU liegt vor bis ${formatLocalDate(row.certificateUntil)}. `
      : '';
    return (
      until +
      (row.certificateMissing
        ? 'AU fehlt'
        : row.certificateDue && (!row.certificateUntil || row.certificateUntil < row.to)
          ? `AU fällig am ${formatLocalDate(row.certificateDue)}`
          : row.certificateUntil
            ? ''
            : 'Keine AU erforderlich')
    );
  }
  protected changed(): void {
    this.status.set('Krankmeldungen aktualisiert.');
    this.saved.emit();
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[data-list-status]')?.focus(),
      { injector: this.injector },
    );
  }
}
