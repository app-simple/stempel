import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { TermsView } from '@as/shared';
import { TermsHistory } from './terms-history';

const current: TermsView = {
  id: 'current',
  validFrom: '2026-01-01',
  type: 'FULL_TIME',
  weeklyMinutes: 2400,
  workDays: [1, 2, 3, 4, 5],
  annualLeaveDays: 30,
  extraLeaveDays: 0,
  hourlyWageCents: null,
  dailyTargetMinutes: 480,
  minVacationDays: 20,
  editable: false,
};
const future: TermsView = { ...current, id: 'future', validFrom: '2028-01-01', editable: true };
describe('TermsHistory', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('bearbeitet nur künftige Stände und fragt vor dem Löschen nach', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TermsHistory);
    fixture.componentRef.setInput('employeeId', 'test');
    fixture.componentRef.setInput('entryDate', '2026-01-01');
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne('/api/employees/test/terms'))).flush([current, future]);
    (await vi.waitFor(() => http.expectOne('/api/legal-parameters'))).flush([
      { key: 'MIN_WAGE_HOURLY_CENTS', value: 1390, validFrom: '2026-01-01', source: 'Test' },
      { key: 'MINIJOB_MONTHLY_LIMIT_CENTS', value: 60300, validFrom: '2026-01-01', source: 'Test' },
    ]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('tbody tr:first-child button.btn')).toBeNull();
    const buttons = el.querySelectorAll<HTMLButtonElement>('tbody tr:nth-child(2) button');
    buttons[0]!.click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('#terms-date')?.value).toBe('2028-01-01');
    el.querySelector<HTMLFormElement>('app-terms-form form')!.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    const patch = http.expectOne({ method: 'PATCH', url: '/api/employees/test/terms/future' });
    expect(patch.request.body.weeklyMinutes).toBe(2400);
    patch.flush({ terms: future, infos: [], warnings: [] });
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne('/api/employees/test/terms'))).flush([current, future]);
    await fixture.whenStable();
    el.querySelectorAll<HTMLButtonElement>('tbody tr:nth-child(2) button')[1]!.click();
    await fixture.whenStable();
    http.expectNone({ method: 'DELETE', url: '/api/employees/test/terms/future' });
    el.querySelector<HTMLButtonElement>('tbody .btn-danger')!.click();
    http.expectOne({ method: 'DELETE', url: '/api/employees/test/terms/future' }).flush(null);
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne('/api/employees/test/terms'))).flush([current]);
    await fixture.whenStable();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
  });
});

it('zeigt unter 640 px Vertragsbeginn, Art und Wochenstunden mit Vertragsdetails', async () => {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);

  const fixture = TestBed.createComponent(TermsHistory);
  fixture.componentRef.setInput('employeeId', 'test');
  fixture.componentRef.setInput('entryDate', '2026-01-01');
  fixture.detectChanges();
  await Promise.resolve();
  http.expectOne('/api/employees/test/terms').flush([future]);
  http.expectOne('/api/legal-parameters').flush([]);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;

  const table = el.querySelector<HTMLTableElement>('table')!;
  const row = table.tBodies[0]!.rows[0]!;
  const headers = table.querySelectorAll('th');
  for (const [index, optional] of [
    false,
    false,
    false,
    true,
    true,
    true,
    true,
    true,
    false,
  ].entries()) {
    expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
    expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
  }
  const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
  expect(toggle.getAttribute('aria-label')).toBe('Details zu 01.01.2028');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  fixture.detectChanges();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const details = row.nextElementSibling!;
  expect(details.classList).toContain('row-details');
  expect(details.querySelector('td')!.colSpan).toBe(headers.length);
  for (const text of [
    'Arbeitstage',
    'Mo',
    'Urlaub',
    '30',
    'Stundenlohn',
    '–',
    'Soll/Tag',
    '8:00',
    'Aktion',
    'Bearbeiten',
    'Löschen',
  ])
    expect(details.textContent).toContain(text);
  expect(details.querySelector('button, a')).not.toBeNull();

  row.cells[0]!.click();
  fixture.detectChanges();
  expect(table.querySelector('.row-details')).toBeNull();
});
