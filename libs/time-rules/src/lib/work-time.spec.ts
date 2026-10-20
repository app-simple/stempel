import type { LocalDate } from '@as/shared';
import type { EmploymentTermsInput } from './types';
import type { TimeSpan, WorkDayInput, WorkEntry } from './work-time-types';
import {
  minijobMonthFromParts,
  evaluateWorkDay,
  lateInfo,
  minijobMonth,
  restBreaks,
  targetMinutesForDay,
  workMinutes,
} from './work-time';

const workDate = '2026-10-01';
const base = Date.parse('2026-10-01T08:00:00+02:00');
const at = (minutes: number): Date => new Date(base + minutes * 60_000);
const span = (start: number, end: number | null): TimeSpan => ({
  start: at(start),
  end: end === null ? null : at(end),
});
const entry = (
  start = 0,
  end: number | null = 60,
  breaks: readonly TimeSpan[] = [],
): WorkEntry => ({
  ...span(start, end),
  workDate,
  breaks,
  source: 'CLOCK',
  recordedAt: at(start),
});
const day = (
  entries: readonly WorkEntry[],
  overrides: Partial<WorkDayInput> = {},
): WorkDayInput => ({
  workDate,
  entries,
  previousDayLastEnd: null,
  holidays: new Set<LocalDate>(),
  isMinijob: false,
  ...overrides,
});
const over8 = {
  code: 'OVER_8H',
  level: 'info',
  text: 'Über 8 Std., Ausgleich nötig',
  paragraph: '§ 3 ArbZG',
};
const over10 = {
  code: 'MAX_10H',
  level: 'crit',
  text: 'Über 10 Std. Arbeitszeit',
  paragraph: '§ 3 ArbZG',
};
const noBreak = {
  code: 'NO_BREAK_6H',
  level: 'crit',
  text: 'Mehr als 6 Std. ohne Pause',
  paragraph: '§ 4 ArbZG',
};
const missing30 = {
  code: 'BREAK_TOO_SHORT',
  level: 'crit',
  text: 'Pause 0 statt 30 Min.',
  paragraph: '§ 4 ArbZG',
};

describe('restBreaks (§ 4 ArbZG)', () => {
  it('clips before applying the minimum, sorts and leaves input unchanged', () => {
    const breaks = Object.freeze([
      Object.freeze(span(110, 140)),
      Object.freeze(span(70, 85)),
      Object.freeze(span(-10, 15)),
      Object.freeze(span(30, 44)),
      Object.freeze(span(90, null)),
      Object.freeze(span(-30, -10)),
      Object.freeze(span(130, 150)),
      Object.freeze(span(105, 125)),
    ]);
    const input = Object.freeze(entry(0, 120, breaks));
    const before = structuredClone(input);
    expect(restBreaks(input)).toEqual([span(0, 15), span(70, 85), span(105, 120)]);
    expect(input).toEqual(before);
  });

  it('accepts completed breaks in an open entry but excludes ongoing breaks', () => {
    expect(restBreaks(entry(0, null, [span(30, null), span(10, 25)]))).toEqual([span(10, 25)]);
  });

  it('requires 15 whole minutes after clipping', () => {
    expect(restBreaks(entry(0, 60, [span(-1, 14 + 59 / 60)]))).toEqual([]);
  });
});

