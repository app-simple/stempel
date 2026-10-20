import { eachDay, type IsoWeekday, type LocalDate } from '@as/shared';
import {
  annualEntitlement,
  leaveAccount,
  leaveHalfDaysByYear,
  type DatedLeaveTerms,
  type DayAbsence,
  type EntitlementResult,
  type LeaveSpan,
  type WorkDaysAt,
} from '@as/time-rules';
import type { EmploymentTerms, LeaveRequest, PrismaClient } from '../../generated/prisma/client';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { holidaysBetween, termsAt } from '../time/time-context';

type Db = Pick<
  PrismaClient,
  'employee' | 'holiday' | 'leaveRequest' | 'leaveLedgerEntry' | 'leaveCarryOver'
> &
  Partial<Pick<PrismaClient, '$transaction'>>;

/** Person, soweit Urlaub sie braucht. Laden ohne Rechteprüfung; die prüft der Aufrufer. */
export interface LeaveSubject {
  id: string;
  name: string;
  jobTitle: string | null;
  role: string;
  leadId: string | null;
  deputyId: string | null;
  loginEmail: string;
  entryDate: LocalDate;
  exitDate: LocalDate | null;
  overtimeAccountSince: LocalDate | null;
  terms: EmploymentTerms[];
  /** Für den Jugendmindesturlaub (Phase 7); nie an Nicht-Admins ausgeben. */
  birthDate: LocalDate | null;
}

export async function loadLeaveSubjects(
  db: Pick<PrismaClient, 'employee'>,
  ids: readonly string[],
): Promise<Map<string, LeaveSubject>> {
  const rows = await db.employee.findMany({
    where: { id: { in: [...new Set(ids)] } },
    include: { terms: true },
  });
  return new Map(
    rows.map((e) => [
      e.id,
      {
        id: e.id,
        name: e.name,
        jobTitle: e.jobTitle,
        role: e.role,
        leadId: e.leadId,
        deputyId: e.deputyId,
        loginEmail: e.loginEmail,
        entryDate: toLocalDate(e.entryDate),
        exitDate: e.exitDate ? toLocalDate(e.exitDate) : null,
        overtimeAccountSince: e.overtimeAccountSince ? toLocalDate(e.overtimeAccountSince) : null,
        terms: e.terms,
        birthDate: e.birthDate ? toLocalDate(e.birthDate) : null,
      },
    ]),
  );
}

/** Arbeitstage laut Vertragsstand am Tag; vor dem Eintritt und nach dem Austritt keine. */
export function workDaysAtFor(subject: LeaveSubject): WorkDaysAt {
  return (date) => {
    if (date < subject.entryDate || (subject.exitDate && date > subject.exitDate)) return null;
    return (termsAt(subject.terms, date)?.workDays as IsoWeekday[] | undefined) ?? null;
  };
}

export function datedTerms(subject: LeaveSubject): DatedLeaveTerms[] {
  return subject.terms.map((t) => ({
    validFrom: toLocalDate(t.validFrom),
    terms: {
      workDays: t.workDays as IsoWeekday[],
      annualLeaveDays: t.annualLeaveDays,
      extraLeaveDays: t.extraLeaveDays,
    },
  }));
}

export function spanOf(r: Pick<LeaveRequest, 'from' | 'to' | 'startHalf' | 'endHalf'>): LeaveSpan {
  return {
    from: toLocalDate(r.from),
    to: toLocalDate(r.to),
    startHalf: r.startHalf,
    endHalf: r.endHalf,
  };
}

export interface YearAccount {
  year: number;
  entitlement: EntitlementResult;
  carryOver: number;
  corrections: number;
  approved: number;
  pending: number;
  rest: number;
}

/**
 * Urlaubskonto eines Jahres (Spezifikation Phase 3, Abschnitt 6.4): Anspruch aus den Vertragsständen,
 * Übertrag aus `LeaveCarryOver`, Korrekturen aus `LeaveLedgerEntry`, Genehmigt und Beantragt aus den
 * Urlaubsanträgen nach aktuellem Stand von Feiertagen und Vertrag (Entscheidung 14). Nur Art Urlaub.
 */
