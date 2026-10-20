import type { LocalDate } from '@as/shared';
import {
  clockInReminderDue,
  clockOutReminderDue,
  lateEntryStats,
  minijobRecordingDue,
  usualStart,
} from './reminders';
import type {
  ClockInDueInput,
  ClockOutDueInput,
  LateEntrySample,
  StartSample,
} from './reminders-types';

function startSample(
  workDate: LocalDate,
  instant: string,
  overrides: Partial<StartSample> = {},
): StartSample {
  return { workDate, start: new Date(instant), source: 'CLOCK', voided: false, ...overrides };
}

function clockInInput(overrides: Partial<ClockInDueInput> = {}): ClockInDueInput {
  return {
    now: new Date('2026-04-20T06:45:00Z'),
    date: '2026-04-20',
    usualStart: '08:30',
    defaultStart: '09:00',
    isWorkday: true,
    holiday: false,
    absent: false,
    hasEntry: false,
    muted: false,
    stage1SentAt: null,
    stage2Sent: false,
    ...overrides,
  };
}

function clockOutInput(overrides: Partial<ClockOutDueInput> = {}): ClockOutDueInput {
  return {
    now: new Date('2026-04-20T16:01:00Z'),
    openSince: new Date('2026-04-20T06:00:00Z'),
    stage1SentAt: null,
    stage2Sent: false,
    ...overrides,
  };
}

function lateSamples(entries: number, late: number): LateEntrySample[] {
  return Array.from({ length: entries }, (_, index) => ({
    source: index < late ? 'MANUAL' : 'CLOCK',
    voided: false,
    late: null,
  }));
}

describe('usualStart (Konzept 4.6, Spezifikation Abschnitt 5)', () => {
  const date = '2026-04-20';
  const samples = [
    startSample('2026-04-13', '2026-04-13T07:00:00Z'),
    startSample('2026-04-06', '2026-04-06T05:00:00Z'),
    startSample('2026-03-30', '2026-03-30T06:00:00Z'),
  ];

  it('nimmt bei genau drei Tagen den mittleren Beginn', () => {
    expect(usualStart(Object.freeze([...samples]), date)).toBe('08:00');
  });

  it('nimmt bei vier Tagen Index 2 und nicht den Mittelwert', () => {
    expect(usualStart([...samples, startSample('2026-03-23', '2026-03-23T09:00:00Z')], date)).toBe(
      '09:00',
    );
  });

  it.each([0, 1, 2])('liefert bei %i Tagen null', (count) => {
    expect(usualStart(samples.slice(0, count), date)).toBeNull();
  });

  it.each([{ source: 'MANUAL' as const }, { voided: true }])(
    'ignoriert ausgeschlossene Buchungen: %j',
    (overrides) => {
      const excluded = startSample('2026-03-23', '2026-03-23T10:00:00Z', overrides);
      expect(usualStart([...samples, excluded], date)).toBe('08:00');
      expect(usualStart([...samples.slice(0, 2), excluded], date)).toBeNull();
    },
  );

  it('ignoriert andere Wochentage', () => {
    expect(usualStart([...samples, startSample('2026-04-14', '2026-04-14T10:00:00Z')], date)).toBe(
      '08:00',
    );
  });

  it('schließt Tag 56 ein', () => {
    expect(
      usualStart([...samples.slice(0, 2), startSample('2026-02-23', '2026-02-23T07:00:00Z')], date),
    ).toBe('08:00');
  });

  it.each(['2026-02-22', '2026-02-16', '2026-04-20', '2026-04-27'])(
    'schließt Tag 57, Tag 63, heute und Zukunft aus: %s',
    (workDate) => {
      expect(usualStart([...samples, startSample(workDate, `${workDate}T10:00:00Z`)], date)).toBe(
        '08:00',
      );
    },
  );

  it('zählt pro Tag nur den frühesten gültigen Stempeluhr-Beginn', () => {
    expect(
      usualStart(
        [
          startSample('2026-04-06', '2026-04-06T04:00:00Z', { source: 'MANUAL' }),
          startSample('2026-04-06', '2026-04-06T03:00:00Z', { voided: true }),
          startSample('2026-04-06', '2026-04-06T10:00:00Z'),
          ...samples,
          startSample('2026-04-06', '2026-04-06T11:00:00Z'),
        ],
        date,
      ),
    ).toBe('08:00');
  });

  it('macht aus drei Buchungen an zwei Tagen keine drei Lerntage', () => {
    expect(
      usualStart([...samples.slice(0, 2), startSample('2026-04-13', '2026-04-13T10:00:00Z')], date),
    ).toBeNull();
  });

  it.each([
    ['2026-03-23', ['2026-03-02', '2026-03-09', '2026-03-16'], '07:00'],
    ['2026-04-20', ['2026-03-30', '2026-04-06', '2026-04-13'], '06:00'],
  ] as const)('lernt 08:00 Berliner Zeit vor und nach der Umstellung: %s', (day, days, utc) => {
    expect(
      usualStart(
        days.map((d) => startSample(d, `${d}T${utc}:00Z`)),
        day,
      ),
    ).toBe('08:00');
  });

  it('vergleicht Berliner Uhrzeiten auch in einer Stichprobe über die Zeitumstellung', () => {
    expect(
      usualStart(
        [
          startSample('2026-03-23', '2026-03-23T07:00:00Z'),
          startSample('2026-03-30', '2026-03-30T06:00:00Z'),
          startSample('2026-04-06', '2026-04-06T06:00:00Z'),
        ],
        date,
      ),
    ).toBe('08:00');
  });

  it('wählt in der doppelten Herbststunde den frühesten Zeitpunkt je Tag', () => {
    expect(
      usualStart(
        [
          startSample('2026-10-25', '2026-10-25T01:10:00Z'),
          startSample('2026-10-25', '2026-10-25T00:50:00Z'),
          startSample('2026-10-18', '2026-10-18T00:30:00Z'),
          startSample('2026-10-11', '2026-10-11T01:00:00Z'),
        ],
        '2026-11-01',
      ),
    ).toBe('02:50');
  });
});

