import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  ClockResult,
  LeaveAccountView,
  ReminderTodayView,
  SessionView,
  TodayView,
  SickLeaveView,
} from '@as/shared';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { HomePage } from './home-page';

const flushAsync = () => new Promise((r) => setTimeout(r, 0));

function today(overrides: Partial<TodayView> = {}): TodayView {
  return {
    serverTime: new Date().toISOString(),
    date: '2026-10-12',
    state: 'OUT',
    since: null,
    isWorkday: true,
    absence: null,
    workedMinutes: 0,
    entries: [],
    week: { workMinutes: 0, targetMinutes: 2400, balanceUntilYesterday: 0 },
    minijob: null,
    overtime: null,
    recentFlags: [],
    youthLimits: null,
    ...overrides,
  };
}

const sick: SickLeaveView = {
  id: 'sick',
  employeeId: '1',
  employeeName: 'Testperson',
  kind: 'SICK',
  from: '2026-10-12',
  to: '2026-10-20',
  sinceLocal: null,
  certificateDue: '2026-10-15',
  certificateUntil: null,
  certificateMissing: true,
  canCertify: false,
  reportedAt: '2026-10-12T08:00:00Z',
  reportedByName: null,
};

const reminder: ReminderTodayView = {
  clockIn: { due: true, start: '09:00', learned: true, muted: false },
  clockOutDue: false,
};
async function render(
  role: SessionView['role'],
  view: TodayView,
  accountError = false,
  reminderView: ReminderTodayView | null = { clockIn: null, clockOutDue: false },
  sickRows: SickLeaveView[] = [],
) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const http = TestBed.inject(HttpTestingController);
  const store = TestBed.inject(SessionStore);
  const loading = store.reload();
  http
    .expectOne('/api/auth/session')
    .flush({ id: '1', name: 'Jonas Reitberger', role, method: 'PASSKEY' });
  await loading;
  const fixture = TestBed.createComponent(HomePage);
  fixture.detectChanges();
  http.expectOne('/api/time/today').flush(view);
  http
    .match('/api/reminders/today')
    .forEach((r) =>
      reminderView
        ? r.flush(reminderView)
        : r.flush({}, { status: 503, statusText: 'Unavailable' }),
    );
  http.expectOne('/api/me').flush({ passkeyCount: 1 });
  if (role !== 'EMPLOYEE')
    http
      .expectOne('/api/time/team-today')
      .flush([
        { employeeId: '2', name: 'Elif', jobTitle: null, presence: 'PRESENT', since: '08:02' },
      ]);
  await flushAsync();
  fixture.detectChanges();
  http.expectOne(`/api/sick?employeeId=1&from=${view.date}&to=${view.date}`).flush(sickRows);
  http.expectOne('/api/sick?employeeId=1').flush(sickRows);
  const accountRequest = await vi.waitFor(() =>
    http.expectOne(`/api/leave/account?year=${view.date.slice(0, 4)}`),
  );
  if (accountError) accountRequest.flush({}, { status: 500, statusText: 'Error' });
  else
    accountRequest.flush({
      employeeId: '1',
      employeeName: 'Testperson',
      year: Number(view.date.slice(0, 4)),
      entitlement: 60,
      entitlementBasis: 'CONTRACT',
      carryOver: 0,
      corrections: 0,
      approved: 48,
      pending: 3,
      rest: 9,
      workDaysPerWeek: 5,
      employmentType: 'FULL_TIME',
    } satisfies LeaveAccountView);
  await fixture.whenStable();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}

const buttons = (el: HTMLElement) =>
  [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());

