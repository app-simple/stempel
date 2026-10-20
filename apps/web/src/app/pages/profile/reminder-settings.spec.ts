import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PushDevice, type PushState } from '../../core/push-device';
import { ToastService } from '../../core/toast.service';
import { ProfilePage } from './profile-page';

const devices = [
  {
    id: 'device',
    deviceName: 'Testbrowser',
    createdAt: '2026-10-12T22:30:00Z',
    lastSuccessAt: null,
    endpointHash: 'hash-device',
  },
];
async function render(
  state: PushState = 'off',
  loadError = false,
  currentHash: string | null = null,
) {
  const push = {
    state: signal<PushState>(state),
    currentEndpointHash: vi.fn(async () => currentHash),
    refresh: vi.fn(async () => {
      if (loadError) throw new Error('offline');
      return push.state();
    }),
    enable: vi.fn(async (): Promise<PushState> => {
      push.state.set('on');
      return 'on' as const;
    }),
    disable: vi.fn(async () => {
      push.state.set('off');
      return 'off' as const;
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PushDevice, useValue: push },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ProfilePage);
  fixture.detectChanges();
  http.expectOne('/api/me').flush({
    name: 'Testperson',
    role: 'EMPLOYEE',
    entryDate: '2026-01-01',
    reminderEmailFallback: true,
  });
  http.expectOne('/api/me/passkeys').flush([]);
  await Promise.resolve();
  fixture.detectChanges();
  await Promise.resolve();
  const request = await vi.waitFor(() => http.expectOne('/api/me/push-subscriptions'));
  if (loadError) request.flush({}, { status: 503, statusText: 'Unavailable' });
  else request.flush(devices);
  await fixture.whenStable();
  return { http, fixture, push, el: fixture.nativeElement as HTMLElement };
}
function button(el: HTMLElement, label: string) {
  return [...el.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  )!;
}
describe('ReminderSettings im Profil', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it.each([
    ['unsupported', 'Dieser Browser kann keine Benachrichtigungen empfangen.'],
    ['disabled', 'Benachrichtigungen sind auf dem Server nicht eingerichtet.'],
    ['denied', 'Browsereinstellungen'],
    ['off', 'Benachrichtigungen einschalten'],
    ['on', 'Eingeschaltet'],
  ] as const)('zeigt den Gerätezustand %s', async (state, text) => {
    const { el, push } = await render(state);
    expect(el.querySelector('app-reminder-settings')?.textContent).toContain(text);
    expect(push.refresh).toHaveBeenCalledOnce();
    if (state === 'unsupported') expect(el.textContent).toContain('Zum Home-Bildschirm');
  });
  it('schaltet ein und aus und fokussiert die nächste Geräteaktion', async () => {
    const { el, http, fixture, push } = await render();
    button(el, 'Benachrichtigungen einschalten').click();
    await Promise.resolve();
    fixture.detectChanges();
    (await vi.waitFor(() => http.expectOne('/api/me/push-subscriptions'))).flush(devices);
    await fixture.whenStable();
    expect(push.enable).toHaveBeenCalledOnce();
    expect(document.activeElement?.textContent?.trim()).toBe('Testnachricht senden');
    button(el, 'Auf diesem Gerät ausschalten').click();
    await Promise.resolve();
    fixture.detectChanges();
    (await vi.waitFor(() => http.expectOne('/api/me/push-subscriptions'))).flush([]);
    await fixture.whenStable();
    expect(push.disable).toHaveBeenCalledOnce();
    expect(document.activeElement?.textContent?.trim()).toBe('Benachrichtigungen einschalten');
  });
  it('sendet eine Testnachricht und meldet die zugestellte Anzahl', async () => {
    const { el, http, fixture } = await render('on');
    button(el, 'Testnachricht senden').click();
    http
      .expectOne({ method: 'POST', url: '/api/me/push-subscriptions/test' })
      .flush({ delivered: 2 });
    await fixture.whenStable();
    expect(TestBed.inject(ToastService).message()).toContain('2');
    expect(document.activeElement?.textContent?.trim()).toBe('Testnachricht senden');
  });
  it('zeigt Berliner Gerätedaten und entfernt eine Anmeldung', async () => {
    const { el, http, fixture } = await render();
    const section = el.querySelector('app-reminder-settings')!;
    expect(section.textContent).toContain('Testbrowser');
    expect(section.textContent).toContain('13.10.2026');
    expect(section.textContent).toContain('Noch nicht erreicht');
    section.querySelector<HTMLButtonElement>('[aria-label="Gerät Testbrowser entfernen"]')!.click();
    http.expectOne({ method: 'DELETE', url: '/api/me/push-subscriptions/device' }).flush(null);
    await fixture.whenStable();
    expect(section.textContent).not.toContain('Testbrowser');
    expect(document.activeElement?.id).toBe('reminder-devices');
  });
  it('erkennt dieses Gerät und meldet es beim Entfernen auch im Browser ab', async () => {
    const { el, fixture, push } = await render('on', false, 'hash-device');
    const section = el.querySelector('app-reminder-settings')!;
    expect(section.textContent).toContain('(dieses Gerät)');
    section.querySelector<HTMLButtonElement>('[aria-label="Gerät Testbrowser entfernen"]')!.click();
    await fixture.whenStable();
    expect(push.disable).toHaveBeenCalledOnce();
    expect(section.textContent).not.toContain('Testbrowser');
    expect(section.textContent).not.toContain('Eingeschaltet');
    expect(button(el, 'Benachrichtigungen einschalten')).toBeDefined();
  });
  it('markiert fremde Geräte nicht als dieses Gerät', async () => {
    const { el } = await render('on', false, 'hash-other');
    expect(el.querySelector('app-reminder-settings')?.textContent).not.toContain('(dieses Gerät)');
  });
  it('speichert den E-Mail-Rückfall und behält bei Fehler den bestätigten Wert', async () => {
    const { el, http, fixture } = await render();
    const checkbox = el.querySelector<HTMLInputElement>('#reminder-email')!;
    expect(checkbox.checked).toBe(true);
    checkbox.click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/me/reminder-settings' });
    expect(req.request.body).toEqual({ emailFallback: false });
    req.flush({ emailFallback: false });
    await fixture.whenStable();
    expect(checkbox.checked).toBe(false);
    checkbox.click();
    http
      .expectOne('/api/me/reminder-settings')
      .flush({ message: 'Speichern fehlgeschlagen.' }, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    expect(checkbox.checked).toBe(false);
    expect(el.querySelector('app-reminder-settings [role="alert"]')?.textContent).toContain(
      'Speichern fehlgeschlagen.',
    );
  });
  it('erläutert Lernen, Schwellen und Zugriffsrechte', async () => {
    const { el } = await render();
    const text = el.querySelector('app-reminder-settings')?.textContent;
    for (const part of [
      'Was das System auswertet',
      'acht Wochen',
      'Median',
      'unter drei Werten',
      'nie an Vorgesetzte',
      'nie automatisch',
      'durchschnittlicher Verzug',
      'Vorgesetzte sehen die Werte ihres Teams',
      'Datenschutzhinweisen',
    ])
      expect(text).toContain(part);
  });
});

it('zeigt Ladefehler sicher und lässt Geräte und Status erneut laden', async () => {
  const { el, http, fixture, push } = await render('off', true);
  expect(el.querySelectorAll('app-reminder-settings [role="alert"]')).toHaveLength(2);
  push.refresh.mockResolvedValue('off');
  button(el, 'Benachrichtigungsstatus erneut laden').click();
  button(el, 'Geräte erneut laden').click();
  fixture.detectChanges();
  (await vi.waitFor(() => http.expectOne('/api/me/push-subscriptions'))).flush(devices);
  await fixture.whenStable();
  expect(el.querySelectorAll('app-reminder-settings [role="alert"]')).toHaveLength(0);
  expect(button(el, 'Benachrichtigungen einschalten')).toBeDefined();
  http.verify();
});
it('meldet verweigertes Einschalten ohne Erfolg und fokussiert den Status', async () => {
  const { el, http, fixture, push } = await render();
  push.enable.mockImplementation(async () => {
    push.state.set('denied');
    return 'denied';
  });
  button(el, 'Benachrichtigungen einschalten').click();
  await Promise.resolve();
  fixture.detectChanges();
  (await vi.waitFor(() => http.expectOne('/api/me/push-subscriptions'))).flush([]);
  await fixture.whenStable();
  expect(el.textContent).toContain('Browsereinstellungen');
  expect(document.activeElement?.id).toBe('reminder-device-state');
  expect(TestBed.inject(ToastService).message()).toBeNull();
  http.verify();
});
it('behält Geräte bei Löschfehlern und fokussiert die Fehlermeldung', async () => {
  const { el, http, fixture } = await render();
  button(el, 'Entfernen').click();
  http
    .expectOne('/api/me/push-subscriptions/device')
    .flush({ message: 'Entfernen fehlgeschlagen.' }, { status: 503, statusText: 'Unavailable' });
  await fixture.whenStable();
  expect(el.querySelector('app-reminder-settings')?.textContent).toContain('Testbrowser');
  expect(el.querySelector('app-reminder-settings [role="alert"]')?.textContent).toContain(
    'Entfernen fehlgeschlagen.',
  );
  expect(document.activeElement?.id).toBe('reminder-error');
  http.verify();
});

it('zeigt unter 640 px Gerät mit Eigenmarkierung und aufklappbaren Anmeldedaten', async () => {
  const { el, fixture } = await render('on', false, 'hash-device');
  const table = el.querySelector<HTMLTableElement>('app-reminder-settings table')!;
  const row = table.tBodies[0]!.rows[0]!;
  const headers = table.querySelectorAll('th');
  for (const [index, optional] of [false, true, true, true, false].entries()) {
    expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
    expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
  }
  const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
  expect(toggle.getAttribute('aria-label')).toBe('Details zu Testbrowser');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  fixture.detectChanges();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const details = row.nextElementSibling!;
  expect(details.classList).toContain('row-details');
  expect(details.querySelector('td')!.colSpan).toBe(headers.length);
  for (const text of [
    'Angemeldet am',
    '13.10.2026',
    'Zuletzt erreicht',
    'Noch nicht erreicht',
    'Aktion',
    'Entfernen',
  ])
    expect(details.textContent).toContain(text);
  expect(details.querySelector('button, a')).not.toBeNull();
  expect(row.cells[0]!.textContent).toContain('(dieses Gerät)');
  row.cells[0]!.click();
  fixture.detectChanges();
  expect(table.querySelector('.row-details')).toBeNull();
});
