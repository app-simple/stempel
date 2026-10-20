import { diffDays } from '@as/shared';
import type { CompensationDay } from './checks-types';
import {
  compensationAverage,
  compensationWindow,
  forfeitableHalfDays,
  forfeitureDates,
  noticeDeadline,
  noticeIsTimely,
  retentionCutoff,
} from './checks';

const day = (
  date: string,
  workMinutes: number,
  holiday = false,
  absent = false,
): CompensationDay => ({ date, workMinutes, holiday, absent });

describe('compensationWindow (§ 3 ArbZG, Entscheidung 7)', () => {
  it.each([
    ['2026-10-13', '2026-04-28', '2026-10-12'],
    ['2026-01-01', '2025-07-17', '2025-12-31'],
    ['2028-03-01', '2027-09-15', '2028-02-29'],
  ])('returns 168 inclusive calendar days before %s', (today, from, to) => {
    const result = compensationWindow(today);
    expect(result).toEqual({ from, to });
    expect(diffDays(result.from, result.to)).toBe(167);
  });
});

describe('compensationAverage (§ 3 ArbZG)', () => {
  it.each([
    [480, false],
    [481, true],
  ])('compares %i minutes with the eight-hour limit', (workMinutes, exceeds) => {
    expect(compensationAverage([day('2026-10-12', workMinutes)])).toEqual({
      workdays: 1,
      totalMinutes: workMinutes,
      averageMinutes: workMinutes,
      exceeds,
    });
  });

  it('balances 600 and 360 minutes to exactly eight hours', () => {
    expect(compensationAverage([day('2026-10-12', 600), day('2026-10-13', 360)])).toEqual({
      workdays: 2,
      totalMinutes: 960,
      averageMinutes: 480,
      exceeds: false,
    });
  });

  it('excludes Sunday work from both the sum and the day count', () => {
    expect(compensationAverage([day('2026-10-11', 600), day('2026-10-12', 480)])).toEqual({
      workdays: 1,
      totalMinutes: 480,
      averageMinutes: 480,
      exceeds: false,
    });
  });

  it('excludes holidays and absences from both the sum and the day count', () => {
    expect(
      compensationAverage([
        day('2026-10-12', 600, true),
        day('2026-10-13', 600, false, true),
        day('2026-10-14', 600, true, true),
        day('2026-10-15', 480),
      ]),
    ).toEqual({ workdays: 1, totalMinutes: 480, averageMinutes: 480, exceeds: false });
  });

  it('counts every weekday Monday through Saturday, including days without work', () => {
    expect(
      compensationAverage([
        day('2026-10-12', 600),
        day('2026-10-13', 600),
        day('2026-10-14', 600),
        day('2026-10-15', 600),
        day('2026-10-16', 0),
        day('2026-10-17', 480),
      ]),
    ).toEqual({ workdays: 6, totalMinutes: 2880, averageMinutes: 480, exceeds: false });
  });

  it.each([
    { name: 'empty input', days: [] },
    {
      name: 'only excluded days',
      days: [
        day('2026-10-11', 600),
        day('2026-10-12', 600, true),
        day('2026-10-13', 600, false, true),
      ],
    },
  ])('returns null and no warning for $name', ({ days }) => {
    expect(compensationAverage(days)).toEqual({
      workdays: 0,
      totalMinutes: 0,
      averageMinutes: null,
      exceeds: false,
    });
  });

  it('rounds 480.5 minutes up to 481', () => {
    expect(compensationAverage([day('2026-10-12', 480), day('2026-10-13', 481)])).toEqual({
      workdays: 2,
      totalMinutes: 961,
      averageMinutes: 481,
      exceeds: true,
    });
  });

  it('warns above eight hours even when the displayed average rounds down to 480', () => {
    expect(
      compensationAverage([day('2026-10-12', 480), day('2026-10-13', 480), day('2026-10-14', 481)]),
    ).toEqual({ workdays: 3, totalMinutes: 1441, averageMinutes: 480, exceeds: true });
  });
});

