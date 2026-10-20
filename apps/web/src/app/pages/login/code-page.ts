import { Component, inject, signal, type OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiError, ApiService } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { LoginFlow } from './login-flow.service';
import { LoginLayout } from './login-layout';

@Component({
  selector: 'app-code-page',
  imports: [LoginLayout, RouterLink],
  template: `
    <app-login-layout
      heading="Code eingeben"
      [lead]="
        'Falls ' +
        (flow.email() ?? '') +
        ' bei uns hinterlegt ist, ist ein sechsstelliger Code unterwegs. Er ist 10 Minuten gültig und einmal verwendbar.'
      "
    >
      <form class="flex flex-col gap-3" novalidate (submit)="verify($event)">
        <label class="field" for="code">
          Code aus der E-Mail
          <input
            id="code"
            class="max-w-[12ch] font-mono text-xl tracking-[0.3em]"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            [value]="code()"
            (input)="code.set(digits($event))"
          />
        </label>
        <div class="flex flex-wrap items-center gap-3">
          <button class="btn btn-primary" type="submit" [disabled]="busy() || code().length !== 6">
            Anmelden
          </button>
          @if (error(); as message) {
            <span class="err" role="alert">{{ message }}</span>
          }
        </div>
      </form>
      <div class="flex flex-wrap gap-3 text-[13px]">
        <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="resend()">
          Neuen Code anfordern
        </button>
        <a routerLink="/anmelden" class="btn btn-sm no-underline">Andere Adresse</a>
      </div>
    </app-login-layout>
  `,
})
export class CodePage implements OnInit {
  protected readonly flow = inject(LoginFlow);
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.flow.email()) void this.router.navigateByUrl('/anmelden');
  }

  protected digits(event: Event): string {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    return input.value;
  }

  protected async verify(event: Event): Promise<void> {
    event.preventDefault();
    const email = this.flow.email();
    if (!email || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.verifyCode(email, this.code());
      const session = await this.store.reload();
      if (!session)
        throw new Error(
          'Die Anmeldung ließ sich nicht bestätigen. Bitte einen neuen Code anfordern.',
        );
      // Erst nach bestätigter Sitzung aufräumen, sonst blieben „Anmelden“ und „Neuer Code“ wirkungslos.
      this.flow.email.set(null);
      await this.router.navigateByUrl('/');
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

  protected async resend(): Promise<void> {
    const email = this.flow.email();
    if (!email || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.requestCode(email);
      this.code.set('');
      this.toast.show('Ein neuer Code ist unterwegs. Ältere Codes gelten nicht mehr.');
    } catch (e) {
      this.error.set(
        e instanceof ApiError ? e.message : 'Der Code konnte nicht angefordert werden.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