describe('clockInReminderDue (Konzept 4.6, Entscheidungen 3 und 6)', () => {
  it.each([
    ['2026-04-20T06:44:00Z', null],
    ['2026-04-20T06:45:00Z', 1],
    ['2026-04-20T06:46:00Z', 1],
  ] as const)('liefert um %s die Stufe %s', (now, expected) => {
    expect(clockInReminderDue(clockInInput({ now: new Date(now) }))).toBe(expected);
  });

  it.each([
    ['2026-04-20T07:14:00Z', null],
    ['2026-04-20T07:15:00Z', 1],
  ] as const)('verwendet ohne gelernten Beginn die Standardzeit: %s', (now, expected) => {
    expect(clockInReminderDue(clockInInput({ usualStart: null, now: new Date(now) }))).toBe(
      expected,
    );
  });

  it.each([
    { isWorkday: false },
    { holiday: true },
    { absent: true },
    { hasEntry: true },
    { muted: true },
  ])('sperrt beide Stufen jeweils unabhängig: %j', (condition) => {
    expect(clockInReminderDue(clockInInput(condition))).toBeNull();
    expect(
      clockInReminderDue(
        clockInInput({ ...condition, stage1SentAt: new Date('2026-04-20T05:45:00Z') }),
      ),
    ).toBeNull();
  });

  it.each([
    ['2026-04-20T08:19:00Z', null],
    ['2026-04-20T08:20:00Z', 2],
    ['2026-04-20T08:21:00Z', 2],
  ] as const)('misst Stufe 2 ab tatsächlichem Versand: %s', (now, expected) => {
    expect(
      clockInReminderDue(
        clockInInput({
          now: new Date(now),
          stage1SentAt: new Date('2026-04-20T07:20:00Z'),
        }),
      ),
    ).toBe(expected);
  });

  it('sendet nach Stufe 2 nicht erneut', () => {
    expect(
      clockInReminderDue(
        clockInInput({
          now: new Date('2026-04-20T12:00:00Z'),
          stage1SentAt: new Date('2026-04-20T06:45:00Z'),
          stage2Sent: true,
        }),
      ),
    ).toBeNull();
  });

  it('berechnet die Standardzeit im Winter in Europe/Berlin', () => {
    expect(
      clockInReminderDue(
        clockInInput({
          date: '2026-03-23',
          usualStart: null,
          defaultStart: '08:30',
          now: new Date('2026-03-23T07:45:00Z'),
        }),
      ),
    ).toBe(1);
  });

  it('liefert bei einer nicht existierenden Beginnzeit null', () => {
    expect(
      clockInReminderDue(
        clockInInput({
          date: '2026-03-29',
          usualStart: '02:30',
          now: new Date('2026-03-29T10:00:00Z'),
        }),
      ),
    ).toBeNull();
  });

  it('addiert 15 echte Minuten über den Frühlingssprung hinweg', () => {
    expect(
      clockInReminderDue(
        clockInInput({
          date: '2026-03-29',
          usualStart: '01:55',
          now: new Date('2026-03-29T01:10:00Z'),
        }),
      ),
    ).toBe(1);
  });
});

