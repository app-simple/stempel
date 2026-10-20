import { addDays, berlinInstant } from '@as/shared';
import type { IsoWeekday } from '@as/shared';
import type { WorkEntry } from './work-time-types';
import {
  ageOn,
  evaluateYouthDay,
  isYouthOn,
  youthDayLimits,
  youthMinVacationDays,
  youthVacationError,
} from './youth';
import type { YouthDayInput } from './youth';

const day = '2026-01-05'; // Montag
const at = (time: string, date = day): Date => {
  const instant = berlinInstant(date, time);
  if (instant === null) throw new Error('Ungültige Testzeit');
  return instant;
};
const plus = (start: Date, minutes: number): Date => new Date(start.getTime() + minutes * 60_000);
const entry = (
  start = '08:00',
  end: string | null = '12:00',
  date = day,
  pauses: readonly (readonly [string, string | null])[] = [],
): WorkEntry => ({
  workDate: date,
  start: at(start, date),
  end: end === null ? null : at(end, date),
  breaks: pauses.map(([from, to]) => ({
    start: at(from, date),
    end: to === null ? null : at(to, date),
  })),
  source: 'CLOCK',
  recordedAt: at(start, date),
});
const duration = (minutes: number, date = day, pause = 0): WorkEntry => ({
  ...entry('06:00', null, date),
  end: plus(at('06:00', date), minutes + pause),
  breaks: pause === 0 ? [] : [{ start: at('08:00', date), end: plus(at('08:00', date), pause) }],
});
const evaluate = (entries: readonly WorkEntry[], overrides: Partial<YouthDayInput> = {}) =>
  evaluateYouthDay({
    workDate: entries[0]?.workDate ?? day,
    entries,
    weekEntries: [],
    previousDayLastEnd: null,
    holidays: new Set(),
    fullTimeSchool: false,
    schoolHolidays: [],
    yearWorkDays: 1,
    ...overrides,
  });
const message = (
  code: string,
  entries: readonly WorkEntry[],
  overrides: Partial<YouthDayInput> = {},
) => evaluate(entries, overrides).find((item) => item.code === code);

// Grenzfälle schützen die Altersberechnung vor einem Wechsel am falschen Kalendertag.
describe('ageOn / isYouthOn (§ 2 Abs. 2 JArbSchG)', () => {
  it.each([
    ['2008-01-06', '2026-01-05', 17, true],
    ['2008-01-06', '2026-01-06', 18, false],
    ['2011-01-06', '2026-01-05', 14, false],
    ['2011-01-06', '2026-01-06', 15, true],
    ['2008-02-29', '2026-02-28', 17, true],
    ['2008-02-29', '2026-03-01', 18, false],
    ['2008-02-29', '2024-02-28', 15, true],
    ['2008-02-29', '2024-02-29', 16, true],
    ['2008-12-31', '2026-01-01', 17, true],
  ])('%s on %s has age %i and youth status %s', (birth, date, age, youth) => {
    expect(ageOn(birth, date)).toBe(age);
    expect(isYouthOn(birth, date)).toBe(youth);
  });
  it('has no youth status without a birth date', () => {
    expect(isYouthOn(null, day)).toBe(false);
  });
});

describe('youthMinVacationDays (§ 19 Abs. 2 JArbSchG)', () => {
  it.each([
    [15, [15, 25, 30]],
    [16, [14, 23, 27]],
    [17, [13, 21, 25]],
    [18, [null, null, null]],
  ] as const)('converts and rounds for age %i', (age, expected) => {
    const days: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6];
    expect([3, 5, 6].map((count) => youthMinVacationDays(days.slice(0, count), age))).toEqual(
      expected,
    );
  });
  it('counts distinct workdays and supports empty schedules', () => {
    expect(youthMinVacationDays([1, 1, 2, 3], 16)).toBe(14);
    expect(youthMinVacationDays([], 15)).toBe(0);
    expect(youthMinVacationDays([1, 2, 3, 4], 17)).toBe(17);
  });
});

