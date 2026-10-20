import { bavarianHolidays, easterSunday, isHoliday } from './holidays';

describe('easterSunday (Art. 1 Abs. 1 FTG, § 9 ArbZG)', () => {
  it.each([
    [1583, '1583-04-10'],
    [1954, '1954-04-18'],
    [1981, '1981-04-19'],
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2029, '2029-04-01'],
    [2030, '2030-04-21'],
    [2049, '2049-04-18'],
    [2076, '2076-04-19'],
    [9999, '9999-03-28'],
  ])('calculates Easter in %i as %s', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });

  it.each([1582, 2026.5, 10000, NaN, Infinity, -Infinity])('rejects year %s', (year) => {
    expect(() => easterSunday(year)).toThrow(RangeError);
    expect(() => bavarianHolidays(year, { assumptionDay: true })).toThrow(RangeError);
  });
});

describe('bavarianHolidays (Art. 1 Abs. 1 FTG, § 9 ArbZG)', () => {
  const commonHolidays = [
    { date: '2026-01-01', key: 'NEW_YEAR', name: 'Neujahr' },
    { date: '2026-01-06', key: 'EPIPHANY', name: 'Heilige Drei Könige' },
    { date: '2026-04-03', key: 'GOOD_FRIDAY', name: 'Karfreitag' },
    { date: '2026-04-06', key: 'EASTER_MONDAY', name: 'Ostermontag' },
    { date: '2026-05-01', key: 'LABOUR_DAY', name: 'Tag der Arbeit' },
    { date: '2026-05-14', key: 'ASCENSION_DAY', name: 'Christi Himmelfahrt' },
    { date: '2026-05-25', key: 'WHIT_MONDAY', name: 'Pfingstmontag' },
    { date: '2026-06-04', key: 'CORPUS_CHRISTI', name: 'Fronleichnam' },
    { date: '2026-10-03', key: 'GERMAN_UNITY_DAY', name: 'Tag der Deutschen Einheit' },
    { date: '2026-11-01', key: 'ALL_SAINTS_DAY', name: 'Allerheiligen' },
    { date: '2026-12-25', key: 'CHRISTMAS_DAY', name: '1. Weihnachtstag' },
    { date: '2026-12-26', key: 'BOXING_DAY', name: '2. Weihnachtstag' },
  ];

  it('returns all twelve holidays without Assumption Day in calendar order', () => {
    expect(bavarianHolidays(2026, { assumptionDay: false })).toEqual(commonHolidays);
  });

  it('includes Assumption Day in its calendar position', () => {
    expect(bavarianHolidays(2026, { assumptionDay: true })).toEqual([
      ...commonHolidays.slice(0, 8),
      { date: '2026-08-15', key: 'ASSUMPTION_DAY', name: 'Mariä Himmelfahrt' },
      ...commonHolidays.slice(8),
    ]);
  });

  it('preserves both holidays on May 1 in 2008', () => {
    const holidays = bavarianHolidays(2008, { assumptionDay: true });
    expect(holidays).toHaveLength(13);
    expect(holidays.filter(({ date }) => date === '2008-05-01')).toEqual([
      { date: '2008-05-01', key: 'LABOUR_DAY', name: 'Tag der Arbeit' },
      { date: '2008-05-01', key: 'ASCENSION_DAY', name: 'Christi Himmelfahrt' },
    ]);
    expect(holidays.map(({ date }) => date)).toEqual(holidays.map(({ date }) => date).sort());
  });

  it('sorts Ascension Day before Labour Day when Easter is early', () => {
    const holidays = bavarianHolidays(1818, { assumptionDay: false });
    expect(holidays.slice(4, 6).map(({ date, key }) => ({ date, key }))).toEqual([
      { date: '1818-04-30', key: 'ASCENSION_DAY' },
      { date: '1818-05-01', key: 'LABOUR_DAY' },
    ]);
  });

  it('returns independent lists for repeated calls', () => {
    const holidays = bavarianHolidays(2026, { assumptionDay: true });
    holidays.splice(0);
    expect(bavarianHolidays(2026, { assumptionDay: false })).toEqual(commonHolidays);
  });
});

describe('isHoliday (§ 9 ArbZG)', () => {
  it.each(['2026-01-01', '2026-01-02'])('checks %s in date sets and object lists', (date) => {
    const expected = date === '2026-01-01';
    expect(isHoliday(date, new Set(['2026-01-01']))).toBe(expected);
    expect(isHoliday(date, [{ date: '2026-01-01' }])).toBe(expected);
  });

  it('accepts object iterables including sets and generators', () => {
    function* holidays() {
      yield { date: '2026-01-01' };
    }
    expect(isHoliday('2026-01-01', holidays())).toBe(true);
    expect(isHoliday('2026-01-01', new Set([{ date: '2026-01-01' }]))).toBe(true);
  });

  it('returns false for empty collections', () => {
    expect(isHoliday('2026-01-01', new Set<string>())).toBe(false);
    expect(isHoliday('2026-01-01', [])).toBe(false);
  });
});