describe('clockOutReminderDue (Entscheidung 4, Konzept 4.6)', () => {
  it.each([
    ['2026-04-20T16:00:00Z', null],
    ['2026-04-20T16:00:00.001Z', 1],
    ['2026-04-20T16:01:00Z', 1],
  ] as const)('erinnert erst nach mehr als 600 Minuten: %s', (now, expected) => {
    expect(clockOutReminderDue(clockOutInput({ now: new Date(now) }))).toBe(expected);
  });

  it.each([null, new Date('2026-04-20T14:00:00Z')])(
    'erinnert ohne offene Buchung in keiner Stufe (%s)',
    (stage1SentAt) => {
      expect(clockOutReminderDue(clockOutInput({ openSince: null, stage1SentAt }))).toBeNull();
    },
  );

  it.each([
    ['2026-04-20T17:19:00Z', null],
    ['2026-04-20T17:20:00Z', 2],
    ['2026-04-20T17:21:00Z', 2],
  ] as const)('misst Stufe 2 ab tatsächlichem Versand: %s', (now, expected) => {
    expect(
      clockOutReminderDue(
        clockOutInput({
          now: new Date(now),
          stage1SentAt: new Date('2026-04-20T16:20:00Z'),
        }),
      ),
    ).toBe(expected);
  });

  it('sendet nach Stufe 2 nicht erneut', () => {
    expect(
      clockOutReminderDue(
        clockOutInput({
          now: new Date('2026-04-20T20:00:00Z'),
          stage1SentAt: new Date('2026-04-20T16:01:00Z'),
          stage2Sent: true,
        }),
      ),
    ).toBeNull();
  });
});

