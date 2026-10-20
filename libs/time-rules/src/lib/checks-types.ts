import type { LocalDate } from '@as/shared';

/** Ein Kalendertag im Ausgleichszeitraum nach § 3 ArbZG (Spezifikation Phase 4, Entscheidung 7). */
export interface CompensationDay {
  date: LocalDate;
  /** Gültige Arbeitszeit des Tages in Minuten. */
  workMinutes: number;
  holiday: boolean;
  /** Ganztägige genehmigte Abwesenheit: kein Ausgleichstag. */
  absent: boolean;
}

export interface CompensationResult {
  /** Gezählte Werktage (Mo–Sa ohne Feiertage und Abwesenheiten). */
  workdays: number;
  /** Arbeitszeit an diesen Werktagen. */
  totalMinutes: number;
  /** Durchschnitt je Werktag, kaufmännisch gerundet; null ohne Werktage. */
  averageMinutes: number | null;
  /** Durchschnitt über 8 Stunden (exakt, ohne Rundung verglichen). */
  exceeds: boolean;
}

export interface ForfeitureInput {
  /** Rest des Urlaubsjahres am 31.12. in halben Tagen (Anspruch + Übertrag + Korrekturen − Genehmigt). */
  restAtYearEnd: number;
  /** In das Folgejahr übertragene Tage in halben Tagen (`LeaveCarryOver` des Folgejahres × 2). */
  carriedOver: number;
  /** Im Folgejahr bis einschließlich 31.03. genommene Urlaubstage in halben Tagen. */
  takenByMarch31: number;
}

export interface ForfeitureResult {
  /** Verfall am 31.12. für den nicht übertragenen Rest. */
  atYearEnd: number;
  /** Verfall am 31.03. für übertragene, bis dahin nicht genommene Tage. */
  atMarch31: number;
}
