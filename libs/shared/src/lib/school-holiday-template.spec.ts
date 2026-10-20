import { schoolHolidaySuggestions } from './school-holiday-template';

describe('schoolHolidaySuggestions', () => {
  it('schlägt die bayerischen Ferien vor, die das Jahr berühren', () => {
    const names = schoolHolidaySuggestions(2027, []).map((s) => `${s.from}–${s.to}`);
    expect(names).toEqual([
      '2026-12-24–2027-01-08',
      '2027-02-08–2027-02-12',
      '2027-03-22–2027-04-02',
      '2027-05-18–2027-05-28',
      '2027-08-02–2027-09-13',
    ]);
  });

  it('nimmt Ferien über den Jahreswechsel in beiden Jahren auf', () => {
    expect(schoolHolidaySuggestions(2026, []).at(-1)).toEqual({
      name: 'Weihnachtsferien',
      from: '2026-12-24',
      to: '2027-01-08',
    });
  });

  it('lässt bereits gepflegte Zeiträume weg', () => {
    const existing = [{ from: '2026-11-02', to: '2026-11-06' }];
    expect(schoolHolidaySuggestions(2026, existing).some((s) => s.from === '2026-11-02')).toBe(
      false,
    );
  });

  it('liefert für Jahre ohne Vorlage nichts', () => {
    expect(schoolHolidaySuggestions(2031, [])).toEqual([]);
  });
});
