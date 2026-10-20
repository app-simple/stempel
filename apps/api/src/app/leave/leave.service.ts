import { reconcileSickCredit, sickLeavesOverlapping } from '../sick/sick-credit';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  diffDays,
  eachDay,
  isoWeekday,
  localDateInBerlin,
  type CalendarCell,
  type LeaveAccountView,
  type LeaveCalendarView,
  type LeaveDecisionContext,
  type LeaveInput,
  type LeaveLedgerInput,
  type LeaveLedgerView,
  type LeavePreview,
  type LeaveRequestView,
  type LeaveStatus,
  type LocalDate,
} from '@as/shared';
import { businessDaysBetween, leaveHalfDays, leaveHalfDaysByYear } from '@as/time-rules';
import type { LeaveRequest, Prisma } from '../../generated/prisma/client';
import { decidesFor, isAbsent, representedIds } from '../access/deputy';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import {
  holidaysBetween,
  lockEmployeeTime,
  monthOf,
  monthRange,
  termsAt,
} from '../time/time-context';
import {
  holidaysFor,
  loadLeaveSubjects,
  spanOf,
  workDaysAtFor,
  yearAccount,
  type LeaveSubject,
} from './leave-context';
import { LeaveMailService, type LeaveMailFacts } from './leave-mail.service';

type Tx = Prisma.TransactionClient;

const MAX_SPAN_DAYS = 366;
const OPEN_STATUSES: LeaveStatus[] = ['PENDING', 'APPROVED'];

interface Access {
  user: AuthUser;
  today: LocalDate;
  represented: Set<string>;
}

