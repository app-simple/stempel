import { formatDecimal, formatEuro, formatHalfDays, formatHoursMinutes } from './format';

describe('format', () => {
  it('formatiert Euro aus Cent', () => {
    expect(formatEuro(1390)).toBe('13,90 €');
    expect(formatEuro(60300)).toBe('603,00 €');
  });

  it('formatiert Stunden und Minuten wie der Prototyp', () => {
    expect(formatHoursMinutes(462)).toBe('7:42');
    expect(formatHoursMinutes(0)).toBe('0:00');
    expect(formatHoursMinutes(-90)).toBe('−1:30');
  });

  it('formatiert Dezimalzahlen mit Komma', () => {
    expect(formatDecimal(43.381, 1)).toBe('43,4');
  });

  it('formatiert halbe Tage mit Komma', () => {
    expect(formatHalfDays(5)).toBe('2,5');
    expect(formatHalfDays(4)).toBe('2');
    expect(formatHalfDays(1)).toBe('0,5');
    expect(formatHalfDays(0)).toBe('0');
    expect(formatHalfDays(-3)).toBe('−1,5');
  });
});
