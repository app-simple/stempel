import type { LocalDate } from '@as/shared';

/** Buchung, soweit der gelernte Beginn sie braucht (Spezifikation Phase 5, Abschnitt 5). */
export interface StartSample {
  workDate: LocalDate;
  start: Date;
  source: 'CLOCK' | 'MANUAL';
  voided: boolean;
}

export interface ClockInDueInput {
  now: Date;
  /** Heute in Europe/Berlin. */
  date: LocalDate;
  /** Gelernter Beginn „HH:MM“ oder null (dann Standardzeit). */
  usualStart: string | null;
  defaultStart: string;
  /** Arbeitstag laut Vertrag. */
  isWorkday: boolean;
  holiday: boolean;
  /** Genehmigte Abwesenheit heute, auch halbtägig (Entscheidung 6). */
  absent: boolean;
  /** Heute gibt es schon eine gültige Buchung (auch eine laufende). */
  hasEntry: boolean;
  /** „Heute nicht erinnern“. */
  muted: boolean;
  /** Zeitpunkt der ersten Erinnerung, falls schon gesendet. */
  stage1SentAt: Date | null;
  stage2Sent: boolean;
}

export interface ClockOutDueInput {
  now: Date;
  /** Beginn der offenen Buchung oder null. */
  openSince: Date | null;
  stage1SentAt: Date | null;
  stage2Sent: boolean;
}

export interface MinijobRecordingInput {
  today: LocalDate;
  /** Vertragliche Arbeitstage der letzten Tage ohne Feiertage und ohne Abwesenheit. */
  workDays: readonly LocalDate[];
  /** Tage mit gültiger Buchung. */
  recordedDates: ReadonlySet<LocalDate>;
  /** Bereits gesendete Erinnerungen als „JJJJ-MM-TT:Stufe“. */
  sent: ReadonlySet<string>;
}

export interface LateEntrySample {
  source: 'CLOCK' | 'MANUAL';
  voided: boolean;
  /** Wie `lateInfo`: Tage Verzug und Minuten nach Beginn (nur am selben Tag). */
  late: { daysLate: number; minutesAfterStart: number | null } | null;
}

export interface LateEntryThresholds {
  minCount: number;
  minPercent: number;
}

export interface LateEntryStats {
  /** Gültige Buchungen im Zeitraum. */
  entries: number;
  /** Davon Nachträge. */
  late: number;
  /** Anteil in Prozent, kaufmännisch gerundet; 0 ohne Buchungen. */
  percent: number;
  /** Ø Minuten zwischen Beginn und Erfassung, nur Nachträge am selben Tag; null ohne solche. */
  averageDelayMinutes: number | null;
  /** Auffällig ab beiden Schwellen (Konzept 4.1, Entscheidung 8). */
  flagged: boolean;
}
