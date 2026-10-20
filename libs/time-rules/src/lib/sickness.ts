import type { IsoWeekday, LocalDate } from '@as/shared';
import { addDays, eachDay, isoWeekday, yearOf } from '@as/shared';

/** Eingabe der AU-Fälligkeit (Spezifikation Phase 6, Abschnitt 6). */
export interface CertificateDueInput {
  kind: 'SICK' | 'CHILD_SICK';
  /** Erster Krankheitstag. */
  from: LocalDate;
  /** Letzter (voraussichtlicher) Krankheitstag, inklusive. */
  to: LocalDate;
  /** AU schon ab dem 1. Tag verlangt (§ 5 Abs. 1 Satz 3 EFZG). */
  fromDay1: boolean;
  /**
   * Arbeitstage laut Vertrag (ISO-Wochentage), fest oder je Datum (Vertragswechsel während der
   * Krankheit, Codex-Review Phase 6 Befund 6).
   */
  workDays: readonly IsoWeekday[] | ((date: LocalDate) => readonly IsoWeekday[]);
  holidays: ReadonlySet<LocalDate>;
}

/**
 * Fälligkeit der Arbeitsunfähigkeitsbescheinigung. § 5 Abs. 1 Satz 2 EFZG: dauert die Krankheit länger
 * als drei Kalendertage, ist die AU spätestens am darauffolgenden Arbeitstag vorzulegen, also am ersten
 * Arbeitstag (laut Vertrag, kein Feiertag) ab dem 4. Kalendertag, sofern die Krankheit bis dahin dauert.
 * § 5 Abs. 1 Satz 3 EFZG (`fromDay1`) und § 45 Abs. 1 SGB V (`CHILD_SICK`): ab dem ersten Tag, also am
 * ersten Arbeitstag ab Beginn. Ergebnis null: keine AU nötig. Ohne Arbeitstag innerhalb von 14
 * Kalendertagen einschließlich des Suchbeginns gilt der Starttag selbst.
 */
export function certificateDue(input: CertificateDueInput): LocalDate | null {
  const start = input.fromDay1 || input.kind === 'CHILD_SICK' ? input.from : addDays(input.from, 3);
  if (start > input.to) return null;

  const workDaysAt =
    typeof input.workDays === 'function'
      ? input.workDays
      : () => input.workDays as readonly IsoWeekday[];
  for (let offset = 0; offset < 14; offset++) {
    const date = addDays(start, offset);
    if (workDaysAt(date).includes(isoWeekday(date)) && !input.holidays.has(date)) return date;
  }
  return start;
}

/**
 * Entgeltfortzahlung bis sechs Wochen (§ 3 Abs. 1 EFZG): Datum des 42. Kalendertags einer
 * zusammenhängenden Krankheit, wenn er bis `asOf` (inklusive) und bis `to` erreicht ist, sonst null.
 */
export function sixWeeksReachedOn(
  from: LocalDate,
  to: LocalDate,
  asOf: LocalDate,
): LocalDate | null {
  const reachedOn = addDays(from, 41);
  return reachedOn <= to && reachedOn <= asOf ? reachedOn : null;
}

/** Eingabe der Urlaubsrückbuchung (Spezifikation Phase 6, Abschnitt 6). */
export interface VacationCreditInput {
  sick: { from: LocalDate; to: LocalDate };
  /** AU liegt vor bis einschließlich; null = keine AU vermerkt. */
  certificateUntil: LocalDate | null;
  /** Genehmigte Urlaubsanträge (nur Art VACATION) der Person. */
  vacations: readonly { from: LocalDate; to: LocalDate; startHalf: boolean; endHalf: boolean }[];
  workDays: readonly IsoWeekday[];
  holidays: ReadonlySet<LocalDate>;
}

/**
 * Krankheit im Urlaub (§ 9 BUrlG): durch AU nachgewiesene Krankheitstage werden nicht auf den Urlaub
 * angerechnet. Gezählt werden Tage, die zugleich im Krankheitszeitraum, bis `certificateUntil`, in einem
 * genehmigten Urlaub, an einem Arbeitstag laut Vertrag und nicht an einem Feiertag liegen; ein halber
 * Urlaubstag am Rand zählt einen halben Tag. Ergebnis: halbe Tage je Kalenderjahr (nur Jahre > 0).
 */
export function vacationCreditHalfDays(input: VacationCreditInput): Map<number, number> {
  const byYear = new Map<number, number>();
  if (input.certificateUntil === null) return byYear;

  const end = input.sick.to < input.certificateUntil ? input.sick.to : input.certificateUntil;
  for (const date of eachDay(input.sick.from, end)) {
    if (!input.workDays.includes(isoWeekday(date)) || input.holidays.has(date)) continue;
    const vacation = input.vacations.find((span) => span.from <= date && date <= span.to);
    if (!vacation) continue;

    const half =
      (date === vacation.from && vacation.startHalf) || (date === vacation.to && vacation.endHalf);
    const year = yearOf(date);
    byYear.set(year, (byYear.get(year) ?? 0) + (half ? 1 : 2));
  }
  return byYear;
}
