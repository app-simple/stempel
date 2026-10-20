import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { HolidayView, Role, SchoolHolidayView } from '@as/shared';
import { SessionStore } from '../../core/session.store';
import { HolidaysPage } from './holidays-page';

const holiday: HolidayView = {
  id: 'holiday-1',
  date: '2026-08-15',
  name: 'Mariä Himmelfahrt',
  origin: 'STATUTORY',
  active: true,
  editable: true,
};
const schoolHoliday: SchoolHolidayView = {
  id: 'school-1',
  name: 'Herbstferien',
  from: '2026-11-02',
  to: '2026-11-06',
  active: true,
};
async function render(role: Role) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const loading = TestBed.inject(SessionStore).reload();
  http
    .expectOne('/api/auth/session')
    .flush({ id: 'test', name: 'Testperson', role, method: 'EMAIL_CODE' });
  await loading;
  const fixture = TestBed.createComponent(HolidaysPage);
  fixture.detectChanges();
  await Promise.resolve();
  http
    .expectOne((r) => r.url === '/api/holidays?year=' + new Date().getFullYear())
    .flush([holiday, { ...holiday, id: 'past', name: 'Unveränderlich', editable: false }]);
  http.expectOne('/api/school-holidays?year=' + new Date().getFullYear()).flush([schoolHoliday]);
  if (role === 'ADMIN')
    http.expectOne('/api/settings/company').flush({ state: 'BY', assumptionDayIsHoliday: true });
  await fixture.whenStable();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}

describe('HolidaysPage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('zeigt Admin-Einstellungen und nur bei bearbeitbaren Tagen Aktionen', async () => {
    const { el } = await render('ADMIN');
    expect(el.textContent).toContain('Einstellungen');
    expect(el.textContent).toContain('Eigenen Feiertag anlegen');
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0]?.textContent).toContain('Umbenennen');
    expect(rows[0]?.textContent).not.toContain('Löschen');
    expect(rows[1]?.querySelector('button.btn')).toBeNull();
  });
  it('zeigt Mitarbeitern nur die Liste und lädt keine Einstellungen', async () => {
    const { el, http } = await render('EMPLOYEE');
    expect(el.textContent).toContain('Mariä Himmelfahrt');
    expect(el.textContent).not.toContain('Einstellungen');
    expect(el.textContent).not.toContain('Eigenen Feiertag anlegen');
    expect(el.querySelector('tbody button.btn')).toBeNull();
    http.expectNone('/api/settings/company');
  });
});

describe('HolidaysPage Änderungen', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('schaltet Feiertage ab, benennt um und lädt die Liste nach Änderungen neu', async () => {
    const { fixture, http, el } = await render('ADMIN');
    const button = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === text,
      )!;
    button('Abschalten').click();
    const toggle = http.expectOne({ method: 'PATCH', url: '/api/holidays/holiday-1' });
    expect(toggle.request.body).toEqual({ active: false });
    toggle.flush({ ...holiday, active: false });
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne((r) => r.url.startsWith('/api/holidays?')))).flush([
      { ...holiday, active: false },
    ]);
    await fixture.whenStable();
    expect(el.querySelector('tbody .lv-mute')?.textContent).toContain('abgeschaltet');
    button('Umbenennen').click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Neuer Name"]')!;
    input.value = 'Neuer Feiertagsname';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    button('Speichern').click();
    const rename = http.expectOne({ method: 'PATCH', url: '/api/holidays/holiday-1' });
    expect(rename.request.body).toEqual({ name: 'Neuer Feiertagsname' });
    rename.flush({ ...holiday, name: 'Neuer Feiertagsname' });
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne((r) => r.url.startsWith('/api/holidays?')))).flush([
      { ...holiday, name: 'Neuer Feiertagsname' },
    ]);
    await fixture.whenStable();
    expect(el.textContent).toContain('Neuer Feiertagsname');
  });
  it('behält bei einem Einstellungsfehler den bestätigten Wert und zeigt den Fehler', async () => {
    const { fixture, http, el } = await render('ADMIN');
    const checkbox = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.click();
    const request = http.expectOne({ method: 'PATCH', url: '/api/settings/company' });
    expect(request.request.body).toEqual({ assumptionDayIsHoliday: false });
    request.flush(
      { message: 'Speichern fehlgeschlagen.' },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    expect(checkbox.checked).toBe(true);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Speichern fehlgeschlagen.');
    checkbox.click();
    http.expectOne('/api/settings/company').flush({ state: 'BY', assumptionDayIsHoliday: false });
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne((r) => r.url.startsWith('/api/holidays?')))).flush([]);
    await fixture.whenStable();
    expect(checkbox.checked).toBe(false);
  });
});

