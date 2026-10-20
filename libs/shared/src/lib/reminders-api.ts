import type { LocalDate } from './domain';

/** Banner in „Heute“ (Spezifikation Phase 5, Abschnitt 6.1). */
export interface ReminderTodayView {
  clockIn: {
    /** Erinnerung jetzt fällig (Banner zeigen). */
    due: boolean;
    /** Beginn, nach dem erinnert wird („HH:MM“). */
    start: string;
    /** Aus eigenen Stempelzeiten gelernt (sonst Standardzeit). */
    learned: boolean;
    muted: boolean;
  } | null;
  /** Offene Buchung seit über 10 Stunden. */
  clockOutDue: boolean;
}

export interface PushDeviceView {
  id: string;
  deviceName: string;
  createdAt: string;
  lastSuccessAt: string | null;
  /** SHA-256 des Endpunkts (hex), damit der Browser „dieses Gerät“ erkennt, ohne den Endpunkt zu erfahren. */
  endpointHash: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceName: string;
}

/** Auswertung der Nachträge je Person (Konzept 4.1, Entscheidung 8). */
export interface LateEntryRow {
  employeeId: string;
  employeeName: string;
  entries: number;
  late: number;
  percent: number;
  averageDelayMinutes: number | null;
  flagged: boolean;
}

export interface LateEntriesView {
  from: LocalDate;
  to: LocalDate;
  thresholds: { minCount: number; minPercent: number; weeks: number };
  rows: LateEntryRow[];
}

export interface ReminderSettingsView {
  defaultStart: string;
  lateFlagMinCount: number;
  lateFlagMinPercent: number;
  lateFlagWeeks: number;
}
