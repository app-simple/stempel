import type { EmploymentTermsInput, LegalValues, UpcomingLegalValues } from './types';
import { validateEmploymentTerms } from './validate-employment-terms';

const legal: LegalValues = { minWageHourlyCents: 1390, minijobMonthlyLimitCents: 60300 };
const fullTime: EmploymentTermsInput = {
  type: 'FULL_TIME',
  weeklyMinutes: 2400,
  workDays: [1, 2, 3, 4, 5],
  annualLeaveDays: 20,
  extraLeaveDays: 0,
  hourlyWageCents: null,
};
const minijob: EmploymentTermsInput = {
  type: 'MINIJOB',
  weeklyMinutes: 480,
  workDays: [2, 4],
  annualLeaveDays: 8,
  extraLeaveDays: 0,
  hourlyWageCents: 1390,
};
const upcoming: readonly UpcomingLegalValues[] = [
  {
    validFrom: '2027-01-01',
    values: { minWageHourlyCents: 1460, minijobMonthlyLimitCents: 63300 },
  },
];

describe('validateEmploymentTerms (§ 3 BUrlG, § 3 ArbZG, § 1 MiLoG, § 8 Abs. 1a SGB IV)', () => {
  it('returns daily target and minimum vacation in the prescribed order', () => {
    expect(validateEmploymentTerms(fullTime, legal)).toEqual({
      errors: [],
      warnings: [],
      infos: [
        { code: 'DAILY_TARGET', text: 'Soll je Arbeitstag: 8:00 Std.' },
        {
          code: 'MIN_VACATION',
          text: 'Gesetzlicher Mindesturlaub bei 5 Tagen/Woche: 20 Tage (§ 3 BUrlG).',
          paragraph: '§ 3 BUrlG',
        },
      ],
    });
  });

  it('uses singular Tag for a one-day week and rounds the daily target', () => {
    expect(
      validateEmploymentTerms(
        { ...fullTime, workDays: [3], weeklyMinutes: 301, annualLeaveDays: 4 },
        legal,
      ).infos,
    ).toEqual([
      { code: 'DAILY_TARGET', text: 'Soll je Arbeitstag: 5:01 Std.' },
      {
        code: 'MIN_VACATION',
        text: 'Gesetzlicher Mindesturlaub bei 1 Tag/Woche: 4 Tage (§ 3 BUrlG).',
        paragraph: '§ 3 BUrlG',
      },
    ]);
    expect(validateEmploymentTerms({ ...fullTime, weeklyMinutes: 2403 }, legal).infos[0]).toEqual({
      code: 'DAILY_TARGET',
      text: 'Soll je Arbeitstag: 8:01 Std.',
    });
  });

  it('reports missing workdays without dependent vacation or daily-hour checks', () => {
    expect(
      validateEmploymentTerms({ ...fullTime, workDays: [], annualLeaveDays: 0 }, legal),
    ).toEqual({
      errors: [{ code: 'NO_WORK_DAYS', text: 'Mindestens ein Arbeitstag.' }],
      warnings: [],
      infos: [],
    });
  });

  it.each([[1, 1], [7], [1, 7]] as const)(
    'rejects invalid workdays %j without dependent checks',
    (...workDays) => {
      expect(validateEmploymentTerms({ ...fullTime, workDays, annualLeaveDays: 0 }, legal)).toEqual(
        {
          errors: [
            {
              code: 'INVALID_WORK_DAYS',
              text: 'Arbeitstage nur von Montag bis Samstag, jeder Tag einmal.',
            },
          ],
          warnings: [],
          infos: [],
        },
      );
    },
  );

  it.each([0, -1, 2400.5, NaN, Infinity, -Infinity])(
    'rejects weekly minutes %s and suppresses hour checks and infos',
    (weeklyMinutes) => {
      const result = validateEmploymentTerms({ ...minijob, weeklyMinutes }, legal, upcoming);
      expect(result.errors).toEqual([
        { code: 'INVALID_WEEKLY_MINUTES', text: 'Die Wochenarbeitszeit muss größer als 0 sein.' },
      ]);
      expect(result.infos).toEqual([]);
      expect(result.warnings.map(({ code }) => code)).toEqual(['FUTURE_WAGE_BELOW_MINIMUM']);
    },
  );

  it.each([
    { annualLeaveDays: -1, extraLeaveDays: 0 },
    { annualLeaveDays: 20.5, extraLeaveDays: 0 },
    { annualLeaveDays: NaN, extraLeaveDays: 0 },
    { annualLeaveDays: Infinity, extraLeaveDays: 0 },
    { annualLeaveDays: 20, extraLeaveDays: -1 },
    { annualLeaveDays: 20, extraLeaveDays: 0.5 },
    { annualLeaveDays: 20, extraLeaveDays: NaN },
    { annualLeaveDays: 20, extraLeaveDays: Infinity },
  ])('rejects invalid leave values $annualLeaveDays / $extraLeaveDays', (leave) => {
    expect(validateEmploymentTerms({ ...fullTime, ...leave }, legal).errors).toContainEqual({
      code: 'INVALID_LEAVE_DAYS',
      text: 'Urlaubstage müssen ganze Zahlen ab 0 sein.',
    });
  });

  it.each([
    { workDays: [1, 2, 3, 4, 5], minimum: 20 },
    { workDays: [1, 2, 3, 4, 5, 6], minimum: 24 },
    { workDays: [1], minimum: 4 },
  ] as const)('enforces $minimum days of annual leave for $workDays', ({ workDays, minimum }) => {
    const terms = { ...fullTime, workDays, weeklyMinutes: 480, annualLeaveDays: minimum };
    expect(validateEmploymentTerms(terms, legal).errors).toEqual([]);
    expect(
      validateEmploymentTerms({ ...terms, annualLeaveDays: minimum - 1 }, legal).errors,
    ).toEqual([
      {
        code: 'VACATION_BELOW_MINIMUM',
        text: `Jahresurlaub liegt unter dem gesetzlichen Minimum von ${minimum} Tagen.`,
        paragraph: '§ 3 BUrlG',
      },
    ]);
  });

  it('does not include additional leave in the statutory minimum', () => {
    expect(
      validateEmploymentTerms({ ...fullTime, annualLeaveDays: 19, extraLeaveDays: 10 }, legal)
        .errors,
    ).toEqual([
      {
        code: 'VACATION_BELOW_MINIMUM',
        text: 'Jahresurlaub liegt unter dem gesetzlichen Minimum von 20 Tagen.',
        paragraph: '§ 3 BUrlG',
      },
    ]);
  });

  it('accepts one weekly minute and zero additional leave', () => {
    expect(validateEmploymentTerms({ ...fullTime, weeklyMinutes: 1 }, legal).errors).toEqual([]);
  });

  it('compares ten-hour limits before rounding the daily target', () => {
    const atLimit = validateEmploymentTerms({ ...fullTime, weeklyMinutes: 3000 }, legal);
    // Fifty weekly hours exceed the independent 48-hour limit, even at ten hours per day.
    expect(atLimit.errors.map(({ code }) => code)).toEqual(['WEEKLY_HOURS_ABOVE_48']);
    expect(atLimit.infos).toContainEqual({
      code: 'DAILY_HOURS_ABOVE_8',
      text: 'Über 8 Stunden je Tag: nur mit Ausgleich auf durchschnittlich 8 Stunden zulässig.',
      paragraph: '§ 3 ArbZG',
    });
    const above = validateEmploymentTerms({ ...fullTime, weeklyMinutes: 3001 }, legal);
    expect(above.errors).toEqual([
      {
        code: 'DAILY_HOURS_ABOVE_10',
        text: 'Mehr als 10 Stunden je Arbeitstag sind nicht zulässig (§ 3 ArbZG).',
        paragraph: '§ 3 ArbZG',
      },
      {
        code: 'WEEKLY_HOURS_ABOVE_48',
        text: 'Mehr als 48 Wochenstunden sind nicht zulässig.',
        paragraph: '§ 3 ArbZG',
      },
    ]);
    expect(above.infos.map(({ code }) => code)).toEqual(['DAILY_TARGET', 'MIN_VACATION']);
  });

  it('compares eight-hour limits before rounding the daily target', () => {
    expect(
      validateEmploymentTerms({ ...fullTime, weeklyMinutes: 2400 }, legal).infos.map(
        ({ code }) => code,
      ),
    ).toEqual(['DAILY_TARGET', 'MIN_VACATION']);
    expect(validateEmploymentTerms({ ...fullTime, weeklyMinutes: 2401 }, legal).infos).toEqual([
      { code: 'DAILY_TARGET', text: 'Soll je Arbeitstag: 8:00 Std.' },
      {
        code: 'MIN_VACATION',
        text: 'Gesetzlicher Mindesturlaub bei 5 Tagen/Woche: 20 Tage (§ 3 BUrlG).',
        paragraph: '§ 3 BUrlG',
      },
      {
        code: 'DAILY_HOURS_ABOVE_8',
        text: 'Über 8 Stunden je Tag: nur mit Ausgleich auf durchschnittlich 8 Stunden zulässig.',
        paragraph: '§ 3 ArbZG',
      },
    ]);
  });

  it('enforces the 48-hour weekly limit with six workdays', () => {
    const terms: EmploymentTermsInput = {
      ...fullTime,
      workDays: [1, 2, 3, 4, 5, 6],
      annualLeaveDays: 24,
      weeklyMinutes: 2880,
    };
    expect(validateEmploymentTerms(terms, legal).errors).toEqual([]);
    expect(validateEmploymentTerms({ ...terms, weeklyMinutes: 2881 }, legal).errors).toEqual([
      {
        code: 'WEEKLY_HOURS_ABOVE_48',
        text: 'Mehr als 48 Wochenstunden sind nicht zulässig.',
        paragraph: '§ 3 ArbZG',
      },
    ]);
  });

  it('still enforces the weekly limit with invalid workdays', () => {
    expect(
      validateEmploymentTerms({ ...fullTime, workDays: [], weeklyMinutes: 3001 }, legal).errors.map(
        ({ code }) => code,
      ),
    ).toEqual(['NO_WORK_DAYS', 'WEEKLY_HOURS_ABOVE_48']);
  });

  it('requires a minijob wage and omits wage-dependent messages when absent', () => {
    const result = validateEmploymentTerms({ ...minijob, hourlyWageCents: null }, legal, upcoming);
    expect(result.errors).toEqual([
      { code: 'MINIJOB_WAGE_MISSING', text: 'Stundenlohn für Minijob fehlt.' },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.infos.map(({ code }) => code)).toEqual(['DAILY_TARGET', 'MIN_VACATION']);
  });

  it.each(['FULL_TIME', 'PART_TIME'] as const)('rejects an hourly wage for %s', (type) => {
    const result = validateEmploymentTerms(
      { ...fullTime, type, hourlyWageCents: 1390 },
      legal,
      upcoming,
    );
    expect(result.errors).toEqual([
      { code: 'WAGE_ONLY_FOR_MINIJOB', text: 'Ein Stundenlohn wird nur bei Minijob angegeben.' },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.infos.map(({ code }) => code)).toEqual(['DAILY_TARGET', 'MIN_VACATION']);
  });

  it('accepts the minimum wage and rejects one cent less', () => {
    expect(validateEmploymentTerms(minijob, legal).errors).toEqual([]);
    expect(validateEmploymentTerms({ ...minijob, hourlyWageCents: 1389 }, legal).errors).toEqual([
      {
        code: 'WAGE_BELOW_MINIMUM',
        text: 'Stundenlohn unter dem Mindestlohn von 13,90\u00a0€.',
        paragraph: '§ 1 MiLoG',
      },
    ]);
  });

  it('enforces the minijob limit at the last whole weekly minute', () => {
    const maximumMinutes = Math.floor((60300 * 180) / (13 * 1390));
    expect(maximumMinutes).toBe(600);
    expect(
      validateEmploymentTerms({ ...minijob, weeklyMinutes: maximumMinutes }, legal).errors,
    ).toEqual([]);
    expect(
      validateEmploymentTerms({ ...minijob, weeklyMinutes: maximumMinutes + 1 }, legal).errors,
    ).toEqual([
      {
        code: 'MINIJOB_LIMIT_EXCEEDED',
        text: 'Die Wochenarbeitszeit führt über die Minijob-Grenze von 603,00\u00a0€.',
        paragraph: '§ 8 Abs. 1a SGB IV',
      },
    ]);
  });

  it('accepts exact monthly equality and uses supplied legal parameters', () => {
    const values = { minWageHourlyCents: 1500, minijobMonthlyLimitCents: 65000 };
    const terms = { ...minijob, hourlyWageCents: 1500, weeklyMinutes: 600 };
    expect(validateEmploymentTerms(terms, values).errors).toEqual([]);
    expect(validateEmploymentTerms({ ...terms, weeklyMinutes: 601 }, values).errors).toEqual([
      {
        code: 'MINIJOB_LIMIT_EXCEEDED',
        text: 'Die Wochenarbeitszeit führt über die Minijob-Grenze von 650,00\u00a0€.',
        paragraph: '§ 8 Abs. 1a SGB IV',
      },
    ]);
    expect(validateEmploymentTerms({ ...terms, hourlyWageCents: 1499 }, values).errors).toEqual([
      {
        code: 'WAGE_BELOW_MINIMUM',
        text: 'Stundenlohn unter dem Mindestlohn von 15,00\u00a0€.',
        paragraph: '§ 1 MiLoG',
      },
    ]);
  });

  it('formats Anna’s current information and future minimum-wage warning exactly', () => {
    expect(validateEmploymentTerms(minijob, legal, upcoming)).toEqual({
      errors: [],
      warnings: [
        {
          code: 'FUTURE_WAGE_BELOW_MINIMUM',
          text: 'Ab 01.01.2027 liegt der Stundenlohn unter dem Mindestlohn von 14,60\u00a0€.',
          paragraph: '§ 1 MiLoG',
        },
      ],
      infos: [
        { code: 'DAILY_TARGET', text: 'Soll je Arbeitstag: 4:00 Std.' },
        {
          code: 'MIN_VACATION',
          text: 'Gesetzlicher Mindesturlaub bei 2 Tagen/Woche: 8 Tage (§ 3 BUrlG).',
          paragraph: '§ 3 BUrlG',
        },
        {
          code: 'MINIJOB_CAPACITY',
          text: 'Minijob: höchstens 43,4 Std./Monat bei 13,90\u00a0€. Geplant sind rund 34,7 Std./Monat (481,87\u00a0€).',
        },
      ],
    });
  });

  it('sorts future warnings by date and then wage before monthly limit without mutating inputs', () => {
    const changes = Object.freeze([
      Object.freeze({
        validFrom: '2028-01-01',
        values: Object.freeze({ minWageHourlyCents: 1600, minijobMonthlyLimitCents: 40000 }),
      }),
      Object.freeze({
        validFrom: '2027-01-01',
        values: Object.freeze({ minWageHourlyCents: 1460, minijobMonthlyLimitCents: 45000 }),
      }),
    ]);
    expect(
      validateEmploymentTerms(
        Object.freeze({ ...minijob, workDays: Object.freeze([2, 4] as const) }),
        Object.freeze(legal),
        changes,
      ).warnings,
    ).toEqual([
      {
        code: 'FUTURE_WAGE_BELOW_MINIMUM',
        text: 'Ab 01.01.2027 liegt der Stundenlohn unter dem Mindestlohn von 14,60\u00a0€.',
        paragraph: '§ 1 MiLoG',
      },
      {
        code: 'FUTURE_MINIJOB_LIMIT_EXCEEDED',
        text: 'Ab 01.01.2027 führt die Wochenarbeitszeit über die Minijob-Grenze von 450,00\u00a0€.',
        paragraph: '§ 8 Abs. 1a SGB IV',
      },
      {
        code: 'FUTURE_WAGE_BELOW_MINIMUM',
        text: 'Ab 01.01.2028 liegt der Stundenlohn unter dem Mindestlohn von 16,00\u00a0€.',
        paragraph: '§ 1 MiLoG',
      },
      {
        code: 'FUTURE_MINIJOB_LIMIT_EXCEEDED',
        text: 'Ab 01.01.2028 führt die Wochenarbeitszeit über die Minijob-Grenze von 400,00\u00a0€.',
        paragraph: '§ 8 Abs. 1a SGB IV',
      },
    ]);
    expect(changes.map(({ validFrom }) => validFrom)).toEqual(['2028-01-01', '2027-01-01']);
  });

  it('does not warn when future wage and monthly limit are met exactly', () => {
    const changes = [
      {
        validFrom: '2027-01-01',
        values: { minWageHourlyCents: 1500, minijobMonthlyLimitCents: 52000 },
      },
    ];
    expect(
      validateEmploymentTerms({ ...minijob, hourlyWageCents: 1500 }, legal, changes).warnings,
    ).toEqual([]);
    expect(
      validateEmploymentTerms(
        { ...minijob, hourlyWageCents: 1500, weeklyMinutes: 481 },
        legal,
        changes,
      ).warnings.map(({ code }) => code),
    ).toEqual(['FUTURE_MINIJOB_LIMIT_EXCEEDED']);
    expect(
      validateEmploymentTerms({ ...minijob, hourlyWageCents: 1499 }, legal, changes).warnings.map(
        ({ code }) => code,
      ),
    ).toEqual(['FUTURE_WAGE_BELOW_MINIMUM']);
  });

  it('suppresses only the future violation already reported against current values', () => {
    const changes = [
      {
        validFrom: '2027-01-01',
        values: { minWageHourlyCents: 1600, minijobMonthlyLimitCents: 40000 },
      },
    ];
    expect(
      validateEmploymentTerms({ ...minijob, hourlyWageCents: 1389 }, legal, changes).warnings.map(
        ({ code }) => code,
      ),
    ).toEqual(['FUTURE_MINIJOB_LIMIT_EXCEEDED']);
    expect(
      validateEmploymentTerms({ ...minijob, weeklyMinutes: 700 }, legal, changes).warnings.map(
        ({ code }) => code,
      ),
    ).toEqual(['FUTURE_WAGE_BELOW_MINIMUM']);
    expect(
      validateEmploymentTerms(
        { ...minijob, hourlyWageCents: 1389, weeklyMinutes: 700 },
        legal,
        changes,
      ).warnings,
    ).toEqual([]);
  });

  it('keeps errors in the prescribed order even with multiple independent violations', () => {
    expect(
      validateEmploymentTerms(
        {
          ...minijob,
          weeklyMinutes: 3001,
          annualLeaveDays: -1,
          extraLeaveDays: -1,
          hourlyWageCents: 1389,
        },
        legal,
      ).errors.map(({ code }) => code),
    ).toEqual([
      'INVALID_LEAVE_DAYS',
      'VACATION_BELOW_MINIMUM',
      'DAILY_HOURS_ABOVE_10',
      'WEEKLY_HOURS_ABOVE_48',
      'WAGE_BELOW_MINIMUM',
      'MINIJOB_LIMIT_EXCEEDED',
    ]);
    expect(
      validateEmploymentTerms(
        {
          ...fullTime,
          workDays: [7, 7],
          weeklyMinutes: 1.5,
          extraLeaveDays: -1,
          hourlyWageCents: 1389,
        },
        legal,
      ).errors.map(({ code }) => code),
    ).toEqual([
      'INVALID_WORK_DAYS',
      'INVALID_WEEKLY_MINUTES',
      'INVALID_LEAVE_DAYS',
      'WAGE_ONLY_FOR_MINIJOB',
      'WAGE_BELOW_MINIMUM',
    ]);
  });

  it('places the eight-hour information before minijob capacity', () => {
    expect(
      validateEmploymentTerms({ ...minijob, workDays: [3], weeklyMinutes: 481 }, legal).infos.map(
        ({ code }) => code,
      ),
    ).toEqual(['DAILY_TARGET', 'MIN_VACATION', 'DAILY_HOURS_ABOVE_8', 'MINIJOB_CAPACITY']);
  });

  it.each([
    { name: 'Katharina Brandl', terms: { ...fullTime, annualLeaveDays: 30 }, errorCodes: [] },
    { name: 'Tobias Lechner', terms: { ...fullTime, annualLeaveDays: 30 }, errorCodes: [] },
    { name: 'Miriam Stadler', terms: { ...fullTime, annualLeaveDays: 30 }, errorCodes: [] },
    { name: 'Jonas Reitberger', terms: { ...fullTime, annualLeaveDays: 30 }, errorCodes: [] },
    { name: 'Elif Aydin', terms: { ...fullTime, annualLeaveDays: 30 }, errorCodes: [] },
    {
      name: 'Sebastian Wolf',
      terms: {
        ...fullTime,
        type: 'PART_TIME',
        weeklyMinutes: 1440,
        workDays: [1, 2, 3],
        annualLeaveDays: 18,
      },
      errorCodes: [],
    },
    {
      name: 'Lena Hofbauer',
      terms: { ...fullTime, weeklyMinutes: 2310, annualLeaveDays: 30 },
      errorCodes: [],
    },
    {
      name: 'Marco Pichler',
      terms: { ...fullTime, type: 'PART_TIME', weeklyMinutes: 1800, annualLeaveDays: 28 },
      errorCodes: [],
    },
    { name: 'Anna Kroiß', terms: minijob, errorCodes: [] },
    {
      name: 'Paul Zellner',
      terms: {
        ...minijob,
        weeklyMinutes: 300,
        workDays: [3],
        annualLeaveDays: 4,
        hourlyWageCents: 1500,
      },
      errorCodes: [],
    },
    // Contrary to the task's blanket expectation, 10.5 × 13/3 × €14 = €637 exceeds €603.
    {
      name: 'Hannelore Fuchs',
      terms: {
        ...minijob,
        weeklyMinutes: 630,
        workDays: [1, 3, 5],
        annualLeaveDays: 12,
        hourlyWageCents: 1400,
      },
      errorCodes: ['MINIJOB_LIMIT_EXCEEDED'],
    },
  ] satisfies { name: string; terms: EmploymentTermsInput; errorCodes: string[] }[])(
    'validates prototype employee $name against the 2026 values',
    ({ terms, errorCodes }) => {
      const result = validateEmploymentTerms(terms, legal);
      expect(result.errors.map(({ code }) => code)).toEqual(errorCodes);
      expect(result.warnings).toEqual([]);
    },
  );

  it('rejects a wage of zero without a capacity information', () => {
    const result = validateEmploymentTerms({ ...minijob, hourlyWageCents: 0 }, legal);
    expect(result.errors.map(({ code }) => code)).toEqual(['WAGE_BELOW_MINIMUM']);
    expect(result.infos.map(({ code }) => code)).toEqual(['DAILY_TARGET', 'MIN_VACATION']);
  });
});
