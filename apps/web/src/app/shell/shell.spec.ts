import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { SessionView } from '@as/shared';
import { SessionStore } from '../core/session.store';
import { Shell } from './shell';

@Component({ template: '' })
class Dummy {}

beforeAll(() => {
  // jsdom kennt kein modales <dialog>; Verhalten der Browser nachbilden.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

type Extra = { representing?: number; leave?: object[]; leaveFails?: boolean };

async function renderAs(session: SessionView, extra: Extra = {}): Promise<HTMLElement> {
  return (await renderShell(session, extra)).el;
}

async function renderShell(session: SessionView, extra: Extra = {}) {
  TestBed.configureTestingModule({
    imports: [Shell],
    providers: [
      provideRouter([{ path: 'zeiten', component: Dummy }]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const store = TestBed.inject(SessionStore);
  const loading = store.reload();
  TestBed.inject(HttpTestingController).expectOne('/api/auth/session').flush(session);
  await loading;
  const fixture = TestBed.createComponent(Shell);
  fixture.detectChanges();
  await Promise.resolve();
  const http = TestBed.inject(HttpTestingController);
  // Mitarbeiter: Vertretung aktiv? Entscheidende laden den Zähler offener Anträge. Offene Anfragen
  // beantworten, bis keine mehr nachkommen (die Ressourcen hängen voneinander ab).
  for (let i = 0; i < 6; i++) {
    fixture.detectChanges();
    http.match('/api/me').forEach((r) => r.flush({ representing: extra.representing ?? 0 }));
    http
      .match((r) => r.url === '/api/time/corrections')
      .forEach((r) => r.flush([{ employeeId: 'x' }, { employeeId: '1' }]));
    http
      .match((r) => r.url === '/api/leave/requests')
      .forEach((r) =>
        extra.leaveFails
          ? r.flush({ message: 'Fehler' }, { status: 500, statusText: 'Server Error' })
          : r.flush(r.request.params.get('status') === 'PENDING' ? (extra.leave ?? []) : []),
      );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement, http };
}

describe('Shell', () => {
  it('zeigt einem Mitarbeiter die Navigation ohne Mitarbeiterverwaltung', async () => {
    const el = await renderAs({
      id: '1',
      name: 'Jonas Reitberger',
      role: 'EMPLOYEE',
      method: 'EMAIL_CODE',
    });
    const links = [...el.querySelectorAll('nav a')].map((a) => a.textContent?.trim());
    expect(links).toEqual([
      'Heute',
      'Zeiten',
      'Mein Urlaub',
      'Urlaubsübersicht',
      'Feiertage',
      'Profil',
    ]);
    expect(el.querySelector('[data-testid="current-user"]')?.textContent).toContain(
      'Jonas Reitberger',
    );
  });

  it('zeigt dem Admin die Mitarbeiterverwaltung', async () => {
    const el = await renderAs({
      id: '1',
      name: 'Katharina Brandl',
      role: 'ADMIN',
      method: 'PASSKEY',
    });
    expect([...el.querySelectorAll('nav a')].map((a) => a.textContent?.trim())).toContain(
      'Mitarbeiter',
    );
  });

  it('zählt offene Anträge anderer an „Freigaben“', async () => {
    const el = await renderAs({ id: '1', name: 'Tobias Lechner', role: 'LEAD', method: 'PASSKEY' });
    const link = [...el.querySelectorAll('nav a')].find((a) =>
      a.textContent?.includes('Freigaben'),
    );
    expect(link?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Freigaben 1');
  });

  it('zählt entscheidbare Urlaubsanträge mit und zeigt Freigaben während einer Vertretung', async () => {
    const el = await renderAs(
      { id: '1', name: 'Sebastian Wolf', role: 'EMPLOYEE', method: 'PASSKEY' },
      { representing: 1, leave: [{ canDecide: true }, { canDecide: false }] },
    );
    const link = [...el.querySelectorAll('nav a')].find((a) =>
      a.textContent?.includes('Freigaben'),
    );
    expect(link?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Freigaben 2');
  });

  it('zeigt einen unvollständigen Zähler erkennbar statt einer stillen Null (Befund 3)', async () => {
    const el = await renderAs(
      { id: '1', name: 'Tobias Lechner', role: 'LEAD', method: 'PASSKEY' },
      { leaveFails: true },
    );
    const badge = [...el.querySelectorAll('nav a')]
      .find((a) => a.textContent?.includes('Freigaben'))
      ?.querySelector('span[aria-label]');
    expect(badge?.textContent?.trim()).toBe('1+');
    expect(badge?.getAttribute('aria-label')).toContain('nicht vollständig geladen');
  });
});

describe('Shell: Schublade', () => {
  const session: SessionView = {
    id: '1',
    name: 'Jonas Reitberger',
    role: 'EMPLOYEE',
    method: 'EMAIL_CODE',
  };
  const menuButton = (el: HTMLElement) =>
    el.querySelector<HTMLButtonElement>('[aria-controls="app-drawer"]')!;
  /** Ohne whenStable: Navigation lädt den Zähler neu; offene Anfragen beantworten. */
  async function settle(fixture: { detectChanges(): void }) {
    const http = TestBed.inject(HttpTestingController);
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      http.match('/api/me').forEach((r) => r.flush({ representing: 0 }));
      http.match((r) => r.url === '/api/time/corrections').forEach((r) => r.flush([]));
      http.match((r) => r.url === '/api/leave/requests').forEach((r) => r.flush([]));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  it('öffnet die Schublade mit Navigation und schließt sie beim Menüklick', async () => {
    const { el, fixture } = await renderShell(session);
    expect(el.querySelector('dialog nav')).toBeNull();
    menuButton(el).click();
    await settle(fixture);
    const dialog = el.querySelector<HTMLDialogElement>('dialog#app-drawer')!;
    expect(dialog.open).toBe(true);
    expect(menuButton(el).getAttribute('aria-expanded')).toBe('true');
    dialog.querySelector<HTMLAnchorElement>('nav a')!.click();
    await settle(fixture);
    expect(dialog.open).toBe(false);
    expect(el.querySelector('dialog nav')).toBeNull();
    expect(document.activeElement).toBe(menuButton(el));
  });

  it('schließt die Schublade über „Menü schließen“ und meldet den Zustand', async () => {
    const { el, fixture } = await renderShell(session);
    menuButton(el).click();
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[aria-label="Menü schließen"]')!.click();
    await settle(fixture);
    expect(el.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);
    expect(menuButton(el).getAttribute('aria-expanded')).toBe('false');
  });

  it('schließt die Schublade bei Escape (close-Ereignis des Browsers)', async () => {
    const { el, fixture } = await renderShell(session);
    menuButton(el).click();
    await settle(fixture);
    const dialog = el.querySelector<HTMLDialogElement>('dialog')!;
    dialog.close();
    await settle(fixture);
    expect(menuButton(el).getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('dialog nav')).toBeNull();
  });

  it('schließt die Schublade bei jeder Navigation, auch Zurück (Review Focus 3)', async () => {
    const { el, fixture } = await renderShell(session);
    menuButton(el).click();
    await settle(fixture);
    await TestBed.inject(Router).navigateByUrl('/zeiten');
    await settle(fixture);
    expect(el.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);
  });

  it('nennt offene Anträge im Namen des Menüknopfs', async () => {
    const { el } = await renderShell({
      id: '1',
      name: 'Tobias Lechner',
      role: 'LEAD',
      method: 'PASSKEY',
    });
    expect(menuButton(el).getAttribute('aria-label')).toBe('Menü öffnen, 1 offene Anträge');
  });

  it('nennt einen unvollständig geladenen Zähler im Namen des Menüknopfs (Review Design, Befund 8)', async () => {
    const { el } = await renderShell(
      { id: '1', name: 'Tobias Lechner', role: 'LEAD', method: 'PASSKEY' },
      { leaveFails: true },
    );
    expect(menuButton(el).getAttribute('aria-label')).toBe(
      'Menü öffnen, mindestens 1 offene Anträge, nicht vollständig geladen',
    );
  });

  it('hält den Inhalt seitlich aus Notch und Displayausschnitt heraus (Review Design, Befund 6)', async () => {
    const { el } = await renderShell(session);
    const main = el.querySelector('main')!;
    expect(main.className).toContain('pl-[max(16px,env(safe-area-inset-left))]');
    expect(main.className).toContain('pr-[max(16px,env(safe-area-inset-right))]');
  });

  it('zeigt den Seitentitel in der Kopfleiste', async () => {
    const { el, fixture } = await renderShell(session);
    expect(el.querySelector('[data-page-title]')?.textContent?.trim()).toBe('Heute');
    await TestBed.inject(Router).navigateByUrl('/zeiten');
    await settle(fixture);
    expect(el.querySelector('[data-page-title]')?.textContent?.trim()).toBe('Zeiten');
  });
});

describe('Shell: Wechsel auf Desktop-Breite (Review Focus 2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('schließt eine offene Schublade, sobald die Seitenleiste fest erscheint', async () => {
    const listeners: ((e: { matches: boolean }) => void)[] = [];
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.push(l),
      removeEventListener: () => undefined,
    }));
    const { el, fixture } = await renderShell({
      id: '1',
      name: 'Jonas Reitberger',
      role: 'EMPLOYEE',
      method: 'EMAIL_CODE',
    });
    el.querySelector<HTMLButtonElement>('[aria-controls="app-drawer"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector<HTMLDialogElement>('dialog')!.open).toBe(true);
    listeners.forEach((l) => l({ matches: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);
  });
});
