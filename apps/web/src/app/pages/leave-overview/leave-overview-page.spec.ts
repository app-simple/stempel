import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type LeaveCalendarView, type Role } from '@as/shared';
import { ToastService } from '../../core/toast.service';
import {
  account,
  button,
  calendar,
  check,
  enter,
  firstDay,
  lastDay,
  person,
  preview,
  request,
  setupSession,
  today,
  year,
} from '../leave/leave-test-data';
import { LeaveOverviewPage } from './leave-overview-page';

async function render(role: Role = 'EMPLOYEE', view: LeaveCalendarView = calendar) {
  const http = await setupSession(role);
  const fixture = TestBed.createComponent(LeaveOverviewPage);
  fixture.detectChanges();
  await Promise.resolve();
  http.expectOne((r) => r.url === '/api/leave/calendar').flush(view);
  await fixture.whenStable();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}
async function openList(view: Awaited<ReturnType<typeof render>>, manager = false) {
  button(view.el, 'Liste').click();
  view.fixture.detectChanges();
  await Promise.resolve();
  (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/leave/requests'))).flush([
    request,
  ]);
  if (manager) view.http.expectOne((r) => r.url === '/api/sick').flush([]);
  if (manager)
    view.http
      .expectOne('/api/employees')
      .flush([{ ...person, id: 'self', name: 'Testleitung' }, person]);
  await view.fixture.whenStable();
}