describe('evaluateYouthDay', () => {
  it('does not report rules on days without entries', () => {
    expect(
      evaluate([], { workDate: '2026-01-11', fullTimeSchool: true, yearWorkDays: 21 }),
    ).toEqual([]);
  });

  it.each([
    [480, false, undefined],
    [481, false, 'crit'],
    [481, true, 'warn'],
    [510, true, 'warn'],
    [511, true, 'crit'],
  ] as const)('checks %i daily minutes (shorter day %s)', (minutes, shorter, level) => {
    const result = message('YOUTH_DAY_8H', [duration(minutes)], {
      weekEntries: shorter ? [duration(450, addDays(day, 1))] : [],
    });
    expect(result?.level).toBe(level);
    if (result)
      expect(result.paragraph).toBe(
        level === 'warn' ? '§ 8 Abs. 2a JArbSchG' : '§ 8 Abs. 1 JArbSchG',
      );
  });

  it.each([
    [459, 'warn'],
    [460, 'crit'],
  ] as const)('uses the whole week for the 8.5-hour exception (%i)', (shortMinutes, level) => {
    const weekEntries = [1, 2, 3].map((offset) => duration(480, addDays(day, offset)));
    weekEntries.push(duration(shortMinutes, addDays(day, 4)));
    expect(message('YOUTH_DAY_8H', [duration(501)], { weekEntries })?.level).toBe(level);
  });

  it('requires a genuinely shorter worked day, not a shorter individual booking or an open entry', () => {
    for (const weekEntries of [
      [entry('08:00', '12:00', '2026-01-06'), entry('13:00', '17:00', '2026-01-06')],
      [entry('08:00', null, '2026-01-06')],
      [duration(0, '2026-01-06')],
    ])
      expect(message('YOUTH_DAY_8H', [duration(481)], { weekEntries })?.level).toBe('crit');
  });

  it.each([
    [480, false],
    [481, true],
  ] as const)(
    'reports the first crossing of 2400 weekly minutes (%i today)',
    (minutes, violation) => {
      const workDate = '2026-01-09';
      const weekEntries = [0, 1, 2, 3].map((offset) => duration(480, addDays(day, offset)));
      expect(
        Boolean(message('YOUTH_WEEK_40H', [duration(minutes, workDate)], { weekEntries })),
      ).toBe(violation);
    },
  );

  it('does not repeat a weekly violation after the day of crossing', () => {
    const weekEntries = [0, 1, 2, 3].map((offset) => duration(480, addDays(day, offset)));
    expect(
      message('YOUTH_WEEK_40H', [duration(60, '2026-01-10')], {
        weekEntries: [...weekEntries, duration(481, '2026-01-09')],
      }),
    ).toBeUndefined();
  });

  it('does not count future days in the cumulative weekly limit', () => {
    expect(
      message('YOUTH_WEEK_40H', [duration(480)], {
        weekEntries: [1, 2, 3, 4, 5].map((offset) => duration(480, addDays(day, offset))),
      }),
    ).toBeUndefined();
  });

  it('counts only supplied youth days when the 18th birthday falls within the week', () => {
    const allEntries = [0, 1, 2, 3, 4, 5].map((offset) => duration(481, addDays(day, offset)));
    const youthEntries = allEntries.filter((item) => isYouthOn('2008-01-08', item.workDate));
    expect(youthEntries).toHaveLength(3);
    const result = evaluate([youthEntries[2]!], { weekEntries: youthEntries.slice(0, 2) });
    expect(result.some((item) => ['YOUTH_WEEK_40H', 'YOUTH_SIX_DAYS'].includes(item.code))).toBe(
      false,
    );
  });

  it.each([
    [270, 0, false],
    [271, 29, true],
    [271, 30, false],
    [360, 30, false],
    [361, 59, true],
    [361, 60, false],
    [271, 14, true],
  ] as const)(
    'requires enough rest for %i minutes and %i minutes pause',
    (minutes, pause, violation) => {
      expect(Boolean(message('YOUTH_BREAK', [duration(minutes, day, pause)]))).toBe(violation);
    },
  );

  it.each([
    [270, false],
    [271, true],
  ] as const)('checks %i minutes uninterrupted work', (minutes, violation) => {
    expect(Boolean(message('YOUTH_NO_BREAK_45', [duration(minutes)]))).toBe(violation);
  });

  it('does not treat a 14-minute break as rest or subtract it from work', () => {
    const entries = [entry('08:00', '12:31', day, [['10:00', '10:14']])];
    expect(message('YOUTH_BREAK', entries)).toBeDefined();
    expect(message('YOUTH_NO_BREAK_45', entries)).toBeDefined();
  });

  it('counts 15-minute gaps and resumes the uninterrupted-work clock', () => {
    const entries = [entry('13:00', '14:01'), entry('08:00', '10:00'), entry('10:15', '12:45')];
    expect(message('YOUTH_BREAK', entries)).toBeUndefined();
    expect(message('YOUTH_NO_BREAK_45', entries)).toBeUndefined();
  });

  it('keeps the uninterrupted-work clock running across short booking gaps', () => {
    expect(
      message('YOUTH_NO_BREAK_45', [entry('08:00', '10:00'), entry('10:14', '12:31')]),
    ).toBeDefined();
  });

  it.each([
    ['08:59', '09:29', true],
    ['09:00', '09:30', false],
    ['10:30', '11:00', false],
    ['10:31', '11:01', true],
  ] as const)('checks break placement %s–%s', (from, to, violation) => {
    expect(
      Boolean(message('YOUTH_BREAK_TIMING', [entry('08:00', '12:00', day, [[from, to]])])),
    ).toBe(violation);
  });

  it.each([
    [600, false],
    [601, true],
  ] as const)('checks %i minutes shift including breaks', (minutes, violation) => {
    expect(Boolean(message('YOUTH_SHIFT_10H', [duration(minutes - 60, day, 60)]))).toBe(violation);
  });

  it.each([
    ['20:00', false],
    ['20:01', true],
  ] as const)('checks rest since %s the previous day', (time, violation) => {
    expect(
      Boolean(
        message('YOUTH_REST_12H', [entry('08:00', null)], {
          previousDayLastEnd: at(time, '2026-01-04'),
        }),
      ),
    ).toBe(violation);
  });

  describe.each(['2026-01-05', '2026-07-06', '2026-03-29', '2026-10-25'])(
    'Berlin night limits on %s',
    (date) => {
      it.each([
        ['05:59', null, true],
        ['06:00', null, false],
        ['19:00', '20:00', false],
        ['19:00', '20:01', true],
      ] as const)('checks %s–%s', (start, end, violation) => {
        expect(Boolean(message('YOUTH_NIGHT', [entry(start, end, date)]))).toBe(violation);
      });
      it('detects an end on the next day, including after a DST change', () => {
        expect(
          message('YOUTH_NIGHT', [
            { ...entry('19:00', null, date), end: at('01:00', addDays(date, 1)) },
          ])?.level,
        ).toBe('crit');
      });
    },
  );

  it.each(['2026-03-28', '2026-10-24'])(
    'detects overnight work across the time change after %s',
    (date) => {
      const overnight = { ...entry('19:00', null, date), end: at('06:00', addDays(date, 1)) };
      expect(message('YOUTH_NIGHT', [overnight])?.level).toBe('crit');
    },
  );

  it.each([
    ['2026-03-29', '17:00', false],
    ['2026-03-29', '17:01', true],
    ['2026-10-25', '19:00', false],
    ['2026-10-25', '19:01', true],
  ] as const)(
    'measures elapsed rest across the time change on %s since %s',
    (date, previousEnd, violation) => {
      expect(
        Boolean(
          message('YOUTH_REST_12H', [entry('06:00', null, date)], {
            previousDayLastEnd: at(previousEnd, addDays(date, -1)),
          }),
        ),
      ).toBe(violation);
    },
  );

  it.each([
    [4, false],
    [5, true],
    [6, true],
  ] as const)('checks %i distinct previous workdays', (count, violation) => {
    const date = addDays(day, count);
    const weekEntries = Array.from({ length: count }, (_, offset) =>
      entry('08:00', '09:00', addDays(day, offset)),
    );
    expect(Boolean(message('YOUTH_SIX_DAYS', [entry('08:00', null, date)], { weekEntries }))).toBe(
      violation,
    );
  });

  it('counts split days once and excludes future workdays from the six-day rule', () => {
    expect(
      message('YOUTH_SIX_DAYS', [entry()], {
        weekEntries: [1, 2, 3, 4, 5, 6].map((offset) => entry('08:00', null, addDays(day, offset))),
      }),
    ).toBeUndefined();
    const weekEntries = [0, 1, 2, 3].flatMap((offset) => [
      entry('08:00', '09:00', addDays(day, offset)),
      entry('10:00', '11:00', addDays(day, offset)),
    ]);
    expect(
      message('YOUTH_SIX_DAYS', [entry('08:00', '09:00', '2026-01-09')], { weekEntries }),
    ).toBeUndefined();
  });

  it.each([
    ['2026-01-10', 'YOUTH_SATURDAY'],
    ['2026-01-11', 'YOUTH_SUNDAY'],
  ] as const)('reports weekend work %s', (date, code) => {
    expect(message(code, [entry('08:00', null, date)])?.level).toBe('crit');
  });
  it('reports holiday work', () => {
    expect(message('YOUTH_HOLIDAY', [entry()], { holidays: new Set([day]) })?.level).toBe('crit');
  });
  describe.each(['2026-12-24', '2026-12-31'])('holiday afternoon %s', (date) => {
    it.each([
      ['13:00', '13:59', false],
      ['13:00', '14:00', false],
      ['13:00', '14:01', true],
      ['14:00', null, true],
    ] as const)('checks %s–%s', (start, end, violation) => {
      expect(Boolean(message('YOUTH_HOLIDAY', [entry(start, end, date)]))).toBe(violation);
    });
    it('reports the holiday only once even with multiple violations', () => {
      const messages = evaluate([entry('14:00', '15:00', date), entry('16:00', '17:00', date)], {
        holidays: new Set([date]),
      });
      expect(messages.filter((item) => item.code === 'YOUTH_HOLIDAY')).toHaveLength(1);
    });
  });

  it.each([
    ['2026-07-01', false],
    ['2026-07-31', false],
    ['2026-08-01', true],
  ] as const)('checks inclusive school holiday boundaries on %s', (date, violation) => {
    const result = message('YOUTH_SCHOOL_TERM', [entry('08:00', null, date)], {
      fullTimeSchool: true,
      schoolHolidays: [{ from: '2026-07-01', to: '2026-07-31' }],
    });
    expect(Boolean(result)).toBe(violation);
    if (result) expect(result.text).toBe('Beschäftigung nur in den Schulferien zulässig');
  });
  it.each([
    [15, undefined],
    [16, 'warn'],
    [20, 'warn'],
    [21, 'crit'],
  ] as const)('checks %i school workdays', (yearWorkDays, level) => {
    const result = message('YOUTH_SCHOOL_DAYS', [entry()], { fullTimeSchool: true, yearWorkDays });
    expect(result?.level).toBe(level);
    if (level === 'warn') expect(result?.text).toContain(`noch ${20 - yearWorkDays} Tage`);
  });
  it('does not apply school restrictions without full-time schooling', () => {
    expect(
      evaluate([entry()], { yearWorkDays: 21 }).some((item) =>
        item.code.startsWith('YOUTH_SCHOOL_'),
      ),
    ).toBe(false);
  });

  it('ignores ongoing bookings for duration and break rules', () => {
    expect(evaluate([entry('06:00', null, day, [['06:30', '07:00']])])).toEqual([]);
    expect(evaluate([entry('08:00', '12:00'), entry('12:15', null)])).toEqual([]);
  });

  it('returns each code once, with the prescribed paragraph and level', () => {
    const date = '2026-01-11';
    const entries = [
      entry('05:00', '21:00', date, [['05:30', '05:45']]),
      entry('21:15', '23:00', date),
    ];
    const result = evaluate(entries, {
      weekEntries: [0, 1, 2, 3, 4, 5].map((offset) => duration(390, addDays(day, offset))),
      previousDayLastEnd: at('23:00', '2026-01-10'),
      holidays: new Set([date]),
      fullTimeSchool: true,
      yearWorkDays: 21,
    });
    expect(result.map(({ code, level, paragraph }) => [code, level, paragraph])).toEqual(
      expect.arrayContaining([
        ['YOUTH_DAY_8H', 'crit', '§ 8 Abs. 1 JArbSchG'],
        ['YOUTH_WEEK_40H', 'crit', '§ 8 Abs. 1 JArbSchG'],
        ['YOUTH_BREAK', 'crit', '§ 11 Abs. 1 JArbSchG'],
        ['YOUTH_NO_BREAK_45', 'crit', '§ 11 Abs. 2 JArbSchG'],
        ['YOUTH_BREAK_TIMING', 'warn', '§ 11 Abs. 2 JArbSchG'],
        ['YOUTH_SHIFT_10H', 'crit', '§ 12 JArbSchG'],
        ['YOUTH_REST_12H', 'crit', '§ 13 JArbSchG'],
        ['YOUTH_NIGHT', 'crit', '§ 14 Abs. 1 JArbSchG'],
        ['YOUTH_SIX_DAYS', 'crit', '§ 15 JArbSchG'],
        ['YOUTH_SUNDAY', 'crit', '§ 17 Abs. 1 JArbSchG'],
        ['YOUTH_HOLIDAY', 'crit', '§ 18 Abs. 1 JArbSchG'],
        ['YOUTH_SCHOOL_TERM', 'crit', '§ 5 Abs. 1 und 4 JArbSchG, § 2 KindArbSchV'],
        ['YOUTH_SCHOOL_DAYS', 'crit', '§ 5 Abs. 4 JArbSchG'],
      ]),
    );
    expect(new Set(result.map(({ code }) => code)).size).toBe(result.length);
  });
});