describe('forfeitureDates (§ 7 Abs. 3 BUrlG)', () => {
  it.each([
    [2026, '2026-12-31', '2027-03-31'],
    [2027, '2027-12-31', '2028-03-31'],
  ])('returns the forfeiture dates for %i', (year, rest, carried) => {
    expect(forfeitureDates(year)).toEqual({ rest, carried });
  });
});

describe('noticeDeadline (Entscheidung 3a, BAG 9 AZR 423/16)', () => {
  it.each([
    ['2026-12-31', '2026-09-30'],
    ['2027-03-31', '2026-12-31'],
    ['2026-05-31', '2026-02-28'],
    ['2028-05-31', '2028-02-29'],
    ['2026-01-15', '2025-10-15'],
    ['2026-05-28', '2026-02-28'],
    ['2028-05-29', '2028-02-29'],
    ['2026-07-31', '2026-04-30'],
    ['2100-05-31', '2100-02-28'],
    ['2000-05-31', '2000-02-29'],
  ])('subtracts three calendar months from %s, clamping to %s', (forfeitsOn, expected) => {
    expect(noticeDeadline(forfeitsOn)).toBe(expected);
  });
});

describe('noticeIsTimely (Entscheidung 3a, BAG 9 AZR 423/16)', () => {
  it.each([
    ['2026-09-29', '2026-12-31', true],
    ['2026-09-30', '2026-12-31', true],
    ['2026-10-01', '2026-12-31', false],
    ['2026-12-31', '2027-03-31', true],
    ['2027-01-01', '2027-03-31', false],
    ['2026-02-28', '2026-05-31', true],
    ['2026-03-01', '2026-05-31', false],
    ['2028-02-29', '2028-05-31', true],
    ['2028-03-01', '2028-05-31', false],
  ])('checks sending on %s for forfeiture on %s', (sentOn, forfeitsOn, expected) => {
    expect(noticeIsTimely(sentOn, forfeitsOn)).toBe(expected);
  });
});

describe('forfeitableHalfDays (§ 7 Abs. 3 BUrlG, Entscheidungen 3 und 3a)', () => {
  it.each([
    [4, 6, 0, 0, 6],
    [6, 6, 0, 0, 6],
    [10, 6, 0, 4, 6],
    [10, 6, 3, 4, 3],
    [10, 6, 6, 4, 0],
    [10, 6, 8, 4, 0],
    [7, 0, 0, 7, 0],
    [0, 0, 0, 0, 0],
    [-4, 6, 2, 0, 4],
    [10, -6, 2, 10, 0],
    [10, 6, -2, 4, 6],
    [-4, -6, -2, 0, 0],
  ])(
    'handles rest %i, carried %i and taken %i half days',
    (restAtYearEnd, carriedOver, takenByMarch31, atYearEnd, atMarch31) => {
      expect(forfeitableHalfDays({ restAtYearEnd, carriedOver, takenByMarch31 })).toEqual({
        atYearEnd,
        atMarch31,
      });
    },
  );
});

describe('retentionCutoff (§ 16 Abs. 2 ArbZG, § 17 Abs. 1 MiLoG, Entscheidung 6)', () => {
  it.each([
    ['2026-10-13', 2, '2024-01-01'],
    ['2026-10-13', 8, '2018-01-01'],
    ['2026-01-01', 2, '2024-01-01'],
    ['2026-12-31', 2, '2024-01-01'],
    ['2027-01-01', 2, '2025-01-01'],
    ['2028-02-29', 3, '2025-01-01'],
  ])('uses the calendar year of %s with a retention of %i years', (today, years, expected) => {
    expect(retentionCutoff(today, years)).toBe(expected);
  });

  it.each([-1, 0, 1, 2.5, NaN, Infinity, -Infinity])('rejects %s years', (years) => {
    expect(() => retentionCutoff('2026-10-13', years)).toThrow(RangeError);
  });
});
