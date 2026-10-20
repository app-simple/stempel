import type { ApiMessage } from './api';
import type { AbsenceType, LocalDate, SickKind } from './domain';

/** Gemeinsame Antworttypen der Zeiterfassung (Phase 2). Zeiten: ISO-Zeitpunkt plus Berliner Uhrzeit. */

export type RuleLevel = 'crit' | 'warn' | 'info';

export interface RuleFlag extends ApiMessage {
  level: RuleLevel;
}

export interface BreakView {
  start: string;
  end: string | null;
  startLocal: string;
  endLocal: string | null;
  /** Eindeutige Eingabewerte für Formulare (zweite Stunde der Zeitumstellung als „HH:MMW“). */
  startInput: string;
  endInput: string | null;
}

export interface CorrectionProposal {
  date: LocalDate;
  start: string;
  end: string | null;
  breaks: { start: string; end: string }[];
}

export interface PendingCorrection {
  id: string;
  kind: 'CORRECT' | 'VOID';
  proposed: CorrectionProposal | null;
  reason: string;
  requestedAt: string;
}

export interface TimeEntryView {
  id: string;
  employeeId: string;
  workDate: LocalDate;
  start: string;
  end: string | null;
  startLocal: string;
  endLocal: string | null;
  /** Eindeutige Eingabewerte für Formulare (zweite Stunde der Zeitumstellung als „HH:MMW“). */
  startInput: string;
  endInput: string | null;
  /** Ende liegt am Folgetag (Entscheidung 3). */
  endsNextDay: boolean;
  breaks: BreakView[];
  /** Alle Pausen in Minuten (auch unter 15 Min.). */
  breakMinutes: number;
  /** Arbeitszeit nach § 2 ArbZG (Pausen unter 15 Min. zählen als Arbeitszeit). */
  workMinutes: number;
  source: 'CLOCK' | 'MANUAL';
  recordedAt: string;
  recordedAtLocal: string;
  /** Name, wenn jemand anderes erfasst hat („Nachtrag durch …“). */
  recordedByName: string | null;
  reason: string | null;
  late: { daysLate: number; minutesAfterStart: number | null } | null;
  voided: boolean;
  pendingCorrection: PendingCorrection | null;
}

/** Genehmigte Abwesenheit an einem Tag (Spezifikation Phase 3, Abschnitt 6.6); nur in eigenen bzw. Teamdaten, nie im Kalender. */
/** Abwesenheit eines Tages; Krankheitsarten nur für die Person, Vorgesetzte und Admin (Phase 6). */
export interface DayAbsenceView {
  type: AbsenceType | SickKind;
  half: boolean;
  /** Krank seit Uhrzeit „HH:MM“ (Tag des Heimgehens), sonst null. */
  sinceLocal?: string | null;
}

export interface DayView {
  date: LocalDate;
  absence: DayAbsenceView | null;
  holidayName: string | null;
  isWorkday: boolean;
  targetMinutes: number | null;
  workMinutes: number;
  balanceMinutes: number | null;
  /** Vergangener Arbeitstag ohne Buchung. */
  missing: boolean;
  entries: TimeEntryView[];
  flags: RuleFlag[];
}

export interface MinijobMonthView {
  month: string;
  workMinutes: number;
  hourlyWageCents: number;
  limitCents: number;
  earningsCents: number;
  ratio: number;
  level: 'ok' | 'warn' | 'crit';
}

export interface WeekView {
  employeeId: string;
  employeeName: string;
  week: string;
  from: LocalDate;
  to: LocalDate;
  days: DayView[];
  totals: { workMinutes: number; targetMinutes: number | null; balanceMinutes: number | null };
  minijob: MinijobMonthView | null;
  closedMonths: string[];
}

export interface MonthView {
  employeeId: string;
  month: string;
  workMinutes: number;
  targetMinutes: number | null;
  balanceMinutes: number | null;
  minijob: MinijobMonthView | null;
  closed: boolean;
}

export type ClockState = 'OUT' | 'IN' | 'PAUSE';

export interface TodayView {
  serverTime: string;
  date: LocalDate;
  state: ClockState;
  /** Beginn der laufenden Buchung bzw. Pause, Berliner Uhrzeit. */
  since: string | null;
  isWorkday: boolean;
  absence: DayAbsenceView | null;
  workedMinutes: number;
  entries: TimeEntryView[];
  week: { workMinutes: number; targetMinutes: number | null; balanceUntilYesterday: number | null };
  minijob: MinijobMonthView | null;
  overtime: OvertimeView | null;
  recentFlags: { date: LocalDate; flags: RuleFlag[] }[];
  /** Nur für Jugendliche mit laufender Buchung: Vorwarnung als Berliner Uhrzeit (Phase 7, Abschnitt 7). */
  youthLimits: { latestEnd: string; latestBreak: string | null } | null;
}

export interface ClockResult {
  today: TodayView;
  /** Hinweise zum gerade beendeten Arbeitstag (nur bei „Gehen“). */
  flags: RuleFlag[];
  /** Die gerade geschlossene Buchung (nur bei „Gehen“), auch wenn sie zum Vortag gehört. */
  closed: TimeEntryView | null;
}

/** ABSENT: genehmigte Abwesenheit, ohne Grund (Phase 3). */
/** SICK nur für Vorgesetzte und Admin (eigenes Team bzw. alle), Spezifikation Phase 6, Abschnitt 8. */
export type TeamPresence =
  'PRESENT' | 'PAUSE' | 'LEFT' | 'NOT_WORKDAY' | 'MISSING' | 'ABSENT' | 'SICK';

export interface TeamTodayRow {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  presence: TeamPresence;
  since: string | null;
}

export interface ManualEntryInput {
  employeeId?: string;
  date: LocalDate;
  start: string;
  /** Nur für heute optional. Liegt die Uhrzeit vor Beginn, gilt sie für den Folgetag. */
  end: string | null;
  breaks: { start: string; end: string }[];
  reason: string;
}

export interface EntrySaveResult {
  entry: TimeEntryView;
  flags: RuleFlag[];
}

export interface CorrectionInput {
  start: string;
  end: string | null;
  breaks: { start: string; end: string }[];
  reason: string;
}

/** Ergebnis einer Korrektur: sofort wirksam oder als Antrag. */
export interface CorrectionResult {
  applied: boolean;
  entry: TimeEntryView;
  request: CorrectionRequestView | null;
}

export interface CorrectionRequestView {
  id: string;
  entryId: string;
  employeeId: string;
  employeeName: string;
  workDate: LocalDate;
  kind: 'CORRECT' | 'VOID';
  current: { start: string; end: string | null; breakMinutes: number };
  proposed: CorrectionProposal | null;
  reason: string;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

export interface RevisionView {
  id: string;
  changedAt: string;
  changedByName: string | null;
  reason: string;
  before: unknown;
  after: unknown;
}

export interface MonthClosingView {
  month: string;
  confirmedAt: string;
  reopenedAt: string | null;
}

export interface OvertimeView {
  since: LocalDate;
  balanceMinutes: number;
  adjustments: {
    id: string;
    minutes: number;
    effectiveOn: LocalDate;
    reason: string;
    createdAt: string;
  }[];
}
