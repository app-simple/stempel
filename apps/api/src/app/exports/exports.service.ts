import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ABSENCE_TYPE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  formatEuro,
  formatHoursMinutes,
  type AbsenceType,
} from '@as/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { fromLocalDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import {
  loadSubject,
  loadSubjectById,
  monthRange,
  termsAt,
  type TimeSubject,
} from '../time/time-context';
import { TimeService } from '../time/time.service';
import { toCsv } from './csv';
import {
  REPORT_COLUMNS,
  reportFileName,
  reportRows,
  reportTotals,
  formatTimestamp,
  minijobLine,
  type MonthReport,
} from './month-report';
import { renderPdf } from './pdf';

const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

export interface ExportFile {
  fileName: string;
  contentType: string;
  body: Buffer;
}

/**
 * Export der Nachweise (Spezifikation Phase 4, Abschnitt 6.4, Entscheidungen 4 und 5): je Person und
 * Monat als PDF oder CSV für die Person selbst, Vorgesetzte (Team) und Admin; dazu für den Admin ein
 * Monatsexport aller als CSV. Ohne Anmeldeadressen; jeder Export wird protokolliert.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly time: TimeService,
  ) {}

  async personMonth(
    user: AuthUser,
    employeeId: string,
    month: string,
    format: 'pdf' | 'csv',
  ): Promise<ExportFile> {
    assertMonth(month);
    // Sichtbarkeit über den zentralen Filter; außerhalb 404.
    const subject = await loadSubject(this.prisma, user, employeeId);
    const report = await this.report(subject, month);
    await this.audit.record({
      action: 'export.time',
      actorId: user.id,
      entityType: 'Employee',
      entityId: employeeId,
      details: { month, format },
    });
    const name = reportFileName(report);
    if (format === 'pdf')
      return {
        fileName: `${name}.pdf`,
        contentType: 'application/pdf',
        body: await renderPdf(report),
      };
    const totals = reportTotals(report);
    const rows: string[][] = [
      REPORT_COLUMNS.map(([, label]) => label),
      ...reportRows(report).map((r) => REPORT_COLUMNS.map(([key]) => r[key])),
      [],
      ['Summe', '', '', '', '', totals.work, totals.target, totals.balance],
      ...(report.minijob ? [[minijobLine(report.minijob, report.minijobWages)]] : []),
      // Stand des Exports (Abschnitt 6.4, Befund 15).
      [`Erstellt am ${formatTimestamp(report.createdAt)} (Europe/Berlin)`],
    ];
    return {
      fileName: `${name}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: Buffer.from(toCsv(rows), 'utf8'),
    };
  }

  /** Monatsübersicht aller Beschäftigten für den Steuerberater (nur Admin). */
  async allMonth(user: AuthUser, month: string): Promise<ExportFile> {
    assertMonth(month);
    const { from, to } = monthRange(month);
    const people = await this.prisma.employee.findMany({
      where: {
        entryDate: { lte: fromLocalDate(to) },
        OR: [{ exitDate: null }, { exitDate: { gte: fromLocalDate(from) } }],
      },
      select: { id: true },
      orderBy: { name: 'asc' },
    });
    const rows: string[][] = [
      [
        'Name',
        'Beschäftigungsart',
        'Arbeitszeit (Std.)',
        'Soll (Std.)',
        'Saldo (Std.)',
        ...Object.values(ABSENCE_TYPE_LABELS).map((l) => `${l} (Tage)`),
        'Minijob Stunden',
        'Stundenlohn',
        'Verdienst',
        'Minijob-Grenze',
      ],
    ];
    for (const { id } of people) {
      const subject = await loadSubjectById(this.prisma, id);
      const report = await this.report(subject, month);
      const minijob = report.employmentType === 'MINIJOB';
      const absence = (type: AbsenceType) =>
        report.days.reduce(
          (s, d) => s + (d.absence?.type === type ? (d.absence.half ? 0.5 : 1) : 0),
          0,
        );
      const totals = reportTotals(report);
      rows.push([
        report.employeeName,
        report.employmentType ? EMPLOYMENT_TYPE_LABELS[report.employmentType] : '',
        totals.work,
        totals.target,
        totals.balance,
        ...(Object.keys(ABSENCE_TYPE_LABELS) as AbsenceType[]).map((t) =>
          String(absence(t)).replace('.', ','),
        ),
        minijob && report.minijob ? formatHoursMinutes(report.minijob.workMinutes) : '',
        minijob && report.minijob ? formatEuro(report.minijob.hourlyWageCents) : '',
        minijob && report.minijob ? formatEuro(report.minijob.earningsCents) : '',
        minijob && report.minijob ? formatEuro(report.minijob.limitCents) : '',
      ]);
    }
    rows.push([], [`Erstellt am ${formatTimestamp(this.clock.now())} (Europe/Berlin)`]);
    await this.audit.record({
      action: 'export.month',
      actorId: user.id,
      details: { month, people: people.length },
    });
    return {
      fileName: `monatsuebersicht-${month}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: Buffer.from(toCsv(rows), 'utf8'),
    };
  }

  private async report(subject: TimeSubject, month: string): Promise<MonthReport> {
    const { from, to } = monthRange(month);
    const days = await this.time.daysFor(subject, from, to, true);
    const ids = days.flatMap((d) => d.entries.map((e) => e.id));
    const counts = ids.length
      ? await this.prisma.timeEntryRevision.groupBy({
          by: ['entryId'],
          where: { entryId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: subject.id },
      select: { jobTitle: true },
    });
    const terms = termsAt(subject.terms, to) ?? termsAt(subject.terms, from);
    return {
      month,
      monthLabel: `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`,
      employeeName: subject.name,
      jobTitle: employee.jobTitle,
      employmentType: terms?.type ?? null,
      weeklyMinutes: terms?.weeklyMinutes ?? null,
      days,
      revisions: new Map(counts.map((c) => [c.entryId, c._count._all])),
      // Minijob, sobald ein Tag im Monat Minijob ist (Befund 11).
      minijob: await this.time.minijobMonth(subject, month),
      minijobWages: [
        ...new Set(
          days
            .map((d) => termsAt(subject.terms, d.date))
            .filter((t) => t?.type === 'MINIJOB' && t.hourlyWageCents !== null)
            .map((t) => t?.hourlyWageCents ?? 0),
        ),
      ],
      createdAt: this.clock.now(),
    };
  }
}

function assertMonth(month: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new BadRequestException('Bitte einen Monat im Format JJJJ-MM angeben.');
}
