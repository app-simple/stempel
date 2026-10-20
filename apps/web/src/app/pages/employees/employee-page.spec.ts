import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { localDateInBerlin, type LeaveAccountView } from '@as/shared';
import { CertificateRequirement, EmployeePage, OvertimeAccount } from './employee-page';

const leaveYear = Number(localDateInBerlin(new Date()).slice(0, 4));
const leaveAccount: LeaveAccountView = {
  employeeId: 'test',
  employeeName: 'Testperson',
  year: leaveYear,
  entitlement: 60,
  entitlementBasis: 'CONTRACT',
  carryOver: 0,
  corrections: 0,
  approved: 48,
  pending: 3,
  rest: 9,
  workDaysPerWeek: 5,
  employmentType: 'FULL_TIME',
};
async function flushLeave(http: HttpTestingController) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  http
    .match((r) => r.url === '/api/leave/account')
    .forEach((r) => r.flush({ ...leaveAccount, year: Number(r.request.params.get('year')) }));
  http.match((r) => r.url === '/api/leave/notices').forEach((r) => r.flush([]));
  http.match('/api/employees/test/leave-ledger').forEach((r) => r.flush([]));
}

async function render() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({})) } },
    ],
  });
  const fixture = TestBed.createComponent(EmployeePage);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  await Promise.resolve();
  (await vi.waitFor(() => http.expectOne('/api/employees'))).flush([]);
  (await vi.waitFor(() => http.expectOne('/api/legal-parameters'))).flush([
    { key: 'MIN_WAGE_HOURLY_CENTS', value: 1390, validFrom: '2026-01-01', source: 'Test' },
    { key: 'MINIJOB_MONTHLY_LIMIT_CENTS', value: 60300, validFrom: '2026-01-01', source: 'Test' },
  ]);
  await fixture.whenStable();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}
function enter(el: HTMLElement, id: string, value: string, event = 'input') {
  const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(event));
}
describe('EmployeePage anlegen', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it.each([
    { type: 'PART_TIME', hours: '38.5', minutes: 2310, wage: null },
    { type: 'MINIJOB', hours: '8', minutes: 480, wage: 1390 },
  ])(
    'sendet ganzzahlige Minuten und Cent für $type und zeigt API-Fehler',
    async ({ type, hours, minutes, wage }) => {
      const { fixture, http, el } = await render();
      enter(el, 'employee-name', 'Testperson');
      enter(el, 'employee-email', 'test@example.org');
      enter(el, 'employee-role', 'ADMIN', 'change');
      enter(el, 'employee-entry', '2026-10-12');
      enter(el, 'terms-type', type, 'change');
      await fixture.whenStable();
      expect(el.querySelector<HTMLInputElement>('#terms-date')?.value).toBe('2026-10-12');
      enter(el, 'terms-hours', hours);
      if (wage) enter(el, 'terms-wage', '13.90');
      await fixture.whenStable();
      el.querySelector<HTMLFormElement>('app-terms-form form')!.dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      const req = http.expectOne({ method: 'POST', url: '/api/employees' });
      expect(req.request.body.terms.weeklyMinutes).toBe(minutes);
      expect(req.request.body.terms.hourlyWageCents).toBe(wage);
      expect(req.request.body.leadId).toBeNull();
      req.flush(
        {
          message: 'Vertragsstand abgelehnt.',
          errors: [{ code: 'TEST_RULE', text: 'Serverregel verletzt.' }],
        },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await fixture.whenStable();
      expect(el.querySelector('[role="alert"]')?.textContent).toContain('Serverregel verletzt.');
    },
  );
});