describe('workMinutes (§ 2 Abs. 1 und § 4 ArbZG)', () => {
  it.each([
    { pause: 14, expected: 120 },
    { pause: 15, expected: 105 },
  ])('counts a $pause minute break correctly', ({ pause, expected }) => {
    expect(workMinutes(entry(0, 120, [span(30, 30 + pause)]))).toBe(expected);
  });

  it('returns zero for an open entry without asOf', () => {
    expect(workMinutes(entry(0, null))).toBe(0);
  });

  it('uses asOf for an open entry and clips completed breaks to it', () => {
    expect(workMinutes(entry(0, null, [span(45, 90)]), at(60))).toBe(45);
  });

  it.each([
    { elapsed: 14, expected: 74 },
    { elapsed: 15, expected: 60 },
  ])('counts an ongoing break after $elapsed minutes', ({ elapsed, expected }) => {
    expect(workMinutes(entry(0, null, [span(60, null)]), at(60 + elapsed))).toBe(expected);
  });

  it('keeps the recorded end when asOf is later and clips an ongoing break', () => {
    expect(workMinutes(entry(0, 120, [span(100, null)]), at(150))).toBe(100);
    expect(workMinutes(entry(0, 120), at(150))).toBe(120);
  });

  it('ignores an ongoing break without asOf', () => {
    expect(workMinutes(entry(0, 120, [span(60, null)]))).toBe(120);
  });

  it('subtracts only the qualifying parts of breaks inside the entry', () => {
    expect(workMinutes(entry(0, 120, [span(-10, 15), span(105, 135)]))).toBe(90);
    expect(workMinutes(entry(0, 120, [span(-10, 14), span(106, 135)]))).toBe(120);
  });

  it('floors each duration to whole minutes', () => {
    expect(workMinutes(entry(0, 120 + 59 / 60, [span(30, 45 + 59 / 60)]))).toBe(105);
  });

  it('never returns negative minutes', () => {
    expect(workMinutes(entry(0, null), at(-1))).toBe(0);
    expect(workMinutes(entry(0, 60, [span(-30, 90)]))).toBe(0);
  });

  it('handles an entry and break across midnight', () => {
    expect(
      workMinutes({
        start: new Date('2026-10-01T22:00:00+02:00'),
        end: new Date('2026-10-02T02:00:00+02:00'),
        breaks: [
          {
            start: new Date('2026-10-01T23:50:00+02:00'),
            end: new Date('2026-10-02T00:10:00+02:00'),
          },
        ],
      }),
    ).toBe(220);
  });

  it.each([
    { start: '2026-10-25T00:00:00+02:00', end: '2026-10-25T04:00:00+01:00', expected: 300 },
    { start: '2026-03-29T00:00:00+01:00', end: '2026-03-29T04:00:00+02:00', expected: 180 },
  ])('uses elapsed UTC time from $start to $end', ({ start, end, expected }) => {
    expect(workMinutes({ start: new Date(start), end: new Date(end), breaks: [] })).toBe(expected);
  });
});

describe('evaluateWorkDay (§ 3 ArbZG)', () => {
  it.each([
    { minutes: 480, expected: [] },
    { minutes: 481, expected: [over8] },
    { minutes: 600, expected: [over8] },
    { minutes: 601, expected: [over10] },
  ])('checks $minutes minutes in one entry or split across entries', ({ minutes, expected }) => {
    expect(evaluateWorkDay(day([entry(0, minutes + 45, [span(300, 345)])]))).toEqual(expected);
    expect(evaluateWorkDay(day([entry(345, minutes + 45), entry(0, 300)]))).toEqual(expected);
  });

  it('excludes ongoing entries from working time and break checks', () => {
    expect(evaluateWorkDay(day([entry(0, null)]))).toEqual([]);
    expect(evaluateWorkDay(day([entry(0, 360), entry(400, null)]))).toEqual([]);
  });

  it('returns no messages without entries, even on a holiday', () => {
    expect(
      evaluateWorkDay(
        day([], {
          workDate: '2026-10-04',
          holidays: new Set(['2026-10-04']),
          previousDayLastEnd: at(-1),
          isMinijob: true,
        }),
      ),
    ).toEqual([]);
  });
});

// Review API Phase 7, Befund 2: Lücken unter 15 Min. zwischen Buchungen sind keine Ruhepause.
describe('evaluateWorkDay (§ 2 Abs. 1 ArbZG, kurze Lücken)', () => {
  it('counts a 10-minute gap between entries as working time', () => {
    const codes = evaluateWorkDay(day([entry(0, 240), entry(250, 490)])).map((m) => m.code);
    expect(codes).toContain('OVER_8H');
  });
  it('does not count a 15-minute gap', () => {
    const codes = evaluateWorkDay(day([entry(0, 240), entry(255, 495)])).map((m) => m.code);
    expect(codes).not.toContain('OVER_8H');
  });
});

