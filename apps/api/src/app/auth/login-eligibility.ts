import type { LocalDate } from '@as/shared';
import { toLocalDate } from '../common/dates';

export interface LoginStatusInput {
  lockedAt: Date | null;
  exitDate: Date | null;
}

/**
 * Anmeldesperre nach Spezifikation Phase 1 (Entscheidung 6): manuell gesperrt oder ab dem Tag
 * nach dem Austritt. Am Austrittstag selbst ist die Anmeldung noch möglich.
 */
export function canLogIn(employee: LoginStatusInput, today: LocalDate): boolean {
  if (employee.lockedAt) return false;
  if (employee.exitDate && toLocalDate(employee.exitDate) < today) return false;
  return true;
}
