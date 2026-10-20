import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EmployeeView } from '@as/shared';
import { EmployeesListPage } from './employees-list-page';

export const employee: EmployeeView = {
  id: 'employee-1',
  name: 'Testperson',
  jobTitle: 'Entwicklung',
  role: 'EMPLOYEE',
  leadId: 'admin-1',
  leadName: 'Testadmin',
  deputyId: null,
  deputyName: null,
  entryDate: '2026-01-01',
  exitDate: null,
  status: 'ACTIVE',
  currentTerms: {
    id: 'terms-1',
    validFrom: '2026-01-01',
    type: 'PART_TIME',
    weeklyMinutes: 2310,
    workDays: [1, 2, 3, 4, 5],
    annualLeaveDays: 30,
    extraLeaveDays: 2,
    hourlyWageCents: null,
    dailyTargetMinutes: 462,
    minVacationDays: 20,
    editable: false,
  },
  carryOver: { year: 2026, days: 2 },
  warnings: [{ code: 'FUTURE_WAGE', text: 'Künftiger Mindestlohn unterschritten.' }],
};

describe('EmployeesListPage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('zeigt Vertragswerte, alle Status-Pillen und Warnungen aus der API', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(EmployeesListPage);
    fixture.detectChanges();
    await Promise.resolve();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/employees')
      .flush([
        employee,
        { ...employee, id: '2', status: 'LOCKED' },
        { ...employee, id: '3', status: 'EXITED' },
      ]);
    TestBed.inject(HttpTestingController)
      .expectOne((r) => r.url === '/api/leave/accounts')
      .flush([]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.lv-ok')?.textContent).toContain('Aktiv');
    expect(el.querySelector('.lv-crit')?.textContent).toContain('Gesperrt');
    expect(el.querySelector('.lv-mute')?.textContent).toContain('Ausgetreten');
    expect(el.querySelector('app-rule-messages .lv-warn')?.textContent).toContain(
      'Künftiger Mindestlohn',
    );
    expect(el.textContent).toContain('38,5');
    expect(el.textContent).toContain('32');
    expect(el.querySelector('a[href="/mitarbeiter/employee-1"]')).not.toBeNull();
  });
});

describe('EmployeesListPage Resturlaub', () => {
  it('ordnet Rest über employeeId zu, zeigt Platzhalter und negative Werte rot', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(EmployeesListPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne('/api/employees').flush([employee, { ...employee, id: 'second' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('thead th')[5]?.textContent).toBe('Rest');
    expect(el.querySelectorAll('tbody tr')[0]?.children[5]?.textContent?.trim()).toBe('–');
    http
      .expectOne((r) => r.url === '/api/leave/accounts')
      .flush([
        { employeeId: 'second', rest: 9 },
        { employeeId: employee.id, rest: -1 },
      ]);
    await fixture.whenStable();
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0]?.children[5]?.textContent?.trim()).toBe('−0,5');
    expect(rows[0]?.children[5]?.classList).toContain('text-crit');
    expect(rows[1]?.children[5]?.textContent?.trim()).toBe('4,5');
    http.verify();
  });
});

it('zeigt unter 640 px Name, Rest und Status mit Warnmarkierung und Mitarbeiterdetails', async () => {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const http = TestBed.inject(HttpTestingController);

  const fixture = TestBed.createComponent(EmployeesListPage);
  fixture.detectChanges();
  await Promise.resolve();
  http.expectOne('/api/employees').flush([employee]);
  http
    .expectOne((r) => r.url === '/api/leave/accounts')
    .flush([{ employeeId: employee.id, rest: -1 }]);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;

  const table = el.querySelector<HTMLTableElement>('table')!;
  const row = table.tBodies[0]!.rows[0]!;
  const headers = table.querySelectorAll('th');
  for (const [index, optional] of [
    false,
    true,
    true,
    true,
    true,
    false,
    false,
    true,
    true,
    true,
    false,
  ].entries()) {
    expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
    expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
  }
  const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
  expect(toggle.getAttribute('aria-label')).toBe('Details zu Testperson');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  fixture.detectChanges();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const details = row.nextElementSibling!;
  expect(details.classList).toContain('row-details');
  expect(details.querySelector('td')!.colSpan).toBe(headers.length);
  for (const text of [
    'Art',
    'Teilzeit',
    '38,5',
    'Arbeitstage',
    'Mo',
    'Urlaub/Jahr',
    '32',
    'Vorgesetzte/r',
    'Testadmin',
    'Hinweise',
    'Künftiger Mindestlohn',
    'Bearbeiten',
  ])
    expect(details.textContent).toContain(text);
  expect(details.querySelector('button, a')).not.toBeNull();

  expect(row.cells[5]!.classList).toContain('text-crit');
  expect(row.querySelector('td:not(.col-opt) .lv-warn')).not.toBeNull();
  expect(details.querySelector('a')!.getAttribute('href')).toBe('/mitarbeiter/employee-1');

  row.cells[0]!.click();
  fixture.detectChanges();
  expect(table.querySelector('.row-details')).toBeNull();
});
