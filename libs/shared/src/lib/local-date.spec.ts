import {
  addDays,
  diffDays,
  eachDay,
  formatLocalDate,
  isLocalDate,
  isoWeek,
  isoWeekday,
  localDateInBerlin,
} from './local-date';

describe('local-date', () => {
  it('erkennt gültige und ungültige Daten', () => {
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2027-02-29')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('2026-1-01')).toBe(false);
    expect(isLocalDate(20260101)).toBe(false);
  });

  it('rechnet Tage über Sommerzeit und Jahreswechsel', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
    expect(diffDays('2026-10-26', '2026-10-24')).toBe(-2);
  });

  it('liefert ISO-Wochentage', () => {
    expect(isoWeekday('2026-10-12')).toBe(1);
    expect(isoWeekday('2026-10-18')).toBe(7);
  });

  it('zählt Tage inklusive beider Grenzen', () => {
    expect(eachDay('2026-12-30', '2027-01-01')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(eachDay('2026-01-02', '2026-01-01')).toEqual([]);
  });

  it('bestimmt das Datum in Europe/Berlin', () => {
    expect(localDateInBerlin(new Date('2026-10-11T22:30:00Z'))).toBe('2026-10-12');
    expect(localDateInBerlin(new Date('2026-01-31T22:59:59Z'))).toBe('2026-01-31');
    expect(localDateInBerlin(new Date('2026-01-31T23:00:00Z'))).toBe('2026-02-01');
  });

  it('formatiert deutsch', () => {
    expect(formatLocalDate('2027-01-01')).toBe('01.01.2027');
    expect(() => formatLocalDate('2027-02-30')).toThrow(RangeError);
  });

  it('bestimmt die ISO-Kalenderwoche auch am Jahreswechsel', () => {
    expect(isoWeek('2026-10-12')).toBe(42);
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeek('2026-12-28')).toBe(53);
    expect(isoWeek('2025-12-29')).toBe(1);
  });
});