describe('HomePage (Heute)', () => {
  it('zeigt je nach Zustand die passenden Stempel-Aktionen', async () => {
    let { el } = await render('EMPLOYEE', today());
    expect(buttons(el)).toContain('Kommen');
    expect(el.querySelector('[data-testid="clock-status"]')?.textContent).toContain(
      'Noch nicht gestempelt.',
    );
    TestBed.resetTestingModule();
    ({ el } = await render('EMPLOYEE', today({ state: 'IN', since: '08:02' })));
    expect(buttons(el)).toEqual(expect.arrayContaining(['Pause beginnen', 'Gehen']));
    expect(el.querySelector('[data-testid="clock-status"]')?.textContent).toContain(
      'Anwesend seit 08:02 Uhr',
    );
  });

  it('meldet beim Gehen Arbeitszeit und Hinweise mit Paragraf', async () => {
    const { el, http, fixture } = await render('EMPLOYEE', today({ state: 'IN', since: '08:00' }));
    const toast = TestBed.inject(ToastService);
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Gehen'))!.click();
    const result: ClockResult = {
      today: today({
        workedMinutes: 421,
        entries: [{ endLocal: '15:01', voided: false } as ClockResult['today']['entries'][number]],
      }),
      flags: [
        {
          code: 'BREAK_TOO_SHORT',
          level: 'crit',
          text: 'Pause 0 statt 30 Min.',
          paragraph: '§ 4 ArbZG',
        },
      ],
      closed: { endLocal: '15:01', workMinutes: 421 } as ClockResult['closed'],
    };
    http.expectOne('/api/time/clock/out').flush(result);
    await flushAsync();
    http
      .match('/api/reminders/today')
      .forEach((r) => r.flush({ clockIn: null, clockOutDue: false }));
    await fixture.whenStable();
    expect(toast.message()).toBe(
      'Gegangen um 15:01 Uhr. Arbeitszeit 7:01 Std. Hinweis: Pause 0 statt 30 Min. (§ 4 ArbZG)',
    );
  });

  it('zeigt „Team heute“ nur Vorgesetzten', async () => {
    let { el } = await render('EMPLOYEE', today());
    expect(el.textContent).not.toContain('Team heute');
    TestBed.resetTestingModule();
    ({ el } = await render('LEAD', today()));
    expect(el.textContent).toContain('Team heute');
    expect(el.textContent).toContain('anwesend seit 08:02');
  });

  it('weist auf eine abweichende Geräteuhr hin', async () => {
    const { el } = await render(
      'EMPLOYEE',
      today({ serverTime: new Date(Date.now() - 5 * 60_000).toISOString() }),
    );
    expect(el.textContent).toContain('weicht um etwa 5 Minuten von der Serverzeit ab');
  });

  it('zeigt Minijobbern den Monat gegen die Grenze', async () => {
    const { el } = await render(
      'EMPLOYEE',
      today({
        minijob: {
          month: '2026-10',
          workMinutes: 2520,
          hourlyWageCents: 1400,
          limitCents: 60300,
          earningsCents: 58800,
          ratio: 0.975,
          level: 'warn',
        },
      }),
    );
    expect(el.querySelector('[data-testid="minijob-meter"]')?.textContent).toContain(
      'Über 90 % der Grenze.',
    );
    expect(el.textContent).toContain('588,00');
  });

  describe('mit gesteuerter Uhr', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());

    it('zählt laufende Arbeitszeit nach erneutem Laden nicht doppelt', async () => {
      vi.setSystemTime(new Date('2026-10-12T08:00:00Z'));
      const { el, http, fixture } = await render(
        'EMPLOYEE',
        today({ state: 'IN', since: '08:00', workedMinutes: 120 }),
      );
      vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
      vi.advanceTimersByTime(20_000);
      await fixture.whenStable();
      expect(el.textContent).toContain('Heute gearbeitet: 6:00 Std.');
      // Fehlgeschlagene Aktion lädt den Stand neu; ab dann zählt der neue Empfangszeitpunkt.
      [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Gehen'))!.click();
      http
        .expectOne('/api/time/clock/out')
        .flush({ message: 'Fehler' }, { status: 409, statusText: 'Conflict' });
      await flushAsync();
      http.expectOne('/api/time/today').flush(
        today({
          serverTime: new Date().toISOString(),
          state: 'IN',
          since: '08:00',
          workedMinutes: 360,
        }),
      );
      await flushAsync();
      await fixture.whenStable();
      expect(el.textContent).toContain('Heute gearbeitet: 6:00 Std.');
      expect(el.textContent).not.toContain('weicht um');
    });

    it('lädt über Mitternacht die Tagesdaten neu', async () => {
      vi.setSystemTime(new Date('2026-10-12T21:59:00Z')); // 23:59 in Berlin
      const { http, fixture } = await render('LEAD', today());
      vi.setSystemTime(new Date('2026-10-12T22:01:00Z')); // 00:01 am 13.10.
      vi.advanceTimersByTime(20_000);
      await flushAsync();
      http.expectOne('/api/time/today').flush(today({ date: '2026-10-13' }));
      http.expectOne('/api/time/team-today').flush([]);
      http.expectOne('/api/reminders/today').flush({ clockIn: null, clockOutDue: false });
      http.expectOne('/api/sick?employeeId=1').flush([]);
      fixture.detectChanges();
      (
        await vi.waitFor(() =>
          http.expectOne('/api/sick?employeeId=1&from=2026-10-13&to=2026-10-13'),
        )
      ).flush([]);
      await fixture.whenStable();
    });
  });

  it('setzt den Fokus nach dem Stempeln auf die nächste Stempelaktion', async () => {
    const { el, http, fixture } = await render('EMPLOYEE', today());
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Kommen')!.click();
    http.expectOne('/api/time/clock/in').flush({
      today: today({ state: 'IN', since: '08:00' }),
      flags: [],
      closed: null,
    } satisfies ClockResult);
    await flushAsync();
    http
      .match('/api/reminders/today')
      .forEach((r) => r.flush({ clockIn: null, clockOutDue: false }));
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe('Pause beginnen'),
    );
  });
});

