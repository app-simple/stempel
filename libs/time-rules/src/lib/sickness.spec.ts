import type { LocalDate } from '@as/shared';
import { eachDay } from '@as/shared';
import type { CertificateDueInput, VacationCreditInput } from './sickness';
import { certificateDue, sixWeeksReachedOn, vacationCreditHalfDays } from './sickness';

describe('certificateDue (§ 5 Abs. 1 EFZG, § 45 Abs. 1 SGB V)', () => {
  const base: CertificateDueInput = {
    kind: 'SICK',
    from: '2026-10-05',
    to: '2026-10-08',
    fromDay1: false,
    workDays: [1, 2, 3, 4, 5],
    holidays: new Set<LocalDate>(),
  };

  it('verlangt für drei Kalendertage keine AU', () => {
    expect(certificateDue({ ...base, to: '2026-10-07' })).toBeNull();
  });

  it('verlangt ab vier Kalendertagen die AU am vierten Tag', () => {
    expect(certificateDue(base)).toBe('2026-10-08');
  });

  it.each([
    { from: '2026-10-07', to: '2026-10-10' },
    { from: '2026-10-08', to: '2026-10-11' },
  ])('verschiebt den vierten Tag am Wochenende auf Montag, auch nach $to', ({ from, to }) => {
    expect(certificateDue({ ...base, from, to })).toBe('2026-10-12');
  });

  it('überspringt einen Feiertag am vierten Kalendertag', () => {
    expect(certificateDue({ ...base, holidays: new Set(['2026-10-08']) })).toBe('2026-10-09');
  });

  it.each(['SICK', 'CHILD_SICK'] as const)(
    'verlangt bei %s mit fromDay1 auch eintägig eine AU',
    (kind) => {
      expect(certificateDue({ ...base, kind, to: base.from, fromDay1: true })).toBe(base.from);
    },
  );

  it('verschiebt fromDay1 bei Beginn am Sonntag auf Montag', () => {
    expect(certificateDue({ ...base, from: '2026-10-04', to: '2026-10-04', fromDay1: true })).toBe(
      '2026-10-05',
    );
  });

  it('verlangt bei CHILD_SICK ohne fromDay1 auch eintägig eine AU', () => {
    expect(certificateDue({ ...base, kind: 'CHILD_SICK', to: base.from })).toBe(base.from);
  });

  it('überspringt auch bei CHILD_SICK Wochenende und Feiertag', () => {
    expect(
      certificateDue({
        ...base,
        kind: 'CHILD_SICK',
        from: '2026-10-04',
        to: '2026-10-04',
        holidays: new Set(['2026-10-05']),
      }),
    ).toBe('2026-10-06');
  });

  it('berücksichtigt einen Teilzeitvertrag mit Dienstag und Donnerstag', () => {
    expect(
      certificateDue({ ...base, from: '2026-10-06', to: '2026-10-09', workDays: [2, 4] }),
    ).toBe('2026-10-13');
  });

  it.each([false, true])(
    'fällt bei leeren Arbeitstagen auf den Starttag zurück (fromDay1: %s)',
    (fromDay1) => {
      expect(certificateDue({ ...base, fromDay1, workDays: [] })).toBe(
        fromDay1 ? '2026-10-05' : '2026-10-08',
      );
    },
  );

  it('findet den Arbeitstag noch am 14. Tag des Suchfensters', () => {
    expect(
      certificateDue({ ...base, holidays: new Set(eachDay('2026-10-08', '2026-10-20')) }),
    ).toBe('2026-10-21');
  });

  it('fällt bei 14 blockierten Tagen auf den Starttag zurück', () => {
    expect(
      certificateDue({ ...base, holidays: new Set(eachDay('2026-10-08', '2026-10-21')) }),
    ).toBe('2026-10-08');
  });
});

describe('sixWeeksReachedOn (§ 3 Abs. 1 EFZG)', () => {
  it.each([
    {
      label: '41 Krankheitstage',
      from: '2026-01-01',
      to: '2026-02-10',
      asOf: '2026-02-10',
      expected: null,
    },
    {
      label: '42 Krankheitstage',
      from: '2026-01-01',
      to: '2026-02-11',
      asOf: '2026-02-11',
      expected: '2026-02-11',
    },
    {
      label: 'Stichtag am Tag 41',
      from: '2026-01-01',
      to: '2026-03-01',
      asOf: '2026-02-10',
      expected: null,
    },
    {
      label: 'Stichtag am Tag 42',
      from: '2026-01-01',
      to: '2026-03-01',
      asOf: '2026-02-11',
      expected: '2026-02-11',
    },
    {
      label: 'Ende vor Tag 42 trotz späterem Stichtag',
      from: '2026-01-01',
      to: '2026-02-10',
      asOf: '2026-03-01',
      expected: null,
    },
    {
      label: 'Jahreswechsel',
      from: '2025-12-01',
      to: '2026-01-31',
      asOf: '2026-01-31',
      expected: '2026-01-11',
    },
    {
      label: 'Schaltjahr',
      from: '2028-02-01',
      to: '2028-03-13',
      asOf: '2028-03-13',
      expected: '2028-03-13',
    },
  ])('$label', ({ from, to, asOf, expected }) => {
    expect(sixWeeksReachedOn(from, to, asOf)).toBe(expected);
  });
});

