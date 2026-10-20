import {
  DAY_ABSENCE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  WEEKDAY_SHORT,
  formatEuro,
  formatHoursMinutes,
  formatLocalDate,
  isoWeekday,
  type DayView,
  type EmploymentType,
  type MinijobMonthView,
} from '@as/shared';

/** Arbeitszeitnachweis einer Person für einen Monat (Spezifikation Phase 4, Abschnitt 6.4). */
export interface MonthReport {
  month: string;
  monthLabel: string;
  employeeName: string;
  jobTitle: string | null;
  employmentType: EmploymentType | null;
  weeklyMinutes: number | null;
  days: DayView[];
  /** Anzahl der Änderungen je Buchung (Revisionen). */
  revisions: ReadonlyMap<string, number>;
  minijob: MinijobMonthView | null;
  /** Unterschiedliche Stundenlöhne an Minijob-Tagen des Monats (Befund 12). */
  minijobWages: number[];
  createdAt: Date;
}

export interface ReportRow {
  date: string;
  weekday: string;
  start: string;
  end: string;
  breakMinutes: string;
  work: string;
  target: string;
  balance: string;
  absence: string;
  source: string;
  recordedAt: string;
  recordedBy: string;
  reason: string;
  voided: string;
  changed: string;
  notes: string;
}

export const REPORT_COLUMNS: readonly [keyof ReportRow, string][] = [
  ['date', 'Datum'],
  ['weekday', 'Tag'],
  ['start', 'Kommen'],
  ['end', 'Gehen'],
  ['breakMinutes', 'Pause (Min.)'],
  ['work', 'Arbeitszeit (Std.)'],
  ['target', 'Soll (Std.)'],
  ['balance', 'Saldo (Std.)'],
  ['absence', 'Abwesenheit'],
  ['source', 'Quelle'],
  ['recordedAt', 'Erfasst am'],
  ['recordedBy', 'Erfasst von'],
  ['reason', 'Grund des Nachtrags'],
  ['voided', 'Ungültig'],
  ['changed', 'Geändert'],
  ['notes', 'Hinweise'],
];

const hm = (minutes: number | null): string =>
  minutes === null ? '' : formatHoursMinutes(minutes);

/** Zeilen je Buchung; Tage ohne Buchung mit einer Zeile (Feiertag, Abwesenheit, frei, fehlend). */
export function reportRows(report: MonthReport): ReportRow[] {
  const minijob = report.employmentType === 'MINIJOB';
  const rows: ReportRow[] = [];
  for (const day of report.days) {
    const absence = day.absence
      ? `${DAY_ABSENCE_LABELS[day.absence.type]}${day.absence.half ? ' (halber Tag)' : ''}`
      : '';
    const notes = [
      ...(day.holidayName ? [day.holidayName] : []),
      ...(day.missing ? ['Keine Buchung an einem Arbeitstag'] : []),
      ...day.flags.map((f) => `${f.text}${f.paragraph ? ` (${f.paragraph})` : ''}`),
    ].join('; ');
    const base = {
      date: formatLocalDate(day.date),
      weekday: WEEKDAY_SHORT[isoWeekday(day.date)],
      target: minijob ? '' : hm(day.targetMinutes),
      balance: minijob ? '' : hm(day.balanceMinutes),
      absence,
      notes,
    };
    if (day.entries.length === 0) {
      rows.push({
        ...base,
        start: '',
        end: '',
        breakMinutes: '',
        work: '',
        source: '',
        recordedAt: '',
        recordedBy: '',
        reason: '',
        voided: '',
        changed: '',
        notes: notes || (day.isWorkday ? '' : 'kein Arbeitstag'),
      });
      continue;
    }
    day.entries.forEach((e, i) => {
      const changes = report.revisions.get(e.id) ?? 0;
      rows.push({
        ...base,
        // Soll, Saldo und Hinweise nur in der ersten Zeile des Tages.
        target: i === 0 ? base.target : '',
        balance: i === 0 ? base.balance : '',
        notes: i === 0 ? base.notes : '',
        absence: i === 0 ? base.absence : '',
        start: e.startLocal,
        end: e.endLocal ? `${e.endLocal}${e.endsNextDay ? ' (+1)' : ''}` : 'läuft',
        breakMinutes: String(e.breakMinutes),
        work: hm(e.workMinutes),
        source: e.source === 'CLOCK' ? 'Stempeluhr' : 'Nachtrag',
        recordedAt: e.source === 'MANUAL' ? formatTimestamp(e.recordedAt) : '',
        recordedBy: e.recordedByName ?? '',
        reason: e.reason ?? '',
        voided: e.voided ? 'ja' : '',
        changed: changes ? `${changes}×` : '',
      });
    });
  }
  return rows;
}

export interface ReportTotals {
  work: string;
  target: string;
  balance: string;
}

export function reportTotals(report: MonthReport): ReportTotals {
  const minijob = report.employmentType === 'MINIJOB';
  const work = report.days.reduce((s, d) => s + d.workMinutes, 0);
  const target = report.days.reduce((s, d) => s + (d.targetMinutes ?? 0), 0);
  const balance = report.days.reduce((s, d) => s + (d.balanceMinutes ?? 0), 0);
  return {
    work: hm(work),
    target: minijob ? '' : hm(target),
    balance: minijob ? '' : hm(balance),
  };
}

/** Kopfzeilen des Nachweises, für PDF und Sammelansichten. */
export function reportHeader(report: MonthReport): string[] {
  return [
    `${report.employeeName}${report.jobTitle ? `, ${report.jobTitle}` : ''}`,
    [
      report.employmentType ? EMPLOYMENT_TYPE_LABELS[report.employmentType] : null,
      report.weeklyMinutes !== null && report.employmentType !== 'MINIJOB'
        ? `${formatHoursMinutes(report.weeklyMinutes)} Std./Woche`
        : null,
    ]
      .filter(Boolean)
      .join(', '),
  ].filter(Boolean);
}

export function minijobLine(m: MinijobMonthView, wages: readonly number[] = []): string {
  const limit = `Grenze ${formatEuro(m.limitCents)}, ${Math.round(m.ratio * 100)} %`;
  // Bei Lohnwechsel keine Multiplikation mit einem einzelnen Lohn (Befund 12).
  if (wages.length > 1)
    return `Minijob: ${formatHoursMinutes(m.workMinutes)} Std., Verdienst ${formatEuro(m.earningsCents)} mit dem jeweils geltenden Stundenlohn (${wages.map(formatEuro).join(' / ')}); ${limit}`;
  return `Minijob: ${formatHoursMinutes(m.workMinutes)} Std. × ${formatEuro(m.hourlyWageCents)} = ${formatEuro(m.earningsCents)} (${limit})`;
}

/** Zeitpunkt in Europe/Berlin, z. B. „14.10.2026 10:04“. */
export function formatTimestamp(iso: string | Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(typeof iso === 'string' ? new Date(iso) : iso)
    .replace(',', '');
}

/** Dateiname ohne Sonderzeichen, z. B. „arbeitszeit-2026-10-elif-aydin“. */
export function reportFileName(report: Pick<MonthReport, 'month' | 'employeeName'>): string {
  const slug = report.employeeName
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `arbeitszeit-${report.month}-${slug || 'person'}`;
}
