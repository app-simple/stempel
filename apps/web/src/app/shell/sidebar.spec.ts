import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { SessionView } from '@as/shared';
import { ApprovalsCounter } from '../core/approvals-counter';
import { SessionStore } from '../core/session.store';
import { ThemeService } from '../core/theme.service';
import { Sidebar } from './sidebar';

async function render(
  session: SessionView,
  approvals = { count: 0, failed: false, decides: false },
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ApprovalsCounter,
        useValue: {
          count: () => approvals.count,
          failed: () => approvals.failed,
          decides: () => approvals.decides,
          reload: () => undefined,
        },
      },
    ],
  });
  const store = TestBed.inject(SessionStore);
  const loading = store.reload();
  TestBed.inject(HttpTestingController).expectOne('/api/auth/session').flush(session);
  await loading;
  const fixture = TestBed.createComponent(Sidebar);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}
const admin: SessionView = {
  id: '1',
  name: 'Katharina Brandl',
  role: 'ADMIN',
  method: 'PASSKEY',
};

describe('Sidebar', () => {
  beforeEach(() => localStorage.clear());

  it('zeigt Bereiche mit Symbol, Name und Rolle', async () => {
    const { el } = await render(admin, { count: 0, failed: false, decides: true });
    const links = [...el.querySelectorAll('nav[aria-label="Bereiche"] a')];
    expect(links.map((a) => a.textContent?.trim())).toContain('Mitarbeiter');
    expect(links.every((a) => a.querySelector('svg[aria-hidden="true"]'))).toBe(true);
    expect(el.querySelector('[data-testid="current-user"]')?.textContent).toContain(
      'Katharina Brandl',
    );
    expect(el.textContent).toContain('Admin');
  });

  it('zeigt den Zähler offener Freigaben', async () => {
    const { el } = await render(admin, { count: 3, failed: false, decides: true });
    expect(el.querySelector('[aria-label="3 offene Anträge"]')?.textContent?.trim()).toBe('3');
  });

  it('wählt die Darstellung über eine Radiogruppe', async () => {
    const { el, fixture } = await render(admin);
    const dark = el.querySelector<HTMLInputElement>('input[type="radio"][value="dark"]')!;
    dark.click();
    fixture.detectChanges();
    expect(TestBed.inject(ThemeService).choice()).toBe('dark');
    expect(el.querySelector('fieldset legend')?.textContent).toContain('Darstellung');
  });

  it('meldet einen Menüklick nach außen (Schublade schließt)', async () => {
    const { el, fixture } = await render(admin);
    const spy = vi.fn();
    fixture.componentInstance.navigated.subscribe(spy);
    el.querySelector<HTMLAnchorElement>('nav a')!.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('meldet ab und geht zur Anmeldung', async () => {
    const { el, fixture } = await render(admin);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Abmelden'))!.click();
    TestBed.inject(HttpTestingController).expectOne('/api/auth/logout').flush(null);
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('/anmelden');
  });
});