// Review API Phase 7, Befunde 2 und 5.
describe('evaluateYouthDay review findings', () => {
  it('counts short gaps between entries as working time (§ 4 Abs. 1, § 11 JArbSchG)', () => {
    const split = [entry('08:00', '12:00'), entry('12:10', '17:10', day, [['14:00', '15:00']])];
    const single = [
      entry('08:00', '17:10', day, [
        ['12:00', '12:10'],
        ['14:00', '15:00'],
      ]),
    ];
    expect(message('YOUTH_DAY_8H', split)).toBeDefined();
    expect(message('YOUTH_DAY_8H', single)).toBeDefined();
  });
  it('counts short gaps of other week days towards 40 hours (§ 8 Abs. 1 JArbSchG)', () => {
    const monday = '2026-01-05';
    const week = ['2026-01-06', '2026-01-07', '2026-01-08'].flatMap((date) => [
      entry('08:00', '12:00', date),
      entry('12:10', '16:10', date),
    ]);
    // 3 × 490 + 470 = 1940 Min. bis Donnerstag; Freitag 8 Std. → 2420 > 2400.
    const friday = '2026-01-09';
    expect(
      message('YOUTH_WEEK_40H', [entry('08:00', '16:30', friday, [['12:00', '12:30']])], {
        weekEntries: [...week, entry('08:00', '12:00', monday), entry('12:30', '16:20', monday)],
      }),
    ).toBeDefined();
  });
  it.each([
    ['19:59', false],
    ['20:01', true],
    ['21:00', true],
  ] as const)('reports a running entry starting at %s as night work: %s', (start, violation) => {
    expect(Boolean(message('YOUTH_NIGHT', [entry(start, null)]))).toBe(violation);
  });
});