describe('vacationCreditHalfDays (§ 9 BUrlG)', () => {
  const vacation = { from: '2026-10-05', to: '2026-10-09', startHalf: false, endHalf: false };
  const base: VacationCreditInput = {
    sick: { from: '2026-10-05', to: '2026-10-09' },
    certificateUntil: '2026-10-09',
    vacations: [vacation],
    workDays: [1, 2, 3, 4, 5],
    holidays: new Set<LocalDate>(),
  };

  it('bucht ohne AU keine Tage zurück', () => {
    expect(vacationCreditHalfDays({ ...base, certificateUntil: null })).toEqual(new Map());
  });

  it('begrenzt die Rückbuchung auf die AU einschließlich ihres letzten Tages', () => {
    expect(vacationCreditHalfDays({ ...base, certificateUntil: '2026-10-07' })).toEqual(
      new Map([[2026, 6]]),
    );
  });

  it('bucht bei einer AU vor Krankheitsbeginn keine Tage zurück', () => {
    expect(vacationCreditHalfDays({ ...base, certificateUntil: '2026-10-04' })).toEqual(new Map());
  });

  it('begrenzt die Rückbuchung auf beide Krankheitsgrenzen', () => {
    expect(
      vacationCreditHalfDays({ ...base, sick: { from: '2026-10-06', to: '2026-10-08' } }),
    ).toEqual(new Map([[2026, 6]]));
  });

  it('begrenzt die Rückbuchung auf beide Urlaubsgrenzen', () => {
    expect(
      vacationCreditHalfDays({
        ...base,
        sick: { from: '2026-10-01', to: '2026-10-12' },
        certificateUntil: '2026-10-12',
      }),
    ).toEqual(new Map([[2026, 10]]));
  });

  it('zählt halbe Tage am Anfang und Ende des Urlaubs', () => {
    expect(
      vacationCreditHalfDays({
        ...base,
        vacations: [{ ...vacation, startHalf: true, endHalf: true }],
      }),
    ).toEqual(new Map([[2026, 8]]));
  });

  it.each([
    { startHalf: true, endHalf: false },
    { startHalf: false, endHalf: true },
    { startHalf: true, endHalf: true },
  ])('zählt eintägigen halben Urlaub genau einmal ($startHalf/$endHalf)', (halves) => {
    expect(
      vacationCreditHalfDays({
        ...base,
        vacations: [{ ...vacation, to: vacation.from, ...halves }],
      }),
    ).toEqual(new Map([[2026, 1]]));
  });

  it('überträgt halbe Urlaubsränder nicht auf den Krankheitsbeginn oder das AU-Ende', () => {
    expect(
      vacationCreditHalfDays({
        ...base,
        sick: { from: '2026-10-06', to: '2026-10-09' },
        certificateUntil: '2026-10-08',
        vacations: [{ ...vacation, startHalf: true, endHalf: true }],
      }),
    ).toEqual(new Map([[2026, 6]]));
  });

  it('nimmt Feiertage und vertragsfreie Tage aus', () => {
    expect(
      vacationCreditHalfDays({ ...base, workDays: [2, 4], holidays: new Set(['2026-10-08']) }),
    ).toEqual(new Map([[2026, 2]]));
  });

  it('summiert zwei Urlaube, ohne die Lücke dazwischen zu zählen', () => {
    expect(
      vacationCreditHalfDays({
        ...base,
        vacations: [
          { ...vacation, to: '2026-10-06' },
          { ...vacation, from: '2026-10-08' },
        ],
      }),
    ).toEqual(new Map([[2026, 8]]));
  });

  it('ordnet 30.12.–02.01. dem jeweiligen Kalenderjahr zu', () => {
    expect(
      vacationCreditHalfDays({
        ...base,
        sick: { from: '2025-12-30', to: '2026-01-02' },
        certificateUntil: '2026-01-02',
        vacations: [{ ...vacation, from: '2025-12-30', to: '2026-01-02' }],
        holidays: new Set(['2026-01-01']),
      }),
    ).toEqual(
      new Map([
        [2025, 4],
        [2026, 2],
      ]),
    );
  });

  it('liefert ohne Urlaubsüberschneidung keine Jahre', () => {
    expect(
      vacationCreditHalfDays({
        ...base,
        vacations: [{ ...vacation, from: '2026-10-12', to: '2026-10-16' }],
      }),
    ).toEqual(new Map());
    expect(vacationCreditHalfDays({ ...base, vacations: [] })).toEqual(new Map());
  });

  it('liefert ohne anrechenbare Arbeitstage keine Jahre', () => {
    expect(vacationCreditHalfDays({ ...base, workDays: [] })).toEqual(new Map());
    expect(
      vacationCreditHalfDays({ ...base, holidays: new Set(eachDay('2026-10-05', '2026-10-09')) }),
    ).toEqual(new Map());
  });
});

describe('certificateDue mit Vertragswechsel (Codex-Review Phase 6, Befund 6)', () => {
  it('nimmt für den Fälligkeitstag den dann gültigen Vertrag', () => {
    // Beginn Fr 16.10.; ab Mo 19.10. nur Di und Do Arbeitstage: fällig Di 20.10. statt Mo 19.10.
    expect(
      certificateDue({
        kind: 'SICK',
        from: '2026-10-16',
        to: '2026-10-21',
        fromDay1: false,
        workDays: (date) => (date < '2026-10-19' ? [1, 2, 3, 4, 5] : [2, 4]),
        holidays: new Set(),
      }),
    ).toBe('2026-10-20');
  });
});