describe('EmployeePage bearbeiten', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('sendet nur geänderte Stammdaten, sperrt/entsperrt und speichert den Jahresübertrag', async () => {
    const person = {
      id: 'test',
      name: 'Testperson',
      jobTitle: null,
      loginEmail: 'test@example.org',
      role: 'ADMIN',
      leadId: null,
      leadName: null,
      deputyId: null,
      deputyName: null,
      entryDate: '2026-01-01',
      exitDate: null,
      status: 'ACTIVE',
      currentTerms: null,
      carryOver: null,
      warnings: [],
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'test' })) } },
      ],
    });
    const fixture = TestBed.createComponent(EmployeePage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne('/api/employees/test').flush(person);
    (await vi.waitFor(() => http.expectOne('/api/employees'))).flush([person]);
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne('/api/employees/test/terms'))).flush([]);
    (await vi.waitFor(() => http.expectOne('/api/legal-parameters'))).flush([]);
    await flushLeave(http);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    enter(el, 'employee-job', 'Entwicklung');
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    const patch = http.expectOne({ method: 'PATCH', url: '/api/employees/test' });
    expect(patch.request.body).toEqual({ jobTitle: 'Entwicklung' });
    const updated = { ...person, jobTitle: 'Entwicklung' };
    patch.flush(updated);
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne('/api/employees'))).flush([updated]);
    await fixture.whenStable();
    const button = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === text,
      )!;
    enter(el, 'employee-name', 'Noch nicht gespeichert');
    await fixture.whenStable();
    button('Sperren').click();
    http
      .expectOne({ method: 'POST', url: '/api/employees/test/lock' })
      .flush({ ...updated, status: 'LOCKED' });
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('#employee-name')?.value).toBe(
      'Noch nicht gespeichert',
    );
    button('Entsperren').click();
    http.expectOne({ method: 'POST', url: '/api/employees/test/unlock' }).flush(updated);
    await fixture.whenStable();
    enter(el, 'employee-carry', '7');
    button('Übertrag speichern').click();
    const carry = http.expectOne(
      (r) => r.method === 'PUT' && r.url.startsWith('/api/employees/test/carry-over/'),
    );
    expect(carry.request.body).toEqual({ days: 7 });
    expect(carry.request.url).toContain(String(new Date().getFullYear()));
    carry.flush({ year: new Date().getFullYear(), days: 7 });
    await flushLeave(http);
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('#employee-carry')?.value).toBe('7');
    expect(el.querySelector<HTMLInputElement>('#employee-name')?.value).toBe(
      'Noch nicht gespeichert',
    );
  });
});

describe('EmployeePage Urlaubskonto', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('lädt Konto und Übertragsvorschlag nach geändertem Austritt neu (Codex-Review Web Phase 3, Befund 4)', async () => {
    const person = {
      id: 'test',
      name: 'Testperson',
      jobTitle: null,
      loginEmail: 'test@example.org',
      role: 'ADMIN',
      leadId: null,
      leadName: null,
      deputyId: null,
      deputyName: null,
      entryDate: '2026-01-01',
      exitDate: null,
      status: 'ACTIVE',
      currentTerms: null,
      carryOver: null,
      warnings: [],
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'test' })) } },
      ],
    });
    const fixture = TestBed.createComponent(EmployeePage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne('/api/employees/test').flush(person);
    (await vi.waitFor(() => http.expectOne('/api/employees'))).flush([person]);
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne('/api/employees/test/terms'))).flush([]);
    (await vi.waitFor(() => http.expectOne('/api/legal-parameters'))).flush([]);
    await flushLeave(http);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    enter(el, 'employee-exit', `${leaveYear}-12-31`);
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    const updated = { ...person, exitDate: `${leaveYear}-12-31` };
    http.expectOne({ method: 'PATCH', url: '/api/employees/test' }).flush(updated);
    await Promise.resolve();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    (await vi.waitFor(() => http.expectOne('/api/employees'))).flush([updated]);
    const reloaded = await vi.waitFor(() => {
      const requests = http.match((r) => r.url === '/api/leave/account');
      expect(requests.length).toBeGreaterThanOrEqual(2);
      return requests;
    });
    reloaded.forEach((r) =>
      r.flush({ ...leaveAccount, year: Number(r.request.params.get('year')) }),
    );
    await flushLeave(http);
    await fixture.whenStable();
  });
});

