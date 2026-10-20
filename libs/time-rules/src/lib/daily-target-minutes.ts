import type { EmploymentTermsInput } from './types';

/**
 * Tägliches Soll in Minuten an einem Arbeitstag laut Vertrag (Konzept 4.1 und 4.3).
 *
 * `round(weeklyMinutes / Anzahl verschiedener Arbeitstage)`. Bei Minijob gibt es kein Soll (`null`),
 * wie im Prototyp (`soll`). Ohne Arbeitstage ebenfalls `null`.
 * Die Obergrenze von 10 Std. je Werktag (§ 3 ArbZG) prüft `validateEmploymentTerms`.
 */
export function dailyTargetMinutes(
  terms: Pick<EmploymentTermsInput, 'type' | 'weeklyMinutes' | 'workDays'>,
): number | null {
  const dayCount = new Set(terms.workDays).size;
  return terms.type === 'MINIJOB' || dayCount === 0
    ? null
    : Math.round(terms.weeklyMinutes / dayCount);
}
