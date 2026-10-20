import { Component, computed, inject, output } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideLogOut,
  LucideMonitor,
  LucideMoon,
  LucideSun,
  type LucideIcon,
} from '@lucide/angular';
import { ApiError, ApiService } from '../core/api.service';
import { ApprovalsCounter } from '../core/approvals-counter';
import { RoleLabelPipe } from '../core/format.pipes';
import { SessionStore } from '../core/session.store';
import { ThemeService, type ThemeChoice } from '../core/theme.service';
import { ToastService } from '../core/toast.service';
import { navFor } from './nav';

let nextId = 0;

/**
 * Navigation und Kontobereich; am Desktop fest links, auf dem Handy in der Schublade
 * (Spezifikation Design, Abschnitt 3).
 */
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, RoleLabelPipe, LucideDynamicIcon, LucideLogOut],
  host: { class: 'flex min-h-full flex-col gap-5 p-3' },
  template: `
    <div class="flex flex-col gap-0.5 px-3 pt-2">
      <b class="text-[17px] font-semibold tracking-[-0.01em]">Zeit &amp; Urlaub</b>
      <span class="font-mono text-xs text-muted">Company OS</span>
    </div>
    <nav class="flex flex-col gap-0.5" aria-label="Bereiche">
      @for (item of nav(); track item.path) {
        <a
          [routerLink]="item.path"
          routerLinkActive
          ariaCurrentWhenActive="page"
          [routerLinkActiveOptions]="{ exact: item.path === '/' }"
          (click)="navigated.emit()"
          class="flex min-h-11 items-center gap-3 rounded-ui px-3 text-muted no-underline hover:bg-surface-2 hover:text-fg aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-fg"
        >
          <svg [lucideIcon]="item.icon" [size]="20" aria-hidden="true" class="shrink-0"></svg>
          <span class="min-w-0 flex-1 truncate">{{ item.label }}</span
          >{{ ' ' }}
          @if (item.badge === 'approvals' && approvals.failed()) {
            <span
              class="rounded-full bg-warn px-[7px] font-mono text-xs font-medium text-surface"
              title="Offene Anträge konnten nicht vollständig geladen werden"
              aria-label="Offene Anträge konnten nicht vollständig geladen werden"
              >{{ approvals.count() > 0 ? approvals.count() + '+' : '!' }}</span
            >
          } @else if (item.badge === 'approvals' && approvals.count() > 0) {
            <span
              class="rounded-full bg-crit px-[7px] font-mono text-xs font-medium text-surface"
              [attr.aria-label]="approvals.count() + ' offene Anträge'"
              >{{ approvals.count() }}</span
            >
          }
        </a>
      }
    </nav>
    @if (store.session(); as session) {
      <div class="mt-auto flex flex-col gap-3 border-t border-line px-1 pt-4">
        <div class="flex min-w-0 flex-col px-2">
          <span class="truncate font-medium" data-testid="current-user">{{ session.name }}</span>
          <span class="text-[13px] text-muted">{{ session.role | roleLabel }}</span>
        </div>
        <fieldset class="m-0 min-w-0 border-0 p-0">
          <legend class="lbl mb-1.5 px-2">Darstellung</legend>
          <div class="grid grid-cols-3 gap-1 rounded-ui bg-surface-2 p-1">
            @for (option of themes; track option.value) {
              <label
                class="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[4px] text-[13px] text-muted has-checked:bg-surface has-checked:font-semibold has-checked:text-fg has-focus-visible:outline-2 has-focus-visible:outline-accent"
              >
                <input
                  type="radio"
                  class="sr-only"
                  [name]="radioName"
                  [value]="option.value"
                  [checked]="theme.choice() === option.value"
                  (change)="theme.set(option.value)"
                />
                <svg [lucideIcon]="option.icon" [size]="16" aria-hidden="true"></svg>
                {{ option.label }}
              </label>
            }
          </div>
        </fieldset>
        <button type="button" class="btn justify-start" (click)="logout()">
          <svg lucideLogOut [size]="18" aria-hidden="true"></svg>
          Abmelden
        </button>
      </div>
    }
  `,
})
export class Sidebar {
  protected readonly store = inject(SessionStore);
  protected readonly theme = inject(ThemeService);
  protected readonly approvals = inject(ApprovalsCounter);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly navigated = output<void>();

  /** Eigener Name je Instanz: Seitenleiste und Schublade können gleichzeitig im DOM sein. */
  protected readonly radioName = `theme-${nextId++}`;
  protected readonly themes: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
    { value: 'system', label: 'System', icon: LucideMonitor },
    { value: 'light', label: 'Hell', icon: LucideSun },
    { value: 'dark', label: 'Dunkel', icon: LucideMoon },
  ];
  protected readonly nav = computed(() => navFor(this.store.role(), this.approvals.decides()));

  protected async logout(): Promise<void> {
    try {
      await this.api.logout();
    } catch (e) {
      // 401: die Sitzung ist ohnehin beendet. Sonst bleibt die Person angemeldet und erfährt es.
      if (!(e instanceof ApiError && e.status === 401)) {
        this.toast.show('Abmelden fehlgeschlagen. Bitte erneut versuchen.');
        return;
      }
    }
    this.store.clear();
    await this.router.navigateByUrl('/anmelden');
  }
}