describe('evaluateWorkDay (§ 4 ArbZG)', () => {
  it.each([
    { minutes: 360, expected: [] },
    { minutes: 361, expected: [missing30, noBreak] },
  ])('checks $minutes consecutive minutes', ({ minutes, expected }) => {
    expect(evaluateWorkDay(day([entry(0, minutes)]))).toEqual(expected);
  });

  it.each([
    { minutes: 540, expected: [over8] },
    {
      minutes: 541,
      expected: [
        over8,
        {
          code: 'BREAK_TOO_SHORT',
          level: 'crit',
          text: 'Pause 30 statt 45 Min.',
          paragraph: '§ 4 ArbZG',
        },
      ],
    },
  ])('requires the correct total break for $minutes worked minutes', ({ minutes, expected }) => {
    expect(evaluateWorkDay(day([entry(0, minutes + 30, [span(270, 300)])]))).toEqual(expected);
  });

  it.each([
    { gap: 14, expected: [missing30, noBreak] },
    {
      gap: 15,
      expected: [
        {
          code: 'BREAK_TOO_SHORT',
          level: 'crit',
          text: 'Pause 15 statt 30 Min.',
          paragraph: '§ 4 ArbZG',
        },
      ],
    },
    { gap: 30, expected: [] },
  ])('handles a $gap minute gap between unsorted entries', ({ gap, expected }) => {
    expect(evaluateWorkDay(day([entry(180 + gap, 361 + gap), entry(0, 180)]))).toEqual(expected);
  });

  it('counts short gaps as work for the section and the day', () => {
    // 180 + 14 + 180 = 374 Min. Arbeitszeit ohne Ruhepause (Review API Phase 7, Befund 2).
    expect(evaluateWorkDay(day([entry(0, 180), entry(194, 374)]))).toEqual([missing30, noBreak]);
  });

  it('adds breaks and gaps across all completed entries', () => {
    expect(evaluateWorkDay(day([entry(315, 495), entry(0, 300, [span(150, 165)])]))).toEqual([]);
  });

  it('does not count the gap before an ongoing entry towards required breaks', () => {
    expect(evaluateWorkDay(day([entry(0, 361), entry(400, null)]))).toEqual([missing30, noBreak]);
  });

  it.each([
    { breakStart: 361, breakEnd: 391, end: 431 },
    { breakStart: 40, breakEnd: 70, end: 431 },
  ])(
    'checks work before and after sufficient breaks: $breakStart–$breakEnd',
    ({ breakStart, breakEnd, end }) => {
      expect(evaluateWorkDay(day([entry(0, end, [span(breakStart, breakEnd)])]))).toEqual([
        noBreak,
      ]);
    },
  );

  it('checks uninterrupted work between two sufficient breaks', () => {
    expect(evaluateWorkDay(day([entry(0, 431, [span(20, 35), span(396, 411)])]))).toEqual([
      noBreak,
    ]);
  });

  it('does not reset uninterrupted work for a short break', () => {
    expect(evaluateWorkDay(day([entry(0, 361, [span(180, 194)])]))).toEqual([missing30, noBreak]);
  });
});

describe('evaluateWorkDay (§ 5 ArbZG)', () => {
  it.each([
    { rest: 660, expected: [] },
    {
      rest: 659,
      expected: [
        {
          code: 'REST_PERIOD',
          level: 'crit',
          text: 'Ruhezeit nur 10:59 Std.',
          paragraph: '§ 5 ArbZG',
        },
      ],
    },
  ])(
    'checks $rest minutes before the earliest entry, including open entries',
    ({ rest, expected }) => {
      expect(
        evaluateWorkDay(
          day([entry(120, 180), entry(0, 60)], {
            previousDayLastEnd: at(-rest),
          }),
        ),
      ).toEqual(expected);
      expect(evaluateWorkDay(day([entry(0, null)], { previousDayLastEnd: at(-rest) }))).toEqual(
        expected,
      );
    },
  );

  it.each([
    {
      date: '2026-10-25',
      previousEnd: '2026-10-24T20:00:00+02:00',
      start: '2026-10-25T06:00:00+01:00',
      expected: [],
    },
    {
      date: '2026-10-25',
      previousEnd: '2026-10-24T20:01:00+02:00',
      start: '2026-10-25T06:00:00+01:00',
      expected: [
        {
          code: 'REST_PERIOD',
          level: 'crit',
          text: 'Ruhezeit nur 10:59 Std.',
          paragraph: '§ 5 ArbZG',
        },
      ],
    },
    {
      date: '2026-03-29',
      previousEnd: '2026-03-28T18:00:00+01:00',
      start: '2026-03-29T06:00:00+02:00',
      expected: [],
    },
    {
      date: '2026-03-29',
      previousEnd: '2026-03-28T18:01:00+01:00',
      start: '2026-03-29T06:00:00+02:00',
      expected: [
        {
          code: 'REST_PERIOD',
          level: 'crit',
          text: 'Ruhezeit nur 10:59 Std.',
          paragraph: '§ 5 ArbZG',
        },
      ],
    },
  ])(
    'uses UTC for rest across the clock change: $previousEnd',
    ({ date, previousEnd, start, expected }) => {
      expect(
        evaluateWorkDay(
          day([{ ...entry(0, null), workDate: date, start: new Date(start) }], {
            workDate: date,
            previousDayLastEnd: new Date(previousEnd),
          }),
        ),
      ).toEqual([
        ...expected,
        {
          code: 'SUNDAY_WORK',
          level: 'warn',
          text: 'Sonntagsarbeit',
          paragraph: '§ 9 ArbZG',
        },
      ]);
    },
  );
});

