import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { localDateInBerlin, addDays, isoWeekKey } from '@as/shared';
import { setupSession, button } from '../leave/leave-test-data';
import { SickReport } from './sick-report';

const today = localDateInBerlin(new Date());
async function render(stamped = false) {
  const http = await setupSession('EMPLOYEE');
  const fixture = TestBed.createComponent(SickReport);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  button(el, 'Krank melden').click();
  fixture.detectChanges();
  (await vi.waitFor(() => http.expectOne('/api/time/today'))).flush({
    date: today,
    entries: stamped ? [{ voided: false }] : [],
  });
  await fixture.whenStable();
  return { http, fixture, el };
}
function enter(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
describe('SickReport', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('meldet Kind krank ab jetzt ohne Diagnosen und zeigt API-Fehler wörtlich', async () => {
    const { el, fixture, http } = await render(true);
    el.querySelector<HTMLInputElement>('[value="CHILD_SICK"]')!.click();
    el.querySelector<HTMLInputElement>('[type="checkbox"]')!.click();
    await fixture.whenStable();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const req = http.expectOne({ method: 'POST', url: '/api/sick' });
    expect(req.request.body).toEqual({
      kind: 'CHILD_SICK',
      from: today,
      to: today,
      sinceNow: true,
    });
    req.flush(
      { message: 'Der Zeitraum überschneidet sich.' },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Der Zeitraum überschneidet sich.',
    );
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.textContent).toContain('Bitte stemple selbst aus.');
  });
  it('begrenzt eigene Daten und entfernt ab jetzt bei einem früheren Beginn', async () => {
    const { el, fixture, http } = await render(true);
    const dates = el.querySelectorAll<HTMLInputElement>('[type="date"]');
    expect(dates[0]!.min).toBe(addDays(today, -7));
    expect(dates[0]!.max).toBe(today);
    expect(dates[1]!.max).toBe(addDays(today, 14));
    el.querySelector<HTMLInputElement>('[type="checkbox"]')!.click();
    enter(el, '[data-from]', addDays(today, -1));
    await fixture.whenStable();
    expect(el.querySelector('[type="checkbox"]')).toBeNull();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const req = http.expectOne('/api/sick');
    expect(req.request.body).toEqual({ kind: 'SICK', from: addDays(today, -1), to: today });
    req.flush({});
    await fixture.whenStable();
    expect(el.querySelector('form')).toBeNull();
    expect(document.activeElement?.textContent).toContain('Krank melden');
  });
  it('bietet ohne Stempelbuchung kein ab jetzt an', async () => {
    const { el } = await render();
    expect(el.querySelector('[type="checkbox"]')).toBeNull();
  });
});

it('meldet für eine ausgewählte Teamperson mit beliebigem Zeitraum', async () => {
  const http = await setupSession('LEAD');
  const fixture = TestBed.createComponent(SickReport);
  fixture.componentRef.setInput('forOthers', true);
  fixture.componentRef.setInput('people', [{ id: 'team', name: 'Testperson' }]);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  button(el, 'Krankmeldung eintragen').click();
  fixture.detectChanges();
  const select = el.querySelector('select')!;
  select.value = 'team';
  select.dispatchEvent(new Event('change'));
  fixture.detectChanges();
  (
    await vi.waitFor(() =>
      http.expectOne(`/api/time/week?week=${isoWeekKey(today)}&employeeId=team`),
    )
  ).flush({ days: [{ date: today, entries: [{ voided: false }] }] });
  await fixture.whenStable();
  expect(el.querySelector('[type="checkbox"]')).not.toBeNull();
  const dates = el.querySelectorAll<HTMLInputElement>('[type="date"]');
  expect(dates[0]!.min).toBe('');
  expect(dates[0]!.max).toBe('');
  expect(dates[1]!.max).toBe('');
  enter(el, '[data-from]', addDays(today, 20));
  dates[1]!.value = addDays(today, 25);
  dates[1]!.dispatchEvent(new Event('input'));
  await fixture.whenStable();
  el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  const req = http.expectOne('/api/sick');
  expect(req.request.body).toEqual({
    employeeId: 'team',
    kind: 'SICK',
    from: addDays(today, 20),
    to: addDays(today, 25),
  });
  req.flush({});
  await fixture.whenStable();
  http.verify();
});

it('nimmt beim Öffnen nach Mitternacht das neue Datum (Review Web, Befund 1)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-10-14T21:50:00Z')); // 23:50 in Berlin
    const http = await setupSession('EMPLOYEE');
    const fixture = TestBed.createComponent(SickReport);
    fixture.componentRef.setInput('currentDay', { date: '2026-10-14', entries: [] } as never);
    fixture.detectChanges();
    vi.setSystemTime(new Date('2026-10-14T22:10:00Z')); // 00:10 am 15.10.
    const el = fixture.nativeElement as HTMLElement;
    button(el, 'Krank melden').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const dates = el.querySelectorAll<HTMLInputElement>('[type="date"]');
    expect(dates[0]!.value).toBe('2026-10-15');
    expect(dates[0]!.max).toBe('2026-10-15');
    expect(dates[1]!.max).toBe('2026-10-29');
    http.verify();
  } finally {
    vi.useRealTimers();
  }
});
