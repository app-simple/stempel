import { Component, input } from '@angular/core';

@Component({
  selector: 'app-login-layout',
  template: `
    <div class="mx-auto flex min-h-dvh max-w-[440px] flex-col justify-center gap-5 px-4 py-10">
      <div class="flex flex-col gap-0.5">
        <b class="text-[19px] font-semibold">Zeit &amp; Urlaub</b>
        <span class="font-mono text-xs text-muted">Company OS</span>
      </div>
      <section class="card">
        <div>
          <h1>{{ heading() }}</h1>
          <p class="lead">{{ lead() }}</p>
        </div>
        <ng-content />
      </section>
    </div>
  `,
})
export class LoginLayout {
  readonly heading = input.required<string>();
  readonly lead = input.required<string>();
}
