import { Component, inject, signal } from '@angular/core';
import { email as emailValidator, form, FormField, required } from '@angular/forms/signals';
import { Router } from '@angular/router';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  WebAuthnError,
} from '@simplewebauthn/browser';
import { ApiError, ApiService } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { LoginFlow } from './login-flow.service';
import { LoginLayout } from './login-layout';

@Component({
  selector: 'app-login-page',
  imports: [LoginLayout, FormField],
  template: `
    <app-login-layout
      heading="Anmelden"
      lead="Mit einem Passkey oder mit einem Code per E-Mail. Passwörter gibt es nicht."
    >
      @if (passkeySupported) {
        <button
          type="button"
          class="btn btn-primary btn-big"
          [disabled]="busy()"
          (click)="passkey()"
        >
          Mit Passkey anmelden
        </button>
        <div class="flex items-center gap-3 text-[13px] text-muted">
          <span class="h-px flex-1 bg-line"></span>oder<span class="h-px flex-1 bg-line"></span>
        </div>
      }
      <form class="flex flex-col gap-3" novalidate (submit)="requestCode($event)">
        <label class="field" for="email">
          E-Mail-Adresse
          <input
            id="email"
            type="email"
            autocomplete="username webauthn"
            [formField]="loginForm.email"
          />
        </label>
        <div class="flex flex-wrap items-center gap-3">
          <button
            class="btn"
            [class.btn-primary]="!passkeySupported"
            type="submit"
            [disabled]="busy()"
          >
            Code anfordern
          </button>
          @if (error(); as message) {
            <span class="err" role="alert">{{ message }}</span>
          }
        </div>
      </form>
      <p class="m-0 text-[13px] text-muted">
        Konten legt der Admin an. Ein Passkey lässt sich nach der ersten Anmeldung im Profil
        einrichten.
      </p>
    </app-login-layout>
  `,
})
export class LoginPage {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly flow = inject(LoginFlow);
  private readonly router = inject(Router);

  protected readonly passkeySupported = browserSupportsWebAuthn();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly model = signal({ email: this.flow.email() ?? '' });
  protected readonly loginForm = form(this.model, (p) => {
    required(p.email);
    emailValidator(p.email);
  });

  protected async requestCode(event: Event): Promise<void> {
    event.preventDefault();
    if (this.loginForm().invalid()) {
      this.error.set('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }
    await this.run(async () => {
      const email = this.model().email.trim();
      await this.api.requestCode(email);
      this.flow.email.set(email);
      await this.router.navigateByUrl('/anmelden/code');
    });
  }

  protected async passkey(): Promise<void> {
    await this.run(async () => {
      const optionsJSON = await this.api.passkeyLoginOptions();
      let response;
      try {
        response = await startAuthentication({ optionsJSON });
      } catch (e) {
        throw new Error(
          e instanceof WebAuthnError || (e instanceof Error && e.name === 'NotAllowedError')
            ? 'Anmeldung mit Passkey abgebrochen.'
            : 'Dieser Browser konnte keinen Passkey verwenden.',
        );
      }
      await this.api.passkeyLoginVerify(response);
      await this.store.reload();
      await this.router.navigateByUrl('/');
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (e) {
      this.error.set(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Die Anmeldung ist fehlgeschlagen.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
