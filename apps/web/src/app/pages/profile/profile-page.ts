import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  inject,
  Injector,
  resource,
  signal,
  afterNextRender,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { localDateInBerlin, type PasskeyView } from '@as/shared';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { ApiError, ApiService } from '../../core/api.service';
import { LocalDatePipe, RoleLabelPipe } from '../../core/format.pipes';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { ExpandableRows, RowToggle, PageHead } from '../../shared-ui';
import { ReminderSettings } from './reminder-settings';

function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android-Gerät';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows-PC';
  return 'Mein Gerät';
}

/** Zeitstempel als Kalendertag in Europe/Berlin (CLAUDE.md: in Berlin anzeigen). */
function berlinDay(iso: string | null): string | null {
  return iso ? localDateInBerlin(new Date(iso)) : null;
}

@Component({
  selector: 'app-profile-page',
  imports: [RowToggle, NgTemplateOutlet, PageHead, LocalDatePipe, RoleLabelPipe, ReminderSettings],
  template: `
    <ng-template #passkeyActions let-p>
      @if (editing() === p.id) {
        <button type="button" class="btn btn-sm btn-primary" (click)="rename(p)">Speichern</button>
        <button type="button" class="btn btn-sm ml-1" (click)="stopEditing(p)">Abbrechen</button>
      } @else if (confirmDelete() === p.id) {
        <button
          data-confirm-delete
          type="button"
          class="btn btn-sm btn-danger"
          [attr.aria-label]="'Passkey ' + p.name + ' wirklich löschen'"
          (click)="remove(p)"
        >
          Wirklich löschen
        </button>
        <button type="button" class="btn btn-sm ml-1" (click)="stopConfirm(p)">Abbrechen</button>
      } @else {
        <button
          type="button"
          class="btn btn-sm"
          [attr.data-passkey-action]="p.id"
          [attr.aria-label]="'Passkey ' + p.name + ' umbenennen'"
          (click)="startRename(p, $event)"
        >
          Umbenennen
        </button>
        <button
          type="button"
          class="btn btn-sm ml-1"
          [attr.aria-label]="'Passkey ' + p.name + ' löschen'"
          (click)="startConfirm(p, $event)"
        >
          Löschen
        </button>
      }
    </ng-template>
    <app-page-head heading="Profil" lead="Deine Daten, deine Passkeys und deine Anmeldungen." />

    <section class="card">
      <h2>Meine Daten</h2>
      @if (profile.hasValue()) {
        @let me = profile.value();
        <dl class="fields m-0">
          <div class="field">
            <dt>Name</dt>
            <dd class="m-0 text-fg">{{ me.name }}</dd>
          </div>
          <div class="field">
            <dt>Funktion</dt>
            <dd class="m-0 text-fg">{{ me.jobTitle ?? '–' }}</dd>
          </div>
          <div class="field">
            <dt>Rolle</dt>
            <dd class="m-0 text-fg">{{ me.role | roleLabel }}</dd>
          </div>
          <div class="field">
            <dt>Vorgesetzte/r</dt>
            <dd class="m-0 text-fg">{{ me.leadName ?? '–' }}</dd>
          </div>
          <div class="field">
            <dt>Eintritt</dt>
            <dd class="m-0 font-mono text-fg">{{ me.entryDate | localDate }}</dd>
          </div>
          <div class="field">
            <dt>Anmeldeadresse</dt>
            <dd class="m-0 text-fg" data-testid="login-email">{{ me.loginEmail }}</dd>
          </div>
        </dl>
        <p class="m-0 text-[13px] text-muted">
          Die Anmeldeadresse dient nur der Anmeldung und Benachrichtigungen. Ändern kann sie nur der
          Admin.
        </p>
      } @else if (profile.error()) {
        <p class="err m-0" role="alert">Deine Daten konnten nicht geladen werden.</p>
        <div>
          <button type="button" class="btn btn-sm" (click)="profile.reload()">Erneut laden</button>
        </div>
      } @else {
        <p class="m-0 text-muted">Wird geladen …</p>
      }
    </section>

    <section class="card">
      <h2>Passkeys</h2>
      <p class="m-0 text-[13px] text-muted">
        Ein Passkey je Gerät. Danach meldest du dich mit Fingerabdruck, Gesicht oder Geräte-PIN an.
        Der Code per E-Mail bleibt der Rückfallweg, falls ein Gerät verloren geht.
      </p>
      @if (passkeys.hasValue()) {
        @let list = passkeys.value();
        @if (list.length) {
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Gerät</th>
                  <th class="col-opt">Angelegt</th>
                  <th class="col-opt">Zuletzt benutzt</th>
                  <th class="col-opt"></th>
                  <th class="col-narrow"><span class="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                @for (p of list; track p.id) {
                  <tr (click)="rows.onRowClick(p.id, $event)">
                    <td>
                      @if (editing() === p.id) {
                        <input
                          #renameInput
                          class="w-full min-w-0 sm:w-auto"
                          [value]="p.name"
                          maxlength="60"
                          (input)="draft.set(value($event))"
                          (keydown.escape)="stopEditing(p)"
                          [attr.aria-label]="'Neuer Name für ' + p.name"
                        />
                      } @else {
                        {{ p.name }}
                      }
                    </td>
                    <td class="col-opt font-mono">{{ berlinDay(p.createdAt) | localDate }}</td>
                    <td class="col-opt font-mono">{{ berlinDay(p.lastUsedAt) | localDate }}</td>
                    <td class="col-opt whitespace-nowrap">
                      <ng-container
                        [ngTemplateOutlet]="passkeyActions"
                        [ngTemplateOutletContext]="{ $implicit: p }"
                      />
                    </td>
                    <td class="col-narrow">
                      <app-row-toggle
                        [open]="rows.isOpen(p.id)"
                        [label]="'Details zu ' + p.name"
                        (toggled)="rows.toggle(p.id)"
                      />
                    </td>
                  </tr>
                  @if (rows.isOpen(p.id)) {
                    <tr class="row-details">
                      <td colspan="5">
                        <dl class="details">
                          <dt>Angelegt</dt>
                          <dd>{{ berlinDay(p.createdAt) | localDate }}</dd>
                          <dt>Zuletzt benutzt</dt>
                          <dd>{{ berlinDay(p.lastUsedAt) | localDate }}</dd>
                          <dt>Aktion</dt>
                          <dd>
                            <ng-container
                              [ngTemplateOutlet]="passkeyActions"
                              [ngTemplateOutletContext]="{ $implicit: p }"
                            />
                          </dd>
                        </dl>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="m-0 text-muted">Noch kein Passkey angelegt.</p>
        }
      } @else if (passkeys.error()) {
        <p class="err m-0" role="alert">Die Passkeys konnten nicht geladen werden.</p>
        <div>
          <button type="button" class="btn btn-sm" (click)="passkeys.reload()">Erneut laden</button>
        </div>
      }
      @if (supported) {
        <form class="fields" novalidate (submit)="register($event)">
          <label class="field" for="passkey-name">
            Name des Geräts
            <input
              id="passkey-name"
              maxlength="60"
              [value]="newName()"
              (input)="newName.set(value($event))"
            />
          </label>
          <div class="flex flex-wrap items-center gap-3">
            <button class="btn btn-primary" type="submit" [disabled]="busy() || !newName().trim()">
              Passkey anlegen
            </button>
          </div>
        </form>
      } @else {
        <p class="hint m-0">
          Dieser Browser unterstützt keine Passkeys. Die Anmeldung per Code funktioniert weiterhin.
        </p>
      }
      @if (error(); as message) {
        <p class="err m-0" role="alert">{{ message }}</p>
      }
    </section>

    @if (profile.hasValue()) {
      <app-reminder-settings [emailFallback]="profile.value().reminderEmailFallback" />
    }

    <section class="card">
      <h2>Anmeldungen</h2>
      <p class="m-0 text-[13px] text-muted">
        Eine Anmeldung bleibt 30 Tage aktiv und verlängert sich bei Nutzung. Bei einem verlorenen
        Gerät hier überall abmelden und den Passkey des Geräts löschen.
      </p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn" [disabled]="busy()" (click)="logout()">Abmelden</button>
        @if (confirmLogoutAll()) {
          <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="logoutAll()">
            Wirklich auf allen Geräten abmelden
          </button>
          <button type="button" class="btn" (click)="confirmLogoutAll.set(false)">Abbrechen</button>
        } @else {
          <button type="button" class="btn btn-danger" (click)="confirmLogoutAll.set(true)">
            Auf allen Geräten abmelden
          </button>
        }
      </div>
      @if (sessionError(); as message) {
        <p class="err m-0" role="alert">{{ message }}</p>
      }
    </section>
  `,
})
export class ProfilePage {
  protected readonly rows = new ExpandableRows();
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');
  private actionScope: Element | null = null;

