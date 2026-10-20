import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { addDays, isoWeekday, type LeaveCalendarView } from '@as/shared';
import { ApiService } from '../../core/api.service';
import { NARROW } from '../../core/media';
import { SessionStore } from '../../core/session.store';
import { LeaveCalendar } from './leave-calendar';

function monthView(month: string): LeaveCalendarView {
  const days: LeaveCalendarView['days'] = [];
  for (let date = `${month}-01`; date.startsWith(month); date = addDays(date, 1)) {
    days.push({
      date,
      weekday: isoWeekday(date),
      holidayName: date.endsWith('-01') ? 'Testfeiertag' : null,
    });
  }
  return {
    month,
    days,
    rows: [
      {
        employeeId: 'shared',
        name: 'Testperson',
        cells: days.map(() => null),
        offDays: days.map(() => false),
      },
    ],
    teamAbsentCounts: days.map((day) => +day.date.slice(8)),
  };
}

async function render(narrow = true, load = async (month: string) => monthView(month)) {
  let listener: (event: { matches: boolean }) => void = () => undefined;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === NARROW && narrow,
      addEventListener: (_: string, callback: typeof listener) => {
        listener = callback;
      },
      removeEventListener: vi.fn(),
    })),
  );
  const leaveCalendar = vi.fn(load);
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { leaveCalendar } },
      { provide: SessionStore, useValue: { role: signal('EMPLOYEE') } },
    ],
  });
  const fixture = TestBed.createComponent(LeaveCalendar);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return {
    el,
    fixture,
    leaveCalendar,
    settle,
    heading: () => el.querySelector('h2')!.textContent!.trim(),
    days: () => [...el.querySelectorAll('thead th.d b')].map((day) => day.textContent!.trim()),
    click: async (label: string) => {
      const button = [...el.querySelectorAll('button')].find(
        (button) =>
          button.getAttribute('aria-label') === label || button.textContent?.trim() === label,
      );
      expect(button, label).toBeDefined();
      button!.click();
      await settle();
    },
    resize: async (matches: boolean) => {
      listener({ matches });
      await settle();
    },
    swipe: async (dx: number, dy = 0, cancel = false) => {
      const region = el.querySelector('[role="region"]')!;
      region.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: 200, clientY: 100, bubbles: true }),
      );
      if (cancel) region.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
      region.dispatchEvent(
        new MouseEvent('pointerup', { clientX: 200 + dx, clientY: 100 + dy, bubbles: true }),
      );
      await settle();
    },
  };
}