describe('EmployeePage Überstundenkonto', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('sendet -0:45 als -45 Minuten und zeigt die Korrekturbuchung', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'test' })) } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const { SessionStore } = await import('../../core/session.store');
    const session = TestBed.inject(SessionStore).ensureLoaded();
    http
      .expectOne('/api/auth/session')
      .flush({ id: 'admin', name: 'Testadmin', role: 'ADMIN', method: 'CODE' });
    await session;
    const fixture = TestBed.createComponent(EmployeePage);
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne('/api/employees/test').flush({
      id: 'test',
      name: 'Testperson',
      jobTitle: null,
      loginEmail: 'test@example.org',
      role: 'EMPLOYEE',
      leadId: 'admin',
      leadName: 'Testadmin',
      deputyId: null,
      deputyName: null,
      entryDate: '2026-01-01',
      exitDate: null,
      status: 'ACTIVE',
      currentTerms: null,
      carryOver: null,
      warnings: [],
    });
    http.expectOne('/api/employees').flush([]);
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne('/api/employees/test/terms'))).flush([]);
    http.expectOne('/api/legal-parameters').flush([]);
    (await vi.waitFor(() => http.expectOne('/api/time/overtime?employeeId=test'))).flush({
      since: '2026-01-01',
      balanceMinutes: 90,
      adjustments: [],
    });
    await flushLeave(http);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Saldo +1:30 Std.');
    enter(el, 'overtime-minutes', '-0:45');
    enter(el, 'overtime-date', '2026-10-12');
    enter(el, 'overtime-reason', ' Auszahlung ');
    await fixture.whenStable();
    el.querySelector<HTMLFormElement>('#overtime-adjustment-form')!.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    const req = http.expectOne('/api/employees/test/overtime-adjustments');
    expect(req.request.body).toEqual({
      minutes: -45,
      effectiveOn: '2026-10-12',
      reason: 'Auszahlung',
    });
    req.flush({
      since: '2026-01-01',
      balanceMinutes: 45,
      adjustments: [
        {
          id: 'adjustment',
          minutes: -45,
          effectiveOn: '2026-10-12',
          reason: 'Auszahlung',
          createdAt: '2026-10-12T12:00:00Z',
        },
      ],
    });
    await fixture.whenStable();
    expect(el.textContent).toContain('Saldo +0:45 Std.');
    expect(el.querySelector('app-overtime-account table')?.textContent).toContain('Auszahlung');
  });
});

describe('Überstundenkonto verwalten', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('aktiviert und beendet das Konto über die API', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(OvertimeAccount);
    fixture.componentRef.setInput('employeeId', 'test');
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne('/api/time/overtime?employeeId=test'))).flush(null);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('nicht aktiviert');
    enter(el, 'overtime-since', '2026-01-01');
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const activate = http.expectOne('/api/employees/test/overtime-account');
    expect(activate.request.method).toBe('PUT');
    expect(activate.request.body).toEqual({ since: '2026-01-01' });
    activate.flush({ since: '2026-01-01', balanceMinutes: 0, adjustments: [] });
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Beenden')!
      .click();
    const end = http.expectOne('/api/employees/test/overtime-account');
    expect(end.request.body).toEqual({ since: null });
    end.flush(null);
    await fixture.whenStable();
    expect(el.textContent).toContain('nicht aktiviert');
    expect(el.querySelector('#overtime-adjustment-form')).toBeNull();
  });
  it('zeigt für Minijobs nur den Hinweis ohne Kontoabfrage oder Formulare', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(OvertimeAccount);
    fixture.componentRef.setInput('employeeId', 'test');
    fixture.componentRef.setInput('minijob', true);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Für Minijobs gibt es kein Überstundenkonto.');
    expect(el.querySelector('form')).toBeNull();
    TestBed.inject(HttpTestingController).expectNone('/api/time/overtime?employeeId=test');
  });
});