describe('HomePage Abwesenheiten', () => {
  it('blendet Kontofehler still aus und lässt die Stempeluhr nutzbar', async () => {
    const { el } = await render('EMPLOYEE', today(), true);
    expect(el.textContent).not.toContain('Resturlaub');
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(buttons(el)).toContain('Kommen');
  });
  it('zeigt Resturlaub und Beantragt in Tagen', async () => {
    const { el } = await render('EMPLOYEE', today());
    const tiles = [...el.querySelectorAll('.tile')];
    expect(
      tiles.find((tile) => tile.textContent?.includes('Resturlaub 2026'))?.querySelector('b')
        ?.textContent,
    ).toBe('4,5');
    expect(
      tiles.find((tile) => tile.textContent?.includes('Beantragt'))?.querySelector('b')
        ?.textContent,
    ).toBe('1,5');
  });

  it.each([
    { type: 'VACATION' as const, half: true, label: 'Urlaub (halber Tag)' },
    { type: 'SPECIAL_LEAVE' as const, half: false, label: 'Sonderurlaub' },
    { type: 'OVERTIME_OFF' as const, half: false, label: 'Überstundenabbau' },
  ])('zeigt $label und erlaubt weiterhin Kommen', async ({ type, half, label }) => {
    const { el } = await render('EMPLOYEE', today({ absence: { type, half }, isWorkday: false }));
    expect(el.querySelector('[data-testid="clock-status"]')?.textContent).toBe('Heute: ' + label);
    expect(el.querySelector<HTMLButtonElement>('[data-clock-action]')?.disabled).toBe(false);
  });

  it.each([
    { presence: 'ABSENT', label: 'abwesend' },
    { presence: 'SICK', label: 'krank' },
  ])('zeigt Teamstatus $label', async ({ presence, label }) => {
    const { el, fixture, http } = await render('LEAD', today());
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Kommen')!.click();
    http
      .expectOne('/api/time/clock/in')
      .flush({ today: today({ state: 'IN', since: '08:00' }), flags: [], closed: null });
    await flushAsync();
    http
      .match('/api/reminders/today')
      .forEach((r) => r.flush({ clockIn: null, clockOutDue: false }));
    http.expectOne('/api/time/team-today').flush([
      {
        employeeId: 'absent',
        name: 'Testperson',
        jobTitle: null,
        presence,
        since: null,
      },
    ]);
    await fixture.whenStable();
    expect(el.querySelector('table .lv-mute')?.textContent).toBe(label);
    expect(el.querySelector('table')?.textContent).not.toContain('Urlaub');
  });
});

