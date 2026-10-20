import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { localDateInBerlin, type Role, type TimeEntryView, type WeekView } from '@as/shared';
import { SessionStore } from '../../core/session.store';
import { TimesPage } from './times-page';

const entry: TimeEntryView = {
  id: 'entry',
  employeeId: 'self',
  workDate: '2026-10-12',
  start: '2026-10-12T06:00:00Z',
  end: '2026-10-12T14:30:00Z',
  startLocal: '08:00',
  endLocal: '16:30',
  endsNextDay: false,
  breaks: [],
  breakMinutes: 30,
  workMinutes: 480,
  source: 'MANUAL',
  recordedAt: '2026-10-12T08:04:00Z',
  recordedAtLocal: '10:04',
  recordedByName: null,
  reason: 'Stempeln vergessen',
  late: { daysLate: 0, minutesAfterStart: 124 },
  voided: false,
  pendingCorrection: null,
  startInput: '08:00',
  endInput: '16:30',
};
const week: WeekView = {
  employeeId: 'self',
  employeeName: 'Testperson',
  week: '2026-W42',
  from: '2026-10-12',
  to: '2026-10-18',
  days: [
    {
      date: '2026-10-12',
      absence: null,
      holidayName: null,
      isWorkday: true,
      targetMinutes: 480,
      workMinutes: 480,
      balanceMinutes: 0,
      missing: false,
      entries: [entry, { ...entry, id: 'voided', voided: true }],
      flags: [{ code: 'BREAK', text: 'Pause fehlt', paragraph: '§ 4 ArbZG', level: 'crit' }],
    },
    {
      date: '2026-10-13',
      absence: null,
      holidayName: null,
      isWorkday: true,
      targetMinutes: 480,
      workMinutes: 0,
      balanceMinutes: -480,
      missing: true,
      entries: [],
      flags: [],
    },
    {
      date: '2026-10-14',
      absence: null,
      holidayName: 'Testfeiertag',
      isWorkday: false,
      targetMinutes: 0,
      workMinutes: 0,
      balanceMinutes: 0,
      missing: false,
      entries: [],
      flags: [],
    },
  ],
  totals: { workMinutes: 480, targetMinutes: 960, balanceMinutes: -480 },
  minijob: null,
  closedMonths: [],
};
const lateData = {
  from: '2026-09-01',
  to: '2026-10-12',
  thresholds: { minCount: 3, minPercent: 20, weeks: 6 },
  rows: [
    {
      employeeId: 'self',
      employeeName: 'Testperson',
      entries: 10,
      late: 3,
      percent: 30,
      averageDelayMinutes: 60,
      flagged: true,
    },
  ],
};
async function render(role: Role = 'EMPLOYEE', view = week) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const session = TestBed.inject(SessionStore).ensureLoaded();
  http
    .expectOne('/api/auth/session')
    .flush({ id: 'self', name: 'Testperson', role, method: 'CODE' });
  await session;
  const fixture = TestBed.createComponent(TimesPage);
  fixture.detectChanges();
  await Promise.resolve();
  (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/time/week'))).flush(view);
  (await vi.waitFor(() => http.expectOne('/api/time/months'))).flush([]);
  http.match('/api/time/late-entries').forEach((r) => r.flush(lateData));
  http.match((r) => r.url === '/api/time/corrections').forEach((r) => r.flush([]));
  if (role !== 'EMPLOYEE')
    http.expectOne('/api/employees').flush([{ id: 'other', name: 'Teamperson' }]);
  await fixture.whenStable();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}
