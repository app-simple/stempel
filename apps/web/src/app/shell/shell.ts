import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { LucideMenu, LucideX } from '@lucide/angular';
import { filter, map } from 'rxjs';
import { ApprovalsCounter } from '../core/approvals-counter';
import { DESKTOP, mediaQuery } from '../core/media';
import { SessionStore } from '../core/session.store';
import { navFor, pageTitleFor } from './nav';
import { Sidebar } from './sidebar';

/**
 * Rahmen: ab 1024 px feste Seitenleiste, darunter Kopfleiste mit Menü-Schublade
 * (Spezifikation Design, Abschnitt 3).
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, Sidebar, LucideMenu, LucideX],
  template: `
    <div class="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside
        class="sticky top-0 hidden h-dvh overflow-y-auto border-r border-line bg-surface lg:block"
      >
        <app-sidebar />
      </aside>
      <header
        class="sticky top-0 z-20 flex h-[calc(56px+env(safe-area-inset-top))] items-center gap-1 border-b border-line bg-surface pt-[env(safe-area-inset-top)] pr-[max(16px,env(safe-area-inset-right))] pl-[max(8px,env(safe-area-inset-left))] lg:hidden"
      >
        <button
          #menuButton
          type="button"
          class="relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-ui hover:bg-surface-2"
          aria-controls="app-drawer"
          [attr.aria-expanded]="drawerOpen()"
          [attr.aria-label]="menuLabel()"
          (click)="openDrawer()"
        >
          <svg lucideMenu [size]="24" aria-hidden="true"></svg>
          @if (approvals.count() > 0 || approvals.failed()) {
            <span
              class="absolute top-1 right-1 min-w-[18px] rounded-full px-1 text-center font-mono text-[11px] leading-[18px] font-medium text-surface"
              [class.bg-crit]="!approvals.failed()"
              [class.bg-warn]="approvals.failed()"
              aria-hidden="true"
              >{{ approvals.failed() && approvals.count() === 0 ? '!' : approvals.count() }}</span
            >
          }
        </button>
        <span class="min-w-0 truncate text-[17px] font-semibold" data-page-title>{{
          pageTitle()
        }}</span>
      </header>
      <dialog #drawer id="app-drawer" class="drawer" aria-label="Menü" (close)="onDrawerClosed()">
        @if (drawerOpen()) {
          <div class="flex justify-end px-3 pt-2">
            <button
              type="button"
              class="inline-flex size-11 cursor-pointer items-center justify-center rounded-ui hover:bg-surface-2"
              aria-label="Menü schließen"
              (click)="closeDrawer()"
            >
              <svg lucideX [size]="22" aria-hidden="true"></svg>
            </button>
          </div>
          <app-sidebar (navigated)="closeDrawer()" />
        }
      </dialog>
      <main
        class="mx-auto flex w-full max-w-[1100px] min-w-0 flex-col gap-5 pt-4 pr-[max(16px,env(safe-area-inset-right))] pl-[max(16px,env(safe-area-inset-left))] pb-[calc(40px+env(safe-area-inset-bottom))] lg:px-8 lg:pt-8"
      >
        <router-outlet />
      </main>
    </div>
  `,
})
export class Shell {
  protected readonly store = inject(SessionStore);
  protected readonly approvals = inject(ApprovalsCounter);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly drawer = viewChild.required<ElementRef<HTMLDialogElement>>('drawer');
  private readonly menuButton = viewChild.required<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly desktop = mediaQuery(DESKTOP);
  protected readonly drawerOpen = signal(false);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  protected readonly pageTitle = computed(() =>
    pageTitleFor(this.url(), navFor(this.store.role(), this.approvals.decides())),
  );
  protected readonly menuLabel = computed(() => {
    const count = this.approvals.count();
    // Ein unvollständiger Zähler wird genannt, nicht als vollständige Zahl angesagt (Review Design, Befund 8).
    if (this.approvals.failed())
      return count > 0
        ? `Menü öffnen, mindestens ${count} offene Anträge, nicht vollständig geladen`
        : 'Menü öffnen, offene Anträge nicht vollständig geladen';
    return count > 0 ? `Menü öffnen, ${count} offene Anträge` : 'Menü öffnen';
  });

  constructor() {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        // Zähler bei jedem Seitenwechsel aktualisieren.
        this.approvals.reload();
        // Jede Navigation schließt die Schublade, auch Zurück (Review Focus 3).
        this.closeDrawer();
      });
    // Ein Klick auf den abgedunkelten Hintergrund trifft das <dialog> selbst. Tastatur: Escape (nativ).
    afterNextRender(() => {
      const dialog = this.drawer().nativeElement;
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) this.closeDrawer();
      });
    });
    // Wird das Fenster breit, erscheint die feste Seitenleiste; die Schublade schließt (Review Focus 2).
    effect(() => {
      if (this.desktop() && untracked(this.drawerOpen)) this.closeDrawer();
    });
  }

  protected openDrawer(): void {
    this.drawerOpen.set(true);
    // Erst nach dem Rendern öffnen, damit der Fokus auf „Menü schließen“ fällt.
    afterNextRender(() => this.drawer().nativeElement.showModal(), { injector: this.injector });
  }

  protected closeDrawer(): void {
    const dialog = this.drawer().nativeElement;
    if (dialog.open) dialog.close();
    else if (this.drawerOpen()) this.onDrawerClosed();
  }

  /** Escape, Menüpunkt, Hintergrund: alles endet hier. */
  protected onDrawerClosed(): void {
    if (!this.drawerOpen()) return;
    this.drawerOpen.set(false);
    this.menuButton().nativeElement.focus();
  }
}
