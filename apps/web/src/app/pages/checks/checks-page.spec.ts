import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type ChecksView, type LeaveNoticeView, type Role, type SickChecksView } from '@as/shared';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { ChecksPage } from './checks-page';

const notice: LeaveNoticeView = {
  id: 'notice',
  employeeId: 'a',
  employeeName: 'Testperson A',
  year: 2026,
  restHalfDays: 5,
  text: 'Hallo Testperson,\nbitte nimm deinen Resturlaub.',
  sentAt: '2026-10-01T22:30:00Z',
  sentByName: 'Testadmin',
  emailSentAt: null,
  readAt: '2026-10-03T09:00:00Z',
  timelyForYearEnd: false,
  timelyForMarch31: true,
};
const reminderSettings = {
  defaultStart: '08:00',
  lateFlagMinCount: 3,
  lateFlagMinPercent: 20,
  lateFlagWeeks: 6,
};
const lateData = {
  from: '2026-09-01',
  to: '2026-10-12',
  thresholds: { minCount: 4, minPercent: 25, weeks: 8 },
  rows: [
    {
      employeeId: 'a',
      employeeName: 'Testperson A',
      entries: 10,
      late: 3,
      percent: 30,
      averageDelayMinutes: 125,
      flagged: false,
    },
    {
      employeeId: 'b',
      employeeName: 'Testperson B',
      entries: 10,
      late: 6,
      percent: 60,
      averageDelayMinutes: null,
      flagged: true,
    },
    {
      employeeId: 'c',
      employeeName: 'Testperson C',
      entries: 10,
      late: 0,
      percent: 0,
      averageDelayMinutes: null,
      flagged: false,
    },
  ],
};
const settings = { enabled: false, timeYears: 2, payrollYears: 8, leaveYears: 3, auditYears: 3 };
const data: ChecksView = {
  from: '2026-09-01',
  to: '2026-10-12',
  findings: [
    {
      date: '2026-10-01',
      employeeId: 'a',
      employeeName: 'Testperson A',
      code: 'BREAK',
      text: 'Pause fehlt',
      paragraph: '§ 4 ArbZG',
      level: 'crit',
    },
    {
      date: '2026-10-12',
      employeeId: 'b',
      employeeName: 'Testperson B',
      code: 'MISSING',
      text: 'Keine Buchung',
      paragraph: null,
      level: 'warn',
    },
    {
      date: '2026-10-02',
      employeeId: 'a',
      employeeName: 'Testperson A',
      code: 'DAILY',
      text: 'Zu lang',
      paragraph: '§ 3 ArbZG',
      level: 'crit',
    },
  ],
  compensation: [
    {
      employeeId: 'a',
      employeeName: 'Testperson A',
      from: '2026-04-28',
      to: '2026-10-12',
      workdays: 120,
      averageMinutes: 485,
      exceeds: true,
    },
  ],
  minijob: [
    {
      employeeId: 'a',
      employeeName: 'Testperson A',
      jobTitle: 'Testfunktion',
      months: [
        {
          month: '2026-09',
          workMinutes: 2400,
          hourlyWageCents: 1400,
          earningsCents: 56000,
          limitCents: 60000,
          ratio: 0.933,
          level: 'warn',
        },
        {
          month: '2026-10',
          workMinutes: 2700,
          hourlyWageCents: 1400,
          earningsCents: 63000,
          limitCents: 60000,
          ratio: 1.05,
          level: 'crit',
        },
      ],
    },
  ],
  notices: {
    year: 2026,
    reminder: true,
    yearEndDeadlinePassed: true,
    rows: [
      { employeeId: 'a', employeeName: 'Testperson A', year: 2026, rest: 5, latest: notice },
      { employeeId: 'b', employeeName: 'Testperson B', year: 2026, rest: 8, latest: null },
    ],
  },
  forfeitures: [
    {
      employeeId: 'a',
      employeeName: 'Testperson A',
      year: 2025,
      kind: 'YEAR_END',
      forfeitsOn: '2025-12-31',
      halfDays: 5,
      noticeTimely: true,
    },
    {
      employeeId: 'b',
      employeeName: 'Testperson B',
      year: 2025,
      kind: 'MARCH31',
      forfeitsOn: '2026-03-31',
      halfDays: 4,
      noticeTimely: false,
    },
  ],
};
const sickData: SickChecksView = {
  certificateMissing: [
    {
      id: 'sick',
      employeeId: 'a',
      employeeName: 'Testperson A',
      kind: 'SICK',
      from: '2026-09-01',
      to: '2026-10-20',
      sinceLocal: null,
      certificateUntil: null,
      certificateDue: '2026-09-04',
      certificateMissing: true,
      canCertify: true,
      reportedAt: '2026-09-01T08:00:00Z',
      reportedByName: null,
    },
  ],
  vacationWithoutCertificate: [],
  overtimeOffDuringSickness: [
    {
      id: 'overtime',
      employeeId: 'b',
      employeeName: 'Testperson B',
      kind: 'SICK',
      from: '2026-10-05',
      to: '2026-10-06',
      sinceLocal: null,
      certificateUntil: '2026-10-06',
      certificateDue: null,
      certificateMissing: false,
      canCertify: true,
      reportedAt: '2026-10-05T08:00:00Z',
      reportedByName: null,
    },
  ],
  sixWeeks: [
    { employeeId: 'a', employeeName: 'Testperson A', from: '2026-09-01', reachedOn: '2026-10-12' },
  ],
  lastYear: [{ employeeId: 'a', employeeName: 'Testperson A', sickDays: 50, childSickDays: 2 }],
};
async function start(role: Role = 'ADMIN') {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const session = TestBed.inject(SessionStore).ensureLoaded();
  http
    .expectOne('/api/auth/session')
    .flush({ id: 'self', name: 'Testperson', role, method: 'CODE' });
  await session;
  const fixture = TestBed.createComponent(ChecksPage);
  fixture.detectChanges();
  await Promise.resolve();
  http.match('/api/checks/late-entries').forEach((r) => r.flush(lateData));
  http.match('/api/settings/reminders').forEach((r) => r.flush(reminderSettings));
  http.expectOne('/api/checks/sick').flush(sickData);
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}
async function render(role: Role = 'ADMIN', view = data) {
  const result = await start(role);
  const req = result.http.expectOne('/api/checks');
  expect(req.request.params.keys()).toEqual([]);
  req.flush(view);
  if (role === 'ADMIN') result.http.expectOne('/api/settings/retention').flush(settings);
  await result.fixture.whenStable();
  return result;
}
function button(el: HTMLElement, text: string) {
  return [...el.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!;
}
function enter(el: HTMLElement, selector: string, value: string, event = 'input') {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event(event));
}
async function reload(view: Awaited<ReturnType<typeof render>>, next = data) {
  await Promise.resolve();
  view.fixture.detectChanges();
  (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/checks'))).flush(next);
  view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
  await view.fixture.whenStable();
}
describe('ChecksPage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('zählt Kacheln personenweise, sortiert und filtert Feststellungen, zeigt Ausgleich und Minijob', async () => {
    const { el, fixture } = await render();
    expect([...el.querySelectorAll('.tile b')].map((x) => x.textContent?.trim())).toEqual([
      '2',
      '1',
      '1',
      '1',
    ]);
    expect(el.querySelectorAll('.tile .text-crit').length).toBe(2);
    const rows = () => [...el.querySelectorAll('#findings tbody tr')];
    expect(rows()[0]!.textContent).toContain('Testperson B');
    enter(el, '#finding-person', 'a', 'change');
    await fixture.whenStable();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.textContent).toContain('02.10.2026');
    expect(el.querySelector('#findings .lv-crit')?.textContent).toContain('§ 3 ArbZG');
    expect(el.querySelector('#compensation .pill')?.textContent).toContain('über 8 Std.');
    expect(el.querySelector('#compensation')?.textContent).toContain('8:05');
    expect(el.querySelectorAll('[role="meter"]')).toHaveLength(2);
    expect(el.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('93');
    expect(el.textContent).toContain('Grenze überschritten.');
    expect(el.textContent).toContain('Über 90 % der Grenze.');
    expect(el.textContent).toContain('versendet am 02.10.2026');
    expect(el.textContent).toContain('gelesen am 03.10.2026');
    expect(el.textContent).toContain('verspätet');
    expect(el.querySelector('details')?.textContent).toContain(notice.text);
    expect(el.textContent).toContain(
      'Die Frist für den Verfall zum 31.12.2026 (Hinweis bis 30.09.) ist',
    );
    expect(el.textContent).toContain('wirkt noch für übertragene Tage zum 31.03.2027');
  });
  it('sendet einen Hinweis, lädt neu und meldet die tatsächliche Anzahl', async () => {
    const view = await render();
    view.el
      .querySelector<HTMLButtonElement>('[aria-label="Hinweis senden an Testperson B"]')!
      .click();
    const req = view.http.expectOne('/api/leave/notices');
    expect(req.request.body).toEqual({ year: 2026, employeeIds: ['b'] });
    req.flush([{ ...notice, employeeId: 'b', emailSentAt: '2026-10-12T08:00:00Z' }]);
    await reload(view);
    expect(TestBed.inject(ToastService).message()).toBe(
      '1 Hinweise bereitgestellt und protokolliert, alle per E-Mail versendet.',
    );
    expect(document.activeElement?.id).toBe('notice-heading');
  });
  it('sendet alle fehlenden Hinweise erst nach bestätigter Rückfrage und erlaubt Abbrechen', async () => {
    const view = await render();
    button(view.el, 'Allen ohne Hinweis senden').click();
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    view.http.expectNone('/api/leave/notices');
    expect(document.activeElement?.textContent?.trim()).toBe('Versand bestätigen');
    button(view.el, 'Abbrechen').click();
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    expect(document.activeElement?.textContent?.trim()).toBe('Allen ohne Hinweis senden');
    button(view.el, 'Allen ohne Hinweis senden').click();
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    button(view.el, 'Versand bestätigen').click();
    const req = view.http.expectOne('/api/leave/notices');
    expect(req.request.body).toEqual({ year: 2026 });
    // Teilweiser Mailausfall wird ausdrücklich gemeldet (Codex-Review Web Phase 4, Befund 3).
    req.flush([notice, { ...notice, id: 'second', emailSentAt: '2026-10-12T08:00:00Z' }]);
    await reload(view);
    expect(TestBed.inject(ToastService).message()).toBe(
      '2 Hinweise bereitgestellt und protokolliert; 1 E-Mail wurde nicht zugestellt.',
    );
    expect(button(view.el, 'Allen ohne Hinweis senden')).toBeDefined();
  });
  it('bucht nur rechtzeitig angekündigten Verfall nach Rückfrage', async () => {
    const view = await render();
    expect(view.el.querySelectorAll('#forfeitures button.btn')).toHaveLength(1);
    expect(view.el.textContent).toContain('kein rechtzeitiger Hinweis – kein Verfall');
    button(view.el, 'Verfall buchen').click();
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    view.http.expectNone('/api/leave/forfeitures');
    button(view.el, 'Verfall bestätigen').click();
    const req = view.http.expectOne('/api/leave/forfeitures');
    expect(req.request.body).toEqual({ employeeId: 'a', year: 2025, kind: 'YEAR_END' });
    req.flush(data.forfeitures[0]!);
    await reload(view, { ...data, forfeitures: [] });
    expect(view.el.querySelector('#forfeitures')).toBeNull();
    expect(document.activeElement?.id).toBe('checks-status');
  });
  it('speichert Aufbewahrung mit beiden Grenzwerten und blockiert ungültige Jahre', async () => {
    const view = await render();
    for (const invalid of ['1', '31', '2.5', '']) {
      enter(view.el, '#retention-timeYears', invalid);
      view.http
        .match((r) => r.url === '/api/checks/late-entries')
        .forEach((r) => r.flush(lateData));
      await view.fixture.whenStable();
      expect(button(view.el, 'Aufbewahrung speichern').disabled).toBe(true);
    }
    enter(view.el, '#retention-timeYears', '2');
    enter(view.el, '#retention-payrollYears', '30');
    view.el.querySelector<HTMLInputElement>('#retention-enabled')!.click();
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    button(view.el, 'Aufbewahrung speichern').click();
    const req = view.http.expectOne('/api/settings/retention');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ ...settings, enabled: true, payrollYears: 30 });
    req.flush(req.request.body);
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    expect(TestBed.inject(ToastService).message()).toBe('Aufbewahrung gespeichert.');
  });
  it('zeigt Vorgesetzten weder Admin-Aktionen noch Aufbewahrung oder Monatsexport', async () => {
    const { el, http } = await render('LEAD');
    expect(el.textContent).toContain('Urlaubshinweis 2026');
    expect(el.textContent).not.toContain('Hinweis senden');
    expect(el.querySelector('#forfeitures')).toBeNull();
    expect(el.textContent).not.toContain('Aufbewahrung und Löschung');
    expect(el.querySelector('a[download]')).toBeNull();
    http.expectNone('/api/settings/retention');
  });
  it('zeigt leere Feststellungen und versteckt leere Zusatzabschnitte', async () => {
    const { el } = await render('ADMIN', { ...data, findings: [], minijob: [], forfeitures: [] });
    expect(el.textContent).toContain('Keine Feststellungen.');
    expect(el.textContent).not.toContain('Minijob-Grenze');
    expect(el.querySelector('#forfeitures')).toBeNull();
  });
  it('meldet Ladefehler mit erneuten Ladeaktionen', async () => {
    const view = await start();
    view.http.match(() => true).forEach((r) => r.flush({}, { status: 500, statusText: 'Error' }));
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    expect(view.el.querySelectorAll('[role="alert"]')).toHaveLength(2);
    button(view.el, 'Prüfungen erneut laden').click();
    await reload(view);
    button(view.el, 'Aufbewahrung erneut laden').click();
    view.fixture.detectChanges();
    (await vi.waitFor(() => view.http.expectOne('/api/settings/retention'))).flush(settings);
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    expect(view.el.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
  it('übernimmt den gewählten Zeitraum und exportiert die gewählte Monatsübersicht', async () => {
    const view = await render();
    enter(view.el, '#checks-from', '2026-07-01');
    enter(view.el, '#checks-to', '2026-09-30');
    button(view.el, 'Zeitraum anzeigen').click();
    view.fixture.detectChanges();
    const req = await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/checks'));
    expect(req.request.params.get('from')).toBe('2026-07-01');
    expect(req.request.params.get('to')).toBe('2026-09-30');
    req.flush({ ...data, from: '2026-07-01', to: '2026-09-30' });
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    expect(view.el.textContent).toContain('01.07.2026 – 30.09.2026');
    enter(view.el, '#checks-export-month', '2026-09');
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    expect(view.el.querySelector('a[download]')?.getAttribute('href')).toBe(
      '/api/exports/month?month=2026-09',
    );
    button(view.el, '6 Wochen').click();
    view.fixture.detectChanges();
    (await vi.waitFor(() => view.http.expectOne('/api/checks'))).flush(data);
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    expect(view.el.querySelector<HTMLInputElement>('#checks-from')!.value).toBe('');
  });
  it('meldet fehlgeschlagenen Versand, verhindert Doppelaktionen und erlaubt einen erneuten Versuch', async () => {
    const view = await render();
    const send = view.el.querySelector<HTMLButtonElement>(
      '[aria-label="Hinweis senden an Testperson B"]',
    )!;
    send.click();
    view.fixture.detectChanges();
    expect(send.disabled).toBe(true);
    const req = view.http.expectOne('/api/leave/notices');
    req.flush({ message: 'Versand fehlgeschlagen.' }, { status: 503, statusText: 'Unavailable' });
    await vi.waitFor(() => {
      view.fixture.detectChanges();
      expect(view.el.querySelector('[role="alert"]')?.textContent).toContain(
        'Versand fehlgeschlagen.',
      );
    });
    expect(TestBed.inject(ToastService).message()).toBeNull();
    expect(send.disabled).toBe(false);
    expect(document.activeElement?.id).toBe('checks-status');
    send.click();
    view.http.expectOne('/api/leave/notices').flush([]);
    await reload(view);
    expect(view.el.querySelector('[role="alert"]')).toBeNull();
    expect(TestBed.inject(ToastService).message()).toBe(
      '0 Hinweise bereitgestellt und protokolliert, alle per E-Mail versendet.',
    );
  });
  it('zählt genau 90 Prozent mit und zeigt den unauffälligen Minijob ohne Warnung', async () => {
    const row = data.minijob[0]!;
    const month = row.months[0]!;
    const { el } = await render('LEAD', {
      ...data,
      minijob: [
        { ...row, months: [{ ...month, ratio: 0.9, level: 'warn' }] },
        {
          ...row,
          employeeId: 'b',
          employeeName: 'Testperson B',
          months: [{ ...month, ratio: 0.899, level: 'ok' }],
        },
      ],
    });
    expect(el.querySelectorAll('.tile b')[2]?.textContent).toBe('1');
    expect(el.textContent).toContain('Im Rahmen.');
    expect(el.querySelectorAll('[role="meter"] .bg-ok')).toHaveLength(1);
  });
  it.each([3, 12])(
    'fragt die Schnellwahl %i Monate innerhalb des API-Limits ab',
    async (months) => {
      const view = await render();
      button(view.el, months + ' Monate').click();
      view.fixture.detectChanges();
      const req = await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/checks'));
      const from = req.request.params.get('from')!;
      const to = req.request.params.get('to')!;
      const days = (Date.parse(to) - Date.parse(from)) / 86400000;
      expect(days).toBeGreaterThan(months === 3 ? 85 : 360);
      expect(days).toBeLessThanOrEqual(months === 3 ? 92 : 365);
      req.flush({ ...data, from, to });
      view.http
        .match((r) => r.url === '/api/checks/late-entries')
        .forEach((r) => r.flush(lateData));
      await view.fixture.whenStable();
      expect(view.el.querySelector<HTMLInputElement>('#checks-from')!.value).toBe(from);
      expect(view.el.querySelector<HTMLInputElement>('#checks-to')!.value).toBe(to);
    },
  );
  it('bietet während des Ladens keine Aktionen auf fehlenden Daten an', async () => {
    const view = await start();
    expect(view.el.textContent).toContain('Prüfungen werden geladen');
    expect(view.el.textContent).toContain('Aufbewahrung wird geladen');
    expect(view.el.querySelectorAll('.tile')).toHaveLength(0);
    view.http.expectOne('/api/checks').flush(data);
    view.http.expectOne('/api/settings/retention').flush(settings);
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
  });

  it('zeigt eine nicht zugestellte E-Mail am Hinweis (Codex-Review Phase 4 API, Befund 8)', async () => {
    const { el } = await render('ADMIN');
    expect(el.textContent).toContain('E-Mail nicht zugestellt');
  });

  it('verknüpft die Rückfrage mit dem fokussierten Bestätigungsbutton (Befund 5)', async () => {
    const view = await render();
    button(view.el, 'Allen ohne Hinweis senden').click();
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
    const confirm = button(view.el, 'Versand bestätigen');
    expect(document.activeElement).toBe(confirm);
    const described = view.el.querySelector(`#${confirm.getAttribute('aria-describedby')}`);
    expect(described?.textContent).toContain('Allen Mitarbeitern ohne Hinweis für 2026');
    button(view.el, 'Abbrechen').click();
    view.http.match((r) => r.url === '/api/checks/late-entries').forEach((r) => r.flush(lateData));
    await view.fixture.whenStable();
  });

  it('zeigt bei Lohnwechsel keine falsche Gleichung (Befund 4)', async () => {
    const minijob = data.minijob[0]!;
    const { el } = await render('ADMIN', {
      ...data,
      minijob: [
        {
          ...minijob,
          months: [
            {
              ...minijob.months[0]!,
              workMinutes: 1200,
              hourlyWageCents: 1600,
              earningsCents: 30000,
            },
          ],
        },
      ],
    });
    expect(el.textContent?.replace(/\s+/g, ' ')).toContain(
      'Verdienst 300,00 € mit dem jeweils geltenden Stundenlohn',
    );
    expect(el.textContent).not.toContain('× 16,00');
  });

  it('erinnert vor dem 30.09. an die Frist für den Verfall zum 31.12.', async () => {
    const { el } = await render('ADMIN', {
      ...data,
      notices: { ...data.notices, yearEndDeadlinePassed: false },
    });
    expect(el.textContent).toContain('Hinweise bis 30.09.2026 versenden');
    expect(el.textContent).not.toContain('Die Frist für den Verfall zum 31.12.');
  });
});

describe('ChecksPage Nachträge', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('zeigt Schwellen, sortiert nach Anteil und lässt Personen ohne Nachträge weg', async () => {
    const { el } = await render('LEAD');
    expect(el.textContent).toContain('mindestens 4 Buchungen und 25 % nachgetragen');
    const rows = [...el.querySelectorAll('#late-entries tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Testperson B');
    expect(rows[0]?.textContent).toContain('an späterem Tag');
    expect(rows[0]?.querySelector('.pill')?.textContent).toBe('auffällig');
    expect(rows[1]?.textContent).toContain('2:05 Std.');
    expect(el.textContent).not.toContain('Erinnerungen und Auswertung');
    // Ohne Auswahl gilt der eigene Standard der Auswertung, sichtbar mit Zeitraum (Befund 5).
    expect(el.querySelector('[data-late-range]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Zeitraum: 01.09.2026 – 12.10.2026 (Standard der Nachtrags-Auswertung: 8 Wochen)',
    );
  });
  it('übernimmt den gewählten Zeitraum auch für die Nachträge', async () => {
    const { el, http, fixture } = await render('LEAD');
    enter(el, '#checks-from', '2026-09-01');
    enter(el, '#checks-to', '2026-09-30');
    button(el, 'Zeitraum anzeigen').click();
    fixture.detectChanges();
    const req = await vi.waitFor(() => http.expectOne((r) => r.url === '/api/checks/late-entries'));
    expect(req.request.params.get('from')).toBe('2026-09-01');
    expect(req.request.params.get('to')).toBe('2026-09-30');
    req.flush({ ...lateData, from: '2026-09-01', to: '2026-09-30', rows: [] });
    http.expectOne((r) => r.url === '/api/checks').flush(data);
    await fixture.whenStable();
    expect(el.textContent).toContain('Keine Nachträge im Zeitraum.');
    expect(el.querySelector('[data-late-range]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Zeitraum: 01.09.2026 – 30.09.2026',
    );
  });
  it('validiert Admin-Einstellungen und speichert beide Grenzwerte', async () => {
    const { el, http, fixture } = await render();
    for (const [key, max] of [
      ['lateFlagMinCount', 100],
      ['lateFlagMinPercent', 100],
      ['lateFlagWeeks', 52],
    ] as const) {
      for (const invalid of ['0', String(max + 1), '1.5', '']) {
        enter(el, '#reminder-' + key, invalid);
        await fixture.whenStable();
        expect(button(el, 'Erinnerungen speichern').disabled).toBe(true);
      }
      enter(el, '#reminder-' + key, '1');
    }
    for (const upper of [false, true]) {
      enter(el, '#reminder-defaultStart', upper ? '23:59' : '00:00');
      enter(el, '#reminder-lateFlagMinCount', upper ? '100' : '1');
      enter(el, '#reminder-lateFlagMinPercent', upper ? '100' : '1');
      enter(el, '#reminder-lateFlagWeeks', upper ? '52' : '1');
      await fixture.whenStable();
      button(el, 'Erinnerungen speichern').click();
      const req = http.expectOne({ method: 'PUT', url: '/api/settings/reminders' });
      expect(req.request.body).toEqual({
        defaultStart: upper ? '23:59' : '00:00',
        lateFlagMinCount: upper ? 100 : 1,
        lateFlagMinPercent: upper ? 100 : 1,
        lateFlagWeeks: upper ? 52 : 1,
      });
      req.flush(req.request.body);
      await Promise.resolve();
      fixture.detectChanges();
      (await vi.waitFor(() => http.expectOne((r) => r.url === '/api/checks/late-entries'))).flush(
        lateData,
      );
      await fixture.whenStable();
      expect(document.activeElement?.id).toBe('reminder-heading');
    }
  });
});

it('zeigt unter 640 px Datum und Mitarbeiter gemeinsam und Feststellungen ohne leeren Aufklapper', async () => {
  const { el } = await render();
  const table = el.querySelector<HTMLTableElement>('#findings table')!;
  const row = table.tBodies[0]!.rows[0]!;
  const headers = table.querySelectorAll('th');
  for (const [index, optional] of [false, true, true, false, false].entries()) {
    expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
    expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
  }
  expect(row.cells[0]!.classList).toContain('col-narrow');
  expect(row.cells[0]!.textContent).toContain('12.10.2026');
  expect(row.cells[0]!.textContent).toContain('Testperson B');
  expect(row.cells[0]!.querySelector('div')).not.toBeNull();
  expect(row.cells[3]!.querySelector('.lv-warn')!.textContent).toContain('Keine Buchung');
  expect(row.querySelector('app-row-toggle')).toBeNull();
  expect(row.cells[4]!.classList).toContain('col-narrow');
});

it.each([
  {
    name: 'Ausgleich',
    selector: '#compensation table',
    mask: [false, true, true, true, false, false],
    label: 'Details zu Testperson A',
    values: ['Zeitraum', '28.04.2026', '12.10.2026', 'Werktage', '120', 'Ø je Werktag', '8:05'],
    status: 'über 8 Std.',
  },
  {
    name: 'Urlaubshinweise',
    selector: 'section:has(#notice-heading) table',
    mask: [false, false, false, true, true, false],
    label: 'Details zu Testperson A',
    values: [
      'Wortlaut',
      'Hallo Testperson,',
      'bitte nimm deinen Resturlaub.',
      'Aktionen',
      'Hinweis senden',
    ],
    status: 'verspätet',
  },
  {
    name: 'Verfall',
    selector: '#forfeitures table',
    mask: [false, true, true, false, false, false],
    label: 'Details zu Testperson A, 2025, 31.12.2025',
    values: ['Jahr', '2025', 'Verfallstag', '31.12.2025'],
    status: 'Verfall buchen',
  },
  {
    name: 'Nachträge',
    selector: '#late-entries table',
    mask: [false, true, true, false, true, false, false],
    label: 'Details zu Testperson B',
    values: ['Buchungen', '10', 'Nachgetragen', '6', 'Ø später erfasst', 'an späterem Tag'],
    status: 'auffällig',
  },
])(
  'zeigt unter 640 px die Hauptspalten für $name und klappt die übrigen Werte auf',
  async ({ selector, mask, label, values, status }) => {
    const { el, fixture, http } = await render();
    const table = el.querySelector<HTMLTableElement>(selector)!;
    const row = table.tBodies[0]!.rows[0]!;
    const headers = table.querySelectorAll('th');
    for (const [index, optional] of mask.entries()) {
      expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
      expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
    }
    expect(
      [...row.cells]
        .filter((cell) => !cell.classList.contains('col-opt'))
        .map((cell) => cell.textContent)
        .join(' '),
    ).toContain(status);
    const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
    expect(toggle.getAttribute('aria-label')).toBe(label);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const details = row.nextElementSibling!;
    expect(details.classList).toContain('row-details');
    expect(details.querySelector('td')!.colSpan).toBe(headers.length);
    for (const text of values) expect(details.textContent).toContain(text);
    if (selector.includes('notice-heading')) {
      expect(details.querySelector('button')!.getAttribute('aria-label')).toBe(
        'Hinweis senden an Testperson A',
      );
      expect(details.querySelector('.whitespace-pre-wrap')!.textContent).toBe(notice.text);
    }
    expect(el.querySelectorAll('.row-details')).toHaveLength(1);
    row.cells[0]!.click();
    fixture.detectChanges();
    expect(table.querySelector('.row-details')).toBeNull();
    http.verify();
  },
);

it('zeigt ohne Wortlaut oder Aktionen keinen leeren Aufklapper für Urlaubshinweise', async () => {
  const { el, fixture, http } = await render('LEAD');
  const table = el.querySelector<HTMLTableElement>('section:has(#notice-heading) table')!;
  const row = table.tBodies[0]!.rows[1]!;
  expect(row.textContent).toContain('fehlt');
  expect(row.querySelector('app-row-toggle')).toBeNull();
  row.cells[0]!.click();
  fixture.detectChanges();
  expect(table.querySelector('.row-details')).toBeNull();
  http.verify();
});

it.each(['LEAD', 'ADMIN'] as const)(
  'zeigt Krankmeldungsprüfungen für %s mit Rollenbegrenzung',
  async (role) => {
    const { el, fixture, http } = await render(role);
    const section = el.querySelector('[data-sick-checks]')!;
    expect(section.textContent).toContain('AU fehlt');
    expect(section.textContent).toContain('04.09.2026');
    expect(section.textContent).toContain('Krank im Urlaub ohne AU');
    expect(section.textContent?.includes('Sechs Wochen erreicht')).toBe(role === 'ADMIN');
    expect(section.textContent?.includes('Überstundenabbau während Krankheit')).toBe(
      role === 'ADMIN',
    );
    expect(section.textContent?.includes('Krankheitstage der letzten 12 Monate')).toBe(
      role === 'ADMIN',
    );
    button(section as HTMLElement, 'AU vermerken').click();
    await fixture.whenStable();
    enter(section as HTMLElement, 'input[type="date"]', '2026-10-20');
    section.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const req = http.expectOne('/api/sick/sick/certificate');
    expect(req.request.body).toEqual({ until: '2026-10-20' });
    req.flush({ ...sickData.certificateMissing[0], certificateUntil: '2026-10-20' });
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    (await vi.waitFor(() => http.expectOne('/api/checks/sick'))).flush({
      ...sickData,
      certificateMissing: [],
    });
    await fixture.whenStable();
    expect(section.textContent).not.toContain('04.09.2026');
  },
);