describe('HomePage Erinnerungen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T08:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());
  it('zeigt den gelernten Beginn und den Link zum Nachtragen', async () => {
    const { el } = await render('EMPLOYEE', today(), false, reminder);
    expect(el.textContent).toContain('montags beginnst du meist gegen 09:00 Uhr');
    expect(el.textContent).toContain('Erinnerung · kommt auch als Benachrichtigung');
    expect(el.querySelector('[data-reminder] a')?.getAttribute('href')).toBe('/zeiten');
  });
  it('zeigt die Standardzeit und schaltet Erinnerungen für heute stumm', async () => {
    const { el, http, fixture } = await render('EMPLOYEE', today(), false, {
      ...reminder,
      clockIn: { ...reminder.clockIn!, learned: false },
    });
    expect(el.textContent).toContain('Erinnert wird ab 09:00 Uhr plus 15 Minuten (Standardzeit).');
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Heute nicht erinnern')!
      .click();
    http.expectOne({ method: 'POST', url: '/api/reminders/mute' }).flush(null);
    await fixture.whenStable();
    expect(el.querySelector('[data-reminder]')).toBeNull();
    expect(TestBed.inject(ToastService).message()).toBe('Für heute keine weitere Erinnerung.');
    expect(document.activeElement?.textContent?.trim()).toBe('Kommen');
  });
  it('lässt beim Stummschalten einen fälligen Ausstempel-Hinweis stehen', async () => {
    const { el, http, fixture } = await render('EMPLOYEE', today({ state: 'IN' }), false, {
      ...reminder,
      clockOutDue: true,
    });
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Heute nicht erinnern')!
      .click();
    http.expectOne({ method: 'POST', url: '/api/reminders/mute' }).flush(null);
    await fixture.whenStable();
    expect(el.textContent).not.toContain('Du hast heute noch nicht gestempelt.');
    expect(el.textContent).toContain('Ausstempeln vergessen?');
  });
  it('lädt Erinnerungen beim Zurückkehren auf die Seite neu', async () => {
    const { el, http, fixture } = await render('EMPLOYEE', today());
    expect(el.querySelector('[data-reminder]')).toBeNull();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockRestore();
    await flushAsync();
    fixture.detectChanges();
    await flushAsync();
    http.expectOne('/api/reminders/today').flush(reminder);
    // Die eigene AU kann inzwischen fällig sein (Review Web Phase 6, Befund 2).
    http.expectOne('/api/sick?employeeId=1').flush([
      {
        id: 'sick',
        employeeId: '1',
        employeeName: 'Jonas Reitberger',
        kind: 'SICK',
        from: '2026-10-07',
        to: '2026-10-11',
        sinceLocal: null,
        certificateUntil: null,
        certificateDue: '2026-10-12',
        certificateMissing: true,
        canCertify: false,
        reportedAt: '2026-10-07T06:00:00Z',
        reportedByName: null,
      },
    ]);
    await fixture.whenStable();
    expect(el.textContent).toContain('Du hast heute noch nicht gestempelt.');
    expect(el.textContent).toContain('Bitte reiche deine Arbeitsunfähigkeitsbescheinigung ein.');
  });
  it.each(['in', 'out'] as const)(
    'stempelt über die Erinnerung: %s und lädt neu',
    async (action) => {
      const { el, http, fixture } = await render(
        'EMPLOYEE',
        today(action === 'out' ? { state: 'IN' } : {}),
        false,
        action === 'in' ? reminder : { clockIn: null, clockOutDue: true },
      );
      const section = el.querySelector('[data-reminder]')!;
      if (action === 'out')
        expect(section.textContent).toContain(
          'Du bist seit über 10 Stunden eingestempelt. Ausstempeln vergessen?',
        );
      section.querySelector<HTMLButtonElement>('button')!.click();
      http.expectOne('/api/time/clock/' + action).flush({
        today: today({ state: action === 'in' ? 'IN' : 'OUT' }),
        flags: [],
        closed: null,
      });
      await flushAsync();
      http.expectOne('/api/reminders/today').flush({ clockIn: null, clockOutDue: false });
      await fixture.whenStable();
      expect(el.querySelector('[data-reminder]')).toBeNull();
    },
  );
});

