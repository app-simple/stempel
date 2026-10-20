import type { LocalDate } from '@as/shared';
import type { RuleMessage } from './types';

/** Zeitraum mit UTC-Zeitpunkten; `end` null heißt: läuft noch. */
export interface TimeSpan {
  start: Date;
  end: Date | null;
}

/** Buchung, soweit die Regeln sie brauchen. */
export interface WorkEntry {
  /** Arbeitstag = lokales Datum des Beginns in Europe/Berlin. */
  workDate: LocalDate;
  start: Date;
  end: Date | null;
  breaks: readonly TimeSpan[];
  source: 'CLOCK' | 'MANUAL';
  /** Erfassungszeitpunkt (Serverzeit). */
  recordedAt: Date;
}

export type RuleLevel = 'crit' | 'warn' | 'info';

export interface LeveledRuleMessage extends RuleMessage {
  level: RuleLevel;
}

export interface WorkDayInput {
  workDate: LocalDate;
  /** Gültige Buchungen dieses Arbeitstags, beliebige Reihenfolge. */
  entries: readonly WorkEntry[];
  /** Spätestes Ende der Buchungen des Vortags, falls vorhanden. */
  previousDayLastEnd: Date | null;
  holidays: ReadonlySet<LocalDate>;
  isMinijob: boolean;
}

export interface MinijobMonthResult {
  earningsCents: number;
  /** Verdienst / Grenze, z. B. 0.93. */
  ratio: number;
  level: 'ok' | 'warn' | 'crit';
}

export interface LateInfo {
  /** Kalendertage zwischen Arbeitstag und Erfassung (Europe/Berlin). */
  daysLate: number;
  /** Nur bei Erfassung am selben Tag: Minuten zwischen Beginn und Erfassung. */
  minutesAfterStart: number | null;
}
