import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addDays,
  eachDay,
  berlinTime,
  isoWeekday,
  localDateInBerlin,
  mondayOf,
  mondayOfIsoWeek,
  isoWeekKey,
  type ClockResult,
  type CorrectionInput,
  type CorrectionProposal,
  type CorrectionRequestView,
  type DayView,
  type CorrectionResult,
  type EntrySaveResult,
  type LocalDate,
  type ManualEntryInput,
  type MinijobMonthView,
  type MonthClosingView,
  type MonthView,
  type OvertimeView,
  type RevisionView,
  type RuleFlag,
  type TeamTodayRow,
  type TimeEntryView,
  type TodayView,
  type WeekView,
} from '@as/shared';
import {
  isYouthOn,
  minijobMonthFromParts,
  workMinutes,
  youthDayLimits,
  type DayAbsence,
} from '@as/time-rules';
import type { Prisma } from '../../generated/prisma/client';
import { decidesFor, representedIds } from '../access/deputy';
import { employeeScope } from '../access/employee-scope';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { approvedAbsences } from '../leave/leave-context';
import { loadLegalValues } from '../legal/legal-values';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildDays,
  entryInclude,
  flagsFor,
  toEntryView,
  toWorkEntry,
  type EntryRow,
} from './entry-view';
import {
  holidaysBetween,
  loadSubject,
  lockEmployeeTime,
  managesSubject,
  monthOf,
  monthRange,
  termsAt,
  type TimeSubject,
  type Tx,
  type YouthContext,
} from './time-context';
import { resolveSpan, type ResolvedSpan } from './time-input';

const MONTH_CLOSED =
  'Der Monat ist abgeschlossen. Änderungen nur noch durch Vorgesetzte oder Admin.';

interface Snapshot {
  start: string;
  end: string | null;
  breaks: { start: string; end: string | null }[];
  voided: boolean;
}

function snapshot(row: EntryRow): Snapshot {
  return {
    start: row.startAt.toISOString(),
    end: row.endAt?.toISOString() ?? null,
    breaks: row.breaks.map((b) => ({
      start: b.startAt.toISOString(),
      end: b.endAt?.toISOString() ?? null,
    })),
    voided: row.voidedAt !== null,
  };
}

