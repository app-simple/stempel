import type { IsoWeekday, LocalDate } from '@as/shared';
import { berlinInstant, isoWeekday } from '@as/shared';
import { dayWorkMinutes, restBreaks } from './work-time';
import type { LeveledRuleMessage, WorkEntry } from './work-time-types';

/** Volle Lebensjahre am Datum (Geburtstag zählt ab dem Tag selbst; 29.02. im Nichtschaltjahr = 01.03.). */
export function ageOn(birthDate: LocalDate, date: LocalDate): number {
  const years = Number(date.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return years - (date.slice(5) < birthDate.slice(5) ? 1 : 0);
}

/** Jugendlich nach § 2 Abs. 2 JArbSchG: 15, aber noch nicht 18 Jahre alt. Ohne Geburtsdatum false. */
export function isYouthOn(birthDate: LocalDate | null, date: LocalDate): boolean {
  if (birthDate === null) return false;
  const age = ageOn(birthDate, date);
  return age >= 15 && age < 18;
}

/**
 * Mindesturlaub für Jugendliche (§ 19 Abs. 2 JArbSchG) nach dem Alter zu Beginn des Kalenderjahres:
 * unter 16 → 30, unter 17 → 27, unter 18 → 25 Werktage. Umgerechnet auf Arbeitstage wie beim BUrlG:
 * Werktage × Arbeitstage je Woche / 6, aufgerundet. Ab 18 am 1.1. null (keine Jugendregel).
 */
export function youthMinVacationDays(
  workDays: readonly IsoWeekday[],
  ageOnJan1: number,
): number | null {
  if (ageOnJan1 >= 18) return null;
  const weekdays = ageOnJan1 < 16 ? 30 : ageOnJan1 < 17 ? 27 : 25;
  return Math.ceil((weekdays * new Set(workDays).size) / 6);
}

export interface YouthDayInput {
  workDate: LocalDate;
  /** Gültige Buchungen dieses Arbeitstags, beliebige Reihenfolge. */
  entries: readonly WorkEntry[];
  /** Gültige Buchungen der übrigen Tage derselben ISO-Woche (Mo–So), nur Tage mit Jugendstatus. */
  weekEntries: readonly WorkEntry[];
  /** Spätestes Ende der Buchungen vor diesem Arbeitstag, falls vorhanden. */
  previousDayLastEnd: Date | null;
  holidays: ReadonlySet<LocalDate>;
  /** An diesem Tag vollzeitschulpflichtig (§ 2 Abs. 3 JArbSchG). */
  fullTimeSchool: boolean;
  schoolHolidays: readonly { from: LocalDate; to: LocalDate }[];
  /** Verschiedene Arbeitstage im Kalenderjahr bis einschließlich dieses Tags (für § 5 Abs. 4). */
  yearWorkDays: number;
}

/**
 * Prüft einen Arbeitstag einer jugendlichen Person (Spezifikation Phase 7, Abschnitte 4 und 5).
 * Arbeitszeit ohne Ruhepausen (§ 4 Abs. 1), Schichtzeit mit Ruhepausen (§ 4 Abs. 2), Woche Mo–So
 * (§ 4 Abs. 4). Codes mit Präfix `YOUTH_`. Buchungen ohne Ende zählen für Dauer- und Pausenregeln nicht.
 */
export function evaluateYouthDay(input: YouthDayInput): LeveledRuleMessage[] {
  const entries = [...input.entries].sort((a, b) => a.start.getTime() - b.start.getTime());
  const firstEntry = entries[0];
  if (firstEntry === undefined) return [];

  const minutesBetween = (start: Date, end: Date): number =>
    Math.floor((end.getTime() - start.getTime()) / 60_000);
  const messages: LeveledRuleMessage[] = [];
  const report = (
    code: string,
    text: string,
    paragraph: string,
    level: 'crit' | 'warn' = 'crit',
  ): void => {
    messages.push({ code, text, paragraph, level });
  };
  const completed = entries.filter((entry) => entry.end !== null);
  const minutes = dayWorkMinutes(completed);
  const weekDays = new Map<LocalDate, WorkEntry[]>();
  for (const entry of input.weekEntries) {
    if (entry.end === null) continue;
    weekDays.set(entry.workDate, [...(weekDays.get(entry.workDate) ?? []), entry]);
  }
  const weekMinutes = new Map(
    [...weekDays].map(([date, dayEntries]) => [date, dayWorkMinutes(dayEntries)] as const),
  );
  let otherWeekMinutes = 0;
  let previousWeekMinutes = 0;
  let shorterDay = false;
  const workDays = new Set<LocalDate>([input.workDate]);
  for (const [date, total] of weekMinutes) {
    otherWeekMinutes += total;
    if (total > 0 && total < 480) shorterDay = true;
    if (date < input.workDate) previousWeekMinutes += total;
    if (date <= input.workDate) workDays.add(date);
  }

  // § 8 Abs. 2a: Ausgleich über einen anderen Arbeitstag und die gesamte Woche.
  if (minutes > 480) {
    const compensated = minutes <= 510 && shorterDay && otherWeekMinutes + minutes <= 2400;
    report(
      'YOUTH_DAY_8H',
      compensated ? 'Über 8 Std. Arbeitszeit, Ausgleich in der Woche' : 'Über 8 Std. Arbeitszeit',
      compensated ? '§ 8 Abs. 2a JArbSchG' : '§ 8 Abs. 1 JArbSchG',
      compensated ? 'warn' : 'crit',
    );
  }
  if (previousWeekMinutes <= 2400 && previousWeekMinutes + minutes > 2400) {
    report('YOUTH_WEEK_40H', 'Über 40 Std. Arbeitszeit in der Woche', '§ 8 Abs. 1 JArbSchG');
  }

  const breaks = completed.flatMap((entry) => restBreaks(entry));
  let lastEnd: Date | null = null;
  for (const entry of completed) {
    if (lastEnd !== null && minutesBetween(lastEnd, entry.start) >= 15) {
      breaks.push({ start: lastEnd, end: entry.start });
    }
    lastEnd = entry.end;
  }
  breaks.sort((a, b) => a.start.getTime() - b.start.getTime());
  const firstStart = completed[0]?.start;
  let sectionStart = firstStart;
  let breakMinutes = 0;
  let withoutBreakTooLong = false;
  let misplacedBreak = false;
  for (const pause of breaks) {
    if (pause.end === null) continue;
    breakMinutes += minutesBetween(pause.start, pause.end);
    if (sectionStart !== undefined && minutesBetween(sectionStart, pause.start) > 270) {
      withoutBreakTooLong = true;
    }
    if (
      firstStart !== undefined &&
      lastEnd !== null &&
      (minutesBetween(firstStart, pause.start) < 60 || minutesBetween(pause.end, lastEnd) < 60)
    ) {
      misplacedBreak = true;
    }
    sectionStart = pause.end;
  }
  if (
    sectionStart !== undefined &&
    lastEnd !== null &&
    minutesBetween(sectionStart, lastEnd) > 270
  ) {
    withoutBreakTooLong = true;
  }
  const requiredBreakMinutes = minutes > 360 ? 60 : minutes > 270 ? 30 : 0;
  if (breakMinutes < requiredBreakMinutes) {
    report(
      'YOUTH_BREAK',
      `Pause ${breakMinutes} statt ${requiredBreakMinutes} Min.`,
      '§ 11 Abs. 1 JArbSchG',
    );
  }
  if (withoutBreakTooLong) {
    report('YOUTH_NO_BREAK_45', 'Mehr als 4,5 Std. ohne Pause', '§ 11 Abs. 2 JArbSchG');
  }
  if (misplacedBreak) {
    report(
      'YOUTH_BREAK_TIMING',
      'Pause zu nah am Arbeitsbeginn oder Arbeitsende',
      '§ 11 Abs. 2 JArbSchG',
      'warn',
    );
  }
  if (firstStart !== undefined && lastEnd !== null && minutesBetween(firstStart, lastEnd) > 600) {
    report('YOUTH_SHIFT_10H', 'Über 10 Std. Schichtzeit', '§ 12 JArbSchG');
  }
  if (
    input.previousDayLastEnd !== null &&
    minutesBetween(input.previousDayLastEnd, firstEntry.start) < 720
  ) {
    report('YOUTH_REST_12H', 'Weniger als 12 Std. Ruhezeit', '§ 13 JArbSchG');
  }

  // Absolute Berliner Tagesgrenzen erfassen auch Enden am Folgetag und Zeitumstellungen.
  const earliestStart = berlinInstant(input.workDate, '06:00');
  const latestEnd = berlinInstant(input.workDate, '20:00');
  if (
    earliestStart !== null &&
    latestEnd !== null &&
    entries.some(
      (entry) =>
        entry.start < earliestStart ||
        entry.start >= latestEnd ||
        (entry.end !== null && entry.end > latestEnd),
    )
  ) {
    report('YOUTH_NIGHT', 'Arbeit vor 6 Uhr oder nach 20 Uhr', '§ 14 Abs. 1 JArbSchG');
  }
  if (workDays.size >= 6) {
    report('YOUTH_SIX_DAYS', 'Mehr als 5 Arbeitstage in der Woche', '§ 15 JArbSchG');
  }
  const weekday = isoWeekday(input.workDate);
  if (weekday === 6) report('YOUTH_SATURDAY', 'Samstagsarbeit', '§ 16 Abs. 1 JArbSchG');
  if (weekday === 7) report('YOUTH_SUNDAY', 'Sonntagsarbeit', '§ 17 Abs. 1 JArbSchG');
  const holidayEve = ['12-24', '12-31'].includes(input.workDate.slice(5));
  const afternoon = berlinInstant(input.workDate, '14:00');
  const holidayAfternoon =
    holidayEve &&
    afternoon !== null &&
    entries.some(
      (entry) => entry.start >= afternoon || (entry.end !== null && entry.end > afternoon),
    );
  if (input.holidays.has(input.workDate) || holidayAfternoon) {
    report(
      'YOUTH_HOLIDAY',
      holidayAfternoon ? 'Arbeit nach 14 Uhr am 24./31.12.' : 'Feiertagsarbeit',
      '§ 18 Abs. 1 JArbSchG',
    );
  }
  if (input.fullTimeSchool) {
    if (
      !input.schoolHolidays.some(({ from, to }) => from <= input.workDate && input.workDate <= to)
    ) {
      report(
        'YOUTH_SCHOOL_TERM',
        'Beschäftigung nur in den Schulferien zulässig',
        '§ 5 Abs. 1 und 4 JArbSchG, § 2 KindArbSchV',
      );
    }
    if (input.yearWorkDays > 20) {
      report('YOUTH_SCHOOL_DAYS', 'Mehr als 20 Arbeitstage im Kalenderjahr', '§ 5 Abs. 4 JArbSchG');
    } else if (input.yearWorkDays >= 16) {
      report(
        'YOUTH_SCHOOL_DAYS',
        `Ferienarbeit: noch ${20 - input.yearWorkDays} Tage`,
        '§ 5 Abs. 4 JArbSchG',
        'warn',
      );
    }
  }
  return messages;
}

/**
 * Codes der ArbZG-Meldungen aus `evaluateWorkDay`, die bei Jugendlichen entfallen, weil die
 * Jugendregel zum selben Thema strenger ist (keine doppelten Meldungen).
 */
export const ADULT_CODES_REPLACED_FOR_YOUTH: readonly string[] = [
  'MAX_10H',
  'OVER_8H',
  'BREAK_TOO_SHORT',
  'NO_BREAK_6H',
  'REST_PERIOD',
  'HOLIDAY_WORK',
  'SUNDAY_WORK',
];

/**
 * Vorwarnung für eine laufende Buchung (Spezifikation Phase 7, Abschnitt 7): spätester Feierabend
 * (frühestes aus 8 Std. Arbeitszeit, 10 Std. Schichtzeit, 20 Uhr bzw. 14 Uhr am 24./31.12.) und späteste
 * Pause (4,5 Std. nach Beginn bzw. nach dem Ende der letzten Ruhepause ab 15 Min.; null, wenn der
 * Feierabend vorher kommt).
 */
export function youthDayLimits(input: {
  workDate: LocalDate;
  entries: readonly WorkEntry[];
  now: Date;
}): { latestEnd: Date; latestBreak: Date | null } {
  const entries = [...input.entries].sort((a, b) => a.start.getTime() - b.start.getTime());
  const firstStart = entries[0]?.start ?? input.now;
  const minutes = dayWorkMinutes(entries, input.now);
  const breaks = entries.flatMap((entry) =>
    restBreaks({
      start: entry.start,
      end: entry.end ?? input.now,
      breaks: entry.breaks.map((pause) => ({ start: pause.start, end: pause.end ?? input.now })),
    }),
  );
  let previousEnd: Date | null = null;
  for (const entry of entries) {
    if (previousEnd !== null && entry.start.getTime() - previousEnd.getTime() >= 15 * 60_000) {
      breaks.push({ start: previousEnd, end: entry.start });
    }
    previousEnd = entry.end ?? input.now;
  }
  let sectionStart = firstStart;
  for (const pause of breaks) {
    if (pause.end !== null && pause.end > sectionStart) sectionStart = pause.end;
  }
  const holidayEve = ['12-24', '12-31'].includes(input.workDate.slice(5));
  const evening = berlinInstant(input.workDate, holidayEve ? '14:00' : '20:00');
  const latestEnd = new Date(
    Math.min(
      input.now.getTime() + (480 - minutes) * 60_000,
      firstStart.getTime() + 600 * 60_000,
      evening?.getTime() ?? Infinity,
    ),
  );
  // § 11 Abs. 2: nie länger als 4,5 Std. am Stück, unabhängig von schon genommener Pausenzeit.
  const breakDeadline = new Date(sectionStart.getTime() + 270 * 60_000);
  return { latestEnd, latestBreak: breakDeadline < latestEnd ? breakDeadline : null };
}

/**
 * § 19 Abs. 2 JArbSchG: Jugendmindesturlaub nach dem Alter am 1.1. des Jahres, in dem der Vertragsstand
 * beginnt (strengstes Jahr der Geltung, Spezifikation Phase 7 Abschnitt 6). Null, wenn keine
 * Jugendregel greift oder der Urlaub reicht.
 */
export function youthVacationError(
  terms: { validFrom: LocalDate; workDays: readonly IsoWeekday[]; annualLeaveDays: number },
  birthDate: LocalDate | null,
): { code: 'YOUTH_MIN_VACATION'; text: string } | null {
  if (!birthDate) return null;
  const minimum = youthMinVacationDays(
    terms.workDays,
    ageOn(birthDate, `${terms.validFrom.slice(0, 4)}-01-01`),
  );
  if (minimum === null || terms.annualLeaveDays >= minimum) return null;
  return {
    code: 'YOUTH_MIN_VACATION',
    text: `Jahresurlaub unter dem Mindesturlaub für Jugendliche: mindestens ${minimum} Tage (§ 19 Abs. 2 JArbSchG).`,
  };
}