describe('EmployeePage Übertragsvorschlag', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('übernimmt den abgerundeten Vorjahresrest nur ins Feld und speichert erst auf Aufforderung', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'test' })) } },
      ],
    });
    const fixture = TestBed.createComponent(EmployeePage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne('/api/employees/test').flush({
      id: 'test',
      name: 'Testperson',
      jobTitle: null,
      loginEmail: 'test@example.org',
      role: 'ADMIN',
      leadId: null,
      deputyId: null,
      entryDate: '2026-01-01',
      exitDate: null,
      status: 'ACTIVE',
      currentTerms: null,
      carryOver: { year: leaveYear, days: 2 },
      warnings: [],
    });
    http.expectOne('/api/employees').flush([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne('/api/employees/test/terms').flush([]);
    http.expectOne('/api/legal-parameters').flush([]);
    await flushLeave(http);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    enter(el, 'employee-name', 'Ungespeicherter Entwurf');
    enter(el, 'employee-carry-year', String(leaveYear + 1), 'change');
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne(`/api/leave/account?year=${leaveYear}&employeeId=test`).flush(leaveAccount);
    http
      .expectOne(`/api/leave/account?year=${leaveYear + 1}&employeeId=test`)
      .flush({ ...leaveAccount, year: leaveYear + 1, carryOver: 6 });
    http.expectOne(`/api/leave/notices?employeeId=test&year=${leaveYear}`).flush([]);
    await fixture.whenStable();
    expect(el.textContent).toContain(`Rechnerischer Rest ${leaveYear}: 4,5 Tage`);
    expect(el.textContent).toContain('Ein halber Tag wird nicht übernommen');
    expect(el.querySelector<HTMLInputElement>('#employee-carry')?.value).toBe('3');
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Übernehmen')!
      .click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('#employee-carry')?.value).toBe('4');
    expect(el.textContent).toContain(
      'Ohne rechtzeitigen Urlaubshinweis darf Resturlaub nicht verfallen.',
    );
    http.expectNone((r) => r.method !== 'GET');
    expect(el.querySelector<HTMLInputElement>('#employee-name')?.value).toBe(
      'Ungespeicherter Entwurf',
    );
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Übertrag speichern')!
      .click();
    const request = http.expectOne(`/api/employees/test/carry-over/${leaveYear + 1}`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ days: 4 });
    request.flush({ year: leaveYear + 1, days: 4 });
    await flushLeave(http);
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('#employee-name')?.value).toBe(
      'Ungespeicherter Entwurf',
    );
  });
});

describe('EmployeePage Warnung beim Übertrag', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it.each([
    { timely: false, days: '4', warning: true, late: false },
    { timely: true, days: '4', warning: false, late: false },
    { timely: false, days: '5', warning: false, late: false },
    { timely: false, days: '6', warning: false, late: false },
    // Ein späterer, verspäteter Hinweis ist maßgeblich (Codex-Review Web Phase 4, Befund 1).
    { timely: true, days: '4', warning: true, late: true },
  ])(
    'zeigt bei timely=$timely, später=$late und $days Tagen die Warnung=$warning, ohne Speichern zu sperren',
    async ({ timely, days, warning, late }) => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          {
            provide: ActivatedRoute,
            useValue: { paramMap: of(convertToParamMap({ id: 'test' })) },
          },
        ],
      });
      const fixture = TestBed.createComponent(EmployeePage);
      const http = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      await Promise.resolve();
      http.expectOne('/api/employees/test').flush({
        id: 'test',
        name: 'Testperson',
        jobTitle: null,
        loginEmail: 'test@example.org',
        role: 'ADMIN',
        leadId: null,
        leadName: null,
        deputyId: null,
        deputyName: null,
        entryDate: '2026-01-01',
        exitDate: null,
        status: 'ACTIVE',
        currentTerms: null,
        carryOver: null,
        warnings: [],
      });
      http.expectOne('/api/employees').flush([]);
      http
        .expectOne((r) => r.url === '/api/leave/notices')
        .flush([
          {
            id: 'notice',
            employeeId: 'test',
            employeeName: 'Testperson',
            year: leaveYear - 1,
            restHalfDays: 10,
            text: 'Testhinweis',
            sentAt: `${leaveYear - 1}-09-01T10:00:00Z`,
            sentByName: 'Testadmin',
            emailSentAt: null,
            readAt: null,
            timelyForYearEnd: timely,
            timelyForMarch31: true,
          },
          ...(late
            ? [
                {
                  id: 'late',
                  employeeId: 'test',
                  employeeName: 'Testperson',
                  year: leaveYear - 1,
                  restHalfDays: 10,
                  text: 'Korrigierter Hinweis',
                  sentAt: `${leaveYear - 1}-10-15T10:00:00Z`,
                  sentByName: 'Testadmin',
                  emailSentAt: null,
                  readAt: null,
                  timelyForYearEnd: false,
                  timelyForMarch31: true,
                },
              ]
            : []),
        ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      await Promise.resolve();
      http.expectOne('/api/employees/test/terms').flush([]);
      http.expectOne('/api/legal-parameters').flush([]);
      http
        .match((r) => r.url === '/api/leave/account')
        .forEach((r) =>
          r.flush({ ...leaveAccount, year: Number(r.request.params.get('year')), rest: 10 }),
        );
      http.expectOne('/api/employees/test/leave-ledger').flush([]);
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      enter(el, 'employee-carry', days);
      await fixture.whenStable();
      expect(
        el.textContent?.includes(
          'Ohne rechtzeitigen Urlaubshinweis darf Resturlaub nicht verfallen.',
        ),
      ).toBe(warning);
      expect(
        [...el.querySelectorAll('button')].find(
          (b) => b.textContent?.trim() === 'Übertrag speichern',
        )!.disabled,
      ).toBe(false);
    },
  );
});