describe('evaluateWorkDay (§§ 9, 10 ArbZG)', () => {
  it.each([
    { date: '2026-10-04', holiday: false, code: 'SUNDAY_WORK', text: 'Sonntagsarbeit' },
    { date: '2026-10-03', holiday: true, code: 'HOLIDAY_WORK', text: 'Feiertagsarbeit' },
    { date: '2026-11-01', holiday: true, code: 'HOLIDAY_WORK', text: 'Feiertagsarbeit' },
  ])('reports one warning on $date (holiday: $holiday)', ({ date, holiday, code, text }) => {
    const start = new Date(`${date}T08:00:00+01:00`);
    expect(
      evaluateWorkDay(
        day([{ ...entry(0, null), workDate: date, start }], {
          workDate: date,
          holidays: new Set(holiday ? [date] : []),
        }),
      ),
    ).toEqual([{ code, level: 'warn', text, paragraph: '§ 9 ArbZG' }]);
  });
});

describe('evaluateWorkDay (§ 17 MiLoG)', () => {
  it.each([
    { recordedAt: '2026-10-08T23:30:00+02:00', isMinijob: true, expected: [] },
    {
      recordedAt: '2026-10-09T00:10:00+02:00',
      isMinijob: true,
      expected: [
        {
          code: 'MINIJOB_LATE',
          level: 'crit',
          text: 'Erst nach 8 Tagen aufgezeichnet',
          paragraph: '§ 17 MiLoG',
        },
      ],
    },
    { recordedAt: '2026-10-09T00:10:00+02:00', isMinijob: false, expected: [] },
  ])(
    'checks Berlin calendar days for $recordedAt (minijob: $isMinijob)',
    ({ recordedAt, isMinijob, expected }) => {
      expect(
        evaluateWorkDay(
          day([{ ...entry(), source: 'MANUAL', recordedAt: new Date(recordedAt) }], {
            isMinijob,
          }),
        ),
      ).toEqual(expected);
    },
  );

  it('reports the greatest delay only once, including open entries', () => {
    expect(
      evaluateWorkDay(
        day(
          [
            {
              ...entry(120, null),
              source: 'MANUAL',
              recordedAt: new Date('2026-10-11T00:10:00+02:00'),
            },
            { ...entry(), source: 'MANUAL', recordedAt: new Date('2026-10-09T00:10:00+02:00') },
          ],
          { isMinijob: true },
        ),
      ),
    ).toEqual([
      {
        code: 'MINIJOB_LATE',
        level: 'crit',
        text: 'Erst nach 10 Tagen aufgezeichnet',
        paragraph: '§ 17 MiLoG',
      },
    ]);
  });
});

describe('evaluateWorkDay (Reihenfolge: §§ 3, 4, 5, 9 ArbZG und § 17 MiLoG)', () => {
  it('returns exact messages in the prescribed order without changing the input', () => {
    const input = Object.freeze(
      day(
        Object.freeze([
          Object.freeze({ ...entry(300, 601), recordedAt: new Date('2026-10-09T00:10:00+02:00') }),
          Object.freeze(entry(0, 300)),
        ]),
        { previousDayLastEnd: at(-659), holidays: new Set([workDate]), isMinijob: true },
      ),
    );
    const before = structuredClone(input);
    expect(evaluateWorkDay(input)).toEqual([
      over10,
      {
        code: 'BREAK_TOO_SHORT',
        level: 'crit',
        text: 'Pause 0 statt 45 Min.',
        paragraph: '§ 4 ArbZG',
      },
      noBreak,
      {
        code: 'REST_PERIOD',
        level: 'crit',
        text: 'Ruhezeit nur 10:59 Std.',
        paragraph: '§ 5 ArbZG',
      },
      { code: 'HOLIDAY_WORK', level: 'warn', text: 'Feiertagsarbeit', paragraph: '§ 9 ArbZG' },
      {
        code: 'MINIJOB_LATE',
        level: 'crit',
        text: 'Erst nach 8 Tagen aufgezeichnet',
        paragraph: '§ 17 MiLoG',
      },
    ]);
    expect(input).toEqual(before);
  });
});