function enter(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
function button(el: HTMLElement, text: string) {
  return [...el.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!;
}
describe('TimesPage', () => {
  afterEach(() => {
    const http = TestBed.inject(HttpTestingController);
    // Die Liste der eigenen Korrekturanträge lädt nach Änderungen neu; Inhalt ist hier nicht Gegenstand.
    http.match('/api/time/late-entries').forEach((r) => r.flush(lateData));
    http.match((r) => r.url === '/api/time/corrections').forEach((r) => r.flush([]));
    http.verify();
  });
  it('exportiert PDF und CSV für den gewählten Monat und die gewählte Person', async () => {
    const { el, fixture, http } = await render('LEAD');
    const month = el.querySelector<HTMLInputElement>('#time-export-month');
    expect(month).not.toBeNull();
    expect(month!.value).toMatch(/^\d{4}-\d{2}$/);
    enter(el, '#time-export-month', '2026-09');
    await fixture.whenStable();
    expect(
      el.querySelector('a[download][aria-label="Monat als PDF exportieren"]')?.getAttribute('href'),
    ).toBe('/api/exports/time?month=2026-09&format=pdf');
    const person = el.querySelector<HTMLSelectElement>('#time-employee')!;
    person.value = 'other';
    person.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/time/week'))).flush({
      ...week,
      employeeId: 'other',
    });
    await fixture.whenStable();
    for (const format of ['pdf', 'csv']) {
      expect(
        el
          .querySelector(`a[download][aria-label="Monat als ${format.toUpperCase()} exportieren"]`)
          ?.getAttribute('href'),
      ).toBe(`/api/exports/time?month=2026-09&format=${format}&employeeId=other`);
    }
    el.querySelector<HTMLButtonElement>('[aria-label="Nächste Woche"]')!.click();
    fixture.detectChanges();
    const next = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/time/week'));
    next.flush(week);
    await fixture.whenStable();
    expect(month!.value).not.toBe('2026-09');
    enter(el, '#time-export-month', '');
    await fixture.whenStable();
    expect(el.querySelector('a[download]')).toBeNull();
  });
  it('zeigt unter 640 px Zeitspanne und Nachtrag und klappt Details mit Aktionen auf', async () => {
    const { el, fixture } = await render();
    const row = el.querySelector<HTMLTableRowElement>('tr[data-entry-id="entry"]')!;
    const narrow = row.querySelector('td.col-narrow')!;
    // Zeitspanne oben, Markierungen darunter (Review Design, Befund 1).
    expect(narrow.querySelector('span.whitespace-nowrap')?.textContent?.trim()).toBe('08:00–16:30');
    expect(narrow.querySelector('.pill.lv-warn')?.textContent?.trim()).toBe('Nachtrag');
    // Arbeitszeit steht mit in der kompakten Zelle; die eigene Spalte ist auf dem Handy ausgeblendet.
    expect(narrow.textContent).toContain('8:00 Std.');
    const headers = [...el.querySelectorAll('table.data-table')[0]!.querySelectorAll('th')];
    expect(headers.find((th) => th.textContent?.trim() === 'Arbeitszeit')?.classList).toContain(
      'col-opt',
    );
    for (const cell of [...row.querySelectorAll('td')].filter((td) =>
      td.classList.contains('col-opt'),
    ))
      expect(cell.classList).not.toContain('col-narrow');
    const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
    expect(toggle.getAttribute('aria-label')).toMatch(/^Details zu .+, 08:00$/);
    toggle.click();
    fixture.detectChanges();
    const details = row.nextElementSibling!;
    expect(details.classList).toContain('row-details');
    expect(details.textContent).toContain('Pause');
    expect(details.textContent).toContain('30 Min.');
    expect(details.textContent).toContain('Soll');
    expect(details.textContent).toContain('Grund: Stempeln vergessen');
    expect(details.querySelector('button')).not.toBeNull();
  });
  it('zeigt Regelhinweis und Korrekturantrag auch in der zugeklappten Zeile (Review Design, Befund 3)', async () => {
    const { el } = await render('EMPLOYEE', {
      ...week,
      days: [
        {
          ...week.days[0]!,
          entries: [{ ...entry, pendingCorrection: { id: 'req', kind: 'EDIT' } as never }],
        },
      ],
    });
    const narrow = el.querySelector('tr[data-entry-id="entry"] td.col-narrow')!;
    expect(narrow.querySelector('.pill.lv-crit')?.textContent?.trim()).toBe('1 Hinweis');
    expect(narrow.textContent).toContain('Korrektur beantragt');
  });
  it('zeigt Nachträge, fehlende und ungültige Buchungen, Feiertage und Regelstufen', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('Nachgetragen um 10:04, 2:04 Std. nach Beginn');
    expect(el.textContent).toContain('Keine Buchung');
    expect(el.textContent).toContain('Testfeiertag');
    expect(el.textContent).toContain('ungültig');
    expect(el.querySelector('app-rule-messages .lv-crit')?.textContent).toContain('§ 4 ArbZG');
    expect(el.querySelector('#time-employee')).toBeNull();
  });
  it('sendet Nachträge mit Pausenliste und offenem Ende heute und zeigt API-Fehler', async () => {
    const { el, fixture, http } = await render();
    const form = el.querySelector<HTMLElement>('app-entry-form')!;
    enter(form, '[name="date"]', localDateInBerlin(new Date()));
    enter(form, '[name="start"]', '08:00');
    enter(form, '[name="end"]', '');
    enter(form, '[name="reason"]', ' Vergessen ');
    button(form, 'Pause hinzufügen').click();
    await fixture.whenStable();
    enter(form, '[name="break-start-0"]', '12:00');
    enter(form, '[name="break-end-0"]', '12:30');
    await fixture.whenStable();
    form.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const req = http.expectOne({ method: 'POST', url: '/api/time/entries' });
    expect(req.request.body).toEqual({
      date: localDateInBerlin(new Date()),
      start: '08:00',
      end: null,
      breaks: [{ start: '12:00', end: '12:30' }],
      reason: 'Vergessen',
    });
    req.flush({ message: 'Der Monat ist abgeschlossen.' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Der Monat ist abgeschlossen.',
    );
  });
  it.each(['EMPLOYEE', 'ADMIN'] as const)(
    'verlangt einen Grund für Korrekturen als %s',
    async (role) => {
      const { el, fixture, http } = await render(role);
      const label = role === 'EMPLOYEE' ? 'Korrektur beantragen' : 'Korrigieren';
      button(el, label).click();
      await fixture.whenStable();
      const form = el.querySelector<HTMLElement>('app-entry-form[data-correction]')!;
      expect(button(form, label).disabled).toBe(true);
      enter(form, '[name="reason"]', '   ');
      await fixture.whenStable();
      expect(button(form, label).disabled).toBe(true);
      enter(form, '[name="reason"]', 'Zeit berichtigen');
      await fixture.whenStable();
      button(form, label).click();
      const req = http.expectOne('/api/time/entries/entry/correct');
      expect(req.request.body.reason).toBe('Zeit berichtigen');
      req.flush({ applied: role === 'ADMIN', entry, request: null });
      await Promise.resolve();
      fixture.detectChanges();
      await Promise.resolve();
      (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/time/week'))).flush(week);
      http.match('/api/time/late-entries').forEach((r) => r.flush(lateData));
      http.match((r) => r.url === '/api/time/corrections').forEach((r) => r.flush([]));
      await fixture.whenStable();
    },
  );
  it('korrigiert als Vorgesetzte fremde Zeiten direkt und adressiert Nachträge an die ausgewählte Person', async () => {
    const { el, fixture, http } = await render('LEAD');
    expect(button(el, 'Korrektur beantragen')).toBeDefined();
    const select = el.querySelector<HTMLSelectElement>('#time-employee')!;
    select.value = 'other';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await Promise.resolve();
    const req = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/time/week'));
    expect(req.request.params.get('employeeId')).toBe('other');
    req.flush({
      ...week,
      employeeId: 'other',
      employeeName: 'Teamperson',
      days: [{ ...week.days[0], entries: [{ ...entry, employeeId: 'other' }] }],
    });
    await fixture.whenStable();
    expect(button(el, 'Korrigieren')).toBeDefined();
    expect(button(el, 'Korrektur beantragen')).toBeUndefined();
    expect(el.textContent).toContain('Zeit nachtragen für Teamperson');
    const form = el.querySelector<HTMLElement>('app-entry-form')!;
    enter(form, '[name="reason"]', 'Nachtrag im Auftrag');
    await fixture.whenStable();
    button(form, 'Nachtrag speichern').click();
    const save = http.expectOne('/api/time/entries');
    expect(save.request.body.employeeId).toBe('other');
    save.flush({ message: 'Bitte prüfen.' }, { status: 422, statusText: 'Unprocessable Entity' });
    await fixture.whenStable();
  });
  it('zeigt Revisionen mit Person, Grund und Berliner Zeiten', async () => {
    const { el, fixture, http } = await render();
    button(el, 'Verlauf').click();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne('/api/time/entries/entry/revisions'))).flush([
      {
        id: 'revision',
        changedAt: '2026-10-13T08:00:00Z',
        changedByName: 'Testleitung',
        reason: 'Ende korrigiert',
        before: {
          start: '2026-10-12T06:00:00Z',
          end: '2026-10-12T14:00:00Z',
          breaks: [{ start: '2026-10-12T10:00:00Z', end: '2026-10-12T10:30:00Z' }],
          voided: false,
        },
        after: {
          start: '2026-10-12T06:00:00Z',
          end: '2026-10-12T14:30:00Z',
          breaks: [],
          voided: true,
        },
      },
    ]);
    await fixture.whenStable();
    const history = el.querySelector('app-entry-history')!.textContent;
    expect(history).toContain('Testleitung');
    expect(history).toContain('Ende korrigiert');
    expect(history).toContain('08:00');
    expect(history).toContain('16:30');
    expect(history).toContain('12:00');
    expect(history).toContain('ungültig');
  });
  it('zieht eigene offene Anträge zurück', async () => {
    const { el, fixture, http } = await render('EMPLOYEE', {
      ...week,
      days: [
        {
          ...week.days[0]!,
          entries: [
            {
              ...entry,
              pendingCorrection: {
                id: 'pending',
                kind: 'VOID',
                proposed: null,
                reason: 'Doppelt',
                requestedAt: '2026-10-12T15:00:00Z',
              },
            },
          ],
        },
      ],
    });
    expect(el.textContent).toContain('Korrektur beantragt');
    expect(button(el, 'Korrektur beantragen')).toBeUndefined();
    button(el, 'Antrag zurückziehen').click();
    http.expectOne({ method: 'POST', url: '/api/time/corrections/pending/withdraw' }).flush({});
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/time/week'))).flush(week);
    http.match('/api/time/late-entries').forEach((r) => r.flush(lateData));
    http.match((r) => r.url === '/api/time/corrections').forEach((r) => r.flush([]));
    await fixture.whenStable();
    expect(button(el, 'Antrag zurückziehen')).toBeUndefined();
  });
  it('fragt vor dem Monatsabschluss nach und lädt den Status neu', async () => {
    const { el, fixture, http } = await render();
    const closeButton = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().endsWith('abschließen'),
    )!;
    closeButton.click();
    await fixture.whenStable();
    http.expectNone((r) => r.method === 'POST');
    const confirm = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('endgültig abschließen'),
    )!;
    confirm.click();
    const req = http.expectOne((r) => r.url.endsWith('/close'));
    const month = req.request.url.split('/').at(-2)!;
    req.flush({ month, confirmedAt: '2026-10-12T08:00:00Z', reopenedAt: null });
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne('/api/time/months'))).flush([
      { month, confirmedAt: '2026-10-12T08:00:00Z', reopenedAt: null },
    ]);
    http.expectOne((r) => r.url === '/api/time/week').flush(week);
    await fixture.whenStable();
    expect(el.textContent).toContain('abgeschlossen am');
  });
  it('zeigt Ladefehler sicher und erlaubt erneutes Laden', async () => {
    const { el, fixture, http } = await render();
    el.querySelector<HTMLButtonElement>('[aria-label="Nächste Woche"]')!.click();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/time/week'))).flush(
      { message: 'Woche nicht verfügbar.' },
      { status: 503, statusText: 'Unavailable' },
    );
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Woche nicht verfügbar.');
    button(el, 'Woche erneut laden').click();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/time/week'))).flush(week);
    await fixture.whenStable();
    expect(el.textContent).toContain('Keine Buchung');
  });

  it('zeigt Keine Buchung auch wenn nur ungültige Buchungen existieren', async () => {
    const { el } = await render('EMPLOYEE', {
      ...week,
      days: [
        {
          ...week.days[0]!,
          missing: true,
          workMinutes: 0,
          balanceMinutes: -480,
          entries: [{ ...entry, voided: true }],
        },
      ],
    });
    expect(el.textContent).toContain('ungültig');
    expect(el.textContent).toContain('Keine Buchung');
  });
  it('zeigt Nachträge an Folgetagen, Mitternachtsende und den Minijob-Monat ohne Soll', async () => {
    const { el } = await render('EMPLOYEE', {
      ...week,
      days: [
        {
          ...week.days[0]!,
          entries: [
            {
              ...entry,
              endLocal: '02:00',
              endsNextDay: true,
              recordedAt: '2026-10-14T08:00:00Z',
              recordedByName: 'Testleitung',
              late: { daysLate: 2, minutesAfterStart: null },
            },
          ],
        },
      ],
      minijob: {
        month: '2026-10',
        workMinutes: 2700,
        hourlyWageCents: 1500,
        earningsCents: 67500,
        limitCents: 60300,
        ratio: 67500 / 60300,
        level: 'crit',
      },
    });
    expect(el.textContent).toContain('Nachgetragen am 14.10. durch Testleitung');
    expect(el.textContent).toContain('+1');
    expect(el.textContent).toContain('Grenze überschritten.');
    expect(el.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('100');
    const cells = el.querySelectorAll('tbody tr')[0]!.querySelectorAll('td');
    // Spalte 1 ist die kompakte Zeitspanne für schmale Bildschirme; Soll und Saldo folgen nach Arbeitszeit.
    expect(cells[6]?.textContent?.trim()).toBe('–');
    expect(cells[7]?.textContent?.trim()).toBe('–');
    expect(el.textContent).toContain('spätestens am 7. Kalendertag');
  });

  it('zeigt eigene Korrekturanträge mit Ablehnungsgrund', async () => {
    const { el, fixture, http } = await render();
    // Die Liste wurde beim Rendern leer geladen; neu laden mit einem abgelehnten Antrag.
    fixture.componentInstance['requests'].reload();
    (await vi.waitFor(() => http.expectOne('/api/time/corrections'))).flush([
      {
        id: 'r1',
        entryId: 'e1',
        employeeId: 'self',
        employeeName: 'Testperson',
        workDate: '2026-10-09',
        kind: 'CORRECT',
        current: { start: '08:00', end: '16:00', breakMinutes: 30 },
        proposed: null,
        reason: 'Früher angefangen',
        requestedAt: '2026-10-10T08:00:00Z',
        status: 'REJECTED',
        decidedByName: 'Tobias Lechner',
        decidedAt: '2026-10-11T08:00:00Z',
        decisionReason: 'Laut Zutrittsprotokoll erst ab 08:00.',
      },
    ]);
    await fixture.whenStable();
    expect(el.textContent).toContain('Meine Korrekturanträge');
    expect(el.textContent).toContain('abgelehnt');
    expect(el.textContent).toContain('Laut Zutrittsprotokoll erst ab 08:00.');
  });
  it('übernimmt die zweite Stunde der Zeitumstellung in die Korrektur und fokussiert danach die Buchung', async () => {
    const dst: TimeEntryView = {
      ...entry,
      id: 'dst',
      workDate: '2025-10-26',
      start: '2025-10-26T01:30:00Z',
      end: '2025-10-26T02:30:00Z',
      startLocal: '02:30',
      endLocal: '03:30',
      startInput: '02:30W',
      endInput: '03:30',
      breakMinutes: 0,
      workMinutes: 60,
    };
    const view: WeekView = {
      ...week,
      days: [{ ...week.days[0]!, date: '2025-10-26', entries: [dst], flags: [] }],
    };
    const { el, fixture, http } = await render('EMPLOYEE', view);
    button(el, 'Korrektur beantragen').click();
    await fixture.whenStable();
    const form = el.querySelector<HTMLElement>('[data-correction]')!;
    const second = form.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(second.checked).toBe(true);
    expect(second.parentElement?.textContent).toContain('zweite Stunde (Winterzeit)');
    enter(form, '[name="reason"]', 'Ende berichtigt');
    await fixture.whenStable();
    button(form, 'Korrektur beantragen').click();
    const req = http.expectOne('/api/time/entries/dst/correct');
    expect(req.request.body).toMatchObject({ start: '02:30W', end: '03:30' });
    req.flush({ applied: false, request: null });
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/time/week'))).flush(view);
    http.match('/api/time/late-entries').forEach((r) => r.flush(lateData));
    http.match((r) => r.url === '/api/time/corrections').forEach((r) => r.flush([]));
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute('data-entry-focus')).toBe('dst'),
    );
  });
  it('lässt den Admin auch den eigenen abgeschlossenen Monat wieder öffnen', async () => {
    const { el, fixture, http } = await render('ADMIN', { ...week, closedMonths: ['2026-10'] });
    const reopen = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().endsWith('wieder öffnen'),
    );
    expect(reopen).toBeDefined();
    reopen!.click();
    http
      .expectOne({ method: 'POST', url: '/api/time/months/self/2026-10/reopen' })
      .flush({ month: '2026-10', confirmedAt: '2026-10-01T08:00:00Z', reopenedAt: null });
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/time/week'))).flush(week);
    await fixture.whenStable();
  });
});