/** Abwesenheiten (Spezifikation Phase 3). Rechte: Abschnitt 7, Vertretung: Entscheidung 7. */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly mails: LeaveMailService,
  ) {}

  // ---------- Rechte ----------

  private async access(user: AuthUser): Promise<Access> {
    const today = this.clock.today();
    return { user, today, represented: await representedIds(this.prisma, user.id, today) };
  }

  /** Darf die Person die Daten sehen? Eigene, Team (Vorgesetzte), alle (Admin), vertretene Personen. */
  private sees(a: Access, subject: Pick<LeaveSubject, 'id' | 'leadId'>): boolean {
    return (
      subject.id === a.user.id ||
      a.user.role === 'ADMIN' ||
      (a.user.role === 'LEAD' && subject.leadId === a.user.id) ||
      a.represented.has(subject.id)
    );
  }

  /** Eintragen für andere (Entscheidung 6): Vorgesetzte für ihr Team, Admin für alle. */
  private entersFor(user: AuthUser, subject: Pick<LeaveSubject, 'id' | 'leadId'>): boolean {
    return (
      subject.id !== user.id &&
      (user.role === 'ADMIN' || (user.role === 'LEAD' && subject.leadId === user.id))
    );
  }

  private async subject(a: Access, employeeId: string): Promise<LeaveSubject> {
    const subject = (await loadLeaveSubjects(this.prisma, [employeeId])).get(employeeId);
    if (!subject || !this.sees(a, subject))
      throw new NotFoundException('Mitarbeiter nicht gefunden.');
    return subject;
  }

  // ---------- Vorschau und Antrag ----------

  async preview(user: AuthUser, input: LeaveInput): Promise<LeavePreview> {
    const a = await this.access(user);
    const { subject } = await this.target(a, input);
    return this.evaluate(a, subject, input);
  }

  /** Für wen gilt der Antrag, und darf die Person das? */
  private async target(a: Access, input: LeaveInput): Promise<{ subject: LeaveSubject }> {
    const employeeId = input.employeeId ?? a.user.id;
    const subject = await this.subject(a, employeeId);
    if (employeeId !== a.user.id && !this.entersFor(a.user, subject))
      throw new ForbiddenException(
        'Abwesenheiten für andere tragen nur die/der Vorgesetzte und der Admin ein.',
      );
    return { subject };
  }

  private async evaluate(
    a: Access,
    subject: LeaveSubject,
    input: LeaveInput,
    excludeId?: string,
  ): Promise<LeavePreview> {
    const own = subject.id === a.user.id;
    const immediate = !own || a.user.role === 'ADMIN';
    const errors: string[] = [];
    const warnings: string[] = [];
    const empty: LeavePreview = {
      halfDays: 0,
      years: [],
      skippedHolidays: [],
      errors,
      warnings,
      immediate,
      deciderName: null,
    };
    if (input.from > input.to) {
      errors.push('Der letzte Tag liegt vor dem ersten.');
      return empty;
    }
    if (diffDays(input.from, input.to) >= MAX_SPAN_DAYS) {
      errors.push('Der Zeitraum darf höchstens ein Jahr lang sein.');
      return empty;
    }
    if (input.from === input.to && input.startHalf && input.endHalf) {
      errors.push('Ein eintägiger Antrag kann nur einen halben Tag haben.');
      return empty;
    }
    const span = {
      from: input.from,
      to: input.to,
      startHalf: input.startHalf,
      endHalf: input.endHalf,
    };
    const holidays = await holidaysBetween(this.prisma, input.from, input.to);
    const workDaysAt = workDaysAtFor(subject);
    const halfDays = leaveHalfDays(span, workDaysAt, holidays.dates);
    const byYear = leaveHalfDaysByYear(span, workDaysAt, holidays.dates);
    const skippedHolidays = [...holidays.names]
      .filter(([date]) => workDaysAt(date)?.includes(isoWeekday(date)))
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([date, name]) => ({ date, name }));

    if (input.from < subject.entryDate) errors.push('Der Zeitraum liegt vor dem Eintritt.');
    if (subject.exitDate && input.to > subject.exitDate)
      errors.push('Der Zeitraum liegt nach dem Austritt.');
    if (halfDays === 0)
      errors.push(
        own
          ? 'In diesem Zeitraum liegt keiner deiner Arbeitstage.'
          : 'In diesem Zeitraum liegt kein Arbeitstag laut Vertrag.',
      );
    // Rückwirkend nur beim Eintragen durch Vorgesetzte oder Admin (Entscheidung 6).
    if (input.from < a.today && !immediate)
      errors.push('Urlaub kann nur für kommende Tage beantragt werden.');
    if (input.type === 'OVERTIME_OFF') errors.push(...overtimeOffErrors(subject, input));
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId: subject.id,
        status: { in: OPEN_STATUSES },
        from: { lte: fromLocalDate(input.to) },
        to: { gte: fromLocalDate(input.from) },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (overlap)
      errors.push(
        own
          ? 'In diesem Zeitraum hast du schon einen Antrag.'
          : 'In diesem Zeitraum gibt es schon einen Antrag.',
      );
    errors.push(...(await closedMonthErrors(this.prisma, subject.id, input, a.today)));

    const years = await Promise.all(
      byYear.map(async ({ year, halfDays: days }) => {
        if (input.type !== 'VACATION')
          return { year, halfDays: days, restBefore: null, restAfter: null };
        const account = await yearAccount(this.prisma, subject, year);
        return { year, halfDays: days, restBefore: account.rest, restAfter: account.rest - days };
      }),
    );
    if (years.some((y) => y.restAfter !== null && y.restAfter < 0))
      warnings.push(own ? 'Das übersteigt dein Urlaubskonto.' : 'Das übersteigt das Urlaubskonto.');

    return {
      halfDays,
      years,
      skippedHolidays,
      errors,
      warnings,
      immediate,
      deciderName: immediate ? null : ((await this.deciders(subject, a.today))[0]?.name ?? null),
    };
  }

  /** Wer entscheidet bzw. bekommt die Mail (Entscheidung 7): Vorgesetzte, bei Abwesenheit die Vertretung, sonst Admins. */
  private async deciders(
    subject: LeaveSubject,
    today: LocalDate,
  ): Promise<{ id: string; name: string; loginEmail: string }[]> {
    const pick = { id: true, name: true, loginEmail: true } as const;
    // Nur Personen, die sich noch anmelden können (nicht gesperrt, nicht ausgetreten).
    const active = {
      lockedAt: null,
      OR: [{ exitDate: null }, { exitDate: { gte: fromLocalDate(today) } }],
    };
    const find = (id: string) =>
      this.prisma.employee.findFirst({ where: { id, ...active }, select: pick });
    if (subject.leadId && subject.leadId !== subject.id) {
      const lead = await find(subject.leadId);
      if (lead && !(await isAbsent(this.prisma, lead.id, today))) return [lead];
      if (lead && subject.deputyId && subject.deputyId !== subject.id) {
        const deputy = await find(subject.deputyId);
        if (deputy) return [deputy];
      }
    }
    return this.prisma.employee.findMany({
      where: { role: 'ADMIN', id: { not: subject.id }, ...active },
      select: pick,
      orderBy: { name: 'asc' },
    });
  }

  async create(user: AuthUser, input: LeaveInput): Promise<LeaveRequestView> {
    const a = await this.access(user);
    const { subject } = await this.target(a, input);
    const preview = await this.evaluate(a, subject, input);
    if (preview.errors.length) throw new UnprocessableEntityException(preview.errors.join(' '));
    const now = this.clock.now();
    let created: LeaveRequest;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Gleiche Sperre wie der Monatsabschluss; Abschluss innerhalb der Sperre erneut prüfen (Befund 3).
        await lockEmployeeTime(tx, subject.id);
        const closed = await closedMonthErrors(tx, subject.id, input, a.today);
        if (closed.length) throw new ConflictException(closed.join(' '));
        const row = await tx.leaveRequest.create({
          data: {
            employeeId: subject.id,
            type: input.type,
            from: fromLocalDate(input.from),
            to: fromLocalDate(input.to),
            startHalf: input.startHalf,
            endHalf: input.endHalf,
            halfDays: preview.halfDays,
            note: input.note ?? null,
            requestedAt: now,
            requestedById: user.id,
            ...(preview.immediate
              ? { status: 'APPROVED' as const, decidedAt: now, decidedById: user.id }
              : {}),
          },
        });
        await this.audit.record(
          {
            action: preview.immediate ? 'leave.request.entered' : 'leave.request.create',
            actorId: user.id,
            entityType: 'LeaveRequest',
            entityId: row.id,
            details: { type: input.type, halfDays: preview.halfDays },
          },
          tx,
        );
        await reconcileForVacation(tx, row.id, user.id);
        return row;
      });
    } catch (error) {
      if (isOverlapViolation(error))
        throw new ConflictException('In diesem Zeitraum gibt es schon einen Antrag.');
      throw error;
    }
    const facts = this.facts(subject, created);
    if (preview.immediate) {
      if (subject.id !== user.id) this.mails.send([subject.loginEmail], 'APPROVED', facts);
    } else {
      const deciders = await this.deciders(subject, a.today);
      this.mails.send(
        deciders.map((d) => d.loginEmail),
        'REQUESTED',
        facts,
      );
    }
    return this.view(a, created.id);
  }

  private facts(subject: LeaveSubject, r: LeaveRequest): LeaveMailFacts {
    return {
      employeeName: subject.name,
      type: r.type,
      from: toLocalDate(r.from),
      to: toLocalDate(r.to),
      halfDays: r.halfDays,
    };
  }

  // ---------- Entscheidungen ----------

  private async loadForAction(a: Access, id: string) {
    const request = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Antrag nicht gefunden.');
    const subject = (await loadLeaveSubjects(this.prisma, [request.employeeId])).get(
      request.employeeId,
    );
    if (!subject || !this.sees(a, subject)) throw new NotFoundException('Antrag nicht gefunden.');
    return { request, subject };
  }

  private assertDecides(a: Access, subject: LeaveSubject): void {
    if (!decidesFor(a.user, subject, a.represented))
      throw new ForbiddenException(
        'Über diesen Antrag entscheidet die/der Vorgesetzte, die Vertretung oder der Admin.',
      );
  }

  async approve(user: AuthUser, id: string): Promise<LeaveRequestView> {
    const a = await this.access(user);
    const { request, subject } = await this.loadForAction(a, id);
    this.assertDecides(a, subject);
    const span = spanOf(request);
    await this.transition(
      id,
      'PENDING',
      {
        status: 'APPROVED',
        decidedAt: this.clock.now(),
        decidedById: user.id,
      },
      'leave.request.approve',
      user.id,
      {},
      async (tx) => {
        // Voraussetzungen bei der Genehmigung erneut prüfen (Befunde 3 und 4).
        await lockEmployeeTime(tx, subject.id);
        const fresh = (await loadLeaveSubjects(tx, [subject.id])).get(subject.id) ?? subject;
        const errors = [
          ...(await closedMonthErrors(tx, subject.id, span, a.today)),
          ...(request.type === 'OVERTIME_OFF' ? overtimeOffErrors(fresh, span) : []),
        ];
        if (errors.length) throw new ConflictException(errors.join(' '));
      },
    );
    this.mails.send([subject.loginEmail], 'APPROVED', this.facts(subject, request));
    return this.view(a, id);
  }

  async reject(user: AuthUser, id: string, reason: string): Promise<LeaveRequestView> {
    const a = await this.access(user);
    const { request, subject } = await this.loadForAction(a, id);
    this.assertDecides(a, subject);
    await this.transition(
      id,
      'PENDING',
      {
        status: 'REJECTED',
        decidedAt: this.clock.now(),
        decidedById: user.id,
        decisionReason: reason,
      },
      'leave.request.reject',
      user.id,
    );
    this.mails.send([subject.loginEmail], 'REJECTED', this.facts(subject, request));
    return this.view(a, id);
  }

  async withdraw(user: AuthUser, id: string): Promise<LeaveRequestView> {
    const a = await this.access(user);
    const { request } = await this.loadForAction(a, id);
    if (request.employeeId !== user.id) throw new NotFoundException('Antrag nicht gefunden.');
    await this.transition(
      id,
      'PENDING',
      { status: 'WITHDRAWN' },
      'leave.request.withdraw',
      user.id,
    );
    return this.view(a, id);
  }

  /** Stornierung erbitten (Entscheidung 9): eigener genehmigter Antrag vor dessen Beginn. */
  async requestCancellation(user: AuthUser, id: string): Promise<LeaveRequestView> {
    const a = await this.access(user);
    const { request, subject } = await this.loadForAction(a, id);
    if (request.employeeId !== user.id) throw new NotFoundException('Antrag nicht gefunden.');
    this.assertNotStarted(a, request);
    const now = this.clock.now();
    // Der Admin hat keine Vorgesetzte; seine Stornierung gilt sofort (Entscheidung 8).
    if (user.role === 'ADMIN') {
      await this.transition(
        id,
        'APPROVED',
        {
          status: 'CANCELLED',
          cancelRequestedAt: now,
          cancelledAt: now,
          cancelledById: user.id,
        },
        'leave.request.cancel',
        user.id,
      );
      return this.view(a, id);
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.leaveRequest.updateMany({
        where: { id, status: 'APPROVED', cancelRequestedAt: null },
        data: { cancelRequestedAt: now },
      });
      if (count !== 1)
        throw new ConflictException('Die Stornierung ist bereits erbeten oder nicht möglich.');
      await this.audit.record(
        {
          action: 'leave.request.cancel-request',
          actorId: user.id,
          entityType: 'LeaveRequest',
          entityId: id,
        },
        tx,
      );
    });
    const deciders = await this.deciders(subject, a.today);
    this.mails.send(
      deciders.map((d) => d.loginEmail),
      'CANCEL_REQUESTED',
      this.facts(subject, request),
    );
    return this.view(a, id);
  }

  async approveCancellation(user: AuthUser, id: string): Promise<LeaveRequestView> {
    const a = await this.access(user);
    const { request, subject } = await this.loadForAction(a, id);
    this.assertDecides(a, subject);
    if (!request.cancelRequestedAt)
      throw new ConflictException('Für diesen Antrag ist keine Stornierung erbeten.');
    this.assertNotStarted(a, request);
    await this.transition(
      id,
      'APPROVED',
      {
        status: 'CANCELLED',
        cancelledAt: this.clock.now(),
        cancelledById: user.id,
      },
      'leave.request.cancel',
      user.id,
      { cancelRequestedAt: { not: null } },
    );
    this.mails.send([subject.loginEmail], 'CANCELLED', this.facts(subject, request));
    return this.view(a, id);
  }

  async rejectCancellation(user: AuthUser, id: string): Promise<LeaveRequestView> {
    const a = await this.access(user);
    const { request, subject } = await this.loadForAction(a, id);
    this.assertDecides(a, subject);
    await this.transition(
      id,
      'APPROVED',
      { cancelRequestedAt: null },
      'leave.request.cancel-reject',
      user.id,
      { cancelRequestedAt: { not: null } },
    );
    this.mails.send([subject.loginEmail], 'CANCEL_REJECTED', this.facts(subject, request));
    return this.view(a, id);
  }

  private assertNotStarted(a: Access, request: LeaveRequest): void {
    if (request.status !== 'APPROVED')
      throw new ConflictException('Nur genehmigte Abwesenheiten lassen sich stornieren.');
    if (toLocalDate(request.from) <= a.today)
      throw new ConflictException(
        'Die Abwesenheit hat bereits begonnen. Änderungen danach nur per Korrekturbuchung durch den Admin.',
      );
  }

  /** Statuswechsel genau einmal (parallele Entscheidungen: eine gewinnt, die andere erhält 409). */
  private async transition(
    id: string,
    from: LeaveStatus,
    data: Prisma.LeaveRequestUpdateManyMutationInput,
    action: string,
    actorId: string,
    extra: Prisma.LeaveRequestWhereInput = {},
    guard?: (tx: Tx) => Promise<void>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Zeitsperre der Person zuerst, vor jeder Zeilensperre: gleiche Reihenfolge wie Monatsabschluss
      // und Krankmeldungen, keine Verklemmung mit dem Abgleich der Rückbuchungen.
      const current = await tx.leaveRequest.findUnique({
        where: { id },
        select: { employeeId: true },
      });
      if (current) await lockEmployeeTime(tx, current.employeeId);
      if (guard) await guard(tx);
      const { count } = await tx.leaveRequest.updateMany({
        where: { id, status: from, ...extra },
        data,
      });
      if (count !== 1) throw new ConflictException('Der Antrag ist nicht mehr offen.');
      await this.audit.record({ action, actorId, entityType: 'LeaveRequest', entityId: id }, tx);
      await reconcileForVacation(tx, id, actorId);
    });
  }

  // ---------- Lesen ----------

  async list(
    user: AuthUser,
    filter: { employeeId?: string; status?: LeaveStatus; year?: number },
  ): Promise<LeaveRequestView[]> {
    const a = await this.access(user);
    // Kein leeres Objekt in `OR`: Prisma wertet `OR: [{}]` nicht als „alle“.
    const visible: Prisma.LeaveRequestWhereInput[] = [{ employeeId: user.id }];
    if (user.role === 'LEAD') visible.push({ employee: { leadId: user.id } });
    if (a.represented.size)
      visible.push({
        employeeId: { in: [...a.represented] },
        OR: [{ status: 'PENDING' }, { status: 'APPROVED', cancelRequestedAt: { not: null } }],
      });
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        AND: [
          user.role === 'ADMIN' ? {} : { OR: visible },
          filter.employeeId ? { employeeId: filter.employeeId } : {},
          filter.status ? { status: filter.status } : {},
          filter.year
            ? {
                from: { lte: fromLocalDate(`${filter.year}-12-31`) },
                to: { gte: fromLocalDate(`${filter.year}-01-01`) },
              }
            : {},
        ],
      },
      orderBy: [{ from: 'asc' }, { requestedAt: 'asc' }],
      take: 500,
    });
    return this.views(a, rows);
  }

  private async view(a: Access, id: string): Promise<LeaveRequestView> {
    const row = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    const [view] = await this.views(a, [row]);
    if (!view) throw new NotFoundException('Antrag nicht gefunden.');
    return view;
  }

  private async views(a: Access, rows: LeaveRequest[]): Promise<LeaveRequestView[]> {
    if (rows.length === 0) return [];
    const subjects = await loadLeaveSubjects(
      this.prisma,
      rows.map((r) => r.employeeId),
    );
    const names = await this.names(
      rows.flatMap((r) => [r.requestedById, r.decidedById, r.cancelledById]),
    );
    const holidays = await holidaysFor(
      this.prisma,
      rows.map((r) => spanOf(r)),
    );
    return Promise.all(
      rows.map(async (r) => {
        const subject = required(subjects, r.employeeId);
        const decides =
          decidesFor(a.user, subject, a.represented) &&
          (r.status === 'PENDING' || (r.status === 'APPROVED' && r.cancelRequestedAt !== null));
        return {
          id: r.id,
          employeeId: r.employeeId,
          employeeName: subject.name,
          jobTitle: subject.jobTitle,
          type: r.type,
          from: toLocalDate(r.from),
          to: toLocalDate(r.to),
          startHalf: r.startHalf,
          endHalf: r.endHalf,
          halfDays: r.halfDays,
          currentHalfDays: leaveHalfDays(spanOf(r), workDaysAtFor(subject), holidays.dates),
          note: r.note,
          status: r.status,
          requestedAt: r.requestedAt.toISOString(),
          enteredByName:
            r.requestedById !== r.employeeId ? (names.get(r.requestedById) ?? null) : null,
          decidedByName: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
          decidedAt: r.decidedAt?.toISOString() ?? null,
          decisionReason: r.decisionReason,
          cancelRequestedAt: r.cancelRequestedAt?.toISOString() ?? null,
          cancelledAt: r.cancelledAt?.toISOString() ?? null,
          cancelledByName: r.cancelledById ? (names.get(r.cancelledById) ?? null) : null,
          canDecide: decides,
          decision: decides ? await this.decisionContext(a, subject, r) : null,
        };
      }),
    );
  }

  /** Konto nach Genehmigung und Überschneidungen im Team (Konzept 4.2 Schritt 3, `overlaps` im Prototyp). */
  private async decisionContext(
    a: Access,
    subject: LeaveSubject,
    r: LeaveRequest,
  ): Promise<LeaveDecisionContext> {
    const span = spanOf(r);
    let restAfter: LeaveDecisionContext['restAfter'] = null;
    if (r.type === 'VACATION') {
      const years = [...new Set([Number(span.from.slice(0, 4)), Number(span.to.slice(0, 4))])];
      restAfter = await Promise.all(
        years.map(async (year) => ({
          year,
          rest: (await yearAccount(this.prisma, subject, year)).rest,
        })),
      );
    }
    const teamFilter: Prisma.EmployeeWhereInput = subject.leadId
      ? { OR: [{ leadId: subject.leadId }, { id: subject.leadId }] }
      : { leadId: subject.id };
    const all = await this.prisma.leaveRequest.findMany({
      where: {
        id: { not: r.id },
        employeeId: { not: subject.id },
        status: { in: OPEN_STATUSES },
        from: { lte: r.to },
        to: { gte: r.from },
        employee: teamFilter,
      },
      include: { employee: { select: { name: true, leadId: true } } },
      orderBy: { from: 'asc' },
    });
    // Namen nur für Personen im eigenen Sichtbereich; eine Vertretung sieht übrige Kollegen nur als
    // Anzahl (Befund 1, Datensparsamkeit).
    const named = all.filter((o) => this.sees(a, { id: o.employeeId, leadId: o.employee.leadId }));
    const holidays = await holidaysBetween(this.prisma, localDateInBerlin(r.requestedAt), a.today);
    return {
      restAfter,
      otherOverlaps: all.length - named.length,
      overlaps: named.map((o) => ({
        employeeName: o.employee.name,
        from: toLocalDate(o.from),
        to: toLocalDate(o.to),
        status: o.status as 'PENDING' | 'APPROVED',
      })),
      openBusinessDays:
        r.status === 'PENDING'
          ? businessDaysBetween(localDateInBerlin(r.requestedAt), a.today, holidays.dates)
          : 0,
    };
  }

  async account(user: AuthUser, employeeId: string, year: number): Promise<LeaveAccountView> {
    const a = await this.access(user);
    const subject = await this.subject(a, employeeId);
    return this.accountView(subject, year, a.today);
  }

  /** Kontenliste (Konzept 4.4): Vorgesetzte ihr Team einschließlich sich selbst, Admin alle. */
  async accounts(user: AuthUser, year: number): Promise<LeaveAccountView[]> {
    const a = await this.access(user);
    const rows = await this.prisma.employee.findMany({
      where: {
        AND: [
          user.role === 'ADMIN' ? {} : { OR: [{ id: user.id }, { leadId: user.id }] },
          { entryDate: { lte: fromLocalDate(`${year}-12-31`) } },
          { OR: [{ exitDate: null }, { exitDate: { gte: fromLocalDate(`${year}-01-01`) } }] },
        ],
      },
      select: { id: true },
      orderBy: { name: 'asc' },
    });
    const subjects = await loadLeaveSubjects(
      this.prisma,
      rows.map((r) => r.id),
    );
    return Promise.all(rows.map((r) => this.accountView(required(subjects, r.id), year, a.today)));
  }

  private async accountView(
    subject: LeaveSubject,
    year: number,
    today: LocalDate,
  ): Promise<LeaveAccountView> {
    const account = await yearAccount(this.prisma, subject, year);
    const terms = termsAt(subject.terms, today < `${year}-01-01` ? `${year}-01-01` : today);
    return {
      employeeId: subject.id,
      employeeName: subject.name,
      year,
      entitlement: account.entitlement.halfDays,
      entitlementBasis: account.entitlement.basis,
      carryOver: account.carryOver,
      corrections: account.corrections,
      approved: account.approved,
      pending: account.pending,
      rest: account.rest,
      workDaysPerWeek: terms ? new Set(terms.workDays).size : 0,
      employmentType: terms?.type ?? null,
    };
  }

  /**
   * Kalender eines Monats (Konzept 4.4): Vorgesetzte ihr Team mit Namen, Admin alle. Mitarbeiter nur die
   * eigene Zeile und die Anzahl genehmigter Abwesenheiten im eigenen Team je Tag, ohne Namen, ohne
   * offene Anträge anderer. Nie die Art der Abwesenheit.
   */
  async calendar(user: AuthUser, month: string): Promise<LeaveCalendarView> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new UnprocessableEntityException('Bitte einen Monat im Format JJJJ-MM angeben.');
    const { from, to } = monthRange(month);
    const dates = eachDay(from, to);
    const holidays = await holidaysBetween(this.prisma, from, to);
    const me = await this.prisma.employee.findUniqueOrThrow({ where: { id: user.id } });
    const rowFilter: Prisma.EmployeeWhereInput =
      user.role === 'ADMIN'
        ? {}
        : user.role === 'LEAD'
          ? { OR: [{ id: user.id }, { leadId: user.id }] }
          : { id: user.id };
    const employed: Prisma.EmployeeWhereInput = {
      entryDate: { lte: fromLocalDate(to) },
      OR: [{ exitDate: null }, { exitDate: { gte: fromLocalDate(from) } }],
    };
    const rowIds = (
      await this.prisma.employee.findMany({
        where: { AND: [rowFilter, employed] },
        select: { id: true },
        orderBy: { name: 'asc' },
      })
    ).map((r) => r.id);
    // Kollegen im eigenen Team: gleiche Vorgesetzte, dazu die Vorgesetzte selbst (`anonRow` im Prototyp).
    const peerIds =
      user.role === 'EMPLOYEE' && me.leadId
        ? (
            await this.prisma.employee.findMany({
              where: {
                AND: [
                  { OR: [{ leadId: me.leadId }, { id: me.leadId }] },
                  { id: { not: user.id } },
                  employed,
                ],
              },
              select: { id: true },
            })
          ).map((r) => r.id)
        : [];
    const subjects = await loadLeaveSubjects(this.prisma, [...rowIds, ...peerIds]);
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: [...rowIds, ...peerIds] },
        status: { in: OPEN_STATUSES },
        from: { lte: fromLocalDate(to) },
        to: { gte: fromLocalDate(from) },
      },
    });
    // Krankheit erscheint im Kalender nur als genehmigte Abwesenheit, ohne Art (Phase 6, Abschnitt 2).
    const sickLeaves = await this.prisma.sickLeave.findMany({
      where: {
        employeeId: { in: [...rowIds, ...peerIds] },
        from: { lte: fromLocalDate(to) },
        to: { gte: fromLocalDate(from) },
      },
      select: { employeeId: true, from: true, to: true },
    });
    const isSickOn = (subject: LeaveSubject, date: LocalDate) =>
      sickLeaves.some(
        (x) =>
          x.employeeId === subject.id && toLocalDate(x.from) <= date && toLocalDate(x.to) >= date,
      );
    const worksOn = (subject: LeaveSubject, date: LocalDate) =>
      !holidays.dates.has(date) && !!workDaysAtFor(subject)(date)?.includes(isoWeekday(date));
    const cellFor = (
      subject: LeaveSubject,
      date: LocalDate,
      approvedOnly: boolean,
    ): CalendarCell => {
      if (isSickOn(subject, date) && worksOn(subject, date))
        return { status: 'APPROVED', half: false };
      const r = requests.find(
        (x) =>
          x.employeeId === subject.id &&
          toLocalDate(x.from) <= date &&
          toLocalDate(x.to) >= date &&
          (!approvedOnly || x.status === 'APPROVED'),
      );
      if (!r || !worksOn(subject, date)) return null;
      const half =
        (toLocalDate(r.from) === date && r.startHalf) || (toLocalDate(r.to) === date && r.endHalf);
      return { status: r.status as 'PENDING' | 'APPROVED', half };
    };
    return {
      month,
      days: dates.map((date) => ({
        date,
        weekday: isoWeekday(date),
        holidayName: holidays.names.get(date) ?? null,
      })),
      rows: rowIds.map((id) => {
        const subject = required(subjects, id);
        return {
          employeeId: id,
          name: subject.name,
          cells: dates.map((d) => cellFor(subject, d, false)),
          offDays: dates.map(
            (d) => !holidays.dates.has(d) && isoWeekday(d) <= 6 && !worksOn(subject, d),
          ),
        };
      }),
      teamAbsentCounts:
        user.role === 'EMPLOYEE'
          ? dates.map(
              (d) =>
                peerIds.filter((id) => cellFor(required(subjects, id), d, true) !== null).length,
            )
          : null,
    };
  }

  // ---------- Korrekturbuchungen (Admin) ----------

  async ledger(user: AuthUser, employeeId: string): Promise<LeaveLedgerView[]> {
    const a = await this.access(user);
    await this.subject(a, employeeId);
    const rows = await this.prisma.leaveLedgerEntry.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
    const names = await this.names(rows.map((r) => r.createdById));
    return rows.map((r) => ({
      id: r.id,
      year: r.year,
      kind: r.kind,
      halfDays: r.halfDays,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      createdByName: names.get(r.createdById) ?? null,
    }));
  }

  async addLedger(
    user: AuthUser,
    employeeId: string,
    input: LeaveLedgerInput,
  ): Promise<LeaveLedgerView[]> {
    const a = await this.access(user);
    await this.subject(a, employeeId);
    await this.prisma.$transaction(async (tx) => {
      await lockEmployeeTime(tx, employeeId);
      const row = await tx.leaveLedgerEntry.create({
        data: {
          employeeId,
          year: input.year,
          kind: 'CORRECTION',
          halfDays: input.halfDays,
          note: input.note,
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          action: 'leave.ledger.correction',
          actorId: user.id,
          entityType: 'LeaveLedgerEntry',
          entityId: row.id,
          details: { year: input.year, halfDays: input.halfDays },
        },
        tx,
      );
    });
    return this.ledger(user, employeeId);
  }

  private async names(ids: Iterable<string | null>): Promise<Map<string, string>> {
    const list = [...new Set([...ids].filter((x): x is string => !!x))];
    if (list.length === 0) return new Map();
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: list } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

function required<T>(map: ReadonlyMap<string, T>, id: string): T {
  const value = map.get(id);
  if (value === undefined) throw new NotFoundException('Mitarbeiter nicht gefunden.');
  return value;
}

/** Abgeschlossene Monate im Zeitraum bis heute (Entscheidung 6); nur zurückliegende Tage zählen. */
/**
 * Rückbuchungen nach § 9 BUrlG für Krankmeldungen, die einen Urlaub überschneiden, nach jeder
 * Statusänderung des Urlaubs abgleichen (Genehmigung, sofort genehmigte Eintragung, Stornierung;
 * Spezifikation Phase 6, Abschnitt 6, Sicherheitsreview Befund 3). Unter der Zeitsperre der Person.
 */
async function reconcileForVacation(tx: Tx, requestId: string, actorId: string): Promise<void> {
  const request = await tx.leaveRequest.findUnique({ where: { id: requestId } });
  if (!request || request.type !== 'VACATION') return;
  const ids = await sickLeavesOverlapping(tx, request.employeeId, request.from, request.to);
  if (!ids.length) return;
  await lockEmployeeTime(tx, request.employeeId);
  for (const id of ids) await reconcileSickCredit(tx, request.employeeId, id, actorId);
}

export async function closedMonthErrors(
  db: Pick<Tx, 'monthClosing'>,
  employeeId: string,
  span: { from: LocalDate; to: LocalDate },
  today: LocalDate,
): Promise<string[]> {
  if (span.from > today) return [];
  const months = [...new Set(eachDay(span.from, span.to < today ? span.to : today).map(monthOf))];
  const closed = await db.monthClosing.findMany({
    where: { employeeId, month: { in: months }, reopenedAt: null },
    orderBy: { month: 'asc' },
  });
  return closed.map((c) => `Der Monat ${formatMonth(c.month)} ist abgeschlossen.`);
}

/** Überstundenabbau: aktives Konto ab dem ersten Tag und an keinem Tag ein Minijob-Vertrag (Befund 4). */
function overtimeOffErrors(
  subject: LeaveSubject,
  span: { from: LocalDate; to: LocalDate },
): string[] {
  const errors: string[] = [];
  if (!subject.overtimeAccountSince || subject.overtimeAccountSince > span.from)
    errors.push('Überstundenabbau ist nur mit aktivem Überstundenkonto möglich.');
  if (eachDay(span.from, span.to).some((d) => termsAt(subject.terms, d)?.type === 'MINIJOB'))
    errors.push('Minijobber haben kein Überstundenkonto.');
  return errors;
}

/** Verletzung des Exclusion Constraints `LeaveRequest_no_overlap` (SQLSTATE 23P01). */
function isOverlapViolation(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}`
      : '';
  return text.includes('LeaveRequest_no_overlap') || text.includes('23P01');
}

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

function formatMonth(month: string): string {
  return `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
}
