import { fromLocalDate, toLocalDate } from './dates';

describe('dates', () => {
  it('wandelt lokale Daten verlustfrei hin und zurück', () => {
    expect(toLocalDate(fromLocalDate('2026-03-29'))).toBe('2026-03-29');
    expect(() => fromLocalDate('2026-02-30')).toThrow(RangeError);
  });
});
