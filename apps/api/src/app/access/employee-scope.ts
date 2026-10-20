import type { Prisma } from '../../generated/prisma/client';
import type { AuthUser } from '../common/auth-user';

/**
 * Zentraler Abfragefilter für Mitarbeiterdaten (CLAUDE.md, Datenschutz; Konzept Abschnitt 3).
 * Jede Abfrage auf Daten einer Person läuft durch diesen Filter.
 *
 * - Admin: alle
 * - Vorgesetzte/r: sich selbst und die direkt zugeordneten Mitarbeiter
 * - Mitarbeiter/in: nur sich selbst
 */
export function employeeScope(user: Pick<AuthUser, 'id' | 'role'>): Prisma.EmployeeWhereInput {
  switch (user.role) {
    case 'ADMIN':
      return {};
    case 'LEAD':
      return { OR: [{ id: user.id }, { leadId: user.id }] };
    default:
      return { id: user.id };
  }
}

/** Filter für eine einzelne Person im erlaubten Bereich; außerhalb ergibt die Abfrage nichts (404). */
export function scopedEmployee(
  user: Pick<AuthUser, 'id' | 'role'>,
  employeeId: string,
): Prisma.EmployeeWhereInput {
  return { AND: [employeeScope(user), { id: employeeId }] };
}
