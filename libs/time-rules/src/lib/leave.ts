import type { LocalDate } from '@as/shared';
import { addDays, diffDays, eachDay, isoWeekday, yearOf } from '@as/shared';
import { countLeaveDays } from './count-leave-days';
import { minVacationDays } from './min-vacation-days';
import { ageOn } from './youth';
import type {
  DatedLeaveTerms,
  EntitlementResult,
  LeaveAccountParts,
  LeaveAccountResult,
  LeaveSpan,
  WorkDaysAt,
} from './leave-types';

/**
 * Gezählte Tage eines Antrags in halben Tagen (§ 3 BUrlG, Konzept 4.2, `leaveDays` im Prototyp).
 *
 * Ein Tag zählt, wenn er laut dem an diesem Tag gültigen Vertragsstand ein Arbeitstag und kein
 * Feiertag ist: 2 halbe Tage, am ersten Tag mit `startHalf` bzw. am letzten Tag mit `endHalf` nur 1.
 * Ein halber Tag, der kein Arbeitstag ist, zählt 0. `from` nach `to` ergibt 0.
 */
export function leaveHalfDays(
  span: LeaveSpan,
  workDaysAt: WorkDaysAt,
  holidays: ReadonlySet<LocalDate>,
): number {
  return leaveHalfDaysByYear(span, workDaysAt, holidays).reduce(
    (total, { halfDays }) => total + halfDays,
    0,
  );
}

/**
 * Gezählte halbe Tage eines Antrags je Kalenderjahr (Konzept 4.4, Entscheidung 5), aufsteigend nach
 * Jahr; Jahre ohne gezählten Tag fehlen.
 */
export function leaveHalfDaysByYear(
  span: LeaveSpan,
  workDaysAt: WorkDaysAt,
  holidays: ReadonlySet<LocalDate>,
): { year: number; halfDays: number }[] {
  if (span.from > span.to) return [];
  const byYear = new Map<number, number>();
  for (const date of eachDay(span.from, span.to)) {
    const workDays = workDaysAt(date);
    if (!workDays?.includes(isoWeekday(date)) || holidays.has(date)) continue;
    const half = (date === span.from && span.startHalf) || (date === span.to && span.endHalf);
    const year = yearOf(date);
    byYear.set(year, (byYear.get(year) ?? 0) + (half ? 1 : 2));
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, halfDays]) => ({ year, halfDays }));
}

/**
 * Jahresurlaubsanspruch nach §§ 3, 4, 5 BUrlG und Entscheidung 12.3 der Spezifikation Phase 3.
 *
 * - Vertragsurlaub (Jahresurlaub + Zusatzurlaub) tagesgenau über die Vertragsstände, gezwölftelt nach
 *   vollen Beschäftigungsmonaten im Jahr.
 * - Gesetzliches Minimum (4 Tage je Wochenarbeitstag) als Untergrenze; voll, wenn die Wartezeit
 *   (§ 4) im Jahr erfüllt ist und kein Austritt bis 30.06. vorliegt, sonst gezwölftelt (§ 5 Abs. 1).
 * - Rundung (§ 5 Abs. 2): Bruchteile ab einem halben Tag auf einen ganzen Tag, kleinere auf einen
 *   halben Tag.
 */
export function annualEntitlement(
  year: number,
  terms: readonly DatedLeaveTerms[],
  entryDate: LocalDate,
  exitDate: LocalDate | null,
  /** Für den Jugendmindesturlaub (§ 19 Abs. 2 JArbSchG, Alter am 1.1. des Jahres), Phase 7. */
  birthDate: LocalDate | null = null,
): EntitlementResult {
  const yearStart = `${year}-01-01`;
  const ageOnJan1 = birthDate === null ? null : ageOn(birthDate, yearStart);
  const yearEnd = `${year}-12-31`;
  const start = entryDate > yearStart ? entryDate : yearStart;
  const end = exitDate !== null && exitDate < yearEnd ? exitDate : yearEnd;
  if (start > end) return { halfDays: 0, fullMonths: 0, basis: 'CONTRACT' };

  // Entscheidung 12.3 c: fehlende Vertragsstände tragen 0 bei, bleiben aber Teil von E.
  const orderedTerms = [...terms].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  let termIndex = 0;
  let current: DatedLeaveTerms | undefined;
  let contractSum = 0;
  let statutorySum = 0;
  for (const date of eachDay(start, end)) {
    let next = orderedTerms[termIndex];
    while (next && next.validFrom <= date) {
      current = next;
      next = orderedTerms[++termIndex];
    }
    if (current) {
      contractSum += current.terms.annualLeaveDays + current.terms.extraLeaveDays;
      statutorySum += minVacationDays(current.terms.workDays, ageOnJan1);
    }
  }

  const afterEnd = addDays(end, 1);
  let fullMonths = 0;
  while (fullMonths < 12 && addMonths(start, fullMonths + 1) <= afterEnd) fullMonths++;

  // §§ 4, 5 Abs. 1 BUrlG: Wartezeit und Austritt bis einschließlich 30.06.
  const waitingPeriodComplete = addDays(addMonths(entryDate, 6), -1) <= end;
  const exitsInFirstHalf =
    exitDate !== null && exitDate >= yearStart && exitDate <= `${year}-06-30`;
  const statutoryMonths = waitingPeriodComplete && !exitsInFirstHalf ? 12 : fullMonths;

  // Gemeinsamer Nenner E × 12: Vergleich und Rundung ohne gerundete Zwischenwerte.
  const denominator = (diffDays(start, end) + 1) * 12;
  const contractNumerator = contractSum * fullMonths;
  const statutoryNumerator = statutorySum * statutoryMonths;
  const numerator = Math.max(contractNumerator, statutoryNumerator);
  const remainder = numerator % denominator;
  const wholeDays = (numerator - remainder) / denominator;
  const halfDays = wholeDays * 2 + (remainder === 0 ? 0 : remainder * 2 >= denominator ? 2 : 1);
  return {
    halfDays,
    fullMonths,
    basis: statutoryNumerator > contractNumerator ? 'STATUTORY_MINIMUM' : 'CONTRACT',
  };
}

/** Volle Beschäftigungsmonate (§§ 4, 5 BUrlG): Tag auf das Zielmonatsende begrenzen. */
function addMonths(date: LocalDate, months: number): LocalDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(year, month + months, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

/** Urlaubskonto wie `account` im Prototyp (Konzept 4.4): Rest = Anspruch + Übertrag + Korrekturen − Genehmigt − Beantragt. */
export function leaveAccount(parts: LeaveAccountParts): LeaveAccountResult {
  const totalHalfDays =
    parts.entitlementHalfDays + parts.carryOverHalfDays + parts.correctionHalfDays;
  return {
    totalHalfDays,
    restHalfDays: totalHalfDays - parts.approvedHalfDays - parts.pendingHalfDays,
  };
}

/**
 * Arbeitstage (Mo–Fr ohne Feiertage) nach `from` bis einschließlich `to`, für die Meldung offener
 * Anträge nach mehr als fünf Arbeitstagen (Konzept 4.2, Entscheidung 12). 0, wenn `to` nicht nach
 * `from` liegt.
 */
export function businessDaysBetween(
  from: LocalDate,
  to: LocalDate,
  holidays: ReadonlySet<LocalDate>,
): number {
  if (to <= from) return 0;
  return countLeaveDays(addDays(from, 1), to, [1, 2, 3, 4, 5], holidays);
}
