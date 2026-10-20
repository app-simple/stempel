import { legalValuesAt, type LegalParameterRow } from './legal-values';

const rows: LegalParameterRow[] = [
  { key: 'MIN_WAGE_HOURLY_CENTS', value: 1460, validFrom: '2027-01-01' },
  { key: 'MIN_WAGE_HOURLY_CENTS', value: 1390, validFrom: '2026-01-01' },
  { key: 'MINIJOB_MONTHLY_LIMIT_CENTS', value: 60300, validFrom: '2026-01-01' },
  { key: 'MINIJOB_MONTHLY_LIMIT_CENTS', value: 63300, validFrom: '2027-01-01' },
];

describe('legalValuesAt', () => {
  it('liefert die Werte am Stichtag unabhängig von der Reihenfolge der Zeilen', () => {
    expect(legalValuesAt(rows, '2026-12-31').current).toEqual({
      minWageHourlyCents: 1390,
      minijobMonthlyLimitCents: 60300,
    });
    expect(legalValuesAt(rows, '2027-01-01').current).toEqual({
      minWageHourlyCents: 1460,
      minijobMonthlyLimitCents: 63300,
    });
  });

  it('liefert bekannte spätere Änderungen', () => {
    expect(legalValuesAt(rows, '2026-10-12').upcoming).toEqual([
      {
        validFrom: '2027-01-01',
        values: { minWageHourlyCents: 1460, minijobMonthlyLimitCents: 63300 },
      },
    ]);
  });

  it('meldet fehlende Werte vor dem ersten Stichtag', () => {
    expect(legalValuesAt(rows, '2025-12-31').current).toBeNull();
  });
});
