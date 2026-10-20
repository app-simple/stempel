import type { IsoWeekday, LocalDate } from '@as/shared';
import {
  annualEntitlement,
  businessDaysBetween,
  leaveAccount,
  leaveHalfDays,
  leaveHalfDaysByYear,
} from './leave';
import type { DatedLeaveTerms, LeaveSpan, WorkDaysAt } from './leave-types';

const weekdays = [1, 2, 3, 4, 5] as const;
const noHolidays = new Set<LocalDate>();
const workDaysAt: WorkDaysAt = () => weekdays;
const span = (from: LocalDate, to = from, startHalf = false, endHalf = false): LeaveSpan => ({
  from,
  to,
  startHalf,
  endHalf,
});
const terms = (
  validFrom = '2020-01-01',
  annualLeaveDays = 30,
  workDays: readonly IsoWeekday[] = weekdays,
  extraLeaveDays = 0,
): DatedLeaveTerms => ({ validFrom, terms: { annualLeaveDays, workDays, extraLeaveDays } });

describe('leaveHalfDays (§ 3 BUrlG, Konzept 4.2)', () => {
  it.each([
    ['2026-01-05', '2026-01-09', false, false, 10],
    ['2026-01-05', '2026-01-05', false, false, 2],
    ['2026-01-05', '2026-01-05', true, false, 1],
    ['2026-01-05', '2026-01-05', false, true, 1],
    ['2026-01-05', '2026-01-05', true, true, 1],
    ['2026-01-05', '2026-01-09', true, true, 8],
    ['2026-01-10', '2026-01-10', true, false, 0],
    ['2026-01-10', '2026-01-12', true, false, 2],
    ['2026-01-09', '2026-01-11', false, true, 2],
    ['2026-01-09', '2026-01-05', false, false, 0],
    ['2028-02-28', '2028-03-01', false, false, 6],
    ['2026-03-27', '2026-03-30', false, false, 4],
  ])('counts %s–%s (startHalf=%s, endHalf=%s) as %i', (from, to, startHalf, endHalf, expected) => {
    expect(leaveHalfDays(span(from, to, startHalf, endHalf), workDaysAt, noHolidays)).toBe(
      expected,
    );
  });

  it('excludes holidays, including half-day boundaries', () => {
    const holidays = new Set(['2026-01-06']);
    expect(leaveHalfDays(span('2026-01-05', '2026-01-09'), workDaysAt, holidays)).toBe(8);
    expect(leaveHalfDays(span('2026-01-06', '2026-01-06', true), workDaysAt, holidays)).toBe(0);
    expect(leaveHalfDays(span('2026-01-06', '2026-01-06', false, true), workDaysAt, holidays)).toBe(
      0,
    );
  });

  it('uses the workdays effective on each date', () => {
    const changed: WorkDaysAt = (date) => (date < '2026-01-07' ? weekdays : [1, 2, 3]);
    expect(leaveHalfDays(span('2026-01-05', '2026-01-09'), changed, noHolidays)).toBe(6);
  });

  it('excludes dates without a contract or without workdays', () => {
    const startsWednesday: WorkDaysAt = (date) => (date < '2026-01-07' ? null : weekdays);
    expect(leaveHalfDays(span('2026-01-05', '2026-01-09', true), startsWednesday, noHolidays)).toBe(
      6,
    );
    expect(leaveHalfDays(span('2026-01-05'), () => null, noHolidays)).toBe(0);
    expect(leaveHalfDays(span('2026-01-05'), () => [], noHolidays)).toBe(0);
  });

  it('counts contractual weekend work and duplicate weekdays only once', () => {
    expect(leaveHalfDays(span('2026-01-10', '2026-01-11'), () => [6, 6, 7], noHolidays)).toBe(4);
  });
});

