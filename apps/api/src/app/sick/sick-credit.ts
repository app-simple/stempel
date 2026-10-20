import { eachDay, type IsoWeekday, type LocalDate } from '@as/shared';
import { vacationCreditHalfDays } from '@as/time-rules';
import type { Prisma } from '../../generated/prisma/client';
import { fromLocalDate, toLocalDate } from '../common/dates';
import type { PrismaService } from '../prisma/prisma.service';
import { holidaysBetween, lockEmployeeTime, termsAt } from '../time/time-context';

type Tx = Prisma.TransactionClient;

export const SICK_CREDIT_NOTE = 'Rückbuchung nach § 9 BUrlG';

/**
 * Gleicht die Rückbuchungen einer Krankmeldung (§ 9 BUrlG, Spezifikation Phase 6, Abschnitt 6) je
 * Kalenderjahr auf den Sollwert ab: nur Differenzen werden gebucht, das Konto bleibt append-only.
 * Aufruf innerhalb der Transaktion unter `lockEmployeeTime`; Feiertagsjahre muss der Aufrufer vorher
 * angelegt haben (`holidaysBetween` außerhalb der Transaktion). Fehlt die Krankmeldung (gelöscht), ist
 * der Sollwert 0.
 */
export async function reconcileSickCredit(
  tx: Tx,
  employeeId: string,
  sickLeaveId: string,
  actorId: string,
): Promise<void> {
  const desired = await desiredCredit(tx, sickLeaveId);
  const booked = await tx.leaveLedgerEntry.groupBy({
    by: ['year'],
    where: { sickLeaveId, kind: 'SICK_CREDIT' },
    _sum: { halfDays: true },
  });
  const years = new Set([...desired.keys(), ...booked.map((b) => b.year)]);
  for (const year of [...years].sort()) {
    const current = booked.find((b) => b.year === year)?._sum.halfDays ?? 0;
    const delta = (desired.get(year) ?? 0) - current;
    if (delta === 0) continue;
    await tx.leaveLedgerEntry.create({
      data: {
        employeeId,
        year,
        kind: 'SICK_CREDIT',
        halfDays: delta,
        sickLeaveId,
        note: SICK_CREDIT_NOTE,
        createdById: actorId,
      },
    });
  }
}

async function desiredCredit(tx: Tx, sickLeaveId: string): Promise<Map<number, number>> {
  const sick = await tx.sickLeave.findUnique({ where: { id: sickLeaveId } });
  if (!sick || sick.kind !== 'SICK' || !sick.certificateUntil) return new Map();
  const from = toLocalDate(sick.from);
  const to = toLocalDate(sick.to);
  const [vacations, terms, holidays] = await Promise.all([
    tx.leaveRequest.findMany({
      where: {
        employeeId: sick.employeeId,
        type: 'VACATION',
        status: 'APPROVED',
        from: { lte: sick.to },
        to: { gte: sick.from },
      },
    }),
    tx.employmentTerms.findMany({ where: { employeeId: sick.employeeId } }),
    holidaysBetween(tx, from, to),
  ]);
  // Abschnittsweise mit den jeweils gültigen Arbeitstagen (Vertragswechsel während der Krankheit).
  const total = new Map<number, number>();
  for (const segment of termSegments(from, to, (d) => termsAt(terms, d)?.workDays ?? [])) {
    const part = vacationCreditHalfDays({
      sick: { from: segment.from, to: segment.to },
      certificateUntil: toLocalDate(sick.certificateUntil),
      vacations: vacations.map((v) => ({
        from: toLocalDate(v.from),
        to: toLocalDate(v.to),
        startHalf: v.startHalf,
        endHalf: v.endHalf,
      })),
      workDays: segment.workDays,
      holidays: holidays.dates,
    });
    for (const [year, halfDays] of part) total.set(year, (total.get(year) ?? 0) + halfDays);
  }
  return total;
}

/** Zusammenhängende Abschnitte mit gleichen Arbeitstagen. */
export function termSegments(
  from: LocalDate,
  to: LocalDate,
  workDaysAt: (date: LocalDate) => readonly IsoWeekday[],
): { from: LocalDate; to: LocalDate; workDays: readonly IsoWeekday[] }[] {
  const segments: { from: LocalDate; to: LocalDate; workDays: readonly IsoWeekday[] }[] = [];
  for (const date of eachDay(from, to)) {
    const workDays = workDaysAt(date);
    const last = segments.at(-1);
    if (last && last.workDays.join() === workDays.join()) last.to = date;
    else segments.push({ from: date, to: date, workDays });
  }
  return segments;
}

/** Krankmeldungen, deren Rückbuchung ein geänderter Urlaub betrifft (z. B. nach Stornierung). */
export async function sickLeavesOverlapping(
  tx: Tx,
  employeeId: string,
  from: Date,
  to: Date,
): Promise<string[]> {
  const rows = await tx.sickLeave.findMany({
    where: { employeeId, kind: 'SICK', from: { lte: to }, to: { gte: from } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Nach Änderungen der Berechnungsgrundlagen (Feiertag, Vertragsstand) alle betroffenen Rückbuchungen
 * abgleichen (Codex-Review Phase 6, Befund 2). Je Krankmeldung eine eigene Transaktion unter der
 * Zeitsperre der Person; Feiertagsjahre werden vorher angelegt.
 */
export async function reconcileAffectedSickCredits(
  prisma: PrismaService,
  filter: { employeeId?: string; date?: LocalDate },
  actorId: string,
): Promise<void> {
  const leaves = await prisma.sickLeave.findMany({
    where: {
      kind: 'SICK',
      certificateUntil: { not: null },
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.date
        ? { from: { lte: fromLocalDate(filter.date) }, to: { gte: fromLocalDate(filter.date) } }
        : {}),
    },
    orderBy: [{ employeeId: 'asc' }, { from: 'asc' }],
    select: { id: true, employeeId: true, from: true, to: true },
  });
  for (const leave of leaves) {
    await holidaysBetween(prisma, toLocalDate(leave.from), toLocalDate(leave.to));
    await prisma.$transaction(async (tx) => {
      await lockEmployeeTime(tx, leave.employeeId);
      await reconcileSickCredit(tx, leave.employeeId, leave.id, actorId);
    });
  }
}
