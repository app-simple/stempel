import type { LocalDate } from './domain';
import type { MinijobMonthView, RuleLevel } from './time-api';

/** Feststellung auf der Prüfseite (Spezifikation Phase 4, Abschnitt 6.1). */
export interface CheckFinding {
  date: LocalDate;
  employeeId: string;
  employeeName: string;
  code: string;
  text: string;
  paragraph: string | null;
  level: Extract<RuleLevel, 'crit' | 'warn'>;
}

/** Ausgleich nach § 3 ArbZG über 24 Wochen (Entscheidung 7). */
export interface CompensationRow {
  employeeId: string;
  employeeName: string;
  from: LocalDate;
  to: LocalDate;
  workdays: number;
  averageMinutes: number | null;
  exceeds: boolean;
}

export interface MinijobCheckRow {
  employeeId: string;
  employeeName: string;
  jobTitle: string | null;
  months: MinijobMonthView[];
}

export interface LeaveNoticeView {
  id: string;
  employeeId: string;
  employeeName: string;
  year: number;
  restHalfDays: number;
  text: string;
  sentAt: string;
  sentByName: string | null;
  /** Zustellung per E-Mail; null = nur in der Anwendung bereitgestellt (z. B. Versandfehler). */
  emailSentAt: string | null;
  readAt: string | null;
  /** Rechtzeitig für den Verfall am 31.12. bzw. am 31.03. des Folgejahres (Entscheidung 3a). */
  timelyForYearEnd: boolean;
  timelyForMarch31: boolean;
}

export interface NoticeStatusRow {
  employeeId: string;
  employeeName: string;
  year: number;
  /** Aktueller Rest in halben Tagen. */
  rest: number;
  latest: LeaveNoticeView | null;
}

export type ForfeitureKind = 'YEAR_END' | 'MARCH31';

/** Vorschlag zum Verfall nach dem Verfallstag (Entscheidung 3, nur Admin). */
export interface ForfeitureSuggestion {
  employeeId: string;
  employeeName: string;
  /** Urlaubsjahr, aus dem die Tage stammen. */
  year: number;
  kind: ForfeitureKind;
  forfeitsOn: LocalDate;
  halfDays: number;
  /** Nur mit rechtzeitigem Hinweis darf gebucht werden. */
  noticeTimely: boolean;
}

export interface ChecksView {
  from: LocalDate;
  to: LocalDate;
  findings: CheckFinding[];
  compensation: CompensationRow[];
  minijob: MinijobCheckRow[];
  notices: {
    year: number;
    rows: NoticeStatusRow[];
    /** Ab 1. Juli an fehlende Hinweise erinnern (Entscheidung 2, geändert am 14.10.2026). */
    reminder: boolean;
    /** Frist für den Verfall zum 31.12. (Hinweis bis 30.09., Entscheidung 3a) verstrichen. */
    yearEndDeadlinePassed: boolean;
  };
  forfeitures: ForfeitureSuggestion[];
}

export interface RetentionSettingsView {
  enabled: boolean;
  timeYears: number;
  payrollYears: number;
  leaveYears: number;
  auditYears: number;
}
