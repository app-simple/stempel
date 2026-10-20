import type { DayView, TimeEntryView } from '@as/shared';
import {
  minijobLine,
  reportFileName,
  reportRows,
  reportTotals,
  type MonthReport,
} from './month-report';
import { PDF_COLUMNS } from './pdf';

const entry = (overrides: Partial<TimeEntryView> = {}): TimeEntryView =>
  ({
    id: 'e1',
    startLocal: '08:00',
    endLocal: '16:30',
    endsNextDay: false,
    breakMinutes: 30,
    workMinutes: 480,
    source: 'CLOCK',
    recordedAt: '2026-10-05T06:00:00Z',
    recordedByName: null,
    reason: null,
    voided: false,
    ...overrides,
  }) as TimeEntryView;

const day = (overrides: Partial<DayView>): DayView => ({
  date: '2026-10-05',
  absence: null,
  holidayName: null,
  isWorkday: true,
  targetMinutes: 480,
  workMinutes: 480,
  balanceMinutes: 0,
  missing: false,
  entries: [],
  flags: [],
  ...overrides,
});

const report = (
  days: DayView[],
  type: MonthReport['employmentType'] = 'FULL_TIME',
): MonthReport => ({
  month: '2026-10',
  monthLabel: 'Oktober 2026',
  employeeName: 'Elif Aydın-Groß',
  jobTitle: 'Entwicklung',
  employmentType: type,
  weeklyMinutes: 2400,
  days,
  revisions: new Map([['e2', 2]]),
  minijob: null,
  minijobWages: [],
  createdAt: new Date('2026-10-13T08:00:00Z'),
});

describe('Arbeitszeitnachweis (Spezifikation Phase 4, Abschnitt 6.4)', () => {
  it('schreibt je Buchung eine Zeile mit Nachtrag, Änderungen und Hinweisen', () => {
    const rows = reportRows(
      report([
        day({
          entries: [
            entry(),
            entry({
              id: 'e2',
              startLocal: '17:00',
              endLocal: '18:00',
              source: 'MANUAL',
              recordedAt: '2026-10-06T08:04:00Z',
              recordedByName: 'Tobias Lechner',
              reason: 'Stempeln vergessen',
            }),
          ],
          workMinutes: 540,
          balanceMinutes: 60,
          flags: [
            {
              code: 'OVER_8H',
              text: 'Über 8 Std., Ausgleich nötig',
              paragraph: '§ 3 ArbZG',
              level: 'info',
            },
          ],
        }),
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: '05.10.2026',
      weekday: 'Mo',
      start: '08:00',
      end: '16:30',
      work: '8:00',
      target: '8:00',
      balance: '1:00',
      source: 'Stempeluhr',
      notes: 'Über 8 Std., Ausgleich nötig (§ 3 ArbZG)',
    });
    expect(rows[1]).toMatchObject({
      target: '',
      notes: '',
      source: 'Nachtrag',
      recordedAt: '06.10.2026 10:04',
      recordedBy: 'Tobias Lechner',
      reason: 'Stempeln vergessen',
      changed: '2×',
    });
  });

  it('zeigt Tage ohne Buchung mit Abwesenheit, Feiertag oder fehlender Buchung', () => {
    const rows = reportRows(
      report([
        day({
          date: '2026-10-06',
          absence: { type: 'VACATION', half: false },
          targetMinutes: 0,
          workMinutes: 0,
        }),
        day({ date: '2026-10-07', missing: true, workMinutes: 0, balanceMinutes: -480 }),
        day({
          date: '2026-10-03',
          holidayName: 'Tag der Deutschen Einheit',
          isWorkday: false,
          targetMinutes: 0,
        }),
        day({ date: '2026-10-04', isWorkday: false, targetMinutes: 0 }),
      ]),
    );
    expect(rows.map((r) => [r.absence, r.notes])).toEqual([
      ['Urlaub', ''],
      ['', 'Keine Buchung an einem Arbeitstag'],
      ['', 'Tag der Deutschen Einheit'],
      ['', 'kein Arbeitstag'],
    ]);
    expect(rows[1]?.balance).toBe('−8:00');
  });

  it('lässt Soll und Saldo bei Minijob leer', () => {
    const r = report([day({ entries: [entry()] })], 'MINIJOB');
    expect(reportRows(r)[0]).toMatchObject({ target: '', balance: '' });
    expect(reportTotals(r)).toEqual({ work: '8:00', target: '', balance: '' });
  });

  it('bildet einen Dateinamen ohne Sonderzeichen', () => {
    expect(reportFileName({ month: '2026-10', employeeName: 'Elif Aydın-Groß' })).toBe(
      'arbeitszeit-2026-10-elif-aydin-gross',
    );
    expect(reportFileName({ month: '2026-10', employeeName: 'Renée Müller' })).toBe(
      'arbeitszeit-2026-10-renee-mueller',
    );
  });

  it('zeigt im PDF ungültige und geänderte Buchungen (Codex-Review Phase 4 API, Befund 6)', () => {
    expect(PDF_COLUMNS.map(([key]) => key)).toEqual(expect.arrayContaining(['voided', 'changed']));
    expect(PDF_COLUMNS.reduce((sum, [, width]) => sum + width, 0)).toBeLessThanOrEqual(770);
    const rows = reportRows(report([day({ entries: [entry({ voided: true })], workMinutes: 0 })]));
    expect(rows[0]?.voided).toBe('ja');
  });

  it('multipliziert bei Lohnwechsel nicht mit einem einzelnen Lohn (Befund 12)', () => {
    const m = {
      month: '2026-10',
      workMinutes: 120,
      hourlyWageCents: 1600,
      limitCents: 60300,
      earningsCents: 3000,
      ratio: 3000 / 60300,
      level: 'ok' as const,
    };
    expect(minijobLine(m, [1600]).replace(/\u00a0/g, ' ')).toBe(
      'Minijob: 2:00 Std. × 16,00 € = 30,00 € (Grenze 603,00 €, 5 %)',
    );
    expect(minijobLine(m, [1400, 1600]).replace(/\u00a0/g, ' ')).toBe(
      'Minijob: 2:00 Std., Verdienst 30,00 € mit dem jeweils geltenden Stundenlohn (14,00 € / 16,00 €); Grenze 603,00 €, 5 %',
    );
  });
});
