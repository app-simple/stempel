import type { IsoWeekday, LocalDate } from '@as/shared';
import { eachDay, isoWeekday } from '@as/shared';

/**
 * Urlaubstage in einem Zeitraum nach § 3 BUrlG und Konzept 4.2 (`leaveDays` im Prototyp).
 *
 * Gezählt werden nur Tage, die laut Vertrag Arbeitstage sind und kein Feiertag. Beide Grenzen
 * inklusive. Liegt `from` nach `to`, ist das Ergebnis 0.
 */
export function countLeaveDays(
  from: LocalDate,
  to: LocalDate,
  workDays: readonly IsoWeekday[],
  holidays: ReadonlySet<LocalDate>,
): number {
  if (from > to) return 0;
  const weekdays = new Set(workDays);
  return eachDay(from, to).filter((date) => weekdays.has(isoWeekday(date)) && !holidays.has(date))
    .length;
}
