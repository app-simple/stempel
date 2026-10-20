import type { LegalParameter } from '../../generated/prisma/client';
import { fromLocalDate } from '../common/dates';
import { loadLegalValues } from './legal-values';

const row = (key: LegalParameter['key'], value: number, validFrom: string): LegalParameter => ({
  id: `${key}-${validFrom}`,
  key,
  value,
  validFrom: fromLocalDate(validFrom),
  source: 'Test',
  createdAt: new Date(),
});

const rows = [
  row('MIN_WAGE_HOURLY_CENTS', 1390, '2026-01-01'),
  row('MINIJOB_MONTHLY_LIMIT_CENTS', 60300, '2026-01-01'),
  row('MIN_WAGE_HOURLY_CENTS', 1460, '2027-01-01'),
  row('MINIJOB_MONTHLY_LIMIT_CENTS', 63300, '2027-01-01'),
];
const db = { legalParameter: { findMany: async () => rows } } as unknown as Parameters<
  typeof loadLegalValues
>[0];

describe('loadLegalValues', () => {
  it('liefert die Werte am Stichtag und die bekannten Änderungen danach', async () => {
    const result = await loadLegalValues(db, '2026-10-12');
    expect(result.current).toEqual({ minWageHourlyCents: 1390, minijobMonthlyLimitCents: 60300 });
    expect(result.upcoming).toEqual([
      {
        validFrom: '2027-01-01',
        values: { minWageHourlyCents: 1460, minijobMonthlyLimitCents: 63300 },
      },
    ]);
  });

  it('gilt ab dem Stichtag selbst', async () => {
    const result = await loadLegalValues(db, '2027-01-01');
    expect(result.current?.minWageHourlyCents).toBe(1460);
    expect(result.upcoming).toEqual([]);
    expect((await loadLegalValues(db, '2026-12-31')).current?.minWageHourlyCents).toBe(1390);
  });

  it('meldet fehlende Werte vor dem ersten Stichtag', async () => {
    const result = await loadLegalValues(db, '2025-12-31');
    expect(result.current).toBeNull();
    expect(result.upcoming.map((u) => u.validFrom)).toEqual(['2026-01-01', '2027-01-01']);
  });
});