describe('leaveHalfDaysByYear (Konzept 4.4, Entscheidung 12.5)', () => {
  it('splits the requested year boundary in ascending order', () => {
    expect(
      leaveHalfDaysByYear(span('2026-12-28', '2027-01-05'), workDaysAt, new Set(['2027-01-01'])),
    ).toEqual([
      { year: 2026, halfDays: 8 },
      { year: 2027, halfDays: 4 },
    ]);
  });

  it('applies half days only to the original boundaries', () => {
    expect(
      leaveHalfDaysByYear(
        span('2026-12-28', '2027-01-05', true, true),
        workDaysAt,
        new Set(['2027-01-01']),
      ),
    ).toEqual([
      { year: 2026, halfDays: 7 },
      { year: 2027, halfDays: 3 },
    ]);
  });

  it('uses changing contracts and omits years without counted days', () => {
    const changed: WorkDaysAt = (date) => {
      if (date < '2026-01-01') return null;
      return date < '2027-01-01' ? weekdays : [1];
    };
    expect(leaveHalfDaysByYear(span('2025-12-31', '2027-01-05'), changed, noHolidays)).toEqual([
      { year: 2026, halfDays: 522 },
      { year: 2027, halfDays: 2 },
    ]);
    expect(
      leaveHalfDaysByYear(span('2026-12-31', '2027-01-03'), workDaysAt, new Set(['2027-01-01'])),
    ).toEqual([{ year: 2026, halfDays: 2 }]);
  });

  it('returns no years for reversed or nonworking ranges', () => {
    expect(leaveHalfDaysByYear(span('2027-01-05', '2026-12-28'), workDaysAt, noHolidays)).toEqual(
      [],
    );
    expect(leaveHalfDaysByYear(span('2026-01-10', '2026-01-11'), workDaysAt, noHolidays)).toEqual(
      [],
    );
  });
});

