import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CorrectionRequestView } from '@as/shared';
import { SessionStore } from '../../core/session.store';
import { ApprovalsCounter } from '../../core/approvals-counter';
import { ApprovalsPage } from './approvals-page';

const request: CorrectionRequestView = {
  id: 'request',
  entryId: 'entry',
  employeeId: 'other',
  employeeName: 'Teamperson',
  workDate: '2026-10-12',
  kind: 'CORRECT',
  current: { start: '08:00', end: '16:00', breakMinutes: 30 },
  proposed: {
    date: '2026-10-12',
    start: '08:00',
    end: '16:30',
    breaks: [{ start: '12:00', end: '12:30' }],
  },
  reason: 'Ende berichtigen',
  requestedAt: '2026-10-12T15:00:00Z',
  status: 'PENDING',
  decidedByName: null,
  decidedAt: null,
  decisionReason: null,
};
const counter = { reload: vi.fn(), count: () => 0, decides: () => true };

async function render() {
  counter.reload.mockClear();
  TestBed.configureTestingModule({
    providers: [
      { provide: ApprovalsCounter, useValue: counter },
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const session = TestBed.inject(SessionStore).ensureLoaded();
  http
    .expectOne('/api/auth/session')
    .flush({ id: 'self', name: 'Testleitung', role: 'LEAD', method: 'CODE' });
  await session;
  const fixture = TestBed.createComponent(ApprovalsPage);
  fixture.detectChanges();
  await Promise.resolve();
  (await vi.waitFor(() => http.expectOne('/api/time/corrections?status=PENDING'))).flush([
    request,
    { ...request, id: 'own', employeeId: 'self', employeeName: 'Eigener Antrag' },
  ]);
  http.expectOne('/api/time/corrections').flush([]);
  // Urlaubsanträge testet leave-decisions.spec.ts.
  http.match((r) => r.url === '/api/leave/requests').forEach((r) => r.flush([]));
  await fixture.whenStable();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}
function button(el: HTMLElement, text: string) {
  return [...el.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!;
}
describe('ApprovalsPage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('gibt fremde Anträge frei und bietet eigene nicht zur Entscheidung an', async () => {
    const { el, fixture, http } = await render();
    expect(el.textContent).not.toContain('Eigener Antrag');
    expect(el.textContent).toContain('12:00–12:30');
    button(el, 'Freigeben').click();
    http
      .expectOne({ method: 'POST', url: '/api/time/corrections/request/approve' })
      .flush({ ...request, status: 'APPROVED' });
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne('/api/time/corrections?status=PENDING'))).flush([]);
    http.expectOne('/api/time/corrections').flush([{ ...request, status: 'APPROVED' }]);
    await fixture.whenStable();
    expect(el.textContent).toContain('Freigegeben');
    expect(counter.reload).toHaveBeenCalledTimes(1);
  });
  it('sperrt Ablehnen ohne Begründung und sendet die getrimmte Begründung', async () => {
    const { el, fixture, http } = await render();
    expect(button(el, 'Ablehnen').disabled).toBe(true);
    const input = el.querySelector<HTMLTextAreaElement>('textarea')!;
    input.value = '  ';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(button(el, 'Ablehnen').disabled).toBe(true);
    input.value = ' Bitte prüfen ';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    button(el, 'Ablehnen').click();
    const req = http.expectOne('/api/time/corrections/request/reject');
    expect(req.request.body).toEqual({ reason: 'Bitte prüfen' });
    req.flush({ message: 'Bereits entschieden.' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Bereits entschieden.');
  });
});