describe('TimesPage Abwesenheiten', () => {
  it.each([false, true])('zeigt Urlaub statt frei, halber Tag: %s', async (half) => {
    const { el } = await render('EMPLOYEE', {
      ...week,
      days: [{ ...week.days[1]!, absence: { type: 'VACATION', half }, missing: false }],
    });
    const row = el.querySelector('tbody tr')!;
    expect(row.textContent).toContain(half ? 'Urlaub · halber Tag' : 'Urlaub');
    expect(row.textContent).not.toContain('frei');
    expect(row.textContent).not.toContain('Keine Buchung');
  });

  it('zeigt Abwesenheit unter dem Datum und ABSENCE_WORK als Info', async () => {
    const { el } = await render('EMPLOYEE', {
      ...week,
      days: [
        {
          ...week.days[0]!,
          absence: { type: 'SPECIAL_LEAVE', half: true },
          flags: [{ code: 'ABSENCE_WORK', level: 'info', text: 'Buchung an einem Urlaubstag' }],
        },
      ],
    });
    expect(el.querySelector('tbody td .text-muted')?.textContent).toContain(
      'Sonderurlaub · halber Tag',
    );
    expect(el.querySelector('app-rule-messages .lv-info')?.textContent).toContain(
      'Buchung an einem Urlaubstag',
    );
  });
});

