import type { LegalParameterKey, LocalDate } from './domain';

export interface LegalValuesSnapshot {
  minWageHourlyCents: number;
  minijobMonthlyLimitCents: number;
}

export interface LegalValuesAt {
  /** Werte am Stichtag, oder null, wenn für den Stichtag nicht alle Werte hinterlegt sind. */
  current: LegalValuesSnapshot | null;
  /** Bekannte spätere Änderungen, aufsteigend nach Datum. */
  upcoming: { validFrom: LocalDate; values: LegalValuesSnapshot }[];
}

export interface LegalParameterRow {
  key: LegalParameterKey;
  value: number;
  validFrom: LocalDate;
}

function valueAt(
  rows: readonly LegalParameterRow[],
  key: LegalParameterKey,
  date: LocalDate,
): number | null {
  let best: LegalParameterRow | null = null;
  for (const row of rows) {
    if (row.key === key && row.validFrom <= date && (!best || row.validFrom > best.validFrom))
      best = row;
  }
  return best?.value ?? null;
}

/** Gesetzliche Werte zu einem Stichtag aus den Zeilen von `LegalParameter` (CLAUDE.md: nie als Konstante). */
export function legalValuesAt(rows: readonly LegalParameterRow[], date: LocalDate): LegalValuesAt {
  const at = (d: LocalDate): LegalValuesSnapshot | null => {
    const minWageHourlyCents = valueAt(rows, 'MIN_WAGE_HOURLY_CENTS', d);
    const minijobMonthlyLimitCents = valueAt(rows, 'MINIJOB_MONTHLY_LIMIT_CENTS', d);
    return minWageHourlyCents === null || minijobMonthlyLimitCents === null
      ? null
      : { minWageHourlyCents, minijobMonthlyLimitCents };
  };
  const later = [...new Set(rows.map((r) => r.validFrom).filter((d) => d > date))].sort();
  const upcoming: LegalValuesAt['upcoming'] = [];
  for (const validFrom of later) {
    const values = at(validFrom);
    if (values) upcoming.push({ validFrom, values });
  }
  return { current: at(date), upcoming };
}
