import type { IsoWeekday } from '@as/shared';
import { youthMinVacationDays } from './youth';

/**
 * Gesetzlicher Mindesturlaub nach § 3 Abs. 1 BUrlG.
 *
 * 24 Werktage bei einer 6-Tage-Woche, also 4 Tage je Wochenarbeitstag; gilt auch für
 * Teilzeit und Minijob. Doppelte Wochentage zählen einmal. Keine Arbeitstage → 0.
 * Mit dem Alter zu Beginn des Kalenderjahres gilt für Jugendliche zusätzlich § 19 Abs. 2 JArbSchG;
 * maßgeblich ist der höhere Wert (Phase 7).
 */
export function minVacationDays(
  workDays: readonly IsoWeekday[],
  ageOnJan1: number | null = null,
): number {
  const adultMinimum = 4 * new Set(workDays).size;
  const youthMinimum = ageOnJan1 === null ? null : youthMinVacationDays(workDays, ageOnJan1);
  return Math.max(adultMinimum, youthMinimum ?? 0);
}