describe('TimesPage Nachtragsquote', () => {
  it('zeigt die eigene Quote mit Schwellen und blendet sie für andere Personen aus', async () => {
    const { el, http, fixture } = await render('LEAD');
    expect(el.textContent).toContain(
      'Deine Nachträge in den letzten 6 Wochen: 3 von 10 Buchungen (30 %).',
    );
    expect(el.querySelector('[data-late-summary] .pill')?.textContent).toBe('auffällig');
    expect(el.textContent).toContain('Ab 3 Nachträgen und 20 % gilt das als auffällig.');
    const select = el.querySelector<HTMLSelectElement>('#time-employee')!;
    select.value = 'other';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/time/week'))).flush({
      ...week,
      employeeId: 'other',
    });
    await fixture.whenStable();
    expect(el.querySelector('[data-late-summary]')).toBeNull();
    http.expectNone('/api/time/late-entries');
  });
});

it.each([
  { type: 'SICK' as const, sinceLocal: '11:30', text: 'krank seit 11:30 Uhr' },
  { type: 'CHILD_SICK' as const, sinceLocal: null, text: 'Kind krank' },
  { type: 'NEUTRAL' as const, sinceLocal: null, text: 'abwesend' },
])('zeigt $text an Krankheitstagen', async ({ type, sinceLocal, text }) => {
  const { el } = await render('EMPLOYEE', {
    ...week,
    days: [
      { ...week.days[0]!, absence: { type, sinceLocal, half: false } },
      { ...week.days[1]!, absence: { type, sinceLocal, half: false } },
    ],
  });
  expect(el.querySelector('tbody')?.textContent).toContain(text);
});
