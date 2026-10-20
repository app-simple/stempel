import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type SickLeaveView, type Role } from '@as/shared';
import { setupSession, button } from '../leave/leave-test-data';
import { SickList } from './sick-list';

const sick: SickLeaveView = {
  id: 'sick',
  employeeId: 'self',
  employeeName: 'Testperson',
  kind: 'SICK',
  from: '2026-10-12',
  to: '2026-10-20',
  sinceLocal: null,
  certificateUntil: null,
  certificateDue: '2026-10-15',
  certificateMissing: true,
  canCertify: false,
  reportedAt: '2026-10-12T08:00:00Z',
  reportedByName: null,
};
async function render(role: Role = 'EMPLOYEE', row = sick) {
  const http = await setupSession(role);
  const fixture = TestBed.createComponent(SickList);
  fixture.componentRef.setInput('items', [row]);
  fixture.componentRef.setInput('today', '2026-10-15');
  fixture.detectChanges();
  await fixture.whenStable();
  return { http, fixture, el: fixture.nativeElement as HTMLElement };
}
function enter(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
describe('SickList', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('zeigt eigene Aktionen, AU-Status und aufklappbare Details', async () => {
    const { el, fixture, http } = await render();
    expect(el.textContent).toContain('AU fehlt');
    expect(el.textContent).not.toContain('AU vermerken');
    expect(el.textContent).not.toContain('Löschen');
    const toggle = el.querySelector<HTMLButtonElement>('app-row-toggle button')!;
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('.row-details')?.textContent).toContain('Verlängern');
    button(el, 'Wieder gesund').click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/sick/sick' });
    expect(req.request.body).toEqual({ endToday: true });
    req.flush(sick);
    await fixture.whenStable();
  });
  it('vermerkt AU nur bei canCertify und zeigt Fehler wörtlich', async () => {
    const { el, fixture, http } = await render('LEAD', { ...sick, canCertify: true });
    button(el, 'AU vermerken').click();
    await fixture.whenStable();
    expect(el.textContent).toContain('AU liegt vor bis');
    enter(el, 'input[type="date"]', '2026-10-20');
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const req = http.expectOne({ method: 'PUT', url: '/api/sick/sick/certificate' });
    expect(req.request.body).toEqual({ until: '2026-10-20' });
    req.flush({ message: 'AU nicht gespeichert.' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('AU nicht gespeichert.');
  });
  it('löscht nur als Admin mit Pflichtbegründung', async () => {
    const { el, fixture, http } = await render('ADMIN', { ...sick, canCertify: true });
    button(el, 'Löschen').click();
    await fixture.whenStable();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectNone('/api/sick/sick');
    enter(el, 'textarea', ' Fehleintrag ');
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const req = http.expectOne({ method: 'DELETE', url: '/api/sick/sick' });
    expect(req.request.body).toEqual({ reason: 'Fehleintrag' });
    req.flush(null);
    await fixture.whenStable();
  });
  it('bietet abgelaufene eigene Meldungen nicht zur Änderung an', async () => {
    const { el } = await render('EMPLOYEE', { ...sick, to: '2026-10-10' });
    expect(el.textContent).not.toContain('Verlängern');
    expect(el.textContent).not.toContain('Wieder gesund');
  });
});

it('verlängert den Zeitraum und verhindert doppelte Anfragen', async () => {
  const { el, fixture, http } = await render();
  button(el, 'Verlängern').click();
  await fixture.whenStable();
  enter(el, 'input[type="date"]', '2026-10-22');
  await fixture.whenStable();
  const form = el.querySelector('form')!;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  const req = http.expectOne('/api/sick/sick');
  expect(req.request.body).toEqual({ to: '2026-10-22' });
  req.flush({ ...sick, to: '2026-10-22' });
  await fixture.whenStable();
  http.verify();
});

it('lässt ein von Vorgesetzten weit gesetztes Ende verkürzen (Review Web, Befund 3)', async () => {
  // today = 15.10.; Ende 24.11. liegt weiter als 14 Tage voraus.
  const { el, fixture } = await render('EMPLOYEE', { ...sick, to: '2026-11-24' });
  button(el, 'Verlängern').click();
  await fixture.whenStable();
  expect(el.querySelector<HTMLInputElement>('input[type="date"]')!.max).toBe('2026-11-24');
});

it('begrenzt die Löschbegründung wie die API auf 3 bis 200 Zeichen (Review Web, Befund 7)', async () => {
  const { el, fixture } = await render('ADMIN');
  button(el, 'Löschen').click();
  await fixture.whenStable();
  const reason = el.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(reason.minLength).toBe(3);
  expect(reason.maxLength).toBe(200);
});