describe('minijobRecordingDue (§ 17 Abs. 1 MiLoG, Entscheidung 4)', () => {
  it('liefert Tage 5, 6 und 7 aufsteigend, aber nicht Tag 4 oder 8', () => {
    expect(
      minijobRecordingDue({
        today: '2026-04-20',
        workDays: Object.freeze([
          '2026-04-16',
          '2026-04-15',
          '2026-04-12',
          '2026-04-13',
          '2026-04-14',
        ]),
        recordedDates: new Set(),
        sent: new Set(),
      }),
    ).toEqual([
      { date: '2026-04-13', stage: 7 },
      { date: '2026-04-14', stage: 6 },
      { date: '2026-04-15', stage: 5 },
    ]);
  });

  it('überspringt Buchungen und exakt die schon gesendete Tagesstufe', () => {
    expect(
      minijobRecordingDue({
        today: '2026-04-20',
        workDays: ['2026-04-13', '2026-04-14', '2026-04-15'],
        recordedDates: new Set(['2026-04-15']),
        sent: new Set(['2026-04-13:7', '2026-04-14:5']),
      }),
    ).toEqual([{ date: '2026-04-14', stage: 6 }]);
  });

  it('zählt Kalendertage auch über die Sommerzeitumstellung', () => {
    expect(
      minijobRecordingDue({
        today: '2026-04-01',
        workDays: ['2026-03-27'],
        recordedDates: new Set(),
        sent: new Set(),
      }),
    ).toEqual([{ date: '2026-03-27', stage: 5 }]);
  });

  it.each([{ workDays: [] }, { workDays: ['2026-04-20', '2026-04-21'] }])(
    'erinnert ohne vergangene Arbeitstage nicht: $workDays',
    ({ workDays }) => {
      expect(
        minijobRecordingDue({
          today: '2026-04-20',
          workDays,
          recordedDates: new Set(),
          sent: new Set(),
        }),
      ).toEqual([]);
    },
  );
});

describe('lateEntryStats (Konzept 4.1, Entscheidung 8)', () => {
  const thresholds = { minCount: 3, minPercent: 20 };

  it.each([
    [10, 2, 20, false],
    [15, 3, 20, true],
    [16, 3, 19, false],
    [51, 10, 20, false],
  ] as const)(
    'wertet %i Buchungen mit %i Nachträgen ohne gerundeten Schwellenvergleich aus',
    (entries, late, percent, flagged) => {
      expect(lateEntryStats(lateSamples(entries, late), thresholds)).toEqual({
        entries,
        late,
        percent,
        averageDelayMinutes: null,
        flagged,
      });
    },
  );

  it('verwendet die übergebenen Schwellen', () => {
    expect(lateEntryStats(lateSamples(4, 1), { minCount: 1, minPercent: 25 }).flagged).toBe(true);
    expect(lateEntryStats(lateSamples(4, 1), { minCount: 1, minPercent: 25.1 }).flagged).toBe(
      false,
    );
  });

  it('schließt ungültige Buchungen aus Zähler, Nenner und Verzug aus', () => {
    expect(
      lateEntryStats(
        [
          ...lateSamples(15, 3),
          { source: 'CLOCK', voided: true, late: null },
          {
            source: 'MANUAL',
            voided: true,
            late: { daysLate: 0, minutesAfterStart: 999 },
          },
        ],
        thresholds,
      ),
    ).toEqual({ entries: 15, late: 3, percent: 20, averageDelayMinutes: null, flagged: true });
  });

  it('mittelt nur bekannte Verzögerungen von Nachträgen am selben Tag und rundet', () => {
    expect(
      lateEntryStats(
        [
          { source: 'MANUAL', voided: false, late: { daysLate: 0, minutesAfterStart: 0 } },
          { source: 'MANUAL', voided: false, late: { daysLate: 0, minutesAfterStart: 1 } },
          { source: 'MANUAL', voided: false, late: { daysLate: 1, minutesAfterStart: 999 } },
          { source: 'MANUAL', voided: false, late: { daysLate: 0, minutesAfterStart: null } },
          { source: 'MANUAL', voided: false, late: null },
          { source: 'CLOCK', voided: false, late: { daysLate: 0, minutesAfterStart: 999 } },
        ],
        thresholds,
      ),
    ).toEqual({ entries: 6, late: 5, percent: 83, averageDelayMinutes: 1, flagged: true });
  });

  it('liefert ohne Buchungen eine leere Statistik', () => {
    expect(lateEntryStats([], thresholds)).toEqual({
      entries: 0,
      late: 0,
      percent: 0,
      averageDelayMinutes: null,
      flagged: false,
    });
  });
});
