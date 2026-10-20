import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { LeaveRequestView } from '@as/shared';
import { ApprovalsCounter } from '../../core/approvals-counter';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { LeaveDecisions } from './leave-decisions';

const base: LeaveRequestView = {
  id: 'leave',
  employeeId: 'elif',
  employeeName: 'Elif Aydin',
  jobTitle: 'Entwicklung',
  type: 'VACATION',
  from: '2026-11-02',
  to: '2026-11-06',
  startHalf: false,
  endHalf: true,
  halfDays: 9,
  currentHalfDays: 9,
  note: 'Familienbesuch',
  status: 'PENDING',
  requestedAt: '2026-10-05T07:00:00Z',
  enteredByName: null,
  decidedByName: null,
  decidedAt: null,
  decisionReason: null,
  cancelRequestedAt: null,
  cancelledAt: null,
  cancelledByName: null,
  canDecide: true,
  decision: {
    restAfter: [{ year: 2026, rest: -1 }],
    overlaps: [
      { employeeName: 'Sebastian Wolf', from: '2026-11-04', to: '2026-11-10', status: 'PENDING' },
    ],
    otherOverlaps: 2,
    openBusinessDays: 6,
  },
};
const counter = { reload: vi.fn(), count: () => 0, decides: () => true };

async function render(
  pending: LeaveRequestView[] = [base],
  approved: LeaveRequestView[] = [],
  all: LeaveRequestView[] = [],
) {
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
    .flush({ id: 'lead', name: 'Tobias Lechner', role: 'LEAD', method: 'CODE' });
  await session;
  const fixture = TestBed.createComponent(LeaveDecisions);
  fixture.detectChanges();
  await Promise.resolve();
  flushLists(http, pending, approved, all);
  await fixture.whenStable();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}
