import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { localDateInBerlin, type LeaveAccountView } from '@as/shared';
import { LeaveLedger } from './leave-ledger';

const year = Number(localDateInBerlin(new Date()).slice(0, 4));
const account: LeaveAccountView = {
  employeeId: 'test',
  employeeName: 'Testperson',
  year,
  entitlement: 60,
  entitlementBasis: 'CONTRACT',
  carryOver: 4,
  corrections: -1,
  approved: 40,
  pending: 3,
  rest: 20,
  workDaysPerWeek: 5,
  employmentType: 'FULL_TIME',
};
async function render(fail = false) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(LeaveLedger);
  const http = TestBed.inject(HttpTestingController);
  fixture.componentRef.setInput('employeeId', 'test');
  fixture.detectChanges();
  await Promise.resolve();
  const request = http.expectOne(`/api/leave/account?year=${year}&employeeId=test`);
  const ledger = http.expectOne('/api/employees/test/leave-ledger');
  if (fail) {
    request.flush({}, { status: 500, statusText: 'Error' });
    ledger.flush({}, { status: 500, statusText: 'Error' });
  } else {
    request.flush(account);
    ledger.flush([]);
  }
  await fixture.whenStable();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}
function enter(el: HTMLElement, id: string, value: string, event = 'input') {
  const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event(event));
}
describe('Urlaubskonto', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it.each([
    { days: '1,5', halfDays: 3 },
    { days: '-0,5', halfDays: -1 },
    { days: '+2.5', halfDays: 5 },
  ])(
    'bucht $days Tage mit Pflichtvermerk und lädt Konto und Liste neu',
    async ({ days, halfDays }) => {
      const { fixture, http, el } = await render();
      expect([...el.querySelectorAll('.tile b')].map((b) => b.textContent?.trim())).toEqual([
        '30',
        '2',
        '−0,5',
        '20',
        '1,5',
        '10',
      ]);
      expect(el.textContent).toContain('Bitte keine Gesundheitsangaben');
      const form = el.querySelector('form')!;
      enter(el, 'leave-days', days);
      enter(el, 'leave-note', '   ');
      await fixture.whenStable();
      expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      http.expectNone((r) => r.method === 'POST');
      enter(el, 'leave-note', ' Rückbuchung nach § 9 BUrlG ');
      enter(el, 'leave-year', String(year - 1), 'change');
      await fixture.whenStable();
      expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      const request = http.expectOne('/api/employees/test/leave-ledger');
      expect(request.request.body).toEqual({
        year: year - 1,
        halfDays,
        note: 'Rückbuchung nach § 9 BUrlG',
      });
      request.flush([]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      await Promise.resolve();
      http
        .expectOne(`/api/leave/account?year=${year}&employeeId=test`)
        .flush({ ...account, rest: 23 });
      http.expectOne('/api/employees/test/leave-ledger').flush([
        {
          id: 'entry',
          year: year - 1,
          kind: 'CORRECTION',
          halfDays,
          note: 'Rückbuchung nach § 9 BUrlG',
          createdAt: '2026-10-12T12:00:00Z',
          createdByName: 'Testadmin',
        },
      ]);
      await fixture.whenStable();
      expect(el.querySelector('table')?.textContent).toContain('Testadmin');
      expect(el.querySelector('table')?.textContent).toContain('12.10.2026, 14:00');
      expect(el.querySelector('table button.btn')).toBeNull();
      expect(el.querySelector<HTMLInputElement>('#leave-note')?.value).toBe('');
      expect(el.querySelector('.tiles')?.textContent).toContain('11,5');
    },
  );
  it.each(['1,25', '0', 'abc', '1e2'])(
    'lehnt ungültige Tage %s und überlange Vermerke ab',
    async (days) => {
      const { fixture, http, el } = await render();
      enter(el, 'leave-days', days);
      enter(el, 'leave-note', 'Korrektur');
      await fixture.whenStable();
      el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      http.expectNone((r) => r.method === 'POST');
      expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
      enter(el, 'leave-days', '1');
      enter(el, 'leave-note', 'x'.repeat(201));
      await fixture.whenStable();
      expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    },
  );
  it('zeigt Ladefehler und erlaubt erneutes Laden', async () => {
    const { fixture, http, el } = await render(true);
    expect(el.textContent).toContain('Urlaubskonto konnte nicht geladen werden');
    expect(el.textContent).toContain('Korrekturbuchungen konnten nicht geladen werden');
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .filter((b) => b.textContent?.includes('Erneut'))
      .forEach((b) => b.click());
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne(`/api/leave/account?year=${year}&employeeId=test`).flush(account);
    http.expectOne('/api/employees/test/leave-ledger').flush([]);
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});

it('zeigt unter 640 px Jahr und Tage mit Vermerk, Zeitpunkt und Person', async () => {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);

  const fixture = TestBed.createComponent(LeaveLedger);
  fixture.componentRef.setInput('employeeId', 'test');
  fixture.detectChanges();
  await Promise.resolve();
  http.expectOne((r) => r.url === '/api/leave/account').flush(account);
  http.expectOne('/api/employees/test/leave-ledger').flush([
    {
      id: 'entry',
      year: 2026,
      kind: 'CORRECTION',
      halfDays: -1,
      note: 'Testkorrektur',
      createdAt: '2026-10-12T12:00:00Z',
      createdByName: 'Testadmin',
    },
  ]);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;

  const table = el.querySelector<HTMLTableElement>('table')!;
  const row = table.tBodies[0]!.rows[0]!;
  const headers = table.querySelectorAll('th');
  for (const [index, optional] of [false, false, true, true, true, false].entries()) {
    expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
    expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
  }
  const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
  expect(toggle.getAttribute('aria-label')).toBe('Details zu 2026, 12.10.2026, 14:00');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  fixture.detectChanges();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const details = row.nextElementSibling!;
  expect(details.classList).toContain('row-details');
  expect(details.querySelector('td')!.colSpan).toBe(headers.length);
  for (const text of [
    'Vermerk',
    'Testkorrektur',
    'Zeitpunkt',
    '12.10.2026, 14:00',
    'Person',
    'Testadmin',
  ])
    expect(details.textContent).toContain(text);

  row.cells[0]!.click();
  fixture.detectChanges();
  expect(table.querySelector('.row-details')).toBeNull();
});