describe('youthDayLimits (§§ 8, 11, 12, 14, 18 JArbSchG)', () => {
  it.each(['2026-01-05', '2026-07-06'])('calculates limits for a running entry on %s', (date) => {
    expect(
      youthDayLimits({
        workDate: date,
        entries: [entry('08:00', null, date)],
        now: at('10:00', date),
      }),
    ).toEqual({ latestEnd: at('16:00', date), latestBreak: at('12:30', date) });
  });
  it('accounts for 60 minutes rest and keeps the 4.5-hour deadline after it', () => {
    expect(
      youthDayLimits({
        workDate: day,
        entries: [entry('08:00', null, day, [['10:00', '11:00']])],
        now: at('12:00'),
      }),
    ).toEqual({ latestEnd: at('17:00'), latestBreak: at('15:30') });
  });
  // Review API Phase 7, Befund 1: genommene Pausenzeit ersetzt nicht die Grenze am Stück (§ 11 Abs. 2).
  it('still requires a break 4.5 hours after an early full-hour break', () => {
    expect(
      youthDayLimits({
        workDate: day,
        entries: [entry('08:00', null, day, [['09:00', '10:00']])],
        now: at('11:00'),
      }).latestBreak,
    ).toEqual(at('14:30'));
  });
  it('drops the break deadline when the latest end comes first', () => {
    expect(
      youthDayLimits({
        workDate: day,
        entries: [entry('08:00', null, day, [['12:30', '13:30']])],
        now: at('14:00'),
      }),
    ).toEqual({ latestEnd: at('17:00'), latestBreak: null });
  });
  // Review API Phase 7, Befund 2: Lücken unter 15 Min. sind keine Ruhepause und zählen als Arbeitszeit.
  it('counts short gaps between entries as working time', () => {
    expect(
      youthDayLimits({
        workDate: day,
        entries: [entry('08:00', '10:00'), entry('10:10', null)],
        now: at('11:00'),
      }).latestEnd,
    ).toEqual(at('16:00'));
  });
  it.each([
    [14, '16:00', '12:30'],
    [15, '16:15', '14:45'],
  ] as const)(
    'counts an ongoing pause only after %i minutes',
    (minutes, latestEnd, latestBreak) => {
      expect(
        youthDayLimits({
          workDate: day,
          entries: [entry('08:00', null, day, [['10:00', null]])],
          now: plus(at('10:00'), minutes),
        }),
      ).toEqual({ latestEnd: at(latestEnd), latestBreak: at(latestBreak) });
    },
  );
  it('uses gaps between entries as rest without mutating unsorted inputs', () => {
    const entries = Object.freeze([
      Object.freeze(entry('12:15', null)),
      Object.freeze(entry('08:00', '12:00')),
    ]);
    expect(youthDayLimits({ workDate: day, entries, now: at('13:00') })).toEqual({
      latestEnd: at('16:15'),
      // Die nächste Pausenfrist (16:45) läge nach dem spätesten Feierabend.
      latestBreak: null,
    });
  });
  it('does not reset the break deadline at a short gap', () => {
    expect(
      youthDayLimits({
        workDate: day,
        entries: [entry('08:00', '10:00'), entry('10:14', null)],
        now: at('11:00'),
      }).latestBreak,
    ).toEqual(at('12:30'));
  });
  it('caps long split shifts at ten elapsed hours', () => {
    expect(
      youthDayLimits({
        workDate: day,
        entries: [entry('06:00', '08:00'), entry('12:00', null)],
        now: at('13:00'),
      }),
    ).toEqual({ latestEnd: at('16:00'), latestBreak: null });
  });
  it.each(['2026-12-24', '2026-12-31'])('caps holiday work at 14:00 on %s', (date) => {
    expect(
      youthDayLimits({
        workDate: date,
        entries: [entry('08:00', null, date)],
        now: at('09:00', date),
      }).latestEnd,
    ).toEqual(at('14:00', date));
  });
  it('caps late starts at 20:00', () => {
    expect(
      youthDayLimits({ workDate: day, entries: [entry('13:00', null)], now: at('14:00') })
        .latestEnd,
    ).toEqual(at('20:00'));
  });
  it('preserves an already exceeded deadline', () => {
    expect(
      youthDayLimits({ workDate: day, entries: [entry('08:00', null)], now: at('17:00') })
        .latestEnd,
    ).toEqual(at('16:00'));
  });
});

describe('youthVacationError (§ 19 Abs. 2 JArbSchG)', () => {
  const terms = (annualLeaveDays: number, validFrom = '2027-03-01') => ({
    validFrom,
    workDays: [1, 2, 3, 4, 5] as IsoWeekday[],
    annualLeaveDays,
  });

  it('prüft nach dem Alter am 1.1. des Jahres, in dem der Stand beginnt', () => {
    // Am 01.01.2027 ist die Person 16: 27 Werktage → 23 Arbeitstage.
    expect(youthVacationError(terms(22), '2010-03-01')).toEqual({
      code: 'YOUTH_MIN_VACATION',
      text: 'Jahresurlaub unter dem Mindesturlaub für Jugendliche: mindestens 23 Tage (§ 19 Abs. 2 JArbSchG).',
    });
    expect(youthVacationError(terms(23), '2010-03-01')).toBeNull();
  });

  it('greift nicht ohne Geburtsdatum oder ab 18 am 1.1.', () => {
    expect(youthVacationError(terms(20), null)).toBeNull();
    expect(youthVacationError(terms(20), '2009-01-01')).toBeNull();
    expect(youthVacationError(terms(20), '2009-01-02')).not.toBeNull();
  });
});
