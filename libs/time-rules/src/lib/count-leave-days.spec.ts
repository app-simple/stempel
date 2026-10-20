import { countLeaveDays } from './count-leave-days';
import { bavarianHolidays } from './holidays';

describe('countLeaveDays (§ 3 BUrlG)', () => {
  const weekdays = [1, 2, 3, 4, 5] as const;
  const holidays = new Set(['2026-01-01', '2026-01-06', '2026-08-15']);

  it.each([
    ['2026-01-05', 1],
    ['2026-01-04', 0],
    ['2026-01-06', 0],
  ])('counts the single day %s as %i', (date, expected) => {
    expect(countLeaveDays(date, date, weekdays, holidays)).toBe(expected);
  });

  it('subtracts a holiday on a workday', () => {
    expect(countLeaveDays('2026-01-05', '2026-01-11', weekdays, holidays)).toBe(4);
  });

  it('does not subtract a holiday on a free day', () => {
    expect(countLeaveDays('2026-08-10', '2026-08-16', weekdays, holidays)).toBe(5);
  });

  it('counts only Monday to Wednesday for part-time employment', () => {
    expect(countLeaveDays('2026-01-05', '2026-01-11', [1, 2, 3], holidays)).toBe(2);
    expect(countLeaveDays('2026-08-10', '2026-08-16', [1, 2, 3], holidays)).toBe(3);
  });

  it('counts across the year boundary using holidays from both years', () => {
    const yearEndHolidays = new Set(['2026-12-25', '2026-12-26', '2027-01-01']);
    expect(countLeaveDays('2026-12-24', '2027-01-04', weekdays, yearEndHolidays)).toBe(6);
  });

  it('counts eight days for Jonas from December 21 through 31, 2026', () => {
    // Nine weekdays minus Christmas Day; 24.12. and 31.12. are no statutory holidays.
    const holidays2026 = new Set(
      bavarianHolidays(2026, { assumptionDay: true }).map(({ date }) => date),
    );
    expect(countLeaveDays('2026-12-21', '2026-12-31', weekdays, holidays2026)).toBe(8);
  });

  it('returns zero for a reversed range or no workdays', () => {
    expect(countLeaveDays('2026-01-07', '2026-01-05', weekdays, holidays)).toBe(0);
    expect(countLeaveDays('2026-01-05', '2026-01-11', [], holidays)).toBe(0);
  });

  it('counts duplicate workdays only once and supports Saturday', () => {
    expect(countLeaveDays('2026-01-05', '2026-01-11', [1, 1, 6], holidays)).toBe(2);
  });

  it.each([
    ['2026-03-27', '2026-03-30'],
    ['2026-10-23', '2026-10-26'],
  ])('counts calendar days across the clock change from %s to %s', (from, to) => {
    expect(countLeaveDays(from, to, weekdays, new Set())).toBe(2);
  });

  it('includes February 29 in a leap year', () => {
    expect(countLeaveDays('2024-02-28', '2024-03-01', weekdays, new Set())).toBe(3);
  });
});
