import type { AbsenceType, LeaveStatus, LocalDate } from './domain';

/** Tage in halben Tagen (Spezifikation Phase 3, Abschnitt 4); Anzeige mit `formatHalfDays`. */
export type HalfDays = number;

export interface LeaveInput {
  type: AbsenceType;
  from: LocalDate;
  to: LocalDate;
  startHalf: boolean;
  endHalf: boolean;
  note?: string | null;
  /** Eintragen für eine andere Person (Vorgesetzte für ihr Team, Admin für alle; Entscheidung 6). */
  employeeId?: string;
}

export interface LeaveYearEffect {
  year: number;
  halfDays: HalfDays;
  /** Nur bei Urlaub: Rest vor und nach diesem Antrag (Beantragtes schon abgezogen). */
  restBefore: HalfDays | null;
  restAfter: HalfDays | null;
}

export interface LeavePreview {
  halfDays: HalfDays;
  years: LeaveYearEffect[];
  /** Feiertage an Arbeitstagen im Zeitraum, die nicht gezählt werden. */
  skippedHolidays: { date: LocalDate; name: string }[];
  /** Blockieren das Speichern, z. B. „In diesem Zeitraum liegt keiner deiner Arbeitstage.“ */
  errors: string[];
  /** Blockieren nicht, z. B. „Das übersteigt dein Urlaubskonto.“ (Entscheidung 5) */
  warnings: string[];
  /** Antrag gilt sofort als genehmigt (Eintragen für andere, Admin für sich). */
  immediate: boolean;
  /** Wer entscheidet, für den Hinweis im Formular; null bei `immediate`. */
  deciderName: string | null;
}

export interface LeaveOverlap {
  employeeName: string;
  from: LocalDate;
  to: LocalDate;
  status: Extract<LeaveStatus, 'PENDING' | 'APPROVED'>;
}

/** Zusatzangaben für Entscheidende (Konzept 4.2 Schritt 3). */
export interface LeaveDecisionContext {
  /** Rest je betroffenem Jahr nach Genehmigung; null außer bei Urlaub. */
  restAfter: { year: number; rest: HalfDays }[] | null;
  /** Gleichzeitig abwesend im Team der antragstellenden Person (nur Personen im eigenen Sichtbereich). */
  overlaps: LeaveOverlap[];
  /** Weitere Überschneidungen außerhalb des Sichtbereichs (z. B. bei einer Vertretung), nur als Anzahl. */
  otherOverlaps: number;
  /** Arbeitstage seit dem Antrag (Meldung ab mehr als fünf, Entscheidung 12). */
  openBusinessDays: number;
}

export interface LeaveRequestView {
  id: string;
  employeeId: string;
  employeeName: string;
  jobTitle: string | null;
  type: AbsenceType;
  from: LocalDate;
  to: LocalDate;
  startHalf: boolean;
  endHalf: boolean;
  /** Beim Antrag berechnet. */
  halfDays: HalfDays;
  /** Nach aktuellem Stand von Feiertagen und Vertrag (Entscheidung 14). */
  currentHalfDays: HalfDays;
  note: string | null;
  status: LeaveStatus;
  requestedAt: string;
  /** Gesetzt, wenn eine andere Person eingetragen hat („eingetragen durch …“). */
  enteredByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  /** Darf die anfragende Person entscheiden bzw. die Stornierung bestätigen? */
  canDecide: boolean;
  /** Nur wenn `canDecide`. */
  decision: LeaveDecisionContext | null;
}

export interface LeaveAccountView {
  employeeId: string;
  employeeName: string;
  year: number;
  entitlement: HalfDays;
  /** Anspruch aus dem gesetzlichen Minimum statt aus dem Vertrag (Entscheidung 3 b). */
  entitlementBasis: 'CONTRACT' | 'STATUTORY_MINIMUM';
  carryOver: HalfDays;
  corrections: HalfDays;
  approved: HalfDays;
  pending: HalfDays;
  rest: HalfDays;
  /** Arbeitstage je Woche und Art laut aktuellem Vertragsstand, für die Kontenliste. */
  workDaysPerWeek: number;
  employmentType: string | null;
}

export type CalendarCell = {
  status: Extract<LeaveStatus, 'PENDING' | 'APPROVED'>;
  /** Halber Tag; die Art der Abwesenheit steht nie im Kalender. */
  half: boolean;
} | null;

export interface CalendarRow {
  employeeId: string;
  name: string;
  /** Je Tag des Monats; null = nicht abwesend. */
  cells: CalendarCell[];
  /** Tage ohne Arbeit laut Vertrag (Index wie `days`). */
  offDays: boolean[];
}

export interface LeaveCalendarView {
  month: string;
  days: { date: LocalDate; weekday: number; holidayName: string | null }[];
  rows: CalendarRow[];
  /** Nur für Mitarbeiter: Anzahl genehmigter Abwesenheiten im eigenen Team je Tag, ohne Namen. */
  teamAbsentCounts: number[] | null;
}

export interface LeaveLedgerView {
  id: string;
  year: number;
  kind: 'CORRECTION' | 'FORFEIT' | 'SICK_CREDIT';
  halfDays: HalfDays;
  note: string;
  createdAt: string;
  createdByName: string | null;
}

export interface LeaveLedgerInput {
  year: number;
  halfDays: HalfDays;
  note: string;
}
