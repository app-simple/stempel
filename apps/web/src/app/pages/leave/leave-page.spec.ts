import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type LeaveNoticeView, type LeaveRequestView, type OvertimeView } from '@as/shared';
import { ToastService } from '../../core/toast.service';
import { LeavePage } from './leave-page';
import {
  account,
  button,
  check,
  enter,
  firstDay,
  lastDay,
  preview,
  request,
  setupSession,
  today,
} from './leave-test-data';

async function render(
  list: LeaveRequestView[] = [request],
  overtime: OvertimeView | null = null,
  role: 'EMPLOYEE' | 'ADMIN' = 'EMPLOYEE',
  notices: LeaveNoticeView[] = [],
) {
  const http = await setupSession(role);
  const fixture = TestBed.createComponent(LeavePage);
  fixture.detectChanges();
  await Promise.resolve();
  http.expectOne('/api/me').flush({ currentTerms: { workDays: [1, 3, 5] } });
  http.expectOne((r) => r.url === '/api/leave/account').flush(account);
  const requests = http.expectOne((r) => r.url === '/api/leave/requests');
  expect(requests.request.params.get('employeeId')).toBe('self');
  requests.flush(list);
  http.expectOne('/api/time/overtime').flush(overtime);
  const sickRequest = http.expectOne('/api/sick?employeeId=self');
  sickRequest.flush([]);
  const noticeRequest = http.expectOne((r) => r.url === '/api/leave/notices');
  expect(noticeRequest.request.params.get('employeeId')).toBe('self');
  noticeRequest.flush(notices);
  await fixture.whenStable();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}
async function requestPreview(
  view: Awaited<ReturnType<typeof render>>,
  from = firstDay,
  to = lastDay,
) {
  enter(view.el, '#leave-from', from);
  enter(view.el, '#leave-to', to);
  view.fixture.detectChanges();
  return vi.waitFor(() => view.http.expectOne('/api/leave/preview'));
}

