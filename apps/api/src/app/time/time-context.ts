import { NotFoundException } from '@nestjs/common';
import { addDays, type IsoWeekday, type LocalDate } from '@as/shared';
import type { EmploymentTermsInput } from '@as/time-rules';
import type { EmploymentTerms, Prisma, PrismaClient } from '../../generated/prisma/client';
import { scopedEmployee } from '../access/employee-scope';
import type { AuthUser } from '../common/auth-user';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { ensureStatutoryHolidays } from '../holidays/holiday-generation';

export type Tx = Prisma.TransactionClient;
/** Datenbankzugriff; in einer Transaktion fehlt `$transaction` (Feiertage dann vorher sicherstellen). */
type Db = Pick<PrismaClient, 'employee' | 'holiday'> & Partial<Pick<PrismaClient, '$transaction'>>;

/** Serialisiert alle schreibenden Zeitbuchungs-Operationen einer Person (Stempeln, Nachtrag, Korrektur). */
export async function lockEmployeeTime(tx: Tx, employeeId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`time:${employeeId}`}, 0))`;
}

export interface TimeSubject {
  id: string;
  name: string;
  role: string;
  leadId: string | null;
  entryDate: LocalDate;
  /** Nach dem Austritt gibt es kein Soll mehr (Befund 4). */
  exitDate: LocalDate | null;
  terms: EmploymentTerms[];
  /** Jugendarbeitsschutz (Phase 7); nie an Nicht-Admins ausgeben. */
  birthDate: LocalDate | null;
  fullTimeSchoolUntil: LocalDate | null;
}

/** Zusatzdaten für die Jugendregeln (Phase 7): Schulferien und Arbeitstage im Jahr bei Schulpflicht. */
export interface YouthContext {
  schoolHolidays: { from: LocalDate; to: LocalDate }[];
  /** Tage mit gültiger Buchung ab dem 1.1. des ersten betrachteten Jahres (für § 5 Abs. 4). */
  workedDates: ReadonlySet<LocalDate>;
}

/**
 * Person im Sichtbereich der anfragenden Person laden; außerhalb 404 (zentraler Filter aus Phase 1).
 * `represented`: Personen, die die anfragende Person gerade vertritt (Phase 3, Entscheidung 7); nur
 * für Antragsentscheidungen übergeben, nie für Zeitansichten.
 */
export async function loadSubject(
  db: Db,
  user: AuthUser,
  employeeId: string,
  represented: ReadonlySet<string> = new Set(),
): Promise<TimeSubject> {
  const employee = await db.employee.findFirst({
    where: represented.has(employeeId) ? { id: employeeId } : scopedEmployee(user, employeeId),
    include: { terms: { orderBy: { validFrom: 'asc' } } },
  });
  if (!employee) throw new NotFoundException('Mitarbeiter nicht gefunden.');
  return {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    leadId: employee.leadId,
    entryDate: toLocalDate(employee.entryDate),
    exitDate: employee.exitDate ? toLocalDate(employee.exitDate) : null,
    terms: employee.terms,
    birthDate: employee.birthDate ? toLocalDate(employee.birthDate) : null,
    fullTimeSchoolUntil: employee.fullTimeSchoolUntil
      ? toLocalDate(employee.fullTimeSchoolUntil)
      : null,
  };
}

/** Person ohne Rechtefilter laden; nur nach eigener Prüfung der Sichtbarkeit verwenden (Prüfungen, Export). */
export async function loadSubjectById(db: Db, employeeId: string): Promise<TimeSubject> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { terms: { orderBy: { validFrom: 'asc' } } },
  });
  if (!employee) throw new NotFoundException('Mitarbeiter nicht gefunden.');
  return {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    leadId: employee.leadId,
    entryDate: toLocalDate(employee.entryDate),
    exitDate: employee.exitDate ? toLocalDate(employee.exitDate) : null,
    terms: employee.terms,
    birthDate: employee.birthDate ? toLocalDate(employee.birthDate) : null,
    fullTimeSchoolUntil: employee.fullTimeSchoolUntil
      ? toLocalDate(employee.fullTimeSchoolUntil)
      : null,
  };
}

/** Darf `user` für diese Person handeln (Nachtrag, sofort wirksame Korrektur, Freigabe)? */
export function managesSubject(
  user: AuthUser,
  subject: Pick<TimeSubject, 'id' | 'leadId'>,
): boolean {
  return subject.id !== user.id && (user.role === 'ADMIN' || subject.leadId === user.id);
}

/** Vertragsstand am Stichtag: der mit dem spätesten `validFrom` bis zum Datum, unabhängig von der Reihenfolge (Befund 8). */
export function termsAt(
  terms: readonly EmploymentTerms[],
  date: LocalDate,
): EmploymentTermsInput | null {
  let current: EmploymentTerms | null = null;
  for (const t of terms) {
    const validFrom = toLocalDate(t.validFrom);
    if (validFrom <= date && (!current || validFrom > toLocalDate(current.validFrom))) current = t;
  }
  return current
    ? {
        type: current.type,
        weeklyMinutes: current.weeklyMinutes,
        workDays: current.workDays as IsoWeekday[],
        annualLeaveDays: current.annualLeaveDays,
        extraLeaveDays: current.extraLeaveDays,
        hourlyWageCents: current.hourlyWageCents,
      }
    : null;
}

export interface HolidayLookup {
  dates: Set<LocalDate>;
  names: Map<LocalDate, string>;
}

/** Aktive Feiertage im Zeitraum; fehlende Jahre werden einmalig erzeugt. */
export async function holidaysBetween(
  db: Db,
  from: LocalDate,
  to: LocalDate,
): Promise<HolidayLookup> {
  // Innerhalb einer Transaktion (ohne `$transaction`) erzeugt der Aufrufer fehlende Jahre vorher.
  if (db.$transaction)
    for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
      await db.$transaction((tx) => ensureStatutoryHolidays(tx, year));
    }
  const rows = await db.holiday.findMany({
    where: { active: true, date: { gte: fromLocalDate(from), lte: fromLocalDate(to) } },
  });
  const names = new Map<LocalDate, string>();
  for (const r of rows) {
    const d = toLocalDate(r.date);
    names.set(d, names.has(d) ? `${names.get(d)}, ${r.name}` : r.name);
  }
  return { dates: new Set(names.keys()), names };
}

export function monthOf(date: LocalDate): string {
  return date.slice(0, 7);
}

export function monthRange(month: string): { from: LocalDate; to: LocalDate } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from: `${month}-01`, to: addDays(next, -1) };
}
