import { BadRequestException, Injectable } from '@nestjs/common';
import {
  addDays,
  diffDays,
  isLocalDate,
  type CheckFinding,
  type ChecksView,
  type CompensationRow,
  type ForfeitureSuggestion,
  type LocalDate,
  type MinijobCheckRow,
  type NoticeStatusRow,
} from '@as/shared';
import { compensationAverage, compensationWindow, noticeDeadline } from '@as/time-rules';
import { employeeScope } from '../access/employee-scope';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { fromLocalDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { loadSubjectById, monthOf, type TimeSubject } from '../time/time-context';
import { TimeService } from '../time/time.service';
import { NoticesService } from './notices.service';

const DEFAULT_DAYS = 42;
const MAX_DAYS = 366;

/**
 * Prüfseite (Spezifikation Phase 4, Abschnitt 6.1, Entscheidung 1): Vorgesetzte für ihr Team
 * einschließlich sich selbst, Admin für alle. Prüfungen blockieren nichts.
 */
@Injectable()
export class ChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly time: TimeService,
    private readonly notices: NoticesService,
  ) {}

  async checks(user: AuthUser, range: { from?: string; to?: string }): Promise<ChecksView> {
    const today = this.clock.today();
    const to = range.to ?? today;
    const from = range.from ?? addDays(to, -DEFAULT_DAYS);
    if (!isLocalDate(from) || !isLocalDate(to) || from > to)
      throw new BadRequestException('Bitte einen gültigen Zeitraum angeben.');
    if (diffDays(from, to) >= MAX_DAYS)
      throw new BadRequestException('Der Zeitraum darf höchstens zwölf Monate lang sein.');

    const subjects = await this.subjectsInScope(user, from, to);
    const findings: CheckFinding[] = [];
    const compensation: CompensationRow[] = [];
    const minijob: MinijobCheckRow[] = [];
    const window = compensationWindow(today);
    const months = [monthOf(addDays(`${monthOf(today)}-01`, -1)), monthOf(today)];

    for (const subject of subjects) {
      for (const day of await this.time.daysFor(subject, from, to)) {
        for (const flag of day.flags) {
          if (flag.level === 'info') continue;
          findings.push({
            date: day.date,
            employeeId: subject.id,
            employeeName: subject.name,
            code: flag.code,
            text: flag.text,
            paragraph: flag.paragraph ?? null,
            level: flag.level,
          });
        }
        if (day.missing)
          findings.push({
            date: day.date,
            employeeId: subject.id,
            employeeName: subject.name,
            code: 'MISSING_ENTRY',
            text: 'Keine Buchung an einem Arbeitstag',
            paragraph: 'Erfassungspflicht',
            level: 'warn',
          });
      }

      const span = this.employedSpan(subject, window.from, window.to);
      if (span) {
        const days = await this.time.daysFor(subject, span.from, span.to);
        const result = compensationAverage(
          days.map((d) => ({
            date: d.date,
            workMinutes: d.workMinutes,
            holiday: d.holidayName !== null,
            // Auch halbe Abwesenheitstage sind keine Ausgleichstage (Entscheidung 7, Befund 13).
            absent: !!d.absence,
          })),
        );
        if (result.workdays > 0)
          compensation.push({
            employeeId: subject.id,
            employeeName: subject.name,
            from: span.from,
            to: span.to,
            workdays: result.workdays,
            averageMinutes: result.averageMinutes,
            exceeds: result.exceeds,
          });
      }

      // Jeder Monat mit mindestens einem Minijob-Tag (Befund 11).
      const minijobMonths = (
        await Promise.all(months.map((m) => this.time.minijobMonth(subject, m)))
      ).filter((m): m is NonNullable<typeof m> => m !== null);
      if (minijobMonths.length) {
        const employee = await this.prisma.employee.findUniqueOrThrow({
          where: { id: subject.id },
          select: { jobTitle: true },
        });
        minijob.push({
          employeeId: subject.id,
          employeeName: subject.name,
          jobTitle: employee.jobTitle,
          months: minijobMonths,
        });
      }
    }

    findings.sort(
      (a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName),
    );
    const year = Number(today.slice(0, 4));
    const rows: NoticeStatusRow[] = await this.notices.statusRows(
      subjects.map((s) => s.id),
      year,
    );
    const forfeitures: ForfeitureSuggestion[] =
      user.role === 'ADMIN' ? await this.notices.forfeitureSuggestions(subjects, today) : [];
    return {
      from,
      to,
      findings,
      compensation,
      minijob,
      // Ab 1. Juli erinnert die Prüfseite an fehlende Hinweise, damit sie bis 30.09. rechtzeitig
      // für den Verfall zum 31.12. versendet werden können (Entscheidung 2, geändert am 14.10.2026).
      notices: {
        year,
        rows,
        reminder: today >= `${year}-07-01`,
        yearEndDeadlinePassed: today > noticeDeadline(`${year}-12-31`),
      },
      forfeitures,
    };
  }

  /** Personen im Sichtbereich, die im Zeitraum beschäftigt sind. */
  private async subjectsInScope(
    user: AuthUser,
    from: LocalDate,
    to: LocalDate,
  ): Promise<TimeSubject[]> {
    const rows = await this.prisma.employee.findMany({
      where: {
        AND: [
          employeeScope(user),
          { entryDate: { lte: fromLocalDate(to) } },
          { OR: [{ exitDate: null }, { exitDate: { gte: fromLocalDate(from) } }] },
        ],
      },
      select: { id: true },
      orderBy: { name: 'asc' },
    });
    return Promise.all(rows.map((r) => loadSubjectById(this.prisma, r.id)));
  }

  private employedSpan(
    subject: TimeSubject,
    from: LocalDate,
    to: LocalDate,
  ): { from: LocalDate; to: LocalDate } | null {
    const start = subject.entryDate > from ? subject.entryDate : from;
    const end = subject.exitDate && subject.exitDate < to ? subject.exitDate : to;
    return start <= end ? { from: start, to: end } : null;
  }
}