describe('LeaveCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // In Berlin bereits Montag, in UTC noch Sonntag.
    vi.setSystemTime(new Date('2026-10-11T22:30:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('zeigt Montag bis Sonntag der aktuellen Berliner Woche mit ISO-KW und Heute-Markierung', async () => {
    const view = await render();
    expect(view.heading()).toBe('Oktober 2026 · KW 42');
    expect(view.days()).toEqual(['12', '13', '14', '15', '16', '17', '18']);
    expect(view.el.querySelector('th[aria-current="date"] b')?.textContent).toBe('12');
    expect(view.el.querySelectorAll('thead .we')).toHaveLength(2);
    expect(view.el.querySelector('table')?.getAttribute('aria-label')).toBe(
      'Abwesenheiten Oktober 2026 · KW 42',
    );
  });

  it('lädt beide Monate parallel und verbindet Tage und Personen anhand ihrer IDs', async () => {
    const pending = new Map<string, (value: LeaveCalendarView) => void>();
    let defer = false;
    const view = await render(true, (month) =>
      defer
        ? new Promise((resolve) => pending.set(month, resolve))
        : Promise.resolve(monthView(month)),
    );
    await view.click('Nächste Woche');
    defer = true;
    const next = view.click('Nächste Woche');
    await vi.waitFor(() => expect([...pending.keys()]).toEqual(['2026-10', '2026-11']));
    const october = monthView('2026-10');
    const november = monthView('2026-11');
    october.rows[0]!.cells[25] = { status: 'APPROVED', half: false };
    november.rows[0]!.cells[0] = { status: 'PENDING', half: true };
    november.rows[0]!.offDays[0] = true;
    october.rows.push({
      employeeId: 'october',
      name: 'Test Oktober',
      cells: october.days.map(() => ({ status: 'APPROVED', half: false })),
      offDays: october.days.map(() => true),
    });
    november.rows.unshift({
      employeeId: 'november',
      name: 'Test November',
      cells: november.days.map(() => ({ status: 'PENDING', half: true })),
      offDays: november.days.map(() => true),
    });
    pending.get('2026-11')!(november);
    pending.get('2026-10')!(october);
    await next;
    expect(view.heading()).toBe('Oktober 2026 · KW 44');
    expect(view.days()).toEqual(['26', '27', '28', '29', '30', '31', '1']);
    const rows = [...view.el.querySelectorAll('tbody tr')];
    const row = (name: string) =>
      rows.find((row) => row.querySelector('th')?.textContent?.trim() === name)!;
    const shared = row('Testperson');
    expect(shared.querySelectorAll('td')).toHaveLength(7);
    expect(shared.querySelector('td:first-of-type .ap')).not.toBeNull();
    expect(shared.querySelector('td:last-child.off .op.half')?.getAttribute('aria-label')).toBe(
      'beantragt, halber Tag',
    );
    expect(shared.querySelector('td:last-child.hol')?.getAttribute('title')).toBe('Testfeiertag');
    expect(row('Test Oktober').querySelectorAll('.cal-absence')).toHaveLength(6);
    expect(row('Test Oktober').querySelector('td:last-child')?.classList.contains('off')).toBe(
      false,
    );
    expect(row('Test November').querySelectorAll('.cal-absence')).toHaveLength(1);
    expect(row('Test November').querySelectorAll('td.off')).toHaveLength(1);
    expect(
      [...row('Im Team abwesend').querySelectorAll('td')].map((cell) => cell.textContent?.trim()),
    ).toEqual(['26', '27', '28', '29', '30', '31', '1']);
    expect(rows).toHaveLength(4);
  });

  it('springt mit Heute zur aktuellen Woche zurück', async () => {
    const view = await render();
    await view.click('Vorige Woche');
    expect(view.heading()).toBe('Oktober 2026 · KW 41');
    await view.click('Heute');
    expect(view.days()).toEqual(['12', '13', '14', '15', '16', '17', '18']);
  });

  it('wischt nach links vor und nach rechts zurück', async () => {
    const view = await render();
    await view.swipe(-51, 20);
    expect(view.heading()).toBe('Oktober 2026 · KW 43');
    await view.swipe(51, -20);
    expect(view.heading()).toBe('Oktober 2026 · KW 42');
  });

  it.each([
    [40, 0],
    [50, 0],
    [-50, 0],
    [60, 80],
    [60, 60],
  ])('blättert bei dx=%i und dy=%i nicht', async (dx, dy) => {
    const view = await render();
    await view.swipe(dx, dy);
    expect(view.heading()).toBe('Oktober 2026 · KW 42');
    expect(view.leaveCalendar).toHaveBeenCalledTimes(1);
  });

  it('verwirft abgebrochene Gesten', async () => {
    const view = await render();
    await view.swipe(-100, 0, true);
    expect(view.heading()).toBe('Oktober 2026 · KW 42');
  });

  it('zeigt ab 640 px alle Monatstage und navigiert Monate auch über den Jahreswechsel', async () => {
    const view = await render(false);
    expect(view.heading()).toBe('Oktober 2026');
    expect(view.days()).toHaveLength(31);
    await view.swipe(-100);
    expect(view.heading()).toBe('Oktober 2026');
    await view.click('Voriger Monat');
    expect(view.heading()).toBe('September 2026');
    expect(view.days()).toHaveLength(30);
    await view.click('Heute');
    for (let i = 0; i < 3; i++) await view.click('Nächster Monat');
    expect(view.heading()).toBe('Januar 2027');
    await view.click('Voriger Monat');
    expect(view.heading()).toBe('Dezember 2026');
  });

  it('behält beim mehrfachen Breitenwechsel den gewählten Zeitraum (Review Design, Befund 5)', async () => {
    const view = await render(false);
    expect(view.heading()).toBe('Oktober 2026');
    for (let i = 0; i < 3; i++) {
      await view.resize(true);
      expect(view.heading()).toBe('Oktober 2026 · KW 42');
      expect(view.days()).toEqual(['12', '13', '14', '15', '16', '17', '18']);
      await view.resize(false);
      expect(view.heading()).toBe('Oktober 2026');
      expect(view.days()).toHaveLength(31);
    }
  });

  it('zeigt nach Monatswechsel in der Wochenansicht die Woche des Monatsersten', async () => {
    const view = await render(false);
    await view.click('Nächster Monat');
    await view.resize(true);
    expect(view.heading()).toBe('Oktober 2026 · KW 44');
    expect(view.days()).toEqual(['26', '27', '28', '29', '30', '31', '1']);
    await view.resize(false);
    expect(view.heading()).toBe('November 2026');
  });

  it('verwendet an der Jahresgrenze ISO-Wochen und beide Kalenderjahre', async () => {
    vi.setSystemTime(new Date('2027-01-01T12:00:00Z'));
    const view = await render();
    expect(view.heading()).toBe('Dezember 2026 · KW 53');
    expect(view.days()).toEqual(['28', '29', '30', '31', '1', '2', '3']);
    expect(view.leaveCalendar.mock.calls.map(([month]) => month)).toEqual(['2026-12', '2027-01']);
  });
});
