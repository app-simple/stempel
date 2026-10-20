import {
  addDays,
  berlinTime,
  berlinTimeInput,
  eachDay,
  mondayOf,
  isoWeekday,
  localDateInBerlin,
  type BreakView,
  type DayView,
  type LocalDate,
  type PendingCorrection,
  type RuleFlag,
  type TimeEntryView,
} from '@as/shared';
import {
  ADULT_CODES_REPLACED_FOR_YOUTH,
  evaluateWorkDay,
  evaluateYouthDay,
  isYouthOn,
  lateInfo,
  targetMinutesForDay,
  workMinutes,
  type DayAbsence,
  type WorkEntry,
} from '@as/time-rules';
import type { Prisma, TimeEntry, TimeEntryBreak } from '../../generated/prisma/client';
import { toLocalDate } from '../common/dates';
import { termsAt, type HolidayLookup, type TimeSubject, type YouthContext } from './time-context';

export const entryInclude = {
  breaks: { orderBy: { startAt: 'asc' } },
  corrections: { where: { status: 'PENDING' } },
} satisfies Prisma.TimeEntryInclude;

export type EntryRow = TimeEntry & {
  breaks: TimeEntryBreak[];
  corrections: {
    id: string;
    kind: 'CORRECT' | 'VOID';
    proposed: Prisma.JsonValue;
    reason: string;
    requestedAt: Date;
  }[];
};

export function toWorkEntry(row: EntryRow): WorkEntry {
  return {
    workDate: toLocalDate(row.workDate),
    start: row.startAt,
    end: row.endAt,
    breaks: row.breaks.map((b) => ({ start: b.startAt, end: b.endAt })),
    source: row.source,
    recordedAt: row.recordedAt,
  };
}

function breakView(b: TimeEntryBreak): BreakView {
  return {
    start: b.startAt.toISOString(),
    end: b.endAt?.toISOString() ?? null,
    startLocal: berlinTime(b.startAt),
    endLocal: b.endAt ? berlinTime(b.endAt) : null,
    startInput: berlinTimeInput(b.startAt),
    endInput: b.endAt ? berlinTimeInput(b.endAt) : null,
  };
}

/** Buchung für die Oberfläche. Begründungen sehen nur Personen, die die Buchung ohnehin sehen dürfen. */
export function toEntryView(
  row: EntryRow,
  now: Date,
  names: ReadonlyMap<string, string>,
): TimeEntryView {
  const pending = row.corrections[0];
  const correction: PendingCorrection | null = pending
    ? {
        id: pending.id,
        kind: pending.kind,
        proposed: pending.proposed as PendingCorrection['proposed'],
        reason: pending.reason,
        requestedAt: pending.requestedAt.toISOString(),
      }
    : null;
  const allBreaks = row.breaks.reduce(
    (sum, b) =>
      sum + Math.max(0, Math.floor(((b.endAt ?? now).getTime() - b.startAt.getTime()) / 60_000)),
    0,
  );
  return {
    id: row.id,
    employeeId: row.employeeId,
    workDate: toLocalDate(row.workDate),
    start: row.startAt.toISOString(),
    end: row.endAt?.toISOString() ?? null,
    startLocal: berlinTime(row.startAt),
    endLocal: row.endAt ? berlinTime(row.endAt) : null,
    startInput: berlinTimeInput(row.startAt),
    endInput: row.endAt ? berlinTimeInput(row.endAt) : null,
    endsNextDay: row.endAt !== null && localDateInBerlin(row.endAt) !== toLocalDate(row.workDate),
    breaks: row.breaks.map(breakView),
    breakMinutes: allBreaks,
    workMinutes: workMinutes(toWorkEntry(row), now),
    source: row.source,
    recordedAt: row.recordedAt.toISOString(),
    recordedAtLocal: berlinTime(row.recordedAt),
    recordedByName:
      row.recordedById !== row.employeeId ? (names.get(row.recordedById) ?? null) : null,
    reason: row.reason,
    late: lateInfo(toWorkEntry(row)),
    voided: row.voidedAt !== null,
    pendingCorrection: correction,
  };
}