/** Zeiterfassung nach Spezifikation Phase 2. Stempelzeiten kommen immer von der Serveruhr. */
@Injectable()
export class TimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Hilfen
  // ---------------------------------------------------------------------------

  /**
   * Tagesansichten einer Person im Zeitraum, wie in Woche und Monat (Prüfungen, Export; Phase 4).
   * Ohne Rechtefilter: Der Aufrufer hat die Sichtbarkeit der Person bereits geprüft.
   */
  async daysFor(
    subject: TimeSubject,
    from: LocalDate,
    to: LocalDate,
    withNames = false,
  ): Promise<DayView[]> {
    const rows = await this.entriesBetween(this.prisma, subject.id, addDays(from, -2), to);
    const holidays = await holidaysBetween(this.prisma, addDays(from, -2), to);
    const names = withNames ? await this.names(rows.map((r) => r.recordedById)) : new Map();
    const absences = await this.absences(subject.id, from, to);
    const youth = await this.youthContext(subject, from, to);
    return buildDays(from, to, rows, subject, holidays, this.clock.now(), names, absences, youth);
  }

  /** Genehmigte Abwesenheiten einer Person je Tag (Spezifikation Phase 3, Abschnitt 6.6). */
  private async absences(
    employeeId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<Map<LocalDate, DayAbsence>> {
    return (
      (await approvedAbsences(this.prisma, [employeeId], from, to)).get(employeeId) ?? new Map()
    );
  }

  private async names(ids: Iterable<string>): Promise<Map<string, string>> {
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private entriesBetween(
    db: Tx | PrismaService,
    employeeId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<EntryRow[]> {
    // Ganze ISO-Wochen laden: Wochenregeln für Jugendliche (§§ 8, 15 JArbSchG, Phase 7) hängen auch von
    // späteren Tagen der Woche ab (Review API, Befund 3). Die Ausgabe bleibt auf den Zeitraum begrenzt.
    const monday = mondayOf(from);
    const start = monday < from ? monday : from;
    const sunday = addDays(mondayOf(to), 6);
    return db.timeEntry.findMany({
      where: { employeeId, workDate: { gte: fromLocalDate(start), lte: fromLocalDate(sunday) } },
      include: entryInclude,
      orderBy: { startAt: 'asc' },
    });
  }

  /**
   * Zusatzdaten für die Jugendregeln (Phase 7), nur wenn die Person im Zeitraum jugendlich ist:
   * Schulferien und bei Vollzeitschulpflicht die Arbeitstage ab dem 1.1. des Jahres.
   */
  private async youthContext(
    subject: TimeSubject,
    from: LocalDate,
    to: LocalDate,
  ): Promise<YouthContext | undefined> {
    if (!isYouthOn(subject.birthDate, from) && !isYouthOn(subject.birthDate, to)) return undefined;
    const yearStart = `${from.slice(0, 4)}-01-01`;
    const school = subject.fullTimeSchoolUntil !== null && from <= subject.fullTimeSchoolUntil;
    const [holidays, worked] = await Promise.all([
      school
        ? this.prisma.schoolHoliday.findMany({
            where: {
              active: true,
              from: { lte: fromLocalDate(to) },
              to: { gte: fromLocalDate(yearStart) },
            },
          })
        : Promise.resolve([]),
      school
        ? this.prisma.timeEntry.findMany({
            where: {
              employeeId: subject.id,
              voidedAt: null,
              workDate: { gte: fromLocalDate(yearStart), lte: fromLocalDate(to) },
            },
            select: { workDate: true },
            distinct: ['workDate'],
          })
        : Promise.resolve([]),
    ]);
    return {
      schoolHolidays: holidays.map((h) => ({ from: toLocalDate(h.from), to: toLocalDate(h.to) })),
      workedDates: new Set(worked.map((w) => toLocalDate(w.workDate))),
    };
  }

  private async isMonthClosed(
    db: Tx | PrismaService,
    employeeId: string,
    month: string,
  ): Promise<boolean> {
    const closing = await db.monthClosing.findUnique({
      where: { employeeId_month: { employeeId, month } },
    });
    return !!closing && closing.reopenedAt === null;
  }

  private async assertMonthOpenForSelf(
    tx: Tx,
    user: AuthUser,
    employeeId: string,
    date: LocalDate,
  ): Promise<void> {
    if (employeeId === user.id && (await this.isMonthClosed(tx, employeeId, monthOf(date)))) {
      throw new ConflictException(MONTH_CLOSED);
    }
  }

  private async assertNoOverlap(
    tx: Tx,
    employeeId: string,
    span: ResolvedSpan,
    excludeId?: string,
  ): Promise<void> {
    const end = span.end ?? new Date(8_640_000_000_000_000);
    const overlapping = await tx.timeEntry.findFirst({
      where: {
        employeeId,
        voidedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        startAt: { lt: end },
        OR: [{ endAt: null }, { endAt: { gt: span.start } }],
      },
    });
    if (overlapping)
      throw new ConflictException('Die Zeit überschneidet sich mit einer anderen Buchung.');
  }

  private async dayFlags(subject: TimeSubject, date: LocalDate): Promise<RuleFlag[]> {
    const rows = await this.entriesBetween(this.prisma, subject.id, addDays(date, -2), date);
    return flagsFor(
      date,
      rows,
      subject,
      await holidaysBetween(this.prisma, addDays(date, -2), date),
      await this.youthContext(subject, date, date),
    );
  }

  /** Verstöße werden nicht blockiert, aber protokolliert (CLAUDE.md). */
  private async recordViolations(
    actorId: string,
    employeeId: string,
    date: LocalDate,
    flags: RuleFlag[],
    tx?: Tx,
  ): Promise<void> {
    const crit = flags.filter((f) => f.level === 'crit').map((f) => f.code);
    if (crit.length === 0) return;
    await this.audit.record(
      {
        action: 'time.violation',
        actorId,
        entityType: 'Employee',
        entityId: employeeId,
        details: { date, codes: crit },
      },
      tx,
    );
  }

  private async entryView(row: EntryRow): Promise<TimeEntryView> {
    return toEntryView(row, this.clock.now(), await this.names([row.recordedById]));
  }

  // ---------------------------------------------------------------------------
  // Stempeluhr (nur für sich selbst, immer Serverzeit)
  // ---------------------------------------------------------------------------

  /**
   * Laufende Buchung unter Sperre laden. Die Zeit wird erst danach genommen, damit sie zur Reihenfolge
   * der Aktionen passt; gespeichert wird genau die Serverzeit (Codex-Review Phase 2, Befund 1).
   */
  private async openEntryLocked(tx: Tx, user: AuthUser) {
    await lockEmployeeTime(tx, user.id);
    const open = await tx.timeEntry.findFirst({
      where: { employeeId: user.id, endAt: null, voidedAt: null },
      include: { breaks: true },
    });
    // Auch Pause und Gehen sind nach dem Monatsabschluss gesperrt (Befund 2).
    if (open) await this.assertMonthOpenForSelf(tx, user, user.id, toLocalDate(open.workDate));
    return { open, now: this.clock.now() };
  }

  async clockIn(user: AuthUser): Promise<ClockResult> {
    await this.prisma.$transaction(async (tx) => {
      const { open, now } = await this.openEntryLocked(tx, user);
      if (open) throw new ConflictException('Du bist bereits eingestempelt.');
      const today = localDateInBerlin(now);
      await this.assertMonthOpenForSelf(tx, user, user.id, today);
      await this.assertNoOverlap(tx, user.id, { start: now, end: null, breaks: [] });
      await tx.timeEntry.create({
        data: {
          employeeId: user.id,
          workDate: fromLocalDate(today),
          startAt: now,
          source: 'CLOCK',
          recordedAt: now,
          recordedById: user.id,
        },
      });
    });
    return { today: await this.today(user), flags: [], closed: null };
  }

  async breakStart(user: AuthUser): Promise<ClockResult> {
    await this.prisma.$transaction(async (tx) => {
      const { open, now } = await this.openEntryLocked(tx, user);
      if (!open) throw new ConflictException('Du bist nicht eingestempelt.');
      if (open.breaks.some((b) => b.endAt === null))
        throw new ConflictException('Die Pause läuft bereits.');
      await tx.timeEntryBreak.create({ data: { entryId: open.id, startAt: now } });
    });
    return { today: await this.today(user), flags: [], closed: null };
  }

  async breakEnd(user: AuthUser): Promise<ClockResult> {
    await this.prisma.$transaction(async (tx) => {
      const { open, now } = await this.openEntryLocked(tx, user);
      const running = open?.breaks.find((b) => b.endAt === null);
      if (!running) throw new ConflictException('Es läuft keine Pause.');
      if (now <= running.startAt)
        throw new ConflictException(
          'Die Pause hat gerade erst begonnen. Bitte einen Moment warten.',
        );
      await tx.timeEntryBreak.update({ where: { id: running.id }, data: { endAt: now } });
    });
    return { today: await this.today(user), flags: [], closed: null };
  }

  async clockOut(user: AuthUser): Promise<ClockResult> {
    const { workDate, entryId } = await this.prisma.$transaction(async (tx) => {
      const { open, now } = await this.openEntryLocked(tx, user);
      if (!open) throw new ConflictException('Du bist nicht eingestempelt.');
      if (now <= open.startAt)
        throw new ConflictException(
          'Du hast gerade erst eingestempelt. Bitte einen Moment warten.',
        );
      if (now.getTime() - open.startAt.getTime() > 86_400_000) {
        throw new ConflictException(
          'Die Buchung läuft seit über 24 Stunden. Bitte das Ende über eine Korrektur eintragen.',
        );
      }
      for (const b of open.breaks.filter((b) => b.endAt === null)) {
        // Eine im selben Augenblick begonnene Pause hat keine Dauer und wird verworfen.
        if (now > b.startAt)
          await tx.timeEntryBreak.update({ where: { id: b.id }, data: { endAt: now } });
        else await tx.timeEntryBreak.delete({ where: { id: b.id } });
      }
      await tx.timeEntry.update({ where: { id: open.id }, data: { endAt: now } });
      return { workDate: toLocalDate(open.workDate), entryId: open.id };
    });
    const subject = await loadSubject(this.prisma, user, user.id);
    const flags = await this.dayFlags(subject, workDate);
    await this.recordViolations(user.id, user.id, workDate, flags);
    const closed = await this.prisma.timeEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: entryInclude,
    });
    return { today: await this.today(user), flags, closed: await this.entryView(closed) };
  }

  async today(user: AuthUser): Promise<TodayView> {
    const now = this.clock.now();
    const date = localDateInBerlin(now);
    const subject = await loadSubject(this.prisma, user, user.id);
    const monday = mondayOf(date);
    const from = addDays(date < monday ? date : monday, -14);
    const rows = await this.entriesBetween(
      this.prisma,
      user.id,
      addDays(from, -2),
      addDays(monday, 6),
    );
    // Offene Buchung vom Vortag (über Mitternacht) gehört trotzdem zum Status.
    const open = await this.prisma.timeEntry.findFirst({
      where: { employeeId: user.id, endAt: null, voidedAt: null },
      include: entryInclude,
    });
    const holidays = await holidaysBetween(this.prisma, addDays(from, -2), addDays(monday, 6));
    const names = await this.names(rows.map((r) => r.recordedById));
    const absences = await this.absences(user.id, from, addDays(monday, 6));
    const youth = await this.youthContext(subject, from, addDays(monday, 6));
    const days = buildDays(
      from,
      addDays(monday, 6),
      rows,
      subject,
      holidays,
      now,
      names,
      absences,
      youth,
    );
    const week = days.filter((d) => d.date >= monday);
    const todayView = days.find((d) => d.date === date);
    const terms = termsAt(subject.terms, date);
    const runningBreak = open?.breaks.find((b) => b.endAt === null);
    const isMinijob = terms?.type === 'MINIJOB';
    const weekTarget = week.reduce<number | null>(
      (sum, d) => (d.targetMinutes === null ? sum : (sum ?? 0) + d.targetMinutes),
      null,
    );

    // Vorwarnung für Jugendliche mit laufender Buchung (Phase 7, Abschnitt 7).
    const openDay = open ? toLocalDate(open.workDate) : null;
    const youthLimits =
      open && openDay && isYouthOn(subject.birthDate, openDay)
        ? youthDayLimits({
            workDate: openDay,
            entries: [
              ...rows.filter(
                (r) =>
                  r.voidedAt === null && r.id !== open.id && toLocalDate(r.workDate) === openDay,
              ),
              open,
            ].map(toWorkEntry),
            now,
          })
        : null;

    return {
      serverTime: now.toISOString(),
      date,
      youthLimits: youthLimits
        ? {
            latestEnd: berlinTime(youthLimits.latestEnd),
            latestBreak: youthLimits.latestBreak ? berlinTime(youthLimits.latestBreak) : null,
          }
        : null,
      state: !open ? 'OUT' : runningBreak ? 'PAUSE' : 'IN',
      since: runningBreak
        ? berlinTime(runningBreak.startAt)
        : open
          ? berlinTime(open.startAt)
          : null,
      isWorkday: todayView?.isWorkday ?? false,
      absence: todayView?.absence ?? null,
      workedMinutes:
        (todayView?.workMinutes ?? 0) +
        (open && toLocalDate(open.workDate) !== date ? workMinutes(toWorkEntry(open), now) : 0),
      entries: todayView?.entries ?? [],
      week: {
        workMinutes: week.reduce((sum, d) => sum + d.workMinutes, 0),
        targetMinutes: isMinijob ? null : weekTarget,
        balanceUntilYesterday: isMinijob
          ? null
          : week.filter((d) => d.date < date).reduce((sum, d) => sum + (d.balanceMinutes ?? 0), 0),
      },
      minijob: isMinijob ? await this.minijobMonth(subject, monthOf(date)) : null,
      overtime: await this.overtimeFor(subject),
      recentFlags: days
        .filter((d) => d.date >= addDays(date, -14) && d.date <= date)
        .map((d) => ({ date: d.date, flags: d.flags.filter((f) => f.level !== 'info') }))
        .filter((d) => d.flags.length > 0)
        .reverse(),
    };
  }

  // ---------------------------------------------------------------------------
  // Woche, Monat, Team heute
  // ---------------------------------------------------------------------------

  async week(user: AuthUser, employeeId: string, weekKey: string): Promise<WeekView> {
    const monday = mondayOfIsoWeek(weekKey);
    if (!monday) throw new BadRequestException('Bitte eine Woche im Format JJJJ-Www angeben.');
    const subject = await loadSubject(this.prisma, user, employeeId);
    const now = this.clock.now();
    const sunday = addDays(monday, 6);
    const rows = await this.entriesBetween(this.prisma, employeeId, addDays(monday, -2), sunday);
    const holidays = await holidaysBetween(this.prisma, addDays(monday, -2), sunday);
    const names = await this.names(rows.map((r) => r.recordedById));
    const absences = await this.absences(employeeId, monday, sunday);
    const youth = await this.youthContext(subject, monday, sunday);
    const days = buildDays(monday, sunday, rows, subject, holidays, now, names, absences, youth);
    const target = days.reduce<number | null>(
      (s, d) => (d.targetMinutes === null ? s : (s ?? 0) + d.targetMinutes),
      null,
    );
    const balance = days.reduce<number | null>(
      (s, d) => (d.balanceMinutes === null ? s : (s ?? 0) + d.balanceMinutes),
      null,
    );
    const months = [...new Set([monthOf(monday), monthOf(sunday)])];
    const closings = await this.prisma.monthClosing.findMany({
      where: { employeeId, month: { in: months }, reopenedAt: null },
    });
    const isMinijob =
      termsAt(subject.terms, monday)?.type === 'MINIJOB' ||
      termsAt(subject.terms, sunday)?.type === 'MINIJOB';
    return {
      employeeId,
      employeeName: subject.name,
      week: isoWeekKey(monday),
      from: monday,
      to: sunday,
      days,
      totals: {
        workMinutes: days.reduce((s, d) => s + d.workMinutes, 0),
        targetMinutes: target,
        balanceMinutes: balance,
      },
      minijob: isMinijob ? await this.minijobMonth(subject, monthOf(monday)) : null,
      closedMonths: closings.map((c) => c.month),
    };
  }

  async month(user: AuthUser, employeeId: string, month: string): Promise<MonthView> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new BadRequestException('Bitte einen Monat im Format JJJJ-MM angeben.');
    const subject = await loadSubject(this.prisma, user, employeeId);
    const { from, to } = monthRange(month);
    const now = this.clock.now();
    const rows = await this.entriesBetween(this.prisma, employeeId, addDays(from, -2), to);
    const holidays = await holidaysBetween(this.prisma, addDays(from, -2), to);
    const absences = await this.absences(employeeId, from, to);
    const youth = await this.youthContext(subject, from, to);
    const days = buildDays(from, to, rows, subject, holidays, now, new Map(), absences, youth);
    const target = days.reduce<number | null>(
      (s, d) => (d.targetMinutes === null ? s : (s ?? 0) + d.targetMinutes),
      null,
    );
    const balance = days.reduce<number | null>(
      (s, d) => (d.balanceMinutes === null ? s : (s ?? 0) + d.balanceMinutes),
      null,
    );
    return {
      employeeId,
      month,
      workMinutes: days.reduce((s, d) => s + d.workMinutes, 0),
      targetMinutes: target,
      balanceMinutes: balance,
      minijob:
        termsAt(subject.terms, to)?.type === 'MINIJOB' ||
        termsAt(subject.terms, from)?.type === 'MINIJOB'
          ? await this.minijobMonth(subject, month)
          : null,
      closed: await this.isMonthClosed(this.prisma, employeeId, month),
    };
  }

  /** Minijob-Monat gegen die Grenze (§ 8 Abs. 1a SGB IV); Werte aus LegalParameter am Monatsersten. */
  /**
   * Minijob-Monat gegen die Grenze (§ 8 Abs. 1a SGB IV): jede Buchung mit dem Stundenlohn ihres Arbeitstags
   * (Befund 7), Grenze aus LegalParameter am Monatsersten.
   */
  /** Minijob-Monat einer Person, deren Sichtbarkeit der Aufrufer geprüft hat (auch Prüfungen, Export). */
  async minijobMonth(subject: TimeSubject, month: string): Promise<MinijobMonthView | null> {
    const { from, to } = monthRange(month);
    const today = this.clock.today();
    // Minijob-Monat, sobald an einem Tag des Monats ein Minijob-Vertrag gilt, auch bei Wechsel mitten
    // im Monat (Codex-Review Phase 4 API, Befund 11). Angezeigter Lohn: der zuletzt geltende.
    const minijobTerms = eachDay(from, to < today ? to : today < from ? from : today)
      .map((d) => termsAt(subject.terms, d))
      .filter((t) => t?.type === 'MINIJOB' && t.hourlyWageCents !== null);
    const latest = minijobTerms.at(-1) ?? termsAt(subject.terms, from);
    if (!latest || latest.type !== 'MINIJOB' || latest.hourlyWageCents === null) return null;
    const legal = await loadLegalValues(this.prisma, from);
    if (!legal.current) return null;
    const rows = await this.prisma.timeEntry.findMany({
      where: {
        employeeId: subject.id,
        voidedAt: null,
        endAt: { not: null },
        workDate: { gte: fromLocalDate(from), lte: fromLocalDate(to) },
      },
      include: entryInclude,
    });
    const parts = rows.flatMap((r) => {
      const terms = termsAt(subject.terms, toLocalDate(r.workDate));
      return terms?.type === 'MINIJOB' && terms.hourlyWageCents !== null
        ? [{ minutes: workMinutes(toWorkEntry(r)), hourlyWageCents: terms.hourlyWageCents }]
        : [];
    });
    return {
      month,
      workMinutes: parts.reduce((sum, p) => sum + p.minutes, 0),
      hourlyWageCents: latest.hourlyWageCents,
      limitCents: legal.current.minijobMonthlyLimitCents,
      ...minijobMonthFromParts(parts, legal.current.minijobMonthlyLimitCents),
    };
  }

  /** Anwesenheit des Teams heute. Nur Vorgesetzte (eigenes Team) und Admin; Mitarbeiter sehen keine Stempeldaten anderer. */
  async teamToday(user: AuthUser): Promise<TeamTodayRow[]> {
    const now = this.clock.now();
    const today = localDateInBerlin(now);
    const people = await this.prisma.employee.findMany({
      where: { AND: [employeeScope(user), { id: { not: user.id } }] },
      include: { terms: { orderBy: { validFrom: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    const holidays = await holidaysBetween(this.prisma, today, today);
    const absent = await approvedAbsences(
      this.prisma,
      people.map((p) => p.id),
      today,
      today,
    );
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        employeeId: { in: people.map((p) => p.id) },
        voidedAt: null,
        OR: [{ workDate: fromLocalDate(today) }, { endAt: null }],
      },
      include: { breaks: true },
      orderBy: { startAt: 'asc' },
    });
    return people
      .filter((p) => !p.exitDate || toLocalDate(p.exitDate) >= today)
      .map((p) => {
        const own = entries.filter((e) => e.employeeId === p.id);
        const open = own.find((e) => e.endAt === null);
        const terms = termsAt(p.terms, today);
        const workday =
          !!terms && terms.workDays.includes(isoWeekday(today)) && !holidays.dates.has(today);
        const pause = open?.breaks.find((b) => b.endAt === null);
        const presence: TeamTodayRow['presence'] = open
          ? pause
            ? 'PAUSE'
            : 'PRESENT'
          : own.length
            ? 'LEFT'
            : workday && isSick(absent.get(p.id)?.get(today))
              ? 'SICK'
              : workday && absent.get(p.id)?.get(today)
                ? 'ABSENT'
                : workday
                  ? 'MISSING'
                  : 'NOT_WORKDAY';
        return {
          employeeId: p.id,
          name: p.name,
          jobTitle: p.jobTitle,
          presence,
          since: open ? berlinTime(pause?.startAt ?? open.startAt) : null,
        };
      });
  }

  // ---------------------------------------------------------------------------
  // Nachtrag
  // ---------------------------------------------------------------------------

  async createManual(user: AuthUser, input: ManualEntryInput): Promise<EntrySaveResult> {
    const employeeId = input.employeeId ?? user.id;
    const subject = await loadSubject(this.prisma, user, employeeId);
    if (employeeId !== user.id && !managesSubject(user, subject)) {
      throw new ForbiddenException(
        'Nachträge für andere dürfen nur Vorgesetzte für ihr Team und der Admin erfassen.',
      );
    }
    const now = this.clock.now();
    const today = localDateInBerlin(now);
    if (input.date > today) throw new BadRequestException('Das Datum liegt in der Zukunft.');
    if (input.date < subject.entryDate)
      throw new BadRequestException('Das Datum liegt vor dem Eintritt.');
    if (input.end === null && input.date !== today)
      throw new BadRequestException('„Gehen“ fehlt. Nur für heute darf es leer bleiben.');
    const span = resolveSpan(input.date, input, now);

    const row = await this.prisma.$transaction(async (tx) => {
      await lockEmployeeTime(tx, employeeId);
      await this.assertMonthOpenForSelf(tx, user, employeeId, input.date);
      await this.assertNoOverlap(tx, employeeId, span);
      const created = await tx.timeEntry.create({
        data: {
          employeeId,
          workDate: fromLocalDate(input.date),
          startAt: span.start,
          endAt: span.end,
          source: 'MANUAL',
          recordedAt: now,
          recordedById: user.id,
          reason: input.reason,
          breaks: { create: span.breaks.map((b) => ({ startAt: b.start, endAt: b.end })) },
        },
        include: entryInclude,
      });
      // Keine Begründung im Protokoll: Freitext kann personenbezogene Angaben enthalten.
      await this.audit.record(
        {
          action: 'time.entry.manual',
          actorId: user.id,
          entityType: 'TimeEntry',
          entityId: created.id,
          details: { employeeId, date: input.date },
        },
        tx,
      );
      return created;
    });
    const flags = await this.dayFlags(subject, input.date);
    await this.recordViolations(user.id, employeeId, input.date, flags);
    return { entry: await this.entryView(row), flags };
  }

  // ---------------------------------------------------------------------------
  // Korrekturen (Entscheidung 4, Variante B) und Revisionen
  // ---------------------------------------------------------------------------

  private async loadEntry(
    user: AuthUser,
    entryId: string,
  ): Promise<{ row: EntryRow; subject: TimeSubject }> {
    const row = await this.prisma.timeEntry.findUnique({
      where: { id: entryId },
      include: entryInclude,
    });
    if (!row) throw new NotFoundException('Buchung nicht gefunden.');
    // Sichtbarkeit über den zentralen Filter; fremde Buchungen ergeben 404.
    const subject = await loadSubject(this.prisma, user, row.employeeId).catch(() => {
      throw new NotFoundException('Buchung nicht gefunden.');
    });
    return { row, subject };
  }

  /** Sofort wirksam, wenn Vorgesetzte/r oder Admin für eine andere Person handelt, oder der Admin für sich. */
  private appliesDirectly(user: AuthUser, subject: TimeSubject): boolean {
    return managesSubject(user, subject) || (subject.id === user.id && user.role === 'ADMIN');
  }

  async correct(
    user: AuthUser,
    entryId: string,
    input: CorrectionInput,
  ): Promise<CorrectionResult> {
    const { row, subject } = await this.loadEntry(user, entryId);
    if (row.voidedAt) throw new ConflictException('Die Buchung ist bereits ungültig.');
    const date = toLocalDate(row.workDate);
    const now = this.clock.now();
    if (input.end === null && date !== localDateInBerlin(now)) {
      throw new BadRequestException('„Gehen“ fehlt. Nur für heute darf es leer bleiben.');
    }
    const span = resolveSpan(date, input, now);
    const proposed: CorrectionProposal = {
      date,
      start: input.start,
      end: input.end,
      breaks: [...input.breaks],
    };
    if (subject.id !== user.id && !this.appliesDirectly(user, subject)) {
      throw new ForbiddenException(
        'Buchungen anderer korrigieren nur Vorgesetzte für ihr Team und der Admin.',
      );
    }

    if (this.appliesDirectly(user, subject)) {
      const updated = await this.prisma.$transaction(async (tx) => {
        await lockEmployeeTime(tx, subject.id);
        await this.assertMonthOpenForSelf(tx, user, subject.id, date);
        await this.assertNoOverlap(tx, subject.id, span, row.id);
        return this.applyCorrection(tx, user.id, row.id, span, input.reason);
      });
      const flags = await this.dayFlags(subject, date);
      await this.recordViolations(user.id, subject.id, date, flags);
      return { applied: true, entry: await this.entryView(updated), request: null };
    }

    const request = await this.prisma.$transaction(async (tx) => {
      await lockEmployeeTime(tx, subject.id);
      await this.assertMonthOpenForSelf(tx, user, subject.id, date);
      await this.assertNoOverlap(tx, subject.id, span, row.id);
      return this.createRequest(tx, user, row.id, 'CORRECT', proposed, input.reason);
    });
    const fresh = await this.prisma.timeEntry.findUniqueOrThrow({
      where: { id: row.id },
      include: entryInclude,
    });
    return {
      applied: false,
      entry: await this.entryView(fresh),
      request: await this.requestView(request.id),
    };
  }

  async void(user: AuthUser, entryId: string, reason: string): Promise<CorrectionResult> {
    const { row, subject } = await this.loadEntry(user, entryId);
    if (row.voidedAt) throw new ConflictException('Die Buchung ist bereits ungültig.');
    if (subject.id !== user.id && !this.appliesDirectly(user, subject)) {
      throw new ForbiddenException(
        'Buchungen anderer markieren nur Vorgesetzte für ihr Team und der Admin als ungültig.',
      );
    }
    if (this.appliesDirectly(user, subject)) {
      const updated = await this.prisma.$transaction(async (tx) => {
        await lockEmployeeTime(tx, subject.id);
        await this.assertMonthOpenForSelf(tx, user, subject.id, toLocalDate(row.workDate));
        return this.applyVoid(tx, user.id, row.id, reason);
      });
      return { applied: true, entry: await this.entryView(updated), request: null };
    }
    const request = await this.prisma.$transaction(async (tx) => {
      await lockEmployeeTime(tx, subject.id);
      await this.assertMonthOpenForSelf(tx, user, subject.id, toLocalDate(row.workDate));
      return this.createRequest(tx, user, row.id, 'VOID', null, reason);
    });
    const fresh = await this.prisma.timeEntry.findUniqueOrThrow({
      where: { id: row.id },
      include: entryInclude,
    });
    return {
      applied: false,
      entry: await this.entryView(fresh),
      request: await this.requestView(request.id),
    };
  }

  private async createRequest(
    tx: Tx,
    user: AuthUser,
    entryId: string,
    kind: 'CORRECT' | 'VOID',
    proposed: CorrectionProposal | null,
    reason: string,
  ) {
    const pending = await tx.timeCorrectionRequest.findFirst({
      where: { entryId, status: 'PENDING' },
    });
    if (pending)
      throw new ConflictException('Für diese Buchung gibt es schon einen offenen Antrag.');
    const request = await tx.timeCorrectionRequest.create({
      data: {
        entryId,
        kind,
        ...(proposed ? { proposed: proposed as unknown as Prisma.InputJsonValue } : {}),
        reason,
        requestedById: user.id,
        requestedAt: this.clock.now(),
      },
    });
    await this.audit.record(
      {
        action: 'time.correction.request',
        actorId: user.id,
        entityType: 'TimeCorrectionRequest',
        entityId: request.id,
        details: { entryId, kind },
      },
      tx,
    );
    return request;
  }

  private async applyCorrection(
    tx: Tx,
    actorId: string,
    entryId: string,
    span: ResolvedSpan,
    reason: string,
  ): Promise<EntryRow> {
    const before = await tx.timeEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: entryInclude,
    });
    await tx.timeEntryBreak.deleteMany({ where: { entryId } });
    const after = await tx.timeEntry.update({
      where: { id: entryId },
      data: {
        startAt: span.start,
        endAt: span.end,
        breaks: { create: span.breaks.map((b) => ({ startAt: b.start, endAt: b.end })) },
      },
      include: entryInclude,
    });
    await tx.timeEntryRevision.create({
      data: {
        entryId,
        changedById: actorId,
        reason,
        before: snapshot(before) as unknown as Prisma.InputJsonValue,
        after: snapshot(after) as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record(
      { action: 'time.entry.correct', actorId, entityType: 'TimeEntry', entityId: entryId },
      tx,
    );
    return after;
  }

  /** Markiert ungültig, ohne Ende oder Pausen zu erfinden; auch alte laufende Buchungen (Befund 3). */
  private async applyVoid(
    tx: Tx,
    actorId: string,
    entryId: string,
    reason: string,
  ): Promise<EntryRow> {
    const before = await tx.timeEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: entryInclude,
    });
    const after = await tx.timeEntry.update({
      where: { id: entryId },
      data: { voidedAt: this.clock.now() },
      include: entryInclude,
    });
    await tx.timeEntryRevision.create({
      data: {
        entryId,
        changedById: actorId,
        reason,
        before: snapshot(before) as unknown as Prisma.InputJsonValue,
        after: snapshot(after) as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record(
      { action: 'time.entry.void', actorId, entityType: 'TimeEntry', entityId: entryId },
      tx,
    );
    return after;
  }

  async listCorrections(user: AuthUser, status?: string): Promise<CorrectionRequestView[]> {
    // Vertretung (Phase 3, Entscheidung 7): offene Anträge vertretener Personen, solange die
    // Vorgesetzte abwesend ist.
    const represented = await representedIds(this.prisma, user.id, this.clock.today());
    const where: Prisma.TimeCorrectionRequestWhereInput = {
      ...(status ? { status: status as 'PENDING' } : {}),
      OR: [
        { entry: { employee: employeeScope(user) } },
        ...(represented.size
          ? [{ status: 'PENDING' as const, entry: { employeeId: { in: [...represented] } } }]
          : []),
      ],
    };
    const rows = await this.prisma.timeCorrectionRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
    return Promise.all(rows.map((r) => this.requestView(r.id)));
  }

  private async requestView(id: string): Promise<CorrectionRequestView> {
    const r = await this.prisma.timeCorrectionRequest.findUniqueOrThrow({
      where: { id },
      include: { entry: { include: { breaks: true, employee: { select: { name: true } } } } },
    });
    const names = await this.names(r.decidedById ? [r.decidedById] : []);
    const breakMinutes = r.entry.breaks.reduce(
      (s, b) => s + (b.endAt ? Math.floor((b.endAt.getTime() - b.startAt.getTime()) / 60_000) : 0),
      0,
    );
    return {
      id: r.id,
      entryId: r.entryId,
      employeeId: r.entry.employeeId,
      employeeName: r.entry.employee.name,
      workDate: toLocalDate(r.entry.workDate),
      kind: r.kind,
      current: {
        start: berlinTime(r.entry.startAt),
        end: r.entry.endAt ? berlinTime(r.entry.endAt) : null,
        breakMinutes,
      },
      proposed: r.proposed as CorrectionProposal | null,
      reason: r.reason,
      requestedAt: r.requestedAt.toISOString(),
      status: r.status,
      decidedByName: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionReason: r.decisionReason,
    };
  }

  private async loadRequestForDecision(user: AuthUser, id: string) {
    const request = await this.prisma.timeCorrectionRequest.findUnique({
      where: { id },
      include: { entry: true },
    });
    if (!request) throw new NotFoundException('Antrag nicht gefunden.');
    const represented = await representedIds(this.prisma, user.id, this.clock.today());
    const employeeId = request.entry.employeeId;
    // Sichtbar über den zentralen Filter oder als Vertretung (Phase 3, Entscheidung 7).
    const subject = await loadSubject(this.prisma, user, employeeId, represented).catch(() => {
      throw new NotFoundException('Antrag nicht gefunden.');
    });
    if (!decidesFor(user, subject, represented))
      throw new ForbiddenException(
        'Über diesen Antrag entscheidet die/der Vorgesetzte, die Vertretung oder der Admin.',
      );
    return { request, subject };
  }

  async approve(user: AuthUser, id: string): Promise<CorrectionRequestView> {
    const { request, subject } = await this.loadRequestForDecision(user, id);
    const now = this.clock.now();
    const proposed = request.proposed as CorrectionProposal | null;
    const span =
      request.kind === 'CORRECT' && proposed ? resolveSpan(proposed.date, proposed, now) : null;
    await this.prisma.$transaction(async (tx) => {
      await lockEmployeeTime(tx, subject.id);
      const decided = await tx.timeCorrectionRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'APPROVED', decidedById: user.id, decidedAt: now },
      });
      if (decided.count !== 1) throw new ConflictException('Der Antrag ist nicht mehr offen.');
      const reason = `Antrag freigegeben: ${request.reason}`;
      if (span) {
        await this.assertNoOverlap(tx, subject.id, span, request.entryId);
        await this.applyCorrection(tx, user.id, request.entryId, span, reason);
      } else {
        await this.applyVoid(tx, user.id, request.entryId, reason);
      }
      await this.audit.record(
        {
          action: 'time.correction.approve',
          actorId: user.id,
          entityType: 'TimeCorrectionRequest',
          entityId: id,
        },
        tx,
      );
    });
    if (span)
      await this.recordViolations(
        user.id,
        subject.id,
        toLocalDate(request.entry.workDate),
        await this.dayFlags(subject, toLocalDate(request.entry.workDate)),
      );
    return this.requestView(id);
  }

  async reject(user: AuthUser, id: string, reason: string): Promise<CorrectionRequestView> {
    await this.loadRequestForDecision(user, id);
    await this.prisma.$transaction(async (tx) => {
      const decided = await tx.timeCorrectionRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          decidedById: user.id,
          decidedAt: this.clock.now(),
          decisionReason: reason,
        },
      });
      if (decided.count !== 1) throw new ConflictException('Der Antrag ist nicht mehr offen.');
      await this.audit.record(
        {
          action: 'time.correction.reject',
          actorId: user.id,
          entityType: 'TimeCorrectionRequest',
          entityId: id,
        },
        tx,
      );
    });
    return this.requestView(id);
  }

  async withdraw(user: AuthUser, id: string): Promise<CorrectionRequestView> {
    const request = await this.prisma.timeCorrectionRequest.findUnique({ where: { id } });
    if (!request || request.requestedById !== user.id)
      throw new NotFoundException('Antrag nicht gefunden.');
    const { count } = await this.prisma.timeCorrectionRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'WITHDRAWN', decidedAt: this.clock.now() },
    });
    if (count !== 1) throw new ConflictException('Der Antrag ist nicht mehr offen.');
    await this.audit.record({
      action: 'time.correction.withdraw',
      actorId: user.id,
      entityType: 'TimeCorrectionRequest',
      entityId: id,
    });
    return this.requestView(id);
  }

  async revisions(user: AuthUser, entryId: string): Promise<RevisionView[]> {
    await this.loadEntry(user, entryId);
    const rows = await this.prisma.timeEntryRevision.findMany({
      where: { entryId },
      orderBy: { id: 'asc' },
    });
    const names = await this.names(rows.map((r) => r.changedById));
    return rows.map((r) => ({
      id: r.id.toString(),
      changedAt: r.changedAt.toISOString(),
      changedByName: names.get(r.changedById) ?? null,
      reason: r.reason,
      before: r.before,
      after: r.after,
    }));
  }

  // ---------------------------------------------------------------------------
  // Monatsabschluss (Entscheidung 6)
  // ---------------------------------------------------------------------------

  async listClosings(user: AuthUser): Promise<MonthClosingView[]> {
    const rows = await this.prisma.monthClosing.findMany({
      where: { employeeId: user.id },
      orderBy: { month: 'desc' },
    });
    return rows.map((r) => ({
      month: r.month,
      confirmedAt: r.confirmedAt.toISOString(),
      reopenedAt: r.reopenedAt?.toISOString() ?? null,
    }));
  }

  /** Nur abgelaufene Monate, ohne laufende Buchung und ohne offene Korrekturanträge. */
  async closeMonth(user: AuthUser, month: string): Promise<MonthClosingView> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new BadRequestException('Bitte einen Monat im Format JJJJ-MM angeben.');
    const now = this.clock.now();
    if (month >= monthOf(localDateInBerlin(now)))
      throw new BadRequestException('Abschließen lässt sich nur ein vergangener Monat.');
    const { from, to } = monthRange(month);
    const row = await this.prisma.$transaction(async (tx) => {
      await lockEmployeeTime(tx, user.id);
      const range = { gte: fromLocalDate(from), lte: fromLocalDate(to) };
      if (
        await tx.timeEntry.findFirst({
          where: { employeeId: user.id, endAt: null, voidedAt: null, workDate: range },
        })
      ) {
        throw new ConflictException('In diesem Monat läuft noch eine Buchung.');
      }
      if (
        await tx.timeCorrectionRequest.findFirst({
          where: { status: 'PENDING', entry: { employeeId: user.id, workDate: range } },
        })
      ) {
        throw new ConflictException('In diesem Monat gibt es noch offene Korrekturanträge.');
      }
      const existing = await tx.monthClosing.findUnique({
        where: { employeeId_month: { employeeId: user.id, month } },
      });
      if (existing && !existing.reopenedAt)
        throw new ConflictException('Der Monat ist bereits abgeschlossen.');
      const saved = existing
        ? await tx.monthClosing.update({
            where: { employeeId_month: { employeeId: user.id, month } },
            data: { confirmedAt: now, reopenedAt: null, reopenedById: null },
          })
        : await tx.monthClosing.create({ data: { employeeId: user.id, month, confirmedAt: now } });
      await this.audit.record(
        {
          action: 'time.month.close',
          actorId: user.id,
          entityType: 'Employee',
          entityId: user.id,
          details: { month },
        },
        tx,
      );
      return saved;
    });
    return { month: row.month, confirmedAt: row.confirmedAt.toISOString(), reopenedAt: null };
  }

  async reopenMonth(admin: AuthUser, employeeId: string, month: string): Promise<MonthClosingView> {
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.monthClosing.updateMany({
        where: { employeeId, month, reopenedAt: null },
        data: { reopenedAt: now, reopenedById: admin.id },
      });
      if (count !== 1) throw new NotFoundException('Kein abgeschlossener Monat gefunden.');
      await this.audit.record(
        {
          action: 'time.month.reopen',
          actorId: admin.id,
          entityType: 'Employee',
          entityId: employeeId,
          details: { month },
        },
        tx,
      );
      return tx.monthClosing.findUniqueOrThrow({
        where: { employeeId_month: { employeeId, month } },
      });
    });
    return {
      month: row.month,
      confirmedAt: row.confirmedAt.toISOString(),
      reopenedAt: row.reopenedAt?.toISOString() ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Überstundenkonto (Entscheidung 7)
  // ---------------------------------------------------------------------------

  async overtime(user: AuthUser, employeeId: string): Promise<OvertimeView | null> {
    return this.overtimeFor(await loadSubject(this.prisma, user, employeeId));
  }

  /**
   * Saldo = Ist minus Soll je Tag vom Stichtag bis einschließlich gestern, plus wirksame Korrekturbuchungen.
   * Der laufende Tag zählt ab dem Folgetag, damit das Konto nicht morgens um das Tagessoll ins Minus fällt
   * (Befund 6, Spezifikation 12.7 präzisiert).
   */
  private async overtimeFor(subject: TimeSubject): Promise<OvertimeView | null> {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: subject.id },
      select: {
        overtimeAccountSince: true,
        overtimeAdjustments: { orderBy: { effectiveOn: 'asc' } },
      },
    });
    if (!employee.overtimeAccountSince) return null;
    const since = toLocalDate(employee.overtimeAccountSince);
    const now = this.clock.now();
    const yesterday = addDays(localDateInBerlin(now), -1);
    let balance = 0;
    if (since <= yesterday) {
      const rows = await this.entriesBetween(
        this.prisma,
        subject.id,
        addDays(since, -2),
        yesterday,
      );
      const holidays = await holidaysBetween(this.prisma, since, yesterday);
      const absences = await this.absences(subject.id, since, yesterday);
      for (const day of buildDays(
        since,
        yesterday,
        rows,
        subject,
        holidays,
        now,
        new Map(),
        absences,
      )) {
        balance += day.balanceMinutes ?? 0;
      }
    }
    // Korrekturbuchungen zählen erst ab ihrem Wirksamkeitsdatum (Befund 5).
    const today = localDateInBerlin(now);
    for (const a of employee.overtimeAdjustments)
      if (toLocalDate(a.effectiveOn) <= today) balance += a.minutes;
    return {
      since,
      balanceMinutes: balance,
      adjustments: employee.overtimeAdjustments.map((a) => ({
        id: a.id,
        minutes: a.minutes,
        effectiveOn: toLocalDate(a.effectiveOn),
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  async setOvertimeAccount(
    admin: AuthUser,
    employeeId: string,
    since: LocalDate | null,
  ): Promise<OvertimeView | null> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { terms: true },
    });
    if (!employee) throw new NotFoundException('Mitarbeiter nicht gefunden.');
    if (since && since < toLocalDate(employee.entryDate))
      throw new BadRequestException('Das Konto beginnt frühestens mit dem Eintritt.');
    if (since && termsAt(employee.terms, since)?.type === 'MINIJOB') {
      throw new BadRequestException(
        'Für Minijobs gibt es kein Überstundenkonto, weil es kein Soll gibt.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { overtimeAccountSince: since ? fromLocalDate(since) : null },
      });
      await this.audit.record(
        {
          action: 'time.overtime.account',
          actorId: admin.id,
          entityType: 'Employee',
          entityId: employeeId,
          details: { since },
        },
        tx,
      );
    });
    return this.overtime(admin, employeeId);
  }

  async addOvertimeAdjustment(
    admin: AuthUser,
    employeeId: string,
    input: { minutes: number; effectiveOn: LocalDate; reason: string },
  ): Promise<OvertimeView | null> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('Mitarbeiter nicht gefunden.');
    if (!employee.overtimeAccountSince)
      throw new ConflictException('Für diese Person ist kein Überstundenkonto aktiviert.');
    if (input.effectiveOn < toLocalDate(employee.overtimeAccountSince)) {
      throw new BadRequestException('Die Korrekturbuchung liegt vor dem Beginn des Kontos.');
    }
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.overtimeAdjustment.create({
        data: {
          employeeId,
          minutes: input.minutes,
          effectiveOn: fromLocalDate(input.effectiveOn),
          reason: input.reason,
          createdById: admin.id,
        },
      });
      await this.audit.record(
        {
          action: 'time.overtime.adjust',
          actorId: admin.id,
          entityType: 'OvertimeAdjustment',
          entityId: created.id,
          details: { employeeId, minutes: input.minutes },
        },
        tx,
      );
    });
    return this.overtime(admin, employeeId);
  }
}

/** Krankheit für „Team heute“; nur Vorgesetzte (Team) und Admin sehen diese Liste. */
function isSick(absence: DayAbsence | undefined): boolean {
  return absence?.type === 'SICK' || absence?.type === 'CHILD_SICK';
}