describe('HolidaysPage eigene Feiertage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('legt einen eigenen Tag an, löscht nach Rückfrage und wechselt das Jahr', async () => {
    const { fixture, http, el } = await render('ADMIN');
    const button = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === text,
      )!;
    const date = `${new Date().getFullYear()}-12-31`;
    const input = (id: string, value: string) => {
      const field = el.querySelector<HTMLInputElement>(`#${id}`)!;
      field.value = value;
      field.dispatchEvent(new Event('input'));
    };
    input('holiday-date', date);
    input('holiday-name', 'Betriebsfeiertag');
    await fixture.whenStable();
    button('Feiertag anlegen').click();
    const request = http.expectOne({ method: 'POST', url: '/api/holidays' });
    expect(request.request.body).toEqual({ date, name: 'Betriebsfeiertag' });
    const manual = { ...holiday, id: 'manual', date, name: 'Betriebsfeiertag', origin: 'MANUAL' };
    request.flush(manual);
    (await vi.waitFor(() => http.expectOne((r) => r.url.startsWith('/api/holidays?')))).flush([
      manual,
    ]);
    await fixture.whenStable();
    button('Löschen').click();
    await fixture.whenStable();
    http.expectNone({ method: 'DELETE', url: '/api/holidays/manual' });
    button('Wirklich löschen').click();
    http.expectOne({ method: 'DELETE', url: '/api/holidays/manual' }).flush(null);
    (await vi.waitFor(() => http.expectOne((r) => r.url.startsWith('/api/holidays?')))).flush([]);
    await fixture.whenStable();
    expect(el.textContent).toContain('Keine Feiertage für dieses Jahr.');
    button('← Jahr').click();
    (
      await vi.waitFor(() => http.expectOne(`/api/holidays?year=${new Date().getFullYear() - 1}`))
    ).flush([]);
    (
      await vi.waitFor(() =>
        http.expectOne(`/api/school-holidays?year=${new Date().getFullYear() - 1}`),
      )
    ).flush([]);
    await fixture.whenStable();
    expect(el.textContent).not.toContain('Eigenen Feiertag anlegen');
    button('Heute').click();
    (
      await vi.waitFor(() => http.expectOne(`/api/holidays?year=${new Date().getFullYear()}`))
    ).flush([]);
    (
      await vi.waitFor(() =>
        http.expectOne(`/api/school-holidays?year=${new Date().getFullYear()}`),
      )
    ).flush([schoolHoliday]);
    await fixture.whenStable();
    expect(el.textContent).toContain('Eigenen Feiertag anlegen');
  });
});

it('zeigt unter 640 px Datum und Name mit Feiertagsart und Aktionen', async () => {
  const { el, fixture } = await render('ADMIN');
  const table = el.querySelector<HTMLTableElement>('table')!;
  const row = table.tBodies[0]!.rows[0]!;
  const headers = table.querySelectorAll('th');
  for (const [index, optional] of [false, false, true, true, false].entries()) {
    expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
    expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
  }
  const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
  expect(toggle.getAttribute('aria-label')).toBe('Details zu Mari\u00e4 Himmelfahrt, 15.08.2026');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  fixture.detectChanges();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const details = row.nextElementSibling!;
  expect(details.classList).toContain('row-details');
  expect(details.querySelector('td')!.colSpan).toBe(headers.length);
  for (const text of ['Art', 'gesetzlich', 'Aktion', 'Abschalten', 'Umbenennen'])
    expect(details.textContent).toContain(text);
  expect(details.querySelector('button, a')).not.toBeNull();

  row.cells[0]!.click();
  fixture.detectChanges();
  expect(table.querySelector('.row-details')).toBeNull();
});