describe('minijobMonth (§ 8 Abs. 1a SGB IV)', () => {
  it.each([
    { minutes: 8999, ratio: 0.8999, level: 'ok' },
    { minutes: 9000, ratio: 0.9, level: 'warn' },
    { minutes: 10000, ratio: 1, level: 'warn' },
    { minutes: 10001, ratio: 1.0001, level: 'crit' },
  ])('uses the supplied limit at ratio $ratio', ({ minutes, ratio, level }) => {
    expect(minijobMonth(minutes, 60, 10000)).toEqual({ earningsCents: minutes, ratio, level });
  });

  it('rounds earnings to cents before computing the ratio', () => {
    expect(minijobMonth(1, 1234, 100)).toEqual({ earningsCents: 21, ratio: 0.21, level: 'ok' });
  });

  it('returns zero earnings for zero minutes', () => {
    expect(minijobMonth(0, 1234, 10000)).toEqual({ earningsCents: 0, ratio: 0, level: 'ok' });
  });
});

describe('targetMinutesForDay (§ 3 ArbZG, Konzept 4.1)', () => {
  const terms: Pick<EmploymentTermsInput, 'type' | 'weeklyMinutes' | 'workDays'> = {
    type: 'FULL_TIME',
    weeklyMinutes: 2310,
    workDays: [1, 2, 3, 4, 5],
  };

  it('returns 462 minutes for 38.5 hours over five days', () => {
    expect(targetMinutesForDay(terms, workDate, new Set())).toBe(462);
  });

  it('returns zero on holidays and days outside the contract', () => {
    expect(targetMinutesForDay(terms, workDate, new Set([workDate]))).toBe(0);
    expect(targetMinutesForDay(terms, '2026-10-03', new Set())).toBe(0);
  });

  it('returns null without a contract or for minijob, including holidays', () => {
    expect(targetMinutesForDay(null, workDate, new Set())).toBeNull();
    expect(targetMinutesForDay({ ...terms, type: 'MINIJOB' }, workDate, new Set())).toBeNull();
    expect(
      targetMinutesForDay({ ...terms, type: 'MINIJOB' }, workDate, new Set([workDate])),
    ).toBeNull();
  });

  it('uses the supplied contract and distinct workdays', () => {
    expect(
      targetMinutesForDay(
        { type: 'PART_TIME', weeklyMinutes: 1000, workDays: [2, 3, 4, 4] },
        workDate,
        new Set(),
      ),
    ).toBe(333);
    expect(targetMinutesForDay({ ...terms, workDays: [] }, workDate, new Set())).toBe(0);
  });

  it('setzt das Soll bei Urlaub und Sonderurlaub auf 0, am halben Tag auf die abgerundete Hälfte', () => {
    expect(targetMinutesForDay(terms, workDate, new Set(), { type: 'VACATION', half: false })).toBe(
      0,
    );
    expect(targetMinutesForDay(terms, workDate, new Set(), { type: 'VACATION', half: true })).toBe(
      231,
    );
    expect(
      targetMinutesForDay(terms, workDate, new Set(), { type: 'SPECIAL_LEAVE', half: false }),
    ).toBe(0);
    const odd = { ...terms, weeklyMinutes: 2335 }; // 467 Minuten je Tag
    expect(targetMinutesForDay(odd, workDate, new Set(), { type: 'VACATION', half: true })).toBe(
      233,
    );
  });

  it('lässt das Soll bei Überstundenabbau stehen, Feiertag und Minijob bleiben unverändert', () => {
    expect(
      targetMinutesForDay(terms, workDate, new Set(), { type: 'OVERTIME_OFF', half: false }),
    ).toBe(462);
    expect(
      targetMinutesForDay(terms, workDate, new Set([workDate]), { type: 'VACATION', half: true }),
    ).toBe(0);
    expect(
      targetMinutesForDay({ ...terms, type: 'MINIJOB' }, workDate, new Set(), {
        type: 'VACATION',
        half: false,
      }),
    ).toBeNull();
  });
});