describe('LeaveOverviewPage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('zeigt unter 640 px Mitarbeiter, Von–Bis und Status mit aufklappbaren Listendetails', async () => {
    const view = await render();
    await openList(view);
    const table = view.el.querySelector<HTMLTableElement>('#panel-list table')!;
    const row = table.tBodies[0]!.rows[0]!;
    const headers = table.querySelectorAll('th');
    for (const [index, optional] of [
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      false,
    ].entries()) {
      expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
      expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
    }
    expect(row.cells[1]!.classList).toContain('col-narrow');
    expect(row.cells[1]!.textContent).toContain('–');
    expect(row.cells[1]!.textContent).toContain(row.cells[3]!.textContent!.trim());
    expect(row.cells[1]!.textContent).toContain(row.cells[4]!.textContent!.trim());
    const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
    expect(toggle.getAttribute('aria-label')).toMatch(/^Details zu Testperson, /);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    view.fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const details = row.nextElementSibling!;
    expect(details.classList).toContain('row-details');
    expect(details.querySelector('td')!.colSpan).toBe(headers.length);
    for (const text of ['Art', 'Urlaub', 'Tage', '4 statt 5', 'Entschieden von', '–'])
      expect(details.textContent).toContain(text);
  });

  it('zeigt unter 640 px Mitarbeiter und Rest mit aufklappbaren Kontowerten', async () => {
    const { el, fixture, http } = await render();
    button(el, 'Urlaubskonten').click();
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne((r) => r.url === '/api/leave/account').flush({ ...account, rest: -5 });
    await fixture.whenStable();
    const table = el.querySelector<HTMLTableElement>('#panel-accounts table')!;
    const row = table.tBodies[0]!.rows[0]!;
    const headers = table.querySelectorAll('th');
    for (const [index, optional] of [false, true, true, true, true, true, false, false].entries()) {
      expect(headers[index]!.classList.contains('col-opt')).toBe(optional);
      expect(row.cells[index]!.classList.contains('col-opt')).toBe(optional);
    }
    expect(row.cells[6]!.querySelector('.text-crit')!.textContent).toBe('−2,5 Tage');
    const toggle = row.querySelector<HTMLButtonElement>('app-row-toggle button')!;
    expect(toggle.getAttribute('aria-label')).toBe('Details zu Testperson');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    row.cells[0]!.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const details = row.nextElementSibling!;
    expect(details.classList).toContain('row-details');
    expect(details.querySelector('td')!.colSpan).toBe(headers.length);
    expect([...details.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      'Anspruch',
      'Übertrag',
      'Korrekturen',
      'Genehmigt',
      'Beantragt',
    ]);
    expect([...details.querySelectorAll('dd')].map((dd) => dd.textContent!.trim())).toEqual([
      '30 Tage',
      '2,5 Tage',
      '0,5 Tage',
      '10 Tage',
      '4 Tage',
    ]);
  });

  it('zeigt eigene Zeile und anonyme Teamzahlen, aber nie Abwesenheitsart oder Gründe', async () => {
    const { el, http } = await render();
    expect(el.textContent).toContain('Testperson');
    expect(el.textContent).toContain('Im Team abwesend');
    const cells = [...el.querySelectorAll('tbody tr:last-child td')];
    expect(cells.map((cell) => cell.textContent?.trim())).toEqual(['2', '', '1']);
    expect(el.querySelector('.cal-absence')?.getAttribute('title')).toBe('abwesend');
    expect(el.querySelector('.cal')?.textContent).not.toMatch(
      /Urlaub|Sonderurlaub|Überstundenabbau/,
    );
    expect(el.textContent).toContain('Namen, Gründe und offene Anträge sind nicht sichtbar.');
    expect(el.querySelector('th.today')?.getAttribute('aria-current')).toBe('date');
    expect(el.querySelector('.hol')?.getAttribute('title')).toBe('Testfeiertag');
    expect(el.querySelector('td.off')).not.toBeNull();
    // Befund 6: vertragsfreie Tage auch für Screenreader erkennbar.
    expect(el.querySelector('td.off')?.textContent).toContain('kein Arbeitstag laut Vertrag');
    expect(el.querySelector('td.we')).not.toBeNull();
    http.expectNone('/api/employees');
  });

  it('zeigt im Teamkalender Namen, genehmigte und gestrichelte beantragte halbe Tage', async () => {
    const { el } = await render('LEAD', {
      ...calendar,
      teamAbsentCounts: null,
      rows: [
        ...calendar.rows,
        {
          employeeId: 'other',
          name: 'Teamperson',
          cells: [{ status: 'PENDING', half: true }, null, null],
          offDays: [false, false, true],
        },
      ],
    });
    expect(el.textContent).toContain('Wer aus deinem Team wann nicht da ist.');
    expect(el.querySelector('.cal')?.textContent).toContain('Teamperson');
    expect(el.querySelector('.cal .op.half')?.getAttribute('title')).toBe('beantragt');
    expect(el.querySelector('.cal .ap')).not.toBeNull();
    expect(el.textContent).not.toContain('Im Team abwesend');
    expect(el.querySelector('.cal')?.innerHTML).not.toMatch(/VACATION|SPECIAL_LEAVE|OVERTIME_OFF/);
  });

  it('wechselt Monate inklusive Jahresgrenze und kehrt mit Heute zurück', async () => {
    const view = await render();
    // Die Monatsknöpfe zeigen Symbole; ihr zugänglicher Name nennt die Richtung.
    for (const label of ['Voriger Monat', 'Nächster Monat', 'Heute']) {
      (label === 'Heute'
        ? button(view.el, label)
        : view.el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
      ).click();
      view.fixture.detectChanges();
      await Promise.resolve();
      if (label === 'Heute') {
        view.http.expectNone((r) => r.url === '/api/leave/calendar');
        continue;
      }
      const load = view.http.expectOne((r) => r.url === '/api/leave/calendar');
      const current = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
      if (label === 'Voriger Monat') current.setUTCMonth(current.getUTCMonth() - 1);
      expect(load.request.params.get('month')).toBe(current.toISOString().slice(0, 7));
      load.flush(calendar);
      await view.fixture.whenStable();
    }
  });

  it('filtert die Liste nach Status, Person und Jahr über die API', async () => {
    const view = await render('LEAD');
    await openList(view, true);
    expect(
      [...view.el.querySelectorAll('#leave-person option')].map((o) => o.getAttribute('value')),
    ).toEqual(['', 'other']);
    enter(view.el, '#leave-status', 'APPROVED', 'change');
    enter(view.el, '#leave-filter-person', 'other', 'change');
    enter(view.el, '#leave-year', String(year + 1), 'change');
    view.fixture.detectChanges();
    await Promise.resolve();
    const load = view.http.expectOne((r) => r.url === '/api/leave/requests');
    expect(load.request.params.get('status')).toBe('APPROVED');
    expect(load.request.params.get('employeeId')).toBe('other');
    expect(load.request.params.get('year')).toBe(String(year + 1));
    const sickLoad = view.http.expectOne((r) => r.url === '/api/sick');
    expect(sickLoad.request.params.get('employeeId')).toBe('other');
    expect(sickLoad.request.params.get('from')).toBe(`${year + 1}-01-01`);
    expect(sickLoad.request.params.get('to')).toBe(`${year + 1}-12-31`);
    sickLoad.flush([]);
    load.flush([
      {
        ...request,
        employeeId: 'other',
        employeeName: 'Teamperson',
        status: 'APPROVED',
        decidedByName: 'Testleitung',
        from: '2020-01-01',
        to: '2020-01-02',
      },
    ]);
    await view.fixture.whenStable();
    expect(view.el.querySelector('.data-table tbody')?.textContent).toContain('Teamperson');
    expect(view.el.querySelector('.data-table tbody')?.textContent).toContain('Testleitung');
    expect(view.el.querySelector('tr.opacity-60')).not.toBeNull();
  });

  it('zeigt Mitarbeitern nur die eigene Liste ohne Eintragungsformular und Personenfilter', async () => {
    const view = await render();
    button(view.el, 'Liste').click();
    view.fixture.detectChanges();
    await Promise.resolve();
    const load = view.http.expectOne((r) => r.url === '/api/leave/requests');
    expect(load.request.params.get('employeeId')).toBe('self');
    load.flush([request]);
    await view.fixture.whenStable();
    expect(view.el.querySelector('#leave-filter-person')).toBeNull();
    expect(view.el.querySelector('app-leave-form')).toBeNull();
    view.http.expectNone('/api/employees');
  });

  it('trägt für andere mit employeeId, halben Tagen und Notiz sofort ein', async () => {
    const view = await render('ADMIN');
    await openList(view, true);
    enter(view.el, '#leave-person', 'other', 'change');
    view.fixture.detectChanges();
    await Promise.resolve();
    const overtime = view.http.expectOne((r) => r.url === '/api/time/overtime');
    expect(overtime.request.params.get('employeeId')).toBe('other');
    overtime.flush(null);
    await view.fixture.whenStable();
    enter(view.el, '#leave-from', firstDay);
    enter(view.el, '#leave-to', lastDay);
    check(view.el, '#leave-start-half');
    enter(view.el, '#leave-note', 'Testnotiz');
    view.fixture.detectChanges();
    const pending = await vi.waitFor(() => view.http.expectOne('/api/leave/preview'));
    expect(pending.request.body).toEqual({
      employeeId: 'other',
      type: 'VACATION',
      from: firstDay,
      to: lastDay,
      startHalf: true,
      endHalf: false,
      note: 'Testnotiz',
    });
    pending.flush({ ...preview, immediate: true, deciderName: null });
    await view.fixture.whenStable();
    expect(view.el.textContent).toContain(
      'Wird sofort als genehmigt eingetragen und ist markiert.',
    );
    button(view.el, 'Abwesenheit eintragen').click();
    const save = view.http.expectOne('/api/leave/requests');
    expect(save.request.body).toEqual(pending.request.body);
    save.flush({ ...request, status: 'APPROVED', employeeId: 'other' });
    await Promise.resolve();
    view.fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/leave/requests'))).flush([]);
    await view.fixture.whenStable();
    expect(TestBed.inject(ToastService).message()).toBe('Abwesenheit eingetragen.');
    expect(document.activeElement?.id).toBe('leave-from');
  });

  it('erlaubt Vorgesetzten rückwirkende Eintragungen', async () => {
    const view = await render('LEAD');
    await openList(view, true);
    enter(view.el, '#leave-person', 'other', 'change');
    view.fixture.detectChanges();
    await Promise.resolve();
    view.http.expectOne((r) => r.url === '/api/time/overtime').flush(null);
    await view.fixture.whenStable();
    enter(view.el, '#leave-from', '2020-01-01');
    enter(view.el, '#leave-to', '2020-01-02');
    view.fixture.detectChanges();
    const pending = await vi.waitFor(() => view.http.expectOne('/api/leave/preview'));
    expect(pending.request.body.from).toBe('2020-01-01');
    pending.flush({ ...preview, immediate: true });
    await view.fixture.whenStable();
    expect(button(view.el, 'Abwesenheit eintragen').disabled).toBe(false);
    expect(view.el.querySelector<HTMLInputElement>('#leave-from')!.min).toBe('');
  });

  it.each<Role>(['LEAD', 'ADMIN'])(
    'zeigt für %s Urlaubskonten mit negativem Rest in Rot',
    async (role) => {
      const view = await render(role);
      button(view.el, 'Urlaubskonten').click();
      view.fixture.detectChanges();
      await Promise.resolve();
      view.http.expectOne((r) => r.url === '/api/leave/accounts').flush([{ ...account, rest: -5 }]);
      await view.fixture.whenStable();
      expect(view.el.querySelector('b.text-crit')?.textContent).toBe('−2,5 Tage');
      expect(view.el.textContent).toContain('Vollzeit, 5 Tage/Woche');
      expect(view.el.textContent).toContain('Korrekturen');
      expect(view.el.textContent).not.toContain('Du siehst nur dein eigenes Konto.');
    },
  );

  it('lädt für Mitarbeiter nur das eigene Konto und das gewählte Jahr', async () => {
    const view = await render();
    button(view.el, 'Urlaubskonten').click();
    view.fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/leave/account'))).flush(
      account,
    );
    await view.fixture.whenStable();
    expect(view.el.textContent).toContain('Du siehst nur dein eigenes Konto.');
    enter(view.el, '#leave-year', String(year + 1), 'change');
    view.fixture.detectChanges();
    await Promise.resolve();
    const load = view.http.expectOne((r) => r.url === '/api/leave/account');
    expect(load.request.params.get('year')).toBe(String(year + 1));
    load.flush({ ...account, year: year + 1 });
    await view.fixture.whenStable();
    view.http.expectNone((r) => r.url === '/api/leave/accounts');
  });

  it('bedient Tabs mit Pfeilen, Home und End samt Fokus und aria-selected', async () => {
    const view = await render();
    const calendarTab = button(view.el, 'Kalender');
    calendarTab.focus();
    calendarTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    view.fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/leave/account'))).flush(
      account,
    );
    await view.fixture.whenStable();
    const accountsTab = button(view.el, 'Urlaubskonten');
    expect(document.activeElement).toBe(accountsTab);
    expect(accountsTab.getAttribute('aria-selected')).toBe('true');
    expect(calendarTab.tabIndex).toBe(-1);
    accountsTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    view.fixture.detectChanges();
    await Promise.resolve();
    view.http.expectOne((r) => r.url === '/api/leave/calendar').flush(calendar);
    await view.fixture.whenStable();
    expect(document.activeElement).toBe(calendarTab);
    calendarTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    view.fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/leave/requests'))).flush([]);
    await view.fixture.whenStable();
    expect(document.activeElement).toBe(button(view.el, 'Liste'));
    button(view.el, 'Liste').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    view.fixture.detectChanges();
    await Promise.resolve();
    (await vi.waitFor(() => view.http.expectOne((r) => r.url === '/api/leave/account'))).flush(
      account,
    );
    await view.fixture.whenStable();
    expect(document.activeElement).toBe(accountsTab);
    expect(view.el.querySelector('#panel-list')?.hasAttribute('hidden')).toBe(true);
  });

  it('zeigt Kalenderfehler als Alert mit Wiederholen', async () => {
    const http = await setupSession();
    const fixture = TestBed.createComponent(LeaveOverviewPage);
    fixture.detectChanges();
    await Promise.resolve();
    http
      .expectOne((r) => r.url === '/api/leave/calendar')
      .flush({}, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Kalender konnte nicht geladen werden',
    );
    button(el, 'Kalender erneut laden').click();
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne((r) => r.url === '/api/leave/calendar').flush(calendar);
    await fixture.whenStable();
    expect(el.querySelector('.cal')).not.toBeNull();
  });
});

it.each(['LEAD', 'ADMIN'] as const)(
  'bietet %s Teamkrankmeldungen im Listenreiter an',
  async (role) => {
    const view = await render(role);
    await openList(view, true);
    expect(view.el.textContent).toContain('Krankmeldungen im Team');
    expect(button(view.el, 'Krankmeldung eintragen')).toBeTruthy();
  },
);
it('lädt für Mitarbeiter keine fremden Krankmeldungen', async () => {
  const view = await render();
  await openList(view);
  view.http.expectNone((r) => r.url === '/api/sick');
  expect(view.el.textContent).not.toContain('Krankmeldungen im Team');
});