function schoolSection(el: HTMLElement): HTMLElement {
  return [...el.querySelectorAll<HTMLElement>('section')].find(
    (s) => s.querySelector('h2')?.textContent === 'Schulferien',
  )!;
}
function clickText(el: HTMLElement, text: string) {
  [...el.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => b.textContent?.trim() === text)!
    .click();
}
function schoolInput(el: HTMLElement, id: string, value: string) {
  const input = el.querySelector<HTMLInputElement>('#' + id)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
describe('HolidaysPage Schulferien', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.useRealTimers();
  });
  it.each(['EMPLOYEE', 'LEAD'] as const)(
    'zeigt %s nur die Liste und aufklappbare Details',
    async (role) => {
      const { el, fixture } = await render(role);
      const section = schoolSection(el);
      expect(section.textContent).toContain('Herbstferien');
      expect(section.textContent).toContain('02.11.–06.11.2026');
      expect(section.querySelector('button.btn')).toBeNull();
      expect(section.querySelector('form')).toBeNull();
      const toggle = section.querySelector<HTMLButtonElement>('app-row-toggle button')!;
      toggle.click();
      await fixture.whenStable();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(section.querySelector('.row-details')?.textContent).toContain('Aktiv');
    },
  );
  it('legt Ferien an, bearbeitet alle Felder und löscht erst nach Bestätigung', async () => {
    const { el, fixture, http } = await render('ADMIN');
    const section = schoolSection(el);
    schoolInput(el, 'school-name', ' Testferien ');
    schoolInput(el, 'school-from', '2026-12-01');
    schoolInput(el, 'school-to', '2026-12-04');
    await fixture.whenStable();
    clickText(section, 'Schulferien anlegen');
    const post = http.expectOne({ method: 'POST', url: '/api/school-holidays' });
    expect(post.request.body).toEqual({ name: 'Testferien', from: '2026-12-01', to: '2026-12-04' });
    const created = { ...schoolHoliday, ...post.request.body, id: 'new' };
    post.flush(created);
    (await vi.waitFor(() => http.expectOne('/api/school-holidays?year=2026'))).flush([created]);
    await fixture.whenStable();
    clickText(section, 'Bearbeiten');
    await fixture.whenStable();
    expect(document.activeElement?.id).toBe('school-name');
    schoolInput(el, 'school-name', 'Geänderte Ferien');
    schoolInput(el, 'school-from', '2026-12-02');
    schoolInput(el, 'school-to', '2026-12-05');
    section.querySelector<HTMLInputElement>('#school-active')!.click();
    await fixture.whenStable();
    clickText(section, 'Schulferien speichern');
    const patch = http.expectOne({ method: 'PATCH', url: '/api/school-holidays/new' });
    expect(patch.request.body).toEqual({
      name: 'Geänderte Ferien',
      from: '2026-12-02',
      to: '2026-12-05',
      active: false,
    });
    const updated = { ...created, ...patch.request.body };
    patch.flush(updated);
    (await vi.waitFor(() => http.expectOne('/api/school-holidays?year=2026'))).flush([updated]);
    await fixture.whenStable();
    expect(section.textContent).toContain('abgeschaltet');
    clickText(section, 'Löschen');
    await fixture.whenStable();
    http.expectNone({ method: 'DELETE', url: '/api/school-holidays/new' });
    clickText(section, 'Abbrechen');
    await fixture.whenStable();
    http.expectNone({ method: 'DELETE', url: '/api/school-holidays/new' });
    clickText(section, 'Löschen');
    await fixture.whenStable();
    clickText(section, 'Wirklich löschen');
    http.expectOne({ method: 'DELETE', url: '/api/school-holidays/new' }).flush(null);
    (await vi.waitFor(() => http.expectOne('/api/school-holidays?year=2026'))).flush([]);
    await fixture.whenStable();
    expect(section.textContent).toContain('Keine Schulferien für dieses Jahr.');
  });
  it('übernimmt nur ausgewählte Vorlagen und zeigt danach keine weiteren Termine', async () => {
    const { el, fixture, http } = await render('ADMIN');
    const section = schoolSection(el);
    clickText(section, 'Vorlage übernehmen');
    await fixture.whenStable();
    const choices = [
      ...section.querySelectorAll<HTMLInputElement>(
        '[data-school-suggestions] input[type="checkbox"]',
      ),
    ];
    expect(choices).toHaveLength(2);
    expect(choices.every((c) => c.checked)).toBe(true);
    choices[0]!.click();
    await fixture.whenStable();
    clickText(section, 'Übernehmen');
    const post = http.expectOne({ method: 'POST', url: '/api/school-holidays' });
    expect(post.request.body).toEqual({
      name: 'Weihnachtsferien',
      from: '2026-12-24',
      to: '2027-01-08',
    });
    post.flush({ id: 'christmas', active: true, ...post.request.body });
    (await vi.waitFor(() => http.expectOne('/api/school-holidays?year=2026'))).flush([
      schoolHoliday,
      { id: 'summer', name: 'Sommerferien', from: '2026-08-03', to: '2026-09-14', active: true },
      {
        id: 'christmas',
        name: 'Weihnachtsferien',
        from: '2026-12-24',
        to: '2027-01-08',
        active: true,
      },
    ]);
    await fixture.whenStable();
    http.expectNone({ method: 'POST', url: '/api/school-holidays' });
    clickText(section, 'Vorlage übernehmen');
    await fixture.whenStable();
    expect(section.textContent).toContain(
      'Für 2026 gibt es keine weiteren Termine in der Vorlage.',
    );
  });
  // Review Web Phase 7, Befund 2: Ein anderer Tab hat denselben Zeitraum schon übernommen (409).
  it('zählt beim Vorlagenimport schon angelegte Zeiträume nicht als Fehler', async () => {
    const { el, fixture, http } = await render('ADMIN');
    const section = schoolSection(el);
    clickText(section, 'Vorlage übernehmen');
    await fixture.whenStable();
    clickText(section, 'Übernehmen');
    const first = http.expectOne({ method: 'POST', url: '/api/school-holidays' });
    first.flush(
      { message: 'Diese Schulferien sind schon angelegt.' },
      { status: 409, statusText: 'Conflict' },
    );
    const second = await vi.waitFor(() =>
      http.expectOne({ method: 'POST', url: '/api/school-holidays' }),
    );
    second.flush({ id: 'christmas', active: true, ...second.request.body });
    (await vi.waitFor(() => http.expectOne('/api/school-holidays?year=2026'))).flush([
      schoolHoliday,
    ]);
    await fixture.whenStable();
    expect(section.querySelector('[role="alert"]')).toBeNull();
    expect(section.querySelector('[role="status"]')?.textContent).toContain(
      'Ausgewählte Schulferien übernommen; 1 Zeitraum war schon angelegt.',
    );
  });
  it('behält bei teilweise fehlgeschlagenem Vorlagenimport nur die übrigen Termine zur Wiederholung', async () => {
    const { el, fixture, http } = await render('ADMIN');
    const section = schoolSection(el);
    clickText(section, 'Vorlage übernehmen');
    await fixture.whenStable();
    clickText(section, 'Übernehmen');
    const first = http.expectOne({ method: 'POST', url: '/api/school-holidays' });
    expect(first.request.body.name).toBe('Sommerferien');
    first.flush({ id: 'summer', active: true, ...first.request.body });
    const second = await vi.waitFor(() =>
      http.expectOne({ method: 'POST', url: '/api/school-holidays' }),
    );
    expect(second.request.body.name).toBe('Weihnachtsferien');
    second.flush(
      { message: 'Bitte erneut versuchen.' },
      { status: 503, statusText: 'Unavailable' },
    );
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(section.querySelector('[role="alert"]')?.textContent).toContain(
        'Bitte erneut versuchen.',
      ),
    );
    const choices = section.querySelectorAll<HTMLInputElement>('[data-school-suggestions] input');
    expect(choices).toHaveLength(1);
    expect(choices[0]!.checked).toBe(true);
    clickText(section, 'Übernehmen');
    const retry = http.expectOne({ method: 'POST', url: '/api/school-holidays' });
    expect(retry.request.body.name).toBe('Weihnachtsferien');
    retry.flush({ id: 'christmas', active: true, ...retry.request.body });
    (await vi.waitFor(() => http.expectOne('/api/school-holidays?year=2026'))).flush([
      schoolHoliday,
    ]);
    await fixture.whenStable();
    expect(section.querySelector('[role="alert"]')).toBeNull();
    expect(section.querySelector('[role="status"]')?.textContent).toContain(
      'Ausgewählte Schulferien übernommen.',
    );
  });
  it('zeigt Ferienfehler der API wörtlich und behält die Eingaben', async () => {
    const { el, fixture, http } = await render('ADMIN');
    schoolInput(el, 'school-name', 'Testferien');
    schoolInput(el, 'school-from', '2026-11-06');
    schoolInput(el, 'school-to', '2026-11-02');
    await fixture.whenStable();
    clickText(schoolSection(el), 'Schulferien anlegen');
    http
      .expectOne('/api/school-holidays')
      .flush(
        { message: 'Das Ende der Ferien liegt vor dem Beginn.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Das Ende der Ferien liegt vor dem Beginn.',
    );
    expect(el.querySelector<HTMLInputElement>('#school-name')?.value).toBe('Testferien');
  });
});
