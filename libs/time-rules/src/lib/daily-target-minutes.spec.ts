import { dailyTargetMinutes } from './daily-target-minutes';

describe('dailyTargetMinutes (§ 3 ArbZG)', () => {
  it.each([
    { type: 'FULL_TIME', weeklyMinutes: 2400, workDays: [1, 2, 3, 4, 5], expected: 480 },
    { type: 'FULL_TIME', weeklyMinutes: 2310, workDays: [1, 2, 3, 4, 5], expected: 462 },
    { type: 'PART_TIME', weeklyMinutes: 1000, workDays: [1, 2, 3], expected: 333 },
    { type: 'PART_TIME', weeklyMinutes: 1001, workDays: [1, 2, 3], expected: 334 },
    { type: 'PART_TIME', weeklyMinutes: 601, workDays: [1, 2], expected: 301 },
    { type: 'PART_TIME', weeklyMinutes: 960, workDays: [3, 1, 3], expected: 480 },
    { type: 'FULL_TIME', weeklyMinutes: 2400, workDays: [], expected: null },
    { type: 'PART_TIME', weeklyMinutes: 600, workDays: [], expected: null },
    { type: 'MINIJOB', weeklyMinutes: 480, workDays: [2, 4], expected: null },
    { type: 'MINIJOB', weeklyMinutes: 480, workDays: [], expected: null },
  ] as const)(
    'returns $expected for $type with $weeklyMinutes minutes on $workDays',
    (testCase) => {
      expect(dailyTargetMinutes(Object.freeze(testCase))).toBe(testCase.expected);
    },
  );
});