export async function yearAccount(
  db: Db,
  subject: LeaveSubject,
  year: number,
): Promise<YearAccount> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [requests, ledger, carry, holidays] = await Promise.all([
    db.leaveRequest.findMany({
      where: {
        employeeId: subject.id,
        type: 'VACATION',
        status: { in: ['PENDING', 'APPROVED'] },
        from: { lte: fromLocalDate(to) },
        to: { gte: fromLocalDate(from) },
      },
    }),
    db.leaveLedgerEntry.aggregate({
      where: { employeeId: subject.id, year },
      _sum: { halfDays: true },
    }),
    db.leaveCarryOver.findUnique({ where: { employeeId_year: { employeeId: subject.id, year } } }),
    holidaysBetween(db, from, to),
  ]);
  const workDaysAt = workDaysAtFor(subject);
  let approved = 0;
  let pending = 0;
  for (const r of requests) {
    const days =
      leaveHalfDaysByYear(spanOf(r), workDaysAt, holidays.dates).find((y) => y.year === year)
        ?.halfDays ?? 0;
    if (r.status === 'APPROVED') approved += days;
    else pending += days;
  }
  const entitlement = annualEntitlement(
    year,
    datedTerms(subject),
    subject.entryDate,
    subject.exitDate,
    subject.birthDate,
  );
  const carryOver = (carry?.days ?? 0) * 2;
  const corrections = ledger._sum.halfDays ?? 0;
  const { restHalfDays } = leaveAccount({
    entitlementHalfDays: entitlement.halfDays,
    carryOverHalfDays: carryOver,
    correctionHalfDays: corrections,
    approvedHalfDays: approved,
    pendingHalfDays: pending,
  });
  return { year, entitlement, carryOver, corrections, approved, pending, rest: restHalfDays };
}

/** Feiertage für alle Tage der übergebenen Zeiträume (ein Abruf über die Gesamtspanne). */
export async function holidaysFor(
  db: Db,
  spans: readonly Pick<LeaveSpan, 'from' | 'to'>[],
): Promise<Awaited<ReturnType<typeof holidaysBetween>>> {
  const [first, ...rest] = spans;
  if (!first) return { dates: new Set(), names: new Map() };
  const from = rest.reduce((m, s) => (s.from < m ? s.from : m), first.from);
  const to = rest.reduce((m, s) => (s.to > m ? s.to : m), first.to);
  return holidaysBetween(db, from, to);
}

/** Genehmigte Abwesenheiten je Person und Tag im Zeitraum (ohne Feiertagsprüfung; die macht das Soll). */
export async function approvedAbsences(
  db: Pick<PrismaClient, 'leaveRequest' | 'sickLeave'>,
  employeeIds: readonly string[],
  from: LocalDate,
  to: LocalDate,
): Promise<Map<string, Map<LocalDate, DayAbsence>>> {
  const where = {
    employeeId: { in: [...employeeIds] },
    from: { lte: fromLocalDate(to) },
    to: { gte: fromLocalDate(from) },
  };
  const [rows, sick] = await Promise.all([
    db.leaveRequest.findMany({ where: { ...where, status: 'APPROVED' } }),
    db.sickLeave.findMany({ where }),
  ]);
  const result = new Map<string, Map<LocalDate, DayAbsence>>();
  const daysOf = (id: string) => {
    const days = result.get(id) ?? new Map<LocalDate, DayAbsence>();
    result.set(id, days);
    return days;
  };
  for (const r of rows) {
    const days = daysOf(r.employeeId);
    const span = spanOf(r);
    for (const d of eachDay(span.from > from ? span.from : from, span.to < to ? span.to : to)) {
      days.set(d, {
        type: r.type,
        half: (d === span.from && span.startHalf) || (d === span.to && span.endHalf),
      });
    }
  }
  // Krankheit hat am selben Tag Vorrang vor Urlaub (Spezifikation Phase 6, Abschnitte 4 und 5).
  for (const r of sick) {
    const days = daysOf(r.employeeId);
    const sickFrom = toLocalDate(r.from);
    const sickTo = toLocalDate(r.to);
    for (const d of eachDay(sickFrom > from ? sickFrom : from, sickTo < to ? sickTo : to)) {
      days.set(d, {
        type: r.kind,
        half: false,
        sinceMinute: d === sickFrom ? r.sinceMinute : null,
      });
    }
  }
  return result;
}
