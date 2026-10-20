import { addDays, berlinInstant, type LocalDate } from '@as/shared';
import { bavarianHolidays, leaveHalfDays } from '@as/time-rules';
import type { Prisma } from '../src/generated/prisma/client';
import { fromLocalDate } from '../src/app/common/dates';
import { seedEmployees } from './seed-data';

type SeedTransaction = {
  leaveRequest: {
    create(args: { data: Prisma.LeaveRequestUncheckedCreateInput }): Promise<unknown>;
  };
};

type PrototypeStatus = 'genehmigt' | 'offen' | 'abgelehnt';
type PrototypeLeave = readonly [
  employeeId: string,
  from: LocalDate,
  to: LocalDate,
  status: PrototypeStatus,
  options?: { created?: LocalDate; note?: string; reason?: string },
];

// Ausschließlich Beispielanträge aus prototype/index.html (Array leaves, Funktion L).
const prototypeLeaves: readonly PrototypeLeave[] = [
  ['e1', '2026-08-10', '2026-08-21', 'genehmigt'],
  ['e1', '2026-12-23', '2026-12-31', 'genehmigt'],
  ['e2', '2026-07-27', '2026-08-07', 'genehmigt'],
  ['e2', '2026-11-02', '2026-11-06', 'genehmigt'],
  ['e3', '2026-06-08', '2026-06-19', 'genehmigt'],
  ['e3', '2026-10-26', '2026-10-30', 'offen', { note: 'Herbstferien', created: '2026-10-08' }],
  ['e4', '2026-08-03', '2026-08-14', 'genehmigt'],
  ['e4', '2026-10-19', '2026-10-23', 'genehmigt'],
  [
    'e4',
    '2026-12-21',
    '2026-12-31',
    'offen',
    { note: 'Zwischen den Jahren', created: '2026-10-09' },
  ],
  ['e5', '2026-05-18', '2026-05-29', 'genehmigt'],
  ['e5', '2026-09-07', '2026-09-11', 'genehmigt'],
  ['e5', '2026-11-02', '2026-11-06', 'offen', { note: 'Familienbesuch', created: '2026-10-05' }],
  ['e6', '2026-08-17', '2026-08-26', 'genehmigt'],
  ['e6', '2026-10-12', '2026-10-14', 'genehmigt'],
  ['e7', '2026-07-06', '2026-07-17', 'genehmigt'],
  [
    'e7',
    '2026-10-28',
    '2026-10-30',
    'abgelehnt',
    {
      reason:
        'In dieser Woche fehlt bereits ein Kollege im Support, die Erreichbarkeit wäre nicht gesichert.',
      created: '2026-10-01',
    },
  ],
  ['e8', '2026-04-07', '2026-04-10', 'genehmigt'],
  ['e8', '2026-10-26', '2026-10-30', 'genehmigt'],
  ['m1', '2026-08-04', '2026-08-13', 'genehmigt'],
  ['m3', '2026-12-21', '2026-12-30', 'offen', { created: '2026-10-10' }],
];

const statuses = {
  genehmigt: 'APPROVED',
  offen: 'PENDING',
  abgelehnt: 'REJECTED',
} as const;

/** Nur Beispielanträge; Mitarbeiter und Verträge legt der Aufrufer in derselben Transaktion an. */
export async function seedLeaveRequests(
  tx: SeedTransaction,
  ids: ReadonlyMap<string, string>,
): Promise<void> {
  const databaseId = (reference: string): string => {
    const id = ids.get(reference);
    if (!id) throw new Error('Seed abgebrochen: Mitarbeiterreferenz fehlt.');
    return id;
  };
  const holidays = new Set(bavarianHolidays(2026, { assumptionDay: true }).map((day) => day.date));

  for (const [reference, from, to, prototypeStatus, options] of prototypeLeaves) {
    const employee = seedEmployees.find((candidate) => candidate.id === reference);
    if (!employee) throw new Error('Seed abgebrochen: Mitarbeiterreferenz fehlt.');
    const employeeId = databaseId(reference);
    const requestedAt = berlinInstant(options?.created ?? addDays(from, -40), '09:00');
    if (!requestedAt) throw new RangeError('Seed-Zeit existiert in Europe/Berlin nicht.');
    const status = statuses[prototypeStatus];
    const span = { from, to, startHalf: false, endHalf: false };

    await tx.leaveRequest.create({
      data: {
        employeeId,
        type: 'VACATION',
        ...span,
        from: fromLocalDate(from),
        to: fromLocalDate(to),
        halfDays: leaveHalfDays(
          span,
          (date) => (date >= employee.terms.validFrom ? employee.terms.workDays : null),
          holidays,
        ),
        note: options?.note ?? null,
        status,
        requestedAt,
        requestedById: employeeId,
        decidedAt: status === 'PENDING' ? null : new Date(requestedAt.getTime() + 2 * 86_400_000),
        decidedById: status === 'PENDING' ? null : databaseId(employee.leadId ?? reference),
        decisionReason: options?.reason ?? null,
      },
    });
  }
}
