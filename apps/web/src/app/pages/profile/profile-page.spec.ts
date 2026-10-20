import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PushDevice, type PushState } from '../../core/push-device';
import { ProfilePage } from './profile-page';

it('lädt Erinnerungen erst mit dem Profil und übernimmt den ausgeschalteten E-Mail-Rückfall', async () => {
  const refresh = vi.fn(async () => 'unsupported' as const);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: PushDevice,
        useValue: {
          state: signal<PushState>('unsupported'),
          refresh,
          enable: vi.fn(),
          disable: vi.fn(),
        },
      },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ProfilePage);
  const el: HTMLElement = fixture.nativeElement;
  fixture.detectChanges();
  http.expectOne('/api/me').flush({}, { status: 503, statusText: 'Unavailable' });
  http.expectOne('/api/me/passkeys').flush([]);
  await fixture.whenStable();
  expect(el.querySelector('app-reminder-settings')).toBeNull();
  expect(el.querySelector('[role="alert"]')?.textContent).toContain(
    'Deine Daten konnten nicht geladen werden.',
  );
  expect(refresh).not.toHaveBeenCalled();
  [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Erneut laden')!.click();
  fixture.detectChanges();
  (await vi.waitFor(() => http.expectOne('/api/me'))).flush({
    name: 'Testperson',
    role: 'EMPLOYEE',
    entryDate: '2026-01-01',
    reminderEmailFallback: false,
  });
  (await vi.waitFor(() => http.expectOne('/api/me/push-subscriptions'))).flush([]);
  await fixture.whenStable();
  expect(el.querySelector<HTMLInputElement>('#reminder-email')?.checked).toBe(false);
  expect(el.querySelector('app-reminder-settings')?.textContent).toContain(
    'Was das System auswertet',
  );
  http.verify();
});

it('bestätigt und verwirft Passkey-Löschen in den geöffneten Details mit passendem Fokus', async () => {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ProfilePage);
  fixture.detectChanges();
  http.expectOne('/api/me').flush({}, { status: 503, statusText: 'Unavailable' });
  http
    .expectOne('/api/me/passkeys')
    .flush([
      { id: 'passkey', name: 'Testgerät', createdAt: '2026-10-12T22:30:00Z', lastUsedAt: null },
    ]);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const row = el.querySelector<HTMLTableRowElement>('tbody tr')!;
  row.querySelector<HTMLButtonElement>('app-row-toggle button')!.click();
  fixture.detectChanges();
  const details = row.nextElementSibling!;
  details
    .querySelector<HTMLButtonElement>('button[aria-label="Passkey Testgerät löschen"]')!
    .click();
  await fixture.whenStable();
  expect(document.activeElement).toBe(
    details.querySelector('button[aria-label="Passkey Testgerät wirklich löschen"]'),
  );
  http.expectNone((r) => r.method === 'DELETE');
  [...details.querySelectorAll('button')]
    .find((b) => b.textContent?.trim() === 'Abbrechen')!
    .click();
  await fixture.whenStable();
  expect(document.activeElement).toBe(details.querySelector('[data-passkey-action]'));
  expect(row.querySelector('app-row-toggle button')!.getAttribute('aria-expanded')).toBe('true');
  http.verify();
});

it('zeigt unter 640 px Gerät mit Passkeydaten und Aktionen', async () => {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const http = TestBed.inject(HttpTestingController);

  const fixture = TestBed.createComponent(ProfilePage);
  fixture.detectChanges();
  http.expectOne('/api/me').flush({}, { status: 503, statusText: 'Unavailable' });
  http
    .expectOne('/api/me/passkeys')
    .flush([
      { id: 'passkey', name: 'Testgerät', createdAt: '2026-10-12T22:30:00Z', lastUsedAt: null },
    ]);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;

  const table = el.querySelector<HTMLTableElement>('table')!;
  const row = table.tBodies[0]!.rows[0]!;
  const headers = table.querySelectorAll('th');
  for (const [index, optional] of [false, true, true, true, false].entries()) {
    expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
    expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
  }
  const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
  expect(toggle.getAttribute('aria-label')).toBe('Details zu Testger\u00e4t');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  fixture.detectChanges();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const details = row.nextElementSibling!;
  expect(details.classList).toContain('row-details');
  expect(details.querySelector('td')!.colSpan).toBe(headers.length);
  for (const text of [
    'Angelegt',
    '13.10.2026',
    'Zuletzt benutzt',
    '–',
    'Aktion',
    'Umbenennen',
    'Löschen',
  ])
    expect(details.textContent).toContain(text);
  expect(details.querySelector('button, a')).not.toBeNull();

  row.cells[0]!.click();
  fixture.detectChanges();
  expect(table.querySelector('.row-details')).toBeNull();
});