it('zeigt unter 640 px Stichtag und Stunden mit aufklappbarer Begründung', async () => {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);

  const fixture = TestBed.createComponent(OvertimeAccount);
  fixture.componentRef.setInput('employeeId', 'test');
  fixture.detectChanges();
  await Promise.resolve();
  http.expectOne('/api/time/overtime?employeeId=test').flush({
    since: '2026-01-01',
    balanceMinutes: -45,
    adjustments: [
      {
        id: 'adjustment',
        minutes: -45,
        effectiveOn: '2026-10-12',
        reason: 'Testauszahlung',
        createdAt: '2026-10-12T12:00:00Z',
      },
    ],
  });
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;

  const table = el.querySelector<HTMLTableElement>('table')!;
  const row = table.tBodies[0]!.rows[0]!;
  const headers = table.querySelectorAll('th');
  for (const [index, optional] of [false, false, true, false].entries()) {
    expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
    expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
  }
  const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
  expect(toggle.getAttribute('aria-label')).toBe('Details zu 12.10.2026, \u22120:45');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  fixture.detectChanges();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const details = row.nextElementSibling!;
  expect(details.classList).toContain('row-details');
  expect(details.querySelector('td')!.colSpan).toBe(headers.length);
  for (const text of ['Begründung', 'Testauszahlung']) expect(details.textContent).toContain(text);

  row.cells[0]!.click();
  fixture.detectChanges();
  expect(table.querySelector('.row-details')).toBeNull();
});

describe('AU ab Tag 1', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('zeigt den gespeicherten Wert aus der Mitarbeiteransicht', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(CertificateRequirement);
    fixture.componentRef.setInput('employeeId', 'test');
    fixture.componentRef.setInput('initialValue', true);
    fixture.detectChanges();
    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '[type="checkbox"]',
    )!;
    expect(toggle.checked).toBe(true);
    expect(toggle.indeterminate).toBe(false);
  });
  it('zeigt fehlenden Ausgangswert als unbekannt und speichert bestätigten Zustand', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(CertificateRequirement);
    fixture.componentRef.setInput('employeeId', 'test');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const http = TestBed.inject(HttpTestingController);
    const toggle = el.querySelector<HTMLInputElement>('[type="checkbox"]')!;
    expect(toggle.indeterminate).toBe(true);
    expect(el.textContent).toContain('§ 5 Abs. 1 Satz 3 EFZG');
    toggle.click();
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const req = http.expectOne('/api/employees/test/certificate-from-day1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ value: true });
    req.flush({ value: true });
    await fixture.whenStable();
    expect(toggle.checked).toBe(true);
    expect(toggle.indeterminate).toBe(false);
    expect(el.querySelector('[role="status"]')?.textContent).toContain('AU-Pflicht gespeichert.');
    toggle.click();
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const off = http.expectOne('/api/employees/test/certificate-from-day1');
    expect(off.request.body).toEqual({ value: false });
    off.flush({ message: 'Änderung abgelehnt.' }, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Änderung abgelehnt.');
  });
});

