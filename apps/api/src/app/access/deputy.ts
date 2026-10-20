import type { LocalDate } from '@as/shared';
import type { PrismaClient } from '../../generated/prisma/client';
import type { AuthUser } from '../common/auth-user';
import { fromLocalDate } from '../common/dates';

type Db = Pick<PrismaClient, 'employee'>;

/**
 * Personen, die `userId` heute vertritt (Spezifikation Phase 3, Entscheidung 7): Die Person hat
 * `userId` als Vertretung, und ihre Vorgesetzte hat heute eine genehmigte Abwesenheit oder ist krank.
 * Die Vertretung darf dann deren Urlaubs- und Korrekturanträge sehen und entscheiden und deren
 * Urlaubskonto sehen, aber keine Zeiten außerhalb eines Antrags.
 */
export async function representedIds(
  db: Db,
  userId: string,
  today: LocalDate,
): Promise<Set<string>> {
  const day = fromLocalDate(today);
  const rows = await db.employee.findMany({
    where: {
      deputyId: userId,
      id: { not: userId },
      // Abwesend: genehmigter Urlaub oder Krankheit (Phase 6).
      lead: {
        OR: [
          { leaveRequests: { some: { status: 'APPROVED', from: { lte: day }, to: { gte: day } } } },
          { sickLeaves: { some: { from: { lte: day }, to: { gte: day } } } },
        ],
      },
    },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/** Ist die Vorgesetzte heute abwesend (genehmigte Abwesenheit oder Krankheit, Phase 6)? */
export async function isAbsent(
  db: Pick<PrismaClient, 'leaveRequest' | 'sickLeave'>,
  employeeId: string,
  today: LocalDate,
): Promise<boolean> {
  const day = fromLocalDate(today);
  const [leave, sick] = await Promise.all([
    db.leaveRequest.count({
      where: { employeeId, status: 'APPROVED', from: { lte: day }, to: { gte: day } },
    }),
    db.sickLeave.count({ where: { employeeId, from: { lte: day }, to: { gte: day } } }),
  ]);
  return leave + sick > 0;
}

/**
 * Darf `user` über Anträge dieser Person entscheiden? Nie über eigene; Admin immer, Vorgesetzte für
 * ihr Team, die Vertretung während der Abwesenheit der Vorgesetzten.
 */
export function decidesFor(
  user: Pick<AuthUser, 'id' | 'role'>,
  subject: { id: string; leadId: string | null },
  represented: ReadonlySet<string>,
): boolean {
  if (subject.id === user.id) return false;
  return user.role === 'ADMIN' || subject.leadId === user.id || represented.has(subject.id);
}
