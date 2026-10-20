import { minVacationDays } from './min-vacation-days';

describe('minVacationDays (§ 3 BUrlG)', () => {
  it.each([
    { workDays: [], expected: 0 },
    { workDays: [1], expected: 4 },
    { workDays: [1, 2, 3], expected: 12 },
    { workDays: [1, 2, 3, 4, 5], expected: 20 },
    { workDays: [1, 2, 3, 4, 5, 6], expected: 24 },
    { workDays: [3, 1, 3, 1], expected: 8 },
  ] as const)('returns $expected days for $workDays', ({ workDays, expected }) => {
    expect(minVacationDays(Object.freeze(workDays))).toBe(expected);
  });
});

describe('minVacationDays (§ 19 Abs. 2 JArbSchG)', () => {
  it.each([
    [15, 25],
    [16, 23],
    [17, 21],
    [18, 20],
    [null, 20],
  ] as const)('uses the higher minimum for age %s', (age, expected) => {
    expect(minVacationDays([1, 2, 3, 4, 5], age)).toBe(expected);
  });
  it('converts distinct workdays and preserves the BUrlG floor', () => {
    expect(minVacationDays([1, 2, 3, 3], 16)).toBe(14);
    expect(minVacationDays([], 15)).toBe(0);
    expect(minVacationDays([1, 2, 3, 4, 5, 6, 7], 18)).toBe(28);
  });
});
