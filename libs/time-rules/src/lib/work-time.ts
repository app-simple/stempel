import type { LocalDate } from '@as/shared';
import { diffDays, formatHoursMinutes, isoWeekday, localDateInBerlin } from '@as/shared';
import { dailyTargetMinutes } from './daily-target-minutes';
import type { DayAbsence } from './leave-types';
import type { EmploymentTermsInput } from './types';
import type {
  LateInfo,
  LeveledRuleMessage,
  MinijobMonthResult,
  TimeSpan,
  WorkDayInput,
  WorkEntry,
} from './work-time-types';

function minutesBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 60_000);
}

/**
 * Ruhepausen einer Buchung nach § 4 ArbZG: abgeschlossene Pausen von mindestens 15 Minuten,
 * auf die Buchung begrenzt. Kürzere Unterbrechungen sind keine Ruhepausen.
 */
export function restBreaks(entry: Pick<WorkEntry, 'start' | 'end' | 'breaks'>): TimeSpan[] {
  return entry.breaks
    .flatMap((pause) => {
      if (pause.end === null) return [];
      const start = new Date(Math.max(entry.start.getTime(), pause.start.getTime()));
      const end = new Date(Math.min(entry.end?.getTime() ?? Infinity, pause.end.getTime()));
      return minutesBetween(start, end) >= 15 ? [{ start, end }] : [];
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Arbeitszeit einer Buchung in Minuten nach § 2 Abs. 1 ArbZG: Beginn bis Ende ohne Ruhepausen.
 * Pausen unter 15 Minuten zählen als Arbeitszeit. Bei laufender Buchung gilt `asOf` als Ende,
 * eine laufende Pause zählt bis `asOf`, wenn sie dann schon 15 Minuten dauert.
 */
export function workMinutes(
  entry: Pick<WorkEntry, 'start' | 'end' | 'breaks'>,
  asOf?: Date,
): number {
  const end = entry.end ?? asOf;
  if (end === undefined) return 0;
  const breaks = restBreaks({
    start: entry.start,
    end,
    breaks: entry.breaks.map((pause) => ({
      start: pause.start,
      end: pause.end ?? asOf ?? null,
    })),
  });
  const breakMinutes = breaks.reduce(
    (sum, pause) => sum + (pause.end === null ? 0 : minutesBetween(pause.start, pause.end)),
    0,
  );
  return Math.max(0, minutesBetween(entry.start, end) - breakMinutes);
}

/**
 * Arbeitszeit aller Buchungen eines Tages in Minuten: Summe der Buchungen plus Lücken unter 15 Minuten
 * zwischen ihnen, denn nur Unterbrechungen ab 15 Minuten sind Ruhepausen (§ 2 Abs. 1 und § 4 ArbZG,
 * § 4 Abs. 1 und § 11 JArbSchG). Buchungen ohne Ende zählen nur mit `asOf`.
 */
export function dayWorkMinutes(
  entries: readonly Pick<WorkEntry, 'start' | 'end' | 'breaks'>[],
  asOf?: Date,
): number {
  const sorted = [...entries].sort((a, b) => a.start.getTime() - b.start.getTime());
  let total = 0;
  let previousEnd: Date | null = null;
  for (const entry of sorted) {
    const end = entry.end ?? asOf;
    if (end === undefined) continue;
    total += workMinutes(entry, asOf);
    if (previousEnd !== null) {
      const gap = minutesBetween(previousEnd, entry.start);
      if (gap > 0 && gap < 15) total += gap;
    }
    if (previousEnd === null || end > previousEnd) previousEnd = end;
  }
  return total;
}

/**
 * Prüft einen Arbeitstag wie `entryFlags` im Prototyp, über alle Buchungen des Tages.
 * Buchungen ohne Ende werden für § 3 und § 4 nicht geprüft (wie im Prototyp).
 *
 * - § 3 ArbZG: über 10 Std. Verstoß, über 8 Std. Hinweis „Ausgleich nötig“
 * - § 4 ArbZG: 30 Min. Ruhepause bei mehr als 6 Std., 45 bei mehr als 9 Std.; nicht mehr als
 *   6 Std. hintereinander ohne Ruhepause. Lücken von mindestens 15 Min. zwischen Buchungen desselben
 *   Tages zählen als Ruhepause.
 * - § 5 ArbZG: mindestens 11 Std. Ruhezeit seit dem letzten Ende des Vortags
 * - §§ 9, 10 ArbZG: Sonn- und Feiertagsarbeit als Hinweis
 * - § 17 Abs. 1 MiLoG: bei Minijob Aufzeichnung spätestens am 7. Kalendertag nach dem Arbeitstag
 */
export function evaluateWorkDay(input: WorkDayInput): LeveledRuleMessage[] {
  const entries = [...input.entries].sort((a, b) => a.start.getTime() - b.start.getTime());
  const firstEntry = entries[0];
  if (firstEntry === undefined) return [];

  const messages: LeveledRuleMessage[] = [];
  const completed = entries.filter((entry) => entry.end !== null);
  const minutes = dayWorkMinutes(completed);
  if (minutes > 600) {
    messages.push({
      code: 'MAX_10H',
      level: 'crit',
      text: 'Über 10 Std. Arbeitszeit',
      paragraph: '§ 3 ArbZG',
    });
  } else if (minutes > 480) {
    messages.push({
      code: 'OVER_8H',
      level: 'info',
      text: 'Über 8 Std., Ausgleich nötig',
      paragraph: '§ 3 ArbZG',
    });
  }

  const breaks = completed.flatMap((entry) => restBreaks(entry));
  let previousEnd: Date | null = null;
  for (const entry of completed) {
    if (previousEnd !== null && minutesBetween(previousEnd, entry.start) >= 15) {
      breaks.push({ start: previousEnd, end: entry.start });
    }
    previousEnd = entry.end;
  }
  breaks.sort((a, b) => a.start.getTime() - b.start.getTime());

  let breakMinutes = 0;
  let sectionStart = completed[0]?.start;
  let withoutBreakTooLong = false;
  for (const pause of breaks) {
    if (pause.end === null) continue;
    breakMinutes += minutesBetween(pause.start, pause.end);
    if (sectionStart !== undefined && minutesBetween(sectionStart, pause.start) > 360) {
      withoutBreakTooLong = true;
    }
    sectionStart = pause.end;
  }
  if (
    sectionStart !== undefined &&
    previousEnd !== null &&
    minutesBetween(sectionStart, previousEnd) > 360
  ) {
    withoutBreakTooLong = true;
  }

  const requiredBreakMinutes = minutes > 540 ? 45 : minutes > 360 ? 30 : 0;
  if (breakMinutes < requiredBreakMinutes) {
    messages.push({
      code: 'BREAK_TOO_SHORT',
      level: 'crit',
      text: `Pause ${breakMinutes} statt ${requiredBreakMinutes} Min.`,
      paragraph: '§ 4 ArbZG',
    });
  }
  if (withoutBreakTooLong) {
    messages.push({
      code: 'NO_BREAK_6H',
      level: 'crit',
      text: 'Mehr als 6 Std. ohne Pause',
      paragraph: '§ 4 ArbZG',
    });
  }

  if (input.previousDayLastEnd !== null) {
    const restMinutes = minutesBetween(input.previousDayLastEnd, firstEntry.start);
    if (restMinutes < 660) {
      messages.push({
        code: 'REST_PERIOD',
        level: 'crit',
        text: `Ruhezeit nur ${formatHoursMinutes(restMinutes)} Std.`,
        paragraph: '§ 5 ArbZG',
      });
    }
  }

  if (input.holidays.has(input.workDate)) {
    messages.push({
      code: 'HOLIDAY_WORK',
      level: 'warn',
      text: 'Feiertagsarbeit',
      paragraph: '§ 9 ArbZG',
    });
  } else if (isoWeekday(input.workDate) === 7) {
    messages.push({
      code: 'SUNDAY_WORK',
      level: 'warn',
      text: 'Sonntagsarbeit',
      paragraph: '§ 9 ArbZG',
    });
  }

  if (input.isMinijob) {
    const daysLate = entries.reduce(
      (latest, entry) =>
        Math.max(latest, diffDays(input.workDate, localDateInBerlin(entry.recordedAt))),
      0,
    );
    if (daysLate > 7) {
      messages.push({
        code: 'MINIJOB_LATE',
        level: 'crit',
        text: `Erst nach ${daysLate} Tagen aufgezeichnet`,
        paragraph: '§ 17 MiLoG',
      });
    }
  }
  return messages;
}

/** Minijob-Monat nach § 8 Abs. 1a SGB IV wie `miniMonth`/`meterHtml` im Prototyp. */
export function minijobMonth(
  minutes: number,
  hourlyWageCents: number,
  limitCents: number,
): MinijobMonthResult {
  return minijobMonthFromParts([{ minutes, hourlyWageCents }], limitCents);
}

/**
 * Minijob-Monat mit wechselndem Stundenlohn (§ 8 Abs. 1a SGB IV): jede Arbeitszeit mit dem Lohn ihres
 * Arbeitstags bewerten, dann summieren. Gerundet wird einmal auf den Gesamtbetrag.
 */
export function minijobMonthFromParts(
  parts: readonly { minutes: number; hourlyWageCents: number }[],
  limitCents: number,
): MinijobMonthResult {
  const earningsCents = Math.round(
    parts.reduce((sum, p) => sum + (p.minutes * p.hourlyWageCents) / 60, 0),
  );
  const ratio = earningsCents / limitCents;
  return { earningsCents, ratio, level: ratio > 1 ? 'crit' : ratio >= 0.9 ? 'warn' : 'ok' };
}

/**
 * Soll eines Tages laut Vertragsstand (Konzept 4.1, `soll` im Prototyp): tägliches Soll an
 * Arbeitstagen laut Vertrag, 0 an Feiertagen und freien Tagen, null bei Minijob oder ohne Vertragsstand.
 * Mit genehmigter Abwesenheit wie in Spezifikation Phase 3, Abschnitt 6.6. Krankheit (Phase 6,
 * Abschnitt 5; Lohnausfallprinzip § 4 Abs. 1 EFZG): Soll 0; am Tag des Heimgehens (`sinceMinute`) gilt
 * der Tag als erfüllt, das Soll ist die gearbeitete Zeit (`workedMinutes`), höchstens das Tagessoll.
 */
export function targetMinutesForDay(
  terms: Pick<EmploymentTermsInput, 'type' | 'weeklyMinutes' | 'workDays'> | null,
  date: LocalDate,
  holidays: ReadonlySet<LocalDate>,
  absence: DayAbsence | null = null,
  workedMinutes = 0,
): number | null {
  if (terms === null || terms.type === 'MINIJOB') return null;
  if (holidays.has(date) || !terms.workDays.includes(isoWeekday(date))) return 0;
  const target = dailyTargetMinutes(terms);
  // Urlaub und Sonderurlaub setzen das Soll auf null (Konzept 4.1), am halben Tag auf die Hälfte,
  // abgerundet zugunsten der Beschäftigten. Überstundenabbau lässt das Soll stehen und senkt den Saldo.
  if (target === null || !absence || absence.type === 'OVERTIME_OFF') return target;
  if (absence.type === 'SICK' || absence.type === 'CHILD_SICK' || absence.type === 'NEUTRAL') {
    return absence.sinceMinute == null ? 0 : Math.min(target, Math.max(0, workedMinutes));
  }
  return absence.half ? Math.floor(target / 2) : 0;
}

/** Markierung eines Nachtrags wie `lateInfo` im Prototyp (Konzept 4.1). Stempeluhr: null. */
export function lateInfo(
  entry: Pick<WorkEntry, 'workDate' | 'start' | 'source' | 'recordedAt'>,
): LateInfo | null {
  if (entry.source === 'CLOCK') return null;
  const daysLate = diffDays(entry.workDate, localDateInBerlin(entry.recordedAt));
  return {
    daysLate,
    minutesAfterStart:
      daysLate === 0 ? Math.max(0, minutesBetween(entry.start, entry.recordedAt)) : null,
  };
}
