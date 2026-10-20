import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';
import { ToastService } from './core/toast.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <router-outlet />
    @if (toast.message(); as message) {
      <div
        class="fixed bottom-5 left-1/2 z-10 max-w-[min(92vw,560px)] -translate-x-1/2 rounded-card bg-fg px-4 py-2.5 text-sm text-bg"
        role="status"
        aria-live="polite"
      >
        {{ message }}
      </div>
    }
  `,
})
export class App {
  protected readonly toast = inject(ToastService);
  // Theme beim Start anwenden.
  private readonly theme = inject(ThemeService);
}