  protected readonly supported = browserSupportsWebAuthn();
  protected readonly berlinDay = berlinDay;
  protected readonly profile = resource({ loader: () => this.api.me() });
  protected readonly passkeys = resource({ loader: () => this.api.passkeys() });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sessionError = signal<string | null>(null);
  protected readonly newName = signal(guessDeviceName());
  protected readonly editing = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly confirmDelete = signal<string | null>(null);
  protected readonly confirmLogoutAll = signal(false);

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** Fokus nach dem nächsten Rendern setzen, damit Tastatur und Screenreader den Kontext behalten. */
  private focusAfterRender(target: () => HTMLElement | null | undefined): void {
    afterNextRender(() => target()?.focus(), { injector: this.injector });
  }

  private focusActions(p: PasskeyView): void {
    this.focusAfterRender(() =>
      (this.actionScope ?? this.host.nativeElement).querySelector<HTMLElement>(
        `[data-passkey-action="${p.id}"]`,
      ),
    );
  }

  protected async register(event: Event): Promise<void> {
    event.preventDefault();
    this.busy.set(true);
    this.error.set(null);
    try {
      const optionsJSON = await this.api.passkeyRegistrationOptions();
      let response;
      try {
        response = await startRegistration({ optionsJSON });
      } catch (e) {
        throw new Error(
          e instanceof Error && e.name === 'InvalidStateError'
            ? 'Auf diesem Gerät gibt es schon einen Passkey für dich.'
            : 'Das Anlegen des Passkeys wurde abgebrochen.',
        );
      }
      await this.api.passkeyRegistrationVerify(response, this.newName().trim());
      this.passkeys.reload();
      this.profile.reload();
      this.toast.show('Passkey angelegt. Ab jetzt geht die Anmeldung ohne Code.');
    } catch (e) {
      this.error.set(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Der Passkey konnte nicht angelegt werden.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected startRename(p: PasskeyView, event: Event): void {
    this.actionScope = (event.currentTarget as HTMLElement).closest('td, dd');
    this.draft.set(p.name);
    this.editing.set(p.id);
    this.focusAfterRender(() => this.renameInput()?.nativeElement);
  }

  protected stopEditing(p: PasskeyView): void {
    this.editing.set(null);
    this.focusActions(p);
  }

  protected startConfirm(p: PasskeyView, event: Event): void {
    this.actionScope = (event.currentTarget as HTMLElement).closest('td, dd');
    this.confirmDelete.set(p.id);
    this.focusAfterRender(() =>
      this.actionScope?.querySelector<HTMLElement>('[data-confirm-delete]'),
    );
  }

  protected stopConfirm(p: PasskeyView): void {
    this.confirmDelete.set(null);
    this.focusActions(p);
  }

  protected async rename(p: PasskeyView): Promise<void> {
    try {
      await this.api.renamePasskey(p.id, this.draft().trim());
      this.editing.set(null);
      this.passkeys.reload();
      this.focusActions(p);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Umbenennen fehlgeschlagen.');
    }
  }

  protected async remove(p: PasskeyView): Promise<void> {
    try {
      await this.api.deletePasskey(p.id);
      this.confirmDelete.set(null);
      this.passkeys.reload();
      this.profile.reload();
      this.toast.show(`Passkey „${p.name}“ gelöscht.`);
      this.focusAfterRender(() =>
        this.host.nativeElement.querySelector<HTMLElement>('#passkey-name'),
      );
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen.');
    }
  }

  protected logout(): Promise<void> {
    return this.endSessions(
      () => this.api.logout(),
      'Abmelden fehlgeschlagen. Du bist noch angemeldet.',
    );
  }

  protected logoutAll(): Promise<void> {
    return this.endSessions(
      () => this.api.logoutAll(),
      'Abmelden auf allen Geräten fehlgeschlagen. Die Anmeldungen bestehen weiter; bitte erneut versuchen.',
    );
  }

  /** Den lokalen Zustand erst leeren, wenn der Server die Abmeldung bestätigt hat. */
  private async endSessions(call: () => Promise<void>, failure: string): Promise<void> {
    this.busy.set(true);
    this.sessionError.set(null);
    try {
      await call();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        this.sessionError.set(failure);
        this.busy.set(false);
        return;
      }
    }
    this.store.clear();
    await this.router.navigateByUrl('/anmelden');
  }
}
