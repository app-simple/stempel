import {
  formatHalfDays,
  formatLocalDate,
  type LeaveRequestView,
  type LeaveStatus,
} from '@as/shared';

export function daysText(halfDays: number): string {
  return `${formatHalfDays(halfDays)} ${halfDays === 2 ? 'Tag' : 'Tage'}`;
}

export function leaveDate(date: string, half: boolean): string {
  return `${formatLocalDate(date)}${half ? ' ½' : ''}`;
}

export function statusClass(status: LeaveStatus): string {
  switch (status) {
    case 'APPROVED':
      return 'lv-ok';
    case 'PENDING':
      return 'lv-warn';
    case 'REJECTED':
      return 'lv-crit';
    default:
      return 'lv-mute';
  }
}

/** Tage nach aktuellem Stand, bei Abweichung mit Hinweis „neu berechnet“ (Entscheidung 14). */
export function currentDaysLabel(
  r: Pick<LeaveRequestView, 'halfDays' | 'currentHalfDays'>,
): string {
  const now = daysText(r.currentHalfDays);
  return r.currentHalfDays === r.halfDays
    ? now
    : `${now} (neu berechnet: ${formatHalfDays(r.currentHalfDays)} statt ${formatHalfDays(r.halfDays)})`;
}