function flushLists(
  http: HttpTestingController,
  pending: LeaveRequestView[],
  approved: LeaveRequestView[],
  all: LeaveRequestView[],
) {
  http
    .match((r) => r.url === '/api/leave/requests')
    .forEach((r) => {
      const status = r.request.params.get('status');
      r.flush(status === 'PENDING' ? pending : status === 'APPROVED' ? approved : all);
    });
}
/** Nach einer Aktion laden die Listen neu; offene Anfragen beantworten, bis keine nachkommen. */
async function settle(
  fixture: { detectChanges(): void; whenStable(): Promise<unknown> },
  http: HttpTestingController,
) {
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    flushLists(http, [], [], []);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await fixture.whenStable();
}
function button(el: HTMLElement, text: string) {
  return [...el.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!;
}

describe('LeaveDecisions (Freigaben, Phase 3)', () => {
  beforeEach(() => counter.reload.mockClear());
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('zeigt Zeitraum, Tage, Konto nach Genehmigung, Überschneidungen und Überfälligkeit', async () => {
    const { el } = await render([
      base,
      { ...base, id: 'own', employeeId: 'lead', canDecide: false },
    ]);
    const text = el.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Offene Abwesenheitsanträge (1)');
    expect(text).toContain('02.11. – 06.11.2026 (halb) · Urlaub · 4,5 Tage');
    expect(text).toContain('Notiz: Familienbesuch');
    expect(text).toContain('Urlaubskonto 2026 nach Genehmigung: −0,5 Tage Rest');
    expect(text).toContain('übersteigt das Urlaubskonto');
    expect(text).toContain(
      'Sebastian Wolf (beantragt, 04.11.–10.11.) sowie 2 weitere Personen im Team',
    );
    expect(text).toContain('seit 6 Arbeitstagen offen');
  });

  it('genehmigt, lädt neu und meldet es', async () => {
    const { el, fixture, http } = await render();
    button(el, 'Genehmigen').click();
    http
      .expectOne({ method: 'POST', url: '/api/leave/requests/leave/approve' })
      .flush({ ...base, status: 'APPROVED' });
    await settle(fixture, http);
    expect(TestBed.inject(ToastService).message()).toBe(
      'Urlaub von Elif Aydin genehmigt. Die Tage sind abgebucht und im Kalender eingetragen.',
    );
    expect(counter.reload).toHaveBeenCalled();
    expect(el.textContent).toContain('Keine offenen Anträge.');
  });

  it('verlangt für die Ablehnung einen Satz Begründung', async () => {
    const { el, fixture, http } = await render();
    button(el, 'Ablehnen').click();
    await fixture.whenStable();
    const area = el.querySelector<HTMLTextAreaElement>('textarea')!;
    area.value = 'zu kurz';
    area.dispatchEvent(new Event('input'));
    button(el, 'Ablehnung senden').click();
    await fixture.whenStable();
    http.expectNone((r) => r.method === 'POST');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('mindestens ein Satz');
    area.value = 'In dieser Woche fehlt bereits ein Kollege.';
    area.dispatchEvent(new Event('input'));
    button(el, 'Ablehnung senden').click();
    const req = http.expectOne('/api/leave/requests/leave/reject');
    expect(req.request.body).toEqual({ reason: 'In dieser Woche fehlt bereits ein Kollege.' });
    req.flush({ ...base, status: 'REJECTED' });
    await settle(fixture, http);
  });

  it('bestätigt erbetene Stornierungen', async () => {
    const approved = {
      ...base,
      status: 'APPROVED' as const,
      cancelRequestedAt: '2026-10-10T08:00:00Z',
    };
    const { el, fixture, http } = await render([], [approved]);
    expect(el.textContent).toContain('Elif Aydin bittet um Stornierung');
    button(el, 'Stornierung bestätigen').click();
    http
      .expectOne({ method: 'POST', url: '/api/leave/requests/leave/cancellation/approve' })
      .flush({ ...approved, status: 'CANCELLED' });
    await settle(fixture, http);
    expect(TestBed.inject(ToastService).message()).toContain('storniert');
  });

  it('zeigt die letzten eigenen Entscheidungen über Anträge anderer', async () => {
    const { el } = await render(
      [],
      [],
      [
        {
          ...base,
          status: 'REJECTED',
          decidedByName: 'Tobias Lechner',
          decidedAt: '2026-10-06T08:00:00Z',
          decisionReason: 'Engpass im Support.',
        },
      ],
    );
    expect(el.textContent).toContain('Zuletzt entschieden');
    expect(el.textContent).toContain('Engpass im Support.');
  });

  it('zeigt unter 640 px die Begründung erst in der Detailzeile (Review Design, Befund 7)', async () => {
    const { el, fixture } = await render(
      [],
      [],
      [
        {
          ...base,
          status: 'REJECTED',
          decidedByName: 'Tobias Lechner',
          decidedAt: '2026-10-06T08:00:00Z',
          decisionReason: 'Engpass im Support.',
        },
      ],
    );
    const row = [...el.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('Engpass'))!;
    const reason = [...row.cells].find((td) => td.textContent?.includes('Engpass'))!;
    expect(reason.classList).toContain('col-opt');
    const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
    expect(toggle.getAttribute('aria-label')).toMatch(/^Details zu /);
    toggle.click();
    fixture.detectChanges();
    expect(row.nextElementSibling?.classList).toContain('row-details');
    expect(row.nextElementSibling?.textContent).toContain('Engpass im Support.');
  });

  it('zeigt Ladefehler der Stornierungen und Entscheidungen statt sie still auszublenden (Befund 2)', async () => {
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
      .flush({ id: 'lead', name: 'Tobias Lechner', role: 'LEAD', method: 'CODE' });
    await session;
    const fixture = TestBed.createComponent(LeaveDecisions);
    fixture.detectChanges();
    await Promise.resolve();
    http
      .match((r) => r.url === '/api/leave/requests')
      .forEach((r) =>
        r.request.params.get('status') === 'PENDING'
          ? r.flush([])
          : r.flush({ message: 'Fehler' }, { status: 500, statusText: 'Server Error' }),
      );
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Die erbetenen Stornierungen konnten nicht geladen werden.');
    expect(el.textContent).toContain('Die letzten Entscheidungen konnten nicht geladen werden.');
  });

  it('kennzeichnet neu berechnete Tage (Befund 5)', async () => {
    const { el } = await render([{ ...base, currentHalfDays: 8 }]);
    expect(el.textContent).toContain('4 Tage (neu berechnet: 4 statt 4,5)');
  });

  it('setzt den Fokus nach Abbrechen der Ablehnung zurück auf „Ablehnen“ (Befund 8)', async () => {
    const { el, fixture } = await render();
    button(el, 'Ablehnen').click();
    await fixture.whenStable();
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    button(el, 'Abbrechen').click();
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute('data-reject')).toBe('leave'),
    );
  });
});
