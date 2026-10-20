import type { LocalDate, SickKind } from './domain';

/**
 * Krankmeldung, sichtbar für die Person, ihre Vorgesetzte und den Admin (Spezifikation Phase 6,
 * Abschnitte 2 und 3). Keine Gründe, keine Diagnosen.
 */
export interface SickLeaveView {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: Exclude<SickKind, 'NEUTRAL'>;
  from: LocalDate;
  to: LocalDate;
  /** Krank seit Uhrzeit „HH:MM“ am ersten Tag (Heimgehen), sonst null. */
  sinceLocal: string | null;
  /** AU liegt vor bis einschließlich; null = kein Vermerk. */
  certificateUntil: LocalDate | null;
  /** Tag, an dem die AU vorzulegen ist; null = keine AU nötig. */
  certificateDue: LocalDate | null;
  /** AU fällig, aber für den bisherigen Zeitraum nicht (vollständig) vermerkt. */
  certificateMissing: boolean;
  reportedByName: string | null;
  reportedAt: string;
  /** Darf die anfragende Person den AU-Vermerk setzen (Vorgesetzte, Admin)? */
  canCertify: boolean;
}

export interface SickLeaveInput {
  /** Ohne Angabe: die anfragende Person selbst. */
  employeeId?: string;
  kind: Exclude<SickKind, 'NEUTRAL'>;
  from: LocalDate;
  to: LocalDate;
  /** Nur bei Beginn heute: krank ab jetzt (Heimgehen während der Arbeit), Serverzeit. */
  sinceNow?: boolean;
}

/** Ende ändern oder „wieder gesund“ (Ende gestern bzw. am ersten Tag). */
export interface SickLeaveUpdate {
  to?: LocalDate;
  endToday?: boolean;
}

/** Abschnitt „Krankmeldungen“ in „Prüfungen“ (Spezifikation Phase 6, Abschnitt 8). */
export interface SickChecksView {
  /** AU fällig, aber nicht (vollständig) vermerkt; Vorgesetzte: eigenes Team, Admin: alle. */
  certificateMissing: SickLeaveView[];
  /** Krankheit im genehmigten Urlaub ohne AU-Vermerk (keine Rückbuchung). */
  vacationWithoutCertificate: SickLeaveView[];
  /** Sechs Wochen zusammenhängend krank (§ 3 Abs. 1 EFZG); nur Admin, sonst null. */
  sixWeeks:
    { employeeId: string; employeeName: string; from: LocalDate; reachedOn: LocalDate }[] | null;
  /** Krankheit mit AU während genehmigten Überstundenabbaus (Hinweis, keine Rückbuchung); nur Admin. */
  overtimeOffDuringSickness: SickLeaveView[] | null;
  /** Krankheitstage (Kalendertage) der letzten 12 Monate je Person; nur Admin, sonst null. */
  lastYear:
    { employeeId: string; employeeName: string; sickDays: number; childSickDays: number }[] | null;
}
