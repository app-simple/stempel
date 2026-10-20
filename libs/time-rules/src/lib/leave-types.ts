import type { AbsenceType, IsoWeekday, LocalDate, SickKind } from '@as/shared';
import type { EmploymentTermsInput } from './types';

/** Zeitraum eines Abwesenheitsantrags; beide Grenzen inklusive (Spezifikation Phase 3, Abschnitt 4). */
export interface LeaveSpan {
  from: LocalDate;
  to: LocalDate;
  /** Erster Tag zählt nur halb. */
  startHalf: boolean;
  /** Letzter Tag zählt nur halb. */
  endHalf: boolean;
}

/** Arbeitstage des am Tag gültigen Vertragsstands; null = kein Vertragsstand (vor Eintritt). */
export type WorkDaysAt = (date: LocalDate) => readonly IsoWeekday[] | null;

/** Vertragsstand mit Stichtag, soweit der Urlaubsanspruch ihn braucht. */
export interface DatedLeaveTerms {
  validFrom: LocalDate;
  terms: Pick<EmploymentTermsInput, 'workDays' | 'annualLeaveDays' | 'extraLeaveDays'>;
}

export interface EntitlementResult {
  /** Jahresanspruch in halben Tagen, gerundet nach Entscheidung 12.3 d. */
  halfDays: number;
  /** Volle Beschäftigungsmonate im Jahr (12 bei ganzjähriger Beschäftigung). */
  fullMonths: number;
  /** Welcher Wert gilt: anteiliger Vertragsurlaub oder das gesetzliche Minimum als Untergrenze. */
  basis: 'CONTRACT' | 'STATUTORY_MINIMUM';
}

export interface LeaveAccountParts {
  entitlementHalfDays: number;
  carryOverHalfDays: number;
  /** Summe der Korrekturbuchungen mit Vorzeichen. */
  correctionHalfDays: number;
  approvedHalfDays: number;
  pendingHalfDays: number;
}

export interface LeaveAccountResult {
  /** Anspruch + Übertrag + Korrekturen. */
  totalHalfDays: number;
  /** Rest nach genehmigten und beantragten Tagen, kann negativ sein (Entscheidung 5). */
  restHalfDays: number;
}

/**
 * Genehmigte Abwesenheit oder Krankheit an einem Tag, für das Soll (Spezifikation Phase 3, Abschnitt
 * 6.6; Phase 6, Abschnitt 5). Krankheit hat am selben Tag Vorrang vor Urlaub.
 */
export interface DayAbsence {
  type: AbsenceType | SickKind;
  /** Nur ein halber Tag (Entscheidung 2); bei Krankheit immer false. */
  half: boolean;
  /** Krankheit ab dieser Minute des Tages (Heimgehen während der Arbeit); sonst null bzw. fehlend. */
  sinceMinute?: number | null;
}