describe('LeavePage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('stellt ungelesene Hinweise voran, erhält Textumbrüche und bestätigt das Lesen', async () => {
    const notice: LeaveNoticeView = {
      id: 'unread',
      employeeId: 'self',
      employeeName: 'Testperson',
      year: 2026,
      restHalfDays: 5,
      text: 'Hallo Testperson,\nbitte Urlaub beantragen.',
      emailSentAt: '2026-10-01T08:00:00Z',
      sentAt: '2026-09-01T22:30:00Z',
      sentByName: 'Testadmin',
      readAt: null,
      timelyForYearEnd: true,
      timelyForMarch31: true,
    };
    const view = await render([], null, 'EMPLOYEE', [
      { ...notice, id: 'read', sentAt: '2026-10-01T10:00:00Z', readAt: '2026-10-02T10:00:00Z' },
      notice,
    ]);
    expect(view.el.querySelector('[data-notice]')?.getAttribute('data-notice')).toBe('unread');
    expect(
      view.el.querySelector('[data-notice="unread"]')?.classList.contains('bg-accent-soft'),
    ).toBe(true);
    expect(view.el.querySelector('[data-notice="unread"] .whitespace-pre-wrap')?.textContent).toBe(
      notice.text,
    );
    expect(view.el.textContent).toContain('erhalten am 02.09.2026');
    button(view.el, 'Gelesen').click();
    view.http
      .expectOne('/api/leave/notices/unread/read')
      .flush({ ...notice, readAt: '2026-10-13T12:00:00Z' });
    await view.fixture.whenStable();
    expect(view.el.querySelector('[data-notice="unread"]')?.textContent).toContain(
      'gelesen am 13.10.2026',
    );
    expect(view.el.querySelector('[data-notice="unread"] button')).toBeNull();
    expect(document.activeElement?.getAttribute('data-notice')).toBe('unread');
  });
  it('blendet den Abschnitt ohne Urlaubshinweise aus', async () => {
    const { el } = await render();
    expect(el.textContent).not.toContain('Urlaubshinweise');
  });
  it('zeigt Kontokacheln mit Komma, Mindesturlaub, Arbeitstage und Neuberechnung', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('2,5 Tage');
    expect(el.textContent).toContain('0,5 Tage');
    expect(el.textContent).toContain('Anspruch nach gesetzlichem Mindesturlaub');
    expect(el.textContent).toContain('Arbeitstage (Mo, Mi, Fr), ohne Feiertage.');
    expect(el.textContent).toContain('neu berechnet: 4 statt 5 Tage');
    expect(el.textContent).toContain('offen');
    expect(el.textContent).not.toContain('wartet auf');
    expect(el.querySelector<HTMLInputElement>('#leave-to')!.min).toBe(today);
    expect(el.querySelector<HTMLTextAreaElement>('#leave-note')!.maxLength).toBe(140);
  });

  it('zeigt Vorschautext und Warnung ohne zu sperren, sperrt bei Fehlern', async () => {
    const view = await render();
    (await requestPreview(view)).flush({
      ...preview,
      warnings: ['Das übersteigt dein Urlaubskonto.'],
    });
    await view.fixture.whenStable();
    expect(view.el.textContent?.replace(/\s+/g, ' ')).toContain(
      '5 Arbeitstage Urlaub. Rest danach: 13 Tage.',
    );
    expect(view.el.textContent).toContain('Allerheiligen (01.11.)');
    expect(view.el.textContent).toContain('Das übersteigt dein Urlaubskonto.');
    expect(button(view.el, 'Antrag stellen').disabled).toBe(false);
    enter(view.el, '#leave-note', 'Testnotiz');
    view.fixture.detectChanges();
    expect(button(view.el, 'Antrag stellen').disabled).toBe(true);
    (await vi.waitFor(() => view.http.expectOne('/api/leave/preview'))).flush({
      ...preview,
      errors: ['In diesem Zeitraum hast du schon einen Antrag.'],
    });
    await view.fixture.whenStable();
    expect(button(view.el, 'Antrag stellen').disabled).toBe(true);
    expect(view.el.querySelector('[role="alert"]')?.textContent).toContain('schon einen Antrag');
  });

  it('sendet halbe Ränder und Notiz, nennt den Entscheider und lädt Konto und Liste neu', async () => {
    const view = await render();
    check(view.el, '#leave-start-half');
    check(view.el, '#leave-end-half');
    enter(view.el, '#leave-note', 'Testnotiz');
    const pending = await requestPreview(view);
    expect(pending.request.body).toEqual({
      type: 'VACATION',
      from: firstDay,
      to: lastDay,
      startHalf: true,
      endHalf: true,
      note: 'Testnotiz',
    });
    pending.flush(preview);
    await view.fixture.whenStable();
    expect(view.el.textContent).toContain('Notiz für Testleitung (freiwillig)');
    button(view.el, 'Antrag stellen').click();
    const save = view.http.expectOne('/api/leave/requests');
    expect(save.request.method).toBe('POST');
    expect(save.request.body).toEqual(pending.request.body);
    save.flush(request);
    await Promise.resolve();
    view.fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/leave/account'))).flush(
      account,
    );
    (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/leave/requests'))).flush([
      request,
    ]);
    await view.fixture.whenStable();
    expect(TestBed.inject(ToastService).message()).toBe(
      'Antrag über 5 Tage an Testleitung gesendet.',
    );
    expect(document.activeElement?.id).toBe('leave-from');
  });

  it('zeigt bei einem Tag nur ein Halbtagfeld und sendet endHalf=false', async () => {
    const view = await render();
    check(view.el, '#leave-end-half');
    (await requestPreview(view, firstDay, firstDay)).flush({ ...preview, halfDays: 2 });
    await view.fixture.whenStable();
    expect(view.el.textContent).toContain('Nur ein halber Tag');
    expect(view.el.querySelector('#leave-end-half')).toBeNull();
    check(view.el, '#leave-start-half');
    view.fixture.detectChanges();
    const pending = await vi.waitFor(() => view.http.expectOne('/api/leave/preview'));
    expect(pending.request.body.startHalf).toBe(true);
    expect(pending.request.body.endHalf).toBe(false);
    pending.flush({ ...preview, halfDays: 1 });
    await view.fixture.whenStable();
    button(view.el, 'Antrag stellen').click();
    const save = view.http.expectOne('/api/leave/requests');
    expect(save.request.body.endHalf).toBe(false);
    save.flush({ message: 'Testfehler der API' }, { status: 409, statusText: 'Conflict' });
    await view.fixture.whenStable();
    expect(view.el.querySelector('[role="alert"]')?.textContent).toBe('Testfehler der API');
  });

  it('verwirft verspätete Vorschauen und zeigt Jahresaufteilung sowie sofortige Eintragung', async () => {
    const view = await render();
    const old = await requestPreview(view);
    enter(view.el, '#leave-note', 'Neue Vorschau');
    view.fixture.detectChanges();
    const current = await vi.waitFor(() => view.http.expectOne('/api/leave/preview'));
    current.flush({
      ...preview,
      immediate: true,
      deciderName: null,
      years: [
        { year: 2026, halfDays: 4, restAfter: 8, restBefore: 12 },
        { year: 2027, halfDays: 6, restAfter: 54, restBefore: 60 },
      ],
    });
    old.flush({ ...preview, errors: ['Veralteter Fehler'] });
    await view.fixture.whenStable();
    expect(view.el.textContent).not.toContain('Veralteter Fehler');
    expect(view.el.textContent).toContain('2026: 2 Tage.');
    expect(view.el.textContent).toContain('2027: 3 Tage.');
    expect(view.el.textContent).toContain('Wird sofort eingetragen.');
    expect(button(view.el, 'Antrag stellen').disabled).toBe(false);
  });

  it('zieht offene Anträge zurück und setzt den Fokus auf die aktualisierte Zeile', async () => {
    const view = await render();
    button(view.el, 'Zurückziehen').click();
    view.http
      .expectOne('/api/leave/requests/request/withdraw')
      .flush({ ...request, status: 'WITHDRAWN' });
    await Promise.resolve();
    view.fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/leave/account'))).flush(
      account,
    );
    await view.fixture.whenStable();
    expect(view.el.textContent).toContain('zurückgezogen');
    expect(view.el.querySelector('button[aria-label$="zurückziehen"]')).toBeNull();
    expect(document.activeElement?.getAttribute('data-request')).toBe('request');
  });

  it('erbittet Stornierung erst nach Rückfrage und zeigt anschließend die Pille', async () => {
    const view = await render([{ ...request, status: 'APPROVED' }]);
    button(view.el, 'Stornierung erbitten').click();
    await view.fixture.whenStable();
    expect(view.el.textContent).toContain(
      'Deine Vorgesetzte bzw. dein Vorgesetzter muss zustimmen.',
    );
    view.http.expectNone('/api/leave/requests/request/cancellation');
    expect(document.activeElement?.hasAttribute('data-confirm-cancel')).toBe(true);
    button(view.el, 'Abbrechen').click();
    await view.fixture.whenStable();
    expect(document.activeElement?.textContent?.trim()).toBe('Stornierung erbitten');
    button(view.el, 'Stornierung erbitten').click();
    await view.fixture.whenStable();
    button(view.el, 'Stornierung bestätigen').click();
    view.http
      .expectOne('/api/leave/requests/request/cancellation')
      .flush({ ...request, status: 'APPROVED', cancelRequestedAt: '2026-10-13T10:00:00Z' });
    await Promise.resolve();
    view.fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/leave/account'))).flush(
      account,
    );
    await view.fixture.whenStable();
    expect(view.el.textContent).toContain('Stornierung erbeten');
    expect(view.el.querySelector('button[aria-label$="erbitten"]')).toBeNull();
  });

  it('zeigt Entscheider, Ablehnungsgrund, Eintragende und neueste Anträge zuerst', async () => {
    const { el } = await render([
      request,
      {
        ...request,
        id: 'new',
        requestedAt: '2026-10-02T08:00:00Z',
        status: 'REJECTED',
        decidedByName: 'Testleitung',
        decisionReason: 'Testbegründung',
        enteredByName: 'Testadmin',
      },
      { ...request, id: 'started', status: 'APPROVED', from: today },
    ]);
    expect(el.querySelector('[data-request]')?.getAttribute('data-request')).toBe('new');
    expect(el.textContent).toContain('Testleitung');
    expect(el.textContent).toContain('Testbegründung');
    expect(el.textContent).toContain('eingetragen durch Testadmin');
    expect(el.querySelector('[data-request="started"] button.btn')).toBeNull();
  });

  it('bietet Überstundenabbau ohne Konto nicht an', async () => {
    const { el } = await render();
    expect(el.querySelector('option[value="OVERTIME_OFF"]')).toBeNull();
  });

  it('bietet Überstundenabbau mit Konto an', async () => {
    const { el } = await render([], { since: '2026-01-01', balanceMinutes: 120, adjustments: [] });
    expect(el.querySelector('option[value="OVERTIME_OFF"]')?.textContent).toContain(
      'Überstundenabbau',
    );
  });

  it('behält die gewählte Art, wenn das Überstundenkonto später eintrifft', async () => {
    const http = await setupSession();
    const fixture = TestBed.createComponent(LeavePage);
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne('/api/me').flush({ currentTerms: null });
    http.expectOne('/api/sick?employeeId=self').flush([]);
    http.expectOne((r) => r.url === '/api/leave/account').flush(account);
    http.expectOne((r) => r.url === '/api/leave/requests').flush([]);
    http.expectOne((r) => r.url === '/api/leave/notices').flush([]);
    const overtime = http.expectOne('/api/time/overtime');
    const el: HTMLElement = fixture.nativeElement;
    enter(el, '#leave-type', 'SPECIAL_LEAVE', 'change');
    fixture.detectChanges();
    overtime.flush({ since: '2026-01-01', balanceMinutes: 120, adjustments: [] });
    await fixture.whenStable();
    expect(el.querySelector<HTMLSelectElement>('#leave-type')!.value).toBe('SPECIAL_LEAVE');
  });

  it('hält das Enddatum mindestens auf heute und sperrt eigene Anträge in der Vergangenheit', async () => {
    const view = await render();
    enter(view.el, '#leave-from', '2020-01-01');
    enter(view.el, '#leave-to', '2020-01-02');
    await view.fixture.whenStable();
    expect(view.el.querySelector<HTMLInputElement>('#leave-to')!.min).toBe(today);
    expect(button(view.el, 'Antrag stellen').disabled).toBe(true);
    view.http.expectNone('/api/leave/preview');
  });

  it('meldet Ladefehler und lässt erneutes Laden zu', async () => {
    const http = await setupSession();
    const fixture = TestBed.createComponent(LeavePage);
    fixture.detectChanges();
    await Promise.resolve();
    http
      .match(() => true)
      .forEach((r) =>
        r.flush({ message: 'Testfehler' }, { status: 500, statusText: 'Server Error' }),
      );
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('[role="alert"]').length).toBe(6);
    button(el, 'Konto erneut laden').click();
    fixture.detectChanges();
    await Promise.resolve();
    http
      .expectOne((r) => r.url === '/api/leave/account')
      .flush({ ...account, rest: -5, corrections: 0 });
    await fixture.whenStable();
    expect(el.querySelector('.tile .text-crit')?.textContent).toBe('−2,5 Tage');
    expect(el.textContent).not.toContain('Korrekturen');
  });

  it('lässt den Admin eigene Abwesenheiten rückwirkend eintragen (Befund 1)', async () => {
    const view = await render([request], null, 'ADMIN');
    expect(view.el.querySelector<HTMLInputElement>('#leave-from')!.min).toBe('');
    const req = await requestPreview(view, '2026-10-05', '2026-10-06');
    expect(req.request.body).toMatchObject({ from: '2026-10-05', to: '2026-10-06' });
    req.flush({ ...preview, immediate: true, deciderName: null });
    await view.fixture.whenStable();
    expect(button(view.el, 'Antrag stellen').disabled).toBe(false);
  });

  it('storniert eigene Abwesenheiten des Admins sofort und meldet das so (Befund 9)', async () => {
    const view = await render([{ ...request, status: 'APPROVED' }], null, 'ADMIN');
    button(view.el, 'Stornierung erbitten').click();
    await view.fixture.whenStable();
    expect(view.el.textContent).toContain('Stornieren? Die Tage gehen sofort zurück aufs Konto.');
    button(view.el, 'Stornierung bestätigen').click();
    view.http
      .expectOne('/api/leave/requests/request/cancellation')
      .flush({ ...request, status: 'CANCELLED', cancelRequestedAt: '2026-10-13T10:00:00Z' });
    await Promise.resolve();
    view.fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/leave/account'))).flush(
      account,
    );
    await view.fixture.whenStable();
    expect(TestBed.inject(ToastService).message()).toBe('Abwesenheit storniert.');
  });
});