describe('EmployeePage Jugendarbeitsschutz', () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(HttpTestingController).verify();
  });
  // Geburtstag am 29.02.: im Nichtschaltjahr gilt der 01.03. als 18. Geburtstag (wie `ageOn`).
  it.each([
    ['2008-02-29', '28.02.2026'],
    ['2010-02-28', '27.02.2028'],
  ])('zeigt für Geburtsdatum %s „gilt bis %s“', async (birth, until) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2025-10-16T10:00:00Z'));
    const { fixture, el, http } = await render();
    enter(el, 'employee-birth', birth);
    await fixture.whenStable();
    expect(el.textContent).toContain(`Jugendarbeitsschutz gilt bis ${until}`);
    http.match(() => true);
  });
  it.each([false, true])(
    'sendet Jugenddaten beim Anlegen, geleert=%s, und zeigt API-Fehler',
    async (clear) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
      const { fixture, el, http } = await render();
      enter(el, 'employee-name', 'Testperson');
      enter(el, 'employee-email', 'test@example.org');
      enter(el, 'employee-role', 'ADMIN', 'change');
      enter(el, 'employee-birth', '2010-03-01');
      enter(el, 'employee-school', '2027-07-31');
      await fixture.whenStable();
      expect(el.textContent).toContain('Jugendarbeitsschutz gilt bis 29.02.2028');
      if (clear) {
        enter(el, 'employee-birth', '');
        enter(el, 'employee-school', '');
        await fixture.whenStable();
        expect(el.textContent).not.toContain('Jugendarbeitsschutz gilt bis');
      }
      el.querySelector('app-terms-form form')!.dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      const request = http.expectOne({ method: 'POST', url: '/api/employees' });
      expect(request.request.body).toMatchObject({
        birthDate: clear ? null : '2010-03-01',
        fullTimeSchoolUntil: clear ? null : '2027-07-31',
      });
      request.flush(
        {
          message: 'Personen unter 15 Jahren dürfen nicht beschäftigt werden (§ 5 Abs. 1 JArbSchG)',
        },
        { status: 400, statusText: 'Bad Request' },
      );
      await fixture.whenStable();
      expect(el.querySelector('[role="alert"]')?.textContent).toContain(
        'Personen unter 15 Jahren dürfen nicht beschäftigt werden (§ 5 Abs. 1 JArbSchG)',
      );
    },
  );
  it('blendet den Jugendhinweis am 18. Geburtstag aus', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
    const { fixture, el } = await render();
    enter(el, 'employee-birth', '2008-10-16');
    await fixture.whenStable();
    expect(el.textContent).not.toContain('Jugendarbeitsschutz gilt bis');
    enter(el, 'employee-birth', '2008-10-17');
    await fixture.whenStable();
    expect(el.textContent).toContain('Jugendarbeitsschutz gilt bis 16.10.2026');
  });
});

it('speichert und leert Jugenddaten bestehender Mitarbeiter, reicht das Datum weiter und zeigt Warnungen', async () => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'test' })) } },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(EmployeePage);
  const person = {
    id: 'test',
    name: 'Testperson',
    jobTitle: null,
    loginEmail: 'test@example.org',
    role: 'ADMIN',
    leadId: null,
    deputyId: null,
    entryDate: '2026-01-01',
    exitDate: null,
    birthDate: null,
    fullTimeSchoolUntil: null,
    status: 'ACTIVE',
    currentTerms: null,
    carryOver: null,
    warnings: [],
  };
  fixture.detectChanges();
  await Promise.resolve();
  http.expectOne('/api/employees/test').flush(person);
  http.expectOne('/api/employees').flush([]);
  (await vi.waitFor(() => http.expectOne('/api/employees/test/terms'))).flush([]);
  (await vi.waitFor(() => http.expectOne('/api/legal-parameters'))).flush([
    { key: 'MIN_WAGE_HOURLY_CENTS', value: 1390, validFrom: '2026-01-01', source: 'Test' },
    { key: 'MINIJOB_MONTHLY_LIMIT_CENTS', value: 60300, validFrom: '2026-01-01', source: 'Test' },
  ]);
  await flushLeave(http);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  enter(el, 'employee-birth', '2010-03-01');
  enter(el, 'employee-school', '2027-07-31');
  el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  const patch = http.expectOne({ method: 'PATCH', url: '/api/employees/test' });
  expect(patch.request.body).toEqual({
    birthDate: '2010-03-01',
    fullTimeSchoolUntil: '2027-07-31',
  });
  patch.flush({
    ...person,
    ...patch.request.body,
    warnings: [
      { code: 'YOUTH_MIN_VACATION', text: 'Vertragsstand unterschreitet den Jugendmindesturlaub.' },
    ],
  });
  (await vi.waitFor(() => http.expectOne('/api/employees'))).flush([]);
  await flushLeave(http);
  await fixture.whenStable();
  expect(el.querySelector('app-rule-messages')?.textContent).toContain(
    'Vertragsstand unterschreitet den Jugendmindesturlaub.',
  );
  enter(el, 'terms-date', '2027-01-01');
  enter(el, 'terms-annual', '22');
  await fixture.whenStable();
  expect(el.querySelector('app-terms-history')?.textContent).toContain('mindestens 23 Tage');
  expect(
    el.querySelector<HTMLButtonElement>('app-terms-form button[type="submit"]')!.disabled,
  ).toBe(true);
  enter(el, 'employee-birth', '');
  enter(el, 'employee-school', '');
  el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  const clear = http.expectOne({ method: 'PATCH', url: '/api/employees/test' });
  expect(clear.request.body).toEqual({ birthDate: null, fullTimeSchoolUntil: null });
  clear.flush(person);
  (await vi.waitFor(() => http.expectOne('/api/employees'))).flush([]);
  await flushLeave(http);
  await fixture.whenStable();
  expect(
    el.querySelector<HTMLButtonElement>('app-terms-form button[type="submit"]')!.disabled,
  ).toBe(false);
  http.verify();
});

