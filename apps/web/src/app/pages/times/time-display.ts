import {
  formatHoursMinutes,
  formatLocalDate,
  localDateInBerlin,
  WEEKDAY_SHORT,
  type IsoWeekday,
  type TimeEntryView,
} from '@as/shared';

export function dayLabel(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return `${WEEKDAY_SHORT[day as IsoWeekday]} ${formatLocalDate(date).slice(0, 6)}`;
}
export function signedMinutes(minutes: number | null): string {
  return minutes === null ? '–' : `${minutes > 0 ? '+' : ''}${formatHoursMinutes(minutes)}`;
}
export function berlinTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  }).format(new Date(`${month}-01T12:00:00Z`));
}
export function lateLabel(entry: TimeEntryView): string {
  const late = entry.late;
  const text =
    late && late.daysLate > 0
      ? `Nachgetragen am ${formatLocalDate(localDateInBerlin(new Date(entry.recordedAt))).slice(0, 6)}`
      : late?.minutesAfterStart != null
        ? `Nachgetragen um ${entry.recordedAtLocal}, ${formatHoursMinutes(late.minutesAfterStart)} Std. nach Beginn`
        : 'Nachgetragen';
  return text + (entry.recordedByName ? ` durch ${entry.recordedByName}` : '');
}

/** Revisionen enthalten UTC-Zeitpunkte, keine bereits lokalisierten Formularwerte. */
export function snapshotLabel(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Keine Angaben';
  const snapshot = value as Record<string, unknown>;
  const time = (value: unknown) =>
    typeof value === 'string' && !Number.isNaN(Date.parse(value))
      ? berlinTimestamp(value)
      : 'offen';
  const breaks = Array.isArray(snapshot['breaks']) ? snapshot['breaks'] : [];
  const pause =
    breaks
      .map((value: unknown) => {
        if (!value || typeof value !== 'object') return 'Keine Angaben';
        const span = value as Record<string, unknown>;
        return `${time(span['start'])}–${time(span['end'])}`;
      })
      .join(', ') || 'keine';
  return `${time(snapshot['start'])}–${time(snapshot['end'])}; Pausen: ${pause}${snapshot['voided'] ? '; ungültig' : ''}`;
}