it('hält den Fokus bei einer Stornorückfrage in den geöffneten Details', async () => {
  const { el, fixture, http } = await render([{ ...request, status: 'APPROVED' }]);
  const row = el.querySelector<HTMLTableRowElement>('[data-request="request"]')!;
  row.querySelector<HTMLButtonElement>('app-row-toggle button')!.click();
  fixture.detectChanges();
  const details = row.nextElementSibling!;
  details.querySelector<HTMLButtonElement>('button[aria-label$="erbitten"]')!.click();
  await fixture.whenStable();
  expect(document.activeElement).toBe(details.querySelector('[data-confirm-cancel]'));
  expect(details.textContent).toContain('Deine Vorgesetzte bzw. dein Vorgesetzter muss zustimmen.');
  http.expectNone((r) => r.method !== 'GET');
  button(details as HTMLElement, 'Abbrechen').click();
  await fixture.whenStable();
  expect(document.activeElement).toBe(details.querySelector('button[aria-label$="erbitten"]'));
  expect(row.querySelector('app-row-toggle button')!.getAttribute('aria-expanded')).toBe('true');
  http.verify();
});

it('zeigt unter 640 px Zeitraum, Tage und Status mit Art, Entscheidung und Aktionen', async () => {
  const { el, fixture } = await render();
  const table = el.querySelector<HTMLTableElement>('section:has(#my-leave-requests) .data-table')!;
  const row = table.tBodies[0]!.rows[0]!;
  const headers = table.querySelectorAll('th');
  for (const [index, optional] of [false, true, false, false, true, true, false].entries()) {
    expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
    expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
  }
  const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
  expect(toggle.getAttribute('aria-label')).toBe('Details zu ' + row.cells[0]!.textContent!.trim());
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.click();
  fixture.detectChanges();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const details = row.nextElementSibling!;
  expect(details.classList).toContain('row-details');
  expect(details.querySelector('td')!.colSpan).toBe(headers.length);
  for (const text of ['Art', 'Urlaub', 'Entscheidung', 'offen', 'Aktionen', 'Zurückziehen'])
    expect(details.textContent).toContain(text);
  expect(details.querySelector('button, a')).not.toBeNull();

  row.cells[0]!.click();
  fixture.detectChanges();
  expect(table.querySelector('.row-details')).toBeNull();
});

it('bietet eigene Krankmeldungen mit Datenschutzhinweis an', async () => {
  const { el } = await render();
  expect(el.textContent).toContain('Krankmeldungen');
  expect(el.textContent).toContain(
    'Bitte keine Gründe oder Diagnosen angeben. Die AU vermerkt deine Vorgesetzte oder der Admin.',
  );
  expect(button(el, 'Krank melden')).toBeTruthy();
});