// Review Web Phase 7, Befund 1: Warnungen nach Vertragsänderung neu laden, Entwurf der Stammdaten behalten.
it('aktualisiert Jugendurlaubswarnungen nach einer Vertragsänderung ohne Stammdaten zu verwerfen', async () => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'test' })) } },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(EmployeePage);
  const warning = {
    code: 'YOUTH_MIN_VACATION',
    text: 'Vertragsstand ab 01.01.2027: mindestens 23 Tage (§ 19 Abs. 2 JArbSchG).',
  };
  const person = {
    id: 'test',
    name: 'Testperson',
    jobTitle: null,
    loginEmail: 'test@example.org',
    role: 'ADMIN',
    leadId: null,
    deputyId: null,
    entryDate: '2026-01-01',
    exitDate: null,
    birthDate: '2010-03-01',
    fullTimeSchoolUntil: null,
    status: 'ACTIVE',
    currentTerms: null,
    carryOver: null,
    warnings: [warning],
  };
  fixture.detectChanges();
  await Promise.resolve();
  http.expectOne('/api/employees/test').flush(person);
  http.expectOne('/api/employees').flush([]);
  (await vi.waitFor(() => http.expectOne('/api/employees/test/terms'))).flush([]);
  (await vi.waitFor(() => http.expectOne('/api/legal-parameters'))).flush([
    { key: 'MIN_WAGE_HOURLY_CENTS', value: 1390, validFrom: '2026-01-01', source: 'Test' },
    { key: 'MINIJOB_MONTHLY_LIMIT_CENTS', value: 60300, validFrom: '2026-01-01', source: 'Test' },
  ]);
  await flushLeave(http);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  expect(el.textContent).toContain('Vertragsstand ab 01.01.2027');

  enter(el, 'employee-name', 'Ungespeicherter Name');
  enter(el, 'terms-date', '2027-01-01');
  enter(el, 'terms-annual', '23');
  await fixture.whenStable();
  el.querySelector('app-terms-form form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  const save = await vi.waitFor(() =>
    http.expectOne({ method: 'POST', url: '/api/employees/test/terms' }),
  );
  save.flush({ terms: { id: 't2' }, warnings: [], infos: [] });
  (await vi.waitFor(() => http.expectOne('/api/employees/test'))).flush({
    ...person,
    warnings: [],
  });
  http.match('/api/employees/test/terms').forEach((r) => r.flush([]));
  await flushLeave(http);
  await fixture.whenStable();
  expect(el.textContent).not.toContain('Vertragsstand ab 01.01.2027');
  expect(el.querySelector<HTMLInputElement>('#employee-name')!.value).toBe('Ungespeicherter Name');
});