describe('annualEntitlement (§§ 3, 4, 5 BUrlG, Entscheidung 12.3)', () => {
  it.each([
    ['2020-01-01', null, 60, 12, 'CONTRACT'],
    ['2026-01-01', null, 60, 12, 'CONTRACT'],
    ['2026-07-01', null, 40, 6, 'STATUTORY_MINIMUM'],
    // 30 × 5/12 = 12.5 days; § 5 Abs. 2 rounds to 13 days, hence 26 half days.
    ['2026-07-02', null, 26, 5, 'CONTRACT'],
    ['2026-03-15', null, 46, 9, 'CONTRACT'],
    ['2020-01-01', '2026-06-30', 30, 6, 'CONTRACT'],
    ['2020-01-01', '2026-07-01', 40, 6, 'STATUTORY_MINIMUM'],
    ['2020-01-01', '2026-12-31', 60, 12, 'CONTRACT'],
    ['2020-01-01', '2027-06-30', 60, 12, 'CONTRACT'],
    ['2027-01-01', null, 0, 0, 'CONTRACT'],
    ['2020-01-01', '2025-12-31', 0, 0, 'CONTRACT'],
    ['2026-12-31', null, 0, 0, 'CONTRACT'],
    ['2026-05-01', '2026-04-30', 0, 0, 'CONTRACT'],
  ])('handles entry %s and exit %s', (entry, exit, halfDays, fullMonths, basis) => {
    expect(annualEntitlement(2026, [terms()], entry, exit)).toEqual({
      halfDays,
      fullMonths,
      basis,
    });
  });

  it('grants the full statutory minimum after waiting time for entry on June 1', () => {
    expect(annualEntitlement(2026, [terms('2026-06-01', 20)], '2026-06-01', null)).toEqual({
      halfDays: 40,
      fullMonths: 7,
      basis: 'STATUTORY_MINIMUM',
    });
  });

  it.each([
    ['2026-07-14', 4, 5, 'CONTRACT'],
    ['2026-07-15', 8, 6, 'STATUTORY_MINIMUM'],
  ])(
    'tests the day before and on completion of waiting time: %s',
    (exit, halfDays, fullMonths, basis) => {
      expect(annualEntitlement(2026, [terms('2026-01-16', 4, [1])], '2026-01-16', exit)).toEqual({
        halfDays,
        fullMonths,
        basis,
      });
    },
  );

  it.each([
    [2026, '2026-01-31', '2026-02-26', 0, 0],
    [2026, '2026-01-31', '2026-02-27', 6, 1],
    [2028, '2028-01-31', '2028-02-27', 0, 0],
    [2028, '2028-01-31', '2028-02-28', 6, 1],
    [2026, '2026-01-31', '2026-03-29', 6, 1],
    [2026, '2026-01-31', '2026-03-30', 10, 2],
    [2026, '2026-03-15', '2026-04-13', 0, 0],
    [2026, '2026-03-15', '2026-04-14', 6, 1],
  ])(
    'clamps calendar months from %s / %s through %s',
    (year, entry, exit, halfDays, fullMonths) => {
      expect(annualEntitlement(year, [terms()], entry, exit)).toEqual({
        halfDays,
        fullMonths,
        basis: 'CONTRACT',
      });
    },
  );

  it.each([
    // 181 × 30 + 184 × 18 = 8742; 8742/365 = 23 + 347/365 → 24 days.
    [2026, '2026-07-01', 48],
    // 104 × 30 + 261 × 18 = 7818; 7818/365 = 21 + 153/365 → 21.5 days.
    [2026, '2026-04-15', 43],
    // 182 × 30 + 184 × 18 = 8772; 8772/366 = 23 + 354/366 → 24 days.
    [2028, '2028-07-01', 48],
    // 105 × 30 + 261 × 18 = 7848; 7848/366 = 21 + 162/366 → 21.5 days.
    [2028, '2028-04-15', 43],
  ])('weights every calendar day of %i with a change on %s', (year, changeDate, halfDays) => {
    expect(
      annualEntitlement(year, [terms(), terms(changeDate, 18, [1, 2, 3])], '2020-01-01', null),
    ).toEqual({
      halfDays,
      fullMonths: 12,
      basis: 'CONTRACT',
    });
  });

  it('weights statutory workdays too and counts duplicates only once', () => {
    // (181 × 20 + 184 × 12)/365 = 15 + 353/365 → 16 days.
    expect(
      annualEntitlement(
        2026,
        [terms('2020-01-01', 0, [1, 2, 3, 4, 5, 5]), terms('2026-07-01', 0, [1, 2, 3])],
        '2020-01-01',
        null,
      ),
    ).toEqual({
      halfDays: 32,
      fullMonths: 12,
      basis: 'STATUTORY_MINIMUM',
    });
  });

  it.each([
    // E = 100, fullMonths = 3. (80 × 30 + 20 × 26) × 3/(100 × 12) = 7.3.
    ['2026-03-22', 26, 15],
    // (96 × 30 + 4 × 29) × 3/(100 × 12) = 7.49.
    ['2026-04-07', 29, 15],
    // 30 × 3/12 = 7.5 → 8 days, not 7.5.
    ['2026-04-07', 30, 16],
  ])(
    'rounds fractions only at the end (%s, %i annual days)',
    (changeDate, annualDays, halfDays) => {
      expect(
        annualEntitlement(
          2026,
          [terms(), terms(changeDate, annualDays)],
          '2020-01-01',
          '2026-04-10',
        ),
      ).toEqual({
        halfDays,
        fullMonths: 3,
        basis: 'CONTRACT',
      });
    },
  );

  it('adds extra leave only to the contract value', () => {
    expect(
      annualEntitlement(2026, [terms('2020-01-01', 30, weekdays, 5)], '2020-01-01', null),
    ).toEqual({
      halfDays: 70,
      fullMonths: 12,
      basis: 'CONTRACT',
    });
    expect(
      annualEntitlement(2026, [terms('2020-01-01', 20, weekdays, 5)], '2026-07-01', null),
    ).toEqual({
      halfDays: 40,
      fullMonths: 6,
      basis: 'STATUTORY_MINIMUM',
    });
  });

  it('prefers CONTRACT on equality and determines the basis before rounding', () => {
    expect(annualEntitlement(2026, [terms('2020-01-01', 20)], '2020-01-01', null)).toEqual({
      halfDays: 40,
      fullMonths: 12,
      basis: 'CONTRACT',
    });
    // Contract 19 + 364/365 and statute 20 both round to 20, but the statute is strictly higher.
    expect(
      annualEntitlement(
        2026,
        [terms('2020-01-01', 19), terms('2026-01-02', 20)],
        '2020-01-01',
        null,
      ),
    ).toEqual({
      halfDays: 40,
      fullMonths: 12,
      basis: 'STATUTORY_MINIMUM',
    });
  });

  it('selects the latest applicable terms without mutating or relying on input order', () => {
    const unsorted = Object.freeze([
      terms('2026-07-01', 18, [1, 2, 3]),
      terms('2027-01-01', 100),
      terms(),
      terms('2019-01-01', 24),
    ]);
    expect(annualEntitlement(2026, unsorted, '2020-01-01', null)).toEqual({
      halfDays: 48,
      fullMonths: 12,
      basis: 'CONTRACT',
    });
  });

  it('counts uncovered days as zero while keeping them in the denominator', () => {
    // 184 × 30/365 = 15 + 45/365 → 15.5 days.
    expect(annualEntitlement(2026, [terms('2026-07-01')], '2020-01-01', null)).toEqual({
      halfDays: 31,
      fullMonths: 12,
      basis: 'CONTRACT',
    });
    expect(annualEntitlement(2026, [], '2020-01-01', null)).toEqual({
      halfDays: 0,
      fullMonths: 12,
      basis: 'CONTRACT',
    });
    expect(annualEntitlement(2026, [terms('2027-01-01')], '2020-01-01', null)).toEqual({
      halfDays: 0,
      fullMonths: 12,
      basis: 'CONTRACT',
    });
  });

  it('weights only the employment interval and ignores later contract changes', () => {
    expect(
      annualEntitlement(2026, [terms(), terms('2026-07-01', 100)], '2026-02-01', '2026-04-30'),
    ).toEqual({
      halfDays: 16,
      fullMonths: 3,
      basis: 'CONTRACT',
    });
  });
});