it('blendet Ladefehler der Erinnerung still aus', async () => {
  const { el } = await render('EMPLOYEE', today(), false, null);
  expect(el.querySelector('[data-reminder]')).toBeNull();
  expect(el.querySelector('[role="alert"]')).toBeNull();
  expect(buttons(el)).toContain('Kommen');
});
it('behält das Banner bei fehlgeschlagenem Stummschalten und verhindert doppelte Aktionen', async () => {
  const { el, fixture, http } = await render('EMPLOYEE', today(), false, reminder);
  const mute = [...el.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Heute nicht erinnern',
  )!;
  mute.click();
  mute.click();
  fixture.detectChanges();
  expect(mute.disabled).toBe(true);
  http
    .expectOne('/api/reminders/mute')
    .flush({ message: 'Bitte erneut versuchen.' }, { status: 503, statusText: 'Unavailable' });
  await flushAsync();
  await fixture.whenStable();
  expect(el.querySelector('[data-reminder]')).not.toBeNull();
  expect(el.querySelector('[role="alert"]')?.textContent).toContain('Bitte erneut versuchen.');
  expect(mute.disabled).toBe(false);
  expect(TestBed.inject(ToastService).message()).toBeNull();
});

it('lädt Erinnerungen bei geöffneter Seite alle fünf Minuten neu', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const { el, http, fixture } = await render('EMPLOYEE', today());
    vi.advanceTimersByTime(4 * 60_000);
    await flushAsync();
    expect(http.match('/api/reminders/today')).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    await flushAsync();
    fixture.detectChanges();
    await flushAsync();
    http.expectOne('/api/reminders/today').flush(reminder);
    http.expectOne('/api/sick?employeeId=1').flush([]);
    await fixture.whenStable();
    expect(el.querySelector('[data-reminder]')).not.toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

describe('HomePage Krankmeldungen', () => {
  it('zeigt AU-Banner und Stempeluhr erst nach Trotzdem stempeln', async () => {
    const { el, fixture } = await render('EMPLOYEE', today(), false, null, [sick]);
    expect(el.textContent).toContain('Heute krankgemeldet bis 20.10.2026');
    expect(el.textContent).toContain('Bitte reiche deine Arbeitsunfähigkeitsbescheinigung ein.');
    expect(buttons(el)).not.toContain('Kommen');
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Trotzdem stempeln')!
      .click();
    await fixture.whenStable();
    expect(buttons(el)).toContain('Kommen');
    expect(document.activeElement?.textContent?.trim()).toBe('Kommen');
  });
  it('meldet wieder gesund und lädt den Tagesstatus neu', async () => {
    const { el, http, fixture } = await render('EMPLOYEE', today(), false, null, [sick]);
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Wieder gesund')!
      .click();
    const req = http.expectOne('/api/sick/sick');
    expect(req.request.body).toEqual({ endToday: true });
    req.flush({ ...sick, to: '2026-10-11' });
    await flushAsync();
    fixture.detectChanges();
    await flushAsync();
    http.expectOne('/api/time/today').flush(today());
    http.match((r) => r.url === '/api/sick').forEach((r) => r.flush([]));
    http.match((r) => r.url === '/api/leave/account').forEach((r) => r.flush({}));
    http
      .match('/api/reminders/today')
      .forEach((r) => r.flush({ clockIn: null, clockOutDue: false }));
    await fixture.whenStable();
    expect(el.textContent).not.toContain('Heute krankgemeldet bis');
    expect(buttons(el)).toContain('Kommen');
    expect(document.activeElement?.textContent?.trim()).toBe('Kommen');
  });
});

describe('HomePage Jugendarbeitsschutz', () => {
  it.each(['12:30', null])('zeigt die Servergrenzen mit Pausengrenze %s', async (latestBreak) => {
    const { el, http } = await render(
      'EMPLOYEE',
      today({
        state: 'IN',
        since: '08:00',
        youthLimits: { latestEnd: '16:30', latestBreak },
      }),
    );
    const status = [...el.querySelectorAll('[role="status"]')].find((node) =>
      node.textContent?.includes('Heute spätestens'),
    );
    expect(status?.textContent).toContain('Heute spätestens um 16:30 Uhr Feierabend');
    if (latestBreak) expect(status?.textContent).toContain('Pause spätestens um 12:30 Uhr');
    else expect(status?.textContent).not.toContain('Pause spätestens');
    http.expectNone((r) => r.url.startsWith('/api/time/clock/'));
    http.verify();
  });
  it('zeigt ohne Jugendgrenzen keinen Hinweis', async () => {
    const { el, http } = await render('EMPLOYEE', today({ youthLimits: null }));
    expect(el.textContent).not.toContain('Heute spätestens');
    expect(el.textContent).not.toContain('Pause spätestens');
    http.verify();
  });
});