describe.each(['SICK', 'CHILD_SICK', 'NEUTRAL'] as const)(
  'targetMinutesForDay bei %s (§ 4 Abs. 1 EFZG, Phase 6)',
  (type) => {
    const terms: Pick<EmploymentTermsInput, 'type' | 'weeklyMinutes' | 'workDays'> = {
      type: 'FULL_TIME',
      weeklyMinutes: 2400,
      workDays: [1, 2, 3, 4, 5],
    };

    it.each([{}, { sinceMinute: null }])(
      'setzt bei ganztägiger Abwesenheit das Soll auf 0 (%j)',
      (absence) => {
        expect(
          targetMinutesForDay(terms, workDate, new Set(), { type, half: false, ...absence }, 240),
        ).toBe(0);
      },
    );

    it.each([
      { worked: -30, expected: 0 },
      { worked: 0, expected: 0 },
      { worked: 240, expected: 240 },
      { worked: 480, expected: 480 },
      { worked: 600, expected: 480 },
    ])(
      'begrenzt das Soll beim Heimgehen nach $worked Minuten auf $expected',
      ({ worked, expected }) => {
        expect(
          targetMinutesForDay(
            terms,
            workDate,
            new Set(),
            { type, half: false, sinceMinute: 720 },
            worked,
          ),
        ).toBe(expected);
      },
    );

    it('erkennt sinceMinute 0 als gesetzte Uhrzeit', () => {
      expect(
        targetMinutesForDay(terms, workDate, new Set(), { type, half: false, sinceMinute: 0 }, 240),
      ).toBe(240);
    });

    it('verwendet ohne workedMinutes beim Heimgehen 0', () => {
      expect(
        targetMinutesForDay(terms, workDate, new Set(), { type, half: false, sinceMinute: 720 }),
      ).toBe(0);
    });

    it.each([null, 720])(
      'erhält Minijob, fehlenden Vertrag, Feiertag und freien Tag (sinceMinute: %s)',
      (sinceMinute) => {
        const absence = { type, half: false, sinceMinute };
        expect(
          targetMinutesForDay({ ...terms, type: 'MINIJOB' }, workDate, new Set(), absence, 240),
        ).toBeNull();
        expect(targetMinutesForDay(null, workDate, new Set(), absence, 240)).toBeNull();
        expect(targetMinutesForDay(terms, workDate, new Set([workDate]), absence, 240)).toBe(0);
        expect(targetMinutesForDay(terms, '2026-10-03', new Set(), absence, 240)).toBe(0);
      },
    );
  },
);

describe('lateInfo (§ 17 MiLoG, Konzept 4.1)', () => {
  it('returns null for clock entries', () => {
    expect(lateInfo(entry())).toBeNull();
  });

  it('reports 124 whole minutes for a same-day manual entry', () => {
    expect(lateInfo({ ...entry(), source: 'MANUAL', recordedAt: at(124 + 59 / 60) })).toEqual({
      daysLate: 0,
      minutesAfterStart: 124,
    });
  });

  it('never reports negative minutes after the start', () => {
    expect(lateInfo({ ...entry(), source: 'MANUAL', recordedAt: at(-5) })).toEqual({
      daysLate: 0,
      minutesAfterStart: 0,
    });
  });

  it('recognizes the next Berlin day while the UTC date is unchanged', () => {
    expect(
      lateInfo({ ...entry(), source: 'MANUAL', recordedAt: new Date('2026-10-01T22:10:00Z') }),
    ).toEqual({
      daysLate: 1,
      minutesAfterStart: null,
    });
  });
});

describe('minijobMonthFromParts (§ 8 Abs. 1a SGB IV)', () => {
  it('bewertet jede Arbeitszeit mit dem Lohn ihres Tages', () => {
    expect(
      minijobMonthFromParts(
        [
          { minutes: 240, hourlyWageCents: 1400 },
          { minutes: 240, hourlyWageCents: 2000 },
        ],
        60300,
      ).earningsCents,
    ).toBe(13600);
  });

  it('rundet einmal auf den Gesamtbetrag', () => {
    expect(
      minijobMonthFromParts(
        [
          { minutes: 1, hourlyWageCents: 1390 },
          { minutes: 1, hourlyWageCents: 1390 },
        ],
        60300,
      ).earningsCents,
    ).toBe(46);
  });
});