describe('leaveAccount (Konzept 4.4, Entscheidungen 12.5 und 12.10)', () => {
  it.each([
    [0, 50, 20, 70, 0],
    [0, 60, 20, 70, -10],
    [3, 20, 10, 73, 43],
    [-3, 20, 10, 67, 37],
  ])(
    'includes signed correction %i, approved %i and pending %i',
    (correctionHalfDays, approvedHalfDays, pendingHalfDays, totalHalfDays, restHalfDays) => {
      expect(
        leaveAccount({
          entitlementHalfDays: 60,
          carryOverHalfDays: 10,
          correctionHalfDays,
          approvedHalfDays,
          pendingHalfDays,
        }),
      ).toEqual({ totalHalfDays, restHalfDays });
    },
  );
});

describe('businessDaysBetween (Konzept 4.2, Entscheidung 12.12)', () => {
  it.each([
    ['2026-01-05', '2026-01-12', 5],
    ['2026-01-05', '2026-01-13', 6],
    ['2026-01-09', '2026-01-12', 1],
    ['2026-01-09', '2026-01-11', 0],
    ['2026-01-05', '2026-01-05', 0],
    ['2026-01-06', '2026-01-05', 0],
    ['2026-12-31', '2027-01-04', 2],
  ])('counts after %s through %s as %i', (from, to, expected) => {
    expect(businessDaysBetween(from, to, noHolidays)).toBe(expected);
  });

  it('excludes holidays without double-subtracting weekends or the start', () => {
    expect(
      businessDaysBetween(
        '2026-01-05',
        '2026-01-13',
        new Set(['2026-01-05', '2026-01-06', '2026-01-10']),
      ),
    ).toBe(5);
    expect(businessDaysBetween('2026-01-09', '2026-01-12', new Set(['2026-01-12']))).toBe(0);
  });
});

describe('annualEntitlement (§ 19 Abs. 2 JArbSchG)', () => {
  it.each([
    ['2010-01-02', 50], // 15 am 1.1.
    ['2010-01-01', 46], // 16 am 1.1.
    ['2009-01-02', 46],
    ['2009-01-01', 42], // 17 am 1.1.
    ['2008-01-02', 42], // 18. Geburtstag im Jahr ändert das Minimum nicht.
    ['2008-01-01', 40], // 18 am 1.1.
    [null, 40],
  ] as const)('uses age on January 1 for birth date %s', (birthDate, halfDays) => {
    expect(
      annualEntitlement(2026, [terms('2025-01-01', 0)], '2025-01-01', null, birthDate),
    ).toEqual({
      halfDays,
      fullMonths: 12,
      basis: 'STATUTORY_MINIMUM',
    });
  });
  it('keeps a higher contractual entitlement', () => {
    expect(annualEntitlement(2026, [terms()], '2025-01-01', null, '2010-01-02')).toEqual({
      halfDays: 60,
      fullMonths: 12,
      basis: 'CONTRACT',
    });
  });
  it('prorates the youth minimum for an exit in the first half of the year', () => {
    expect(
      annualEntitlement(2026, [terms('2025-01-01', 0)], '2025-01-01', '2026-06-30', '2010-01-02'),
    ).toEqual({
      halfDays: 26,
      fullMonths: 6,
      basis: 'STATUTORY_MINIMUM',
    });
  });
  it('weights youth minima when contractual workdays change', () => {
    // (181 × 25 + 184 × 15) / 365 = 19.9589... → 20 Tage.
    expect(
      annualEntitlement(
        2026,
        [terms('2025-01-01', 0), terms('2026-07-01', 0, [1, 2, 3])],
        '2025-01-01',
        null,
        '2010-01-02',
      ),
    ).toEqual({
      halfDays: 40,
      fullMonths: 12,
      basis: 'STATUTORY_MINIMUM',
    });
  });
});