export function flagsFor(
  date: LocalDate,
  rows: readonly EntryRow[],
  subject: TimeSubject,
  holidays: HolidayLookup,
  youth?: YouthContext,
): RuleFlag[] {
  const valid = rows.filter((r) => r.voidedAt === null);
  const today = valid.filter((r) => toLocalDate(r.workDate) === date);
  // Ruhezeit seit dem tatsächlich letzten Ende vor diesem Arbeitstag, auch wenn die Buchung früher begann (Befund 10).
  const firstStart = today.reduce<Date | null>(
    (min, r) => (!min || r.startAt < min ? r.startAt : min),
    null,
  );
  const previousDayLastEnd = valid
    .filter(
      (r) =>
        toLocalDate(r.workDate) < date &&
        r.endAt !== null &&
        (!firstStart || r.endAt <= firstStart),
    )
    .reduce<Date | null>(
      (latest, r) => (r.endAt && (!latest || r.endAt > latest) ? r.endAt : latest),
      null,
    );
  const adult = evaluateWorkDay({
    workDate: date,
    entries: today.map(toWorkEntry),
    previousDayLastEnd,
    holidays: holidays.dates,
    isMinijob: termsAt(subject.terms, date)?.type === 'MINIJOB',
  });
  if (!isYouthOn(subject.birthDate, date)) return adult;
  // Jugendarbeitsschutz (Phase 7): strengere Regeln ersetzen die ArbZG-Meldungen zum selben Thema.
  const monday = mondayOf(date);
  const sunday = addDays(monday, 6);
  const weekEntries = valid
    .filter((r) => {
      const day = toLocalDate(r.workDate);
      return day >= monday && day <= sunday && day !== date && isYouthOn(subject.birthDate, day);
    })
    .map(toWorkEntry);
  const fullTimeSchool =
    subject.fullTimeSchoolUntil !== null && date <= subject.fullTimeSchoolUntil;
  const year = date.slice(0, 4);
  const worked = new Set(
    [...(youth?.workedDates ?? [])].filter((d) => d.startsWith(year) && d <= date),
  );
  if (today.length) worked.add(date);
  return [
    ...adult.filter((m) => !ADULT_CODES_REPLACED_FOR_YOUTH.includes(m.code)),
    ...evaluateYouthDay({
      workDate: date,
      entries: today.map(toWorkEntry),
      weekEntries,
      previousDayLastEnd,
      holidays: holidays.dates,
      fullTimeSchool,
      schoolHolidays: youth?.schoolHolidays ?? [],
      yearWorkDays: worked.size,
    }),
  ];
}

/**
 * Tage eines Zeitraums auswerten. `rows` müssen die zwei Tage vor dem ersten Tag enthalten (Ruhezeit nach
 * Nachtschichten von bis zu 24 Std.).
 */
export function buildDays(
  from: LocalDate,
  to: LocalDate,
  rows: readonly EntryRow[],
  subject: TimeSubject,
  holidays: HolidayLookup,
  now: Date,
  names: ReadonlyMap<string, string>,
  absences: ReadonlyMap<LocalDate, DayAbsence> = new Map(),
  youth?: YouthContext,
): DayView[] {
  const today = localDateInBerlin(now);
  return eachDay(from, to).map((date) => {
    const terms = termsAt(subject.terms, date);
    const dayRows = rows.filter((r) => toLocalDate(r.workDate) === date);
    const valid = dayRows.filter((r) => r.voidedAt === null);
    const work = valid.reduce((sum, r) => sum + workMinutes(toWorkEntry(r), now), 0);
    const employed = date >= subject.entryDate && (!subject.exitDate || date <= subject.exitDate);
    const isWorkday =
      !!terms && terms.workDays.includes(isoWeekday(date)) && !holidays.dates.has(date);
    // Abwesenheit zählt nur an Arbeitstagen (Spezifikation Phase 3, Abschnitt 6.6).
    const absence = (isWorkday && employed && absences.get(date)) || null;
    const target = employed
      ? targetMinutesForDay(terms, date, holidays.dates, absence, work)
      : null;
    const flags = flagsFor(date, rows, subject, holidays, youth);
    // Am Tag des Heimgehens ist die Arbeit vor der Krankheit normal (Phase 6, Abschnitt 5).
    if (absence && !absence.half && absence.sinceMinute == null && valid.length > 0)
      flags.push({ code: 'ABSENCE_WORK', text: ABSENCE_WORK_TEXT[absence.type], level: 'info' });
    return {
      date,
      absence: absence
        ? {
            type: absence.type,
            half: absence.half,
            sinceLocal: absence.sinceMinute == null ? null : formatMinuteOfDay(absence.sinceMinute),
          }
        : null,
      holidayName: holidays.names.get(date) ?? null,
      isWorkday,
      targetMinutes: target,
      workMinutes: work,
      balanceMinutes: target === null || date > today ? null : work - target,
      missing:
        date < today && employed && isWorkday && valid.length === 0 && !(absence && !absence.half),
      entries: dayRows.map((r) => toEntryView(r, now, names)),
      flags,
    };
  });
}

/** Info-Hinweis bei Buchungen an ganztägigen Abwesenheitstagen (Entscheidung 15), blockiert nicht. */
const ABSENCE_WORK_TEXT: Record<DayAbsence['type'], string> = {
  VACATION: 'Buchung an einem Urlaubstag',
  SPECIAL_LEAVE: 'Buchung an einem Sonderurlaubstag',
  OVERTIME_OFF: 'Buchung an einem Tag mit Überstundenabbau',
  SICK: 'Buchung an einem Krankheitstag',
  CHILD_SICK: 'Buchung an einem Krankheitstag',
  NEUTRAL: 'Buchung an einem Abwesenheitstag',
};

function formatMinuteOfDay(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
