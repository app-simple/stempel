import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  addDays,
  berlinTime,
  formatLocalDate,
  type LocalDate,
  diffDays,
  type SickChecksView,
  type SickLeaveInput,
  type SickLeaveUpdate,
  type SickLeaveView,
} from '@as/shared';
import { certificateDue, sixWeeksReachedOn } from '@as/time-rules';
import type { Employee, EmploymentTerms, Prisma, SickLeave } from '../../generated/prisma/client';
import { isAbsent } from '../access/deputy';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { closedMonthErrors } from '../leave/leave.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { holidaysBetween, lockEmployeeTime, termsAt } from '../time/time-context';
import { reconcileSickCredit } from './sick-credit';

/** Selbstmeldung höchstens so viele Kalendertage rückwirkend (Spezifikation Phase 6, Abschnitt 4). */
const SELF_BACKDATE_DAYS = 7;
/**
 * Selbstmeldung und -verlängerung reichen höchstens so weit voraus; länger und geplant (z. B. Operation)
 * tragen Vorgesetzte oder der Admin ein (Sicherheitsreview Phase 6).
 */
const SELF_AHEAD_DAYS = 14;

type Subject = Employee & { terms: EmploymentTerms[] };

/**
 * Krankmeldungen (Spezifikation Phase 6). Sichtbar und erfassbar für die Person selbst, ihre
 * Vorgesetzte (eigenes Team) und den Admin; AU-Vermerk durch Vorgesetzte und Admin; Löschen nur durch
 * den Admin. Keine Gründe oder Diagnosen; Audit nur mit Art und Zeitraum.
 */
@Injectable()
export class SickService {
  private readonly logger = new Logger('Sick');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ---------- Rechte ----------

  private sees(user: AuthUser, subject: Pick<Employee, 'id' | 'leadId'>): boolean {
    return (
      subject.id === user.id ||
      user.role === 'ADMIN' ||
      (user.role === 'LEAD' && subject.leadId === user.id)
    );
  }

  /** AU-Vermerk: Vorgesetzte für ihr Team, Admin für alle (auch sich selbst). */
  private certifies(user: AuthUser, subject: Pick<Employee, 'id' | 'leadId'>): boolean {
    if (user.role === 'ADMIN') return true;
    return user.role === 'LEAD' && subject.id !== user.id && subject.leadId === user.id;
  }

  private async subject(user: AuthUser, employeeId: string): Promise<Subject> {
    const subject = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { terms: true },
    });
    if (!subject || !this.sees(user, subject))
      throw new NotFoundException('Mitarbeiter nicht gefunden.');
    return subject;
  }

  private async load(user: AuthUser, id: string): Promise<{ row: SickLeave; subject: Subject }> {
    const row = await this.prisma.sickLeave.findUnique({ where: { id } });
    if (!row || row.kind === 'NEUTRAL') throw new NotFoundException('Krankmeldung nicht gefunden.');
    const subject = await this.prisma.employee.findUnique({
      where: { id: row.employeeId },
      include: { terms: true },
    });
    if (!subject || !this.sees(user, subject))
      throw new NotFoundException('Krankmeldung nicht gefunden.');
    return { row, subject };
  }

  // ---------- Erfassen und Ändern ----------

  async create(user: AuthUser, input: SickLeaveInput): Promise<SickLeaveView> {
    const subject = await this.subject(user, input.employeeId ?? user.id);
    const today = this.clock.today();
    const own = subject.id === user.id;
    if (input.to < input.from) throw new BadRequestException('Das Ende liegt vor dem Beginn.');
    if (own && user.role !== 'ADMIN') {
      if (input.from < addDays(today, -SELF_BACKDATE_DAYS))
        throw new BadRequestException(
          `Eine Krankmeldung kannst du höchstens ${SELF_BACKDATE_DAYS} Tage rückwirkend eintragen. Ältere Zeiträume trägt deine Vorgesetzte oder der Admin ein.`,
        );
      if (input.from > today)
        throw new BadRequestException(
          'Eine Krankmeldung beginnt spätestens heute. Geplante Abwesenheiten trägt deine Vorgesetzte oder der Admin ein.',
        );
      this.assertSelfAhead(input.to, today);
    }
    this.assertEmployed(subject, input.from, input.to);
    if (input.sinceNow && input.from !== today)
      throw new BadRequestException('„Ab jetzt“ geht nur für eine Krankmeldung ab heute.');
    const now = this.clock.now();
    const sinceMinute = input.sinceNow ? minuteOfDay(berlinTime(now)) : null;
    await holidaysBetween(this.prisma, input.from, input.to);
    let created: SickLeave;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await lockEmployeeTime(tx, subject.id);
        await this.assertOpenMonths(tx, subject.id, input.from, input.to, today);
        const row = await tx.sickLeave.create({
          data: {
            employeeId: subject.id,
            kind: input.kind,
            from: fromLocalDate(input.from),
            to: fromLocalDate(input.to),
            sinceMinute,
            reportedAt: now,
            reportedById: user.id,
          },
        });
        await this.record(tx, 'sick.create', user, row);
        return row;
      });
    } catch (error) {
      if (isOverlap(error))
        throw new ConflictException('Für diesen Zeitraum gibt es schon eine Krankmeldung.');
      throw error;
    }
    // Nur bei Selbstmeldung: neutrale E-Mail an die Vorgesetzte (Abschnitt 7).
    if (own) await this.notify(subject, created, false);
    return this.view(user, created.id);
  }

  async update(user: AuthUser, id: string, input: SickLeaveUpdate): Promise<SickLeaveView> {
    const { row, subject } = await this.load(user, id);
    const today = this.clock.today();
    const from = toLocalDate(row.from);
    const oldTo = toLocalDate(row.to);
    const yesterday = addDays(today, -1);
    const to = input.endToday ? (yesterday < from ? from : yesterday) : input.to;
    if (!to) throw new BadRequestException('Bitte ein Ende angeben.');
    if (to < from) throw new BadRequestException('Das Ende liegt vor dem Beginn.');
    const own = subject.id === user.id && user.role !== 'ADMIN';
    // Die Person ändert nur laufende und künftige Tage; rückwirkend nur Vorgesetzte und Admin. Eine
    // abgelaufene Krankmeldung verlängert sie nicht (sonst Rückdatieren ohne Grenze, Sicherheitsreview).
    if (own) {
      if (oldTo < yesterday)
        throw new BadRequestException(
          'Abgelaufene Krankmeldungen ändern nur deine Vorgesetzte und der Admin.',
        );
      if (to < yesterday && to < oldTo)
        throw new BadRequestException(
          'Rückwirkend kürzen können nur deine Vorgesetzte und der Admin.',
        );
      if (to > oldTo) this.assertSelfAhead(to, today);
    }
    this.assertEmployed(subject, from, to);
    if (to === oldTo) return this.view(user, row.id);
    const changedFrom = addDays(to < oldTo ? to : oldTo, 1);
    const changedTo = to < oldTo ? oldTo : to;
    await holidaysBetween(this.prisma, from, changedTo);
    let updated: SickLeave;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        await lockEmployeeTime(tx, subject.id);
        await assertUnchanged(tx, row);
        await this.assertOpenMonths(tx, subject.id, changedFrom, changedTo, today);
        // Nur nicht neutralisierte Einträge ändern; bei gleichzeitiger Neutralisierung wertet Postgres
        // die Bedingung neu aus und es kommt keine Zeile zurück (Codex-Review Phase 6, Befund 3).
        const { count } = await tx.sickLeave.updateMany({
          where: { id: row.id, kind: { not: 'NEUTRAL' } },
          data: {
            to: fromLocalDate(to),
            // Verlängern nach „wieder gesund“ hebt die Gesundmeldung auf.
            endedAt: input.endToday ? this.clock.now() : to > oldTo ? null : row.endedAt,
          },
        });
        if (count !== 1) throw new NotFoundException('Krankmeldung nicht gefunden.');
        const next = await tx.sickLeave.findUniqueOrThrow({ where: { id: row.id } });
        await this.record(tx, input.endToday ? 'sick.end' : 'sick.update', user, next);
        await reconcileSickCredit(tx, subject.id, row.id, user.id);
        return next;
      });
    } catch (error) {
      if (isOverlap(error))
        throw new ConflictException('Für diesen Zeitraum gibt es schon eine Krankmeldung.');
      throw error;
    }
    if (subject.id === user.id && to > oldTo) await this.notify(subject, updated, true);
    return this.view(user, updated.id);
  }

  async certify(user: AuthUser, id: string, until: LocalDate | null): Promise<SickLeaveView> {
    const { row, subject } = await this.load(user, id);
    if (!this.certifies(user, subject))
      throw new ForbiddenException('Den AU-Vermerk setzen die Vorgesetzte und der Admin.');
    const from = toLocalDate(row.from);
    if (until !== null && until < from)
      throw new BadRequestException('Die AU muss mindestens den ersten Krankheitstag abdecken.');
    await holidaysBetween(this.prisma, from, toLocalDate(row.to));
    await this.prisma.$transaction(async (tx) => {
      await lockEmployeeTime(tx, subject.id);
      await assertUnchanged(tx, row);
      const { count } = await tx.sickLeave.updateMany({
        where: { id: row.id, kind: { not: 'NEUTRAL' } },
        data:
          until === null
            ? { certificateUntil: null, certificateAt: null, certificateById: null }
            : {
                certificateUntil: fromLocalDate(until),
                certificateAt: this.clock.now(),
                certificateById: user.id,
              },
      });
      if (count !== 1) throw new NotFoundException('Krankmeldung nicht gefunden.');
      const next = await tx.sickLeave.findUniqueOrThrow({ where: { id: row.id } });
      await this.record(tx, 'sick.certificate', user, next);
      await reconcileSickCredit(tx, subject.id, row.id, user.id);
    });
    return this.view(user, row.id);
  }

  async remove(user: AuthUser, id: string, reason: string): Promise<void> {
    const { row, subject } = await this.load(user, id);
    if (user.role !== 'ADMIN') throw new ForbiddenException('Krankmeldungen löscht nur der Admin.');
    await this.prisma.$transaction(async (tx) => {
      await lockEmployeeTime(tx, subject.id);
      await assertUnchanged(tx, row);
      await tx.sickLeave.delete({ where: { id: row.id } });
      await this.record(tx, 'sick.delete', user, row, { reason });
      await reconcileSickCredit(tx, subject.id, row.id, user.id);
    });
  }

  async setCertificateFromDay1(user: AuthUser, employeeId: string, value: boolean): Promise<void> {
    // Zusätzlich zur Rolle am Controller (Sicherheitsreview): nur der Admin.
    if (user.role !== 'ADMIN') throw new ForbiddenException('Das stellt nur der Admin ein.');
    const subject = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!subject) throw new NotFoundException('Mitarbeiter nicht gefunden.');
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { certificateFromDay1: value },
      });
      await this.audit.record(
        {
          action: 'employee.certificate-from-day1',
          actorId: user.id,
          entityType: 'Employee',
          entityId: employeeId,
          details: { value },
        },
        tx,
      );
    });
  }

  // ---------- Lesen ----------

  async list(
    user: AuthUser,
    query: {
      employeeId?: string | undefined;
      from?: LocalDate | undefined;
      to?: LocalDate | undefined;
    },
  ): Promise<SickLeaveView[]> {
    if (query.employeeId) await this.subject(user, query.employeeId);
    const scope: Prisma.SickLeaveWhereInput =
      user.role === 'ADMIN'
        ? {}
        : user.role === 'LEAD'
          ? { OR: [{ employeeId: user.id }, { employee: { leadId: user.id } }] }
          : { employeeId: user.id };
    const rows = await this.prisma.sickLeave.findMany({
      where: {
        AND: [
          scope,
          { kind: { not: 'NEUTRAL' } },
          query.employeeId ? { employeeId: query.employeeId } : {},
          query.to ? { from: { lte: fromLocalDate(query.to) } } : {},
          query.from ? { to: { gte: fromLocalDate(query.from) } } : {},
        ],
      },
      orderBy: [{ from: 'desc' }],
    });
    return this.views(user, rows);
  }

  /**
   * Abschnitt „Krankmeldungen“ in „Prüfungen“ (Abschnitt 8): „AU fehlt“ und „krank im Urlaub ohne AU“
   * für das eigene Team (Vorgesetzte) bzw. alle (Admin); sechs Wochen und Jahressummen nur für den Admin.
   */
  async checks(user: AuthUser): Promise<SickChecksView> {
    const today = this.clock.today();
    const yearStart = addDays(today, -364);
    const scope: Prisma.SickLeaveWhereInput =
      user.role === 'ADMIN' ? {} : { employee: { leadId: user.id }, employeeId: { not: user.id } };
    const rows = await this.prisma.sickLeave.findMany({
      where: {
        AND: [
          scope,
          { kind: { in: ['SICK', 'CHILD_SICK'] } },
          { from: { lte: fromLocalDate(today) } },
          { to: { gte: fromLocalDate(yearStart) } },
        ],
      },
      orderBy: [{ from: 'desc' }],
    });
    const views = await this.views(user, rows);
    const vacations = await this.prisma.leaveRequest.findMany({
      where: {
        type: { in: ['VACATION', 'OVERTIME_OFF'] },
        status: 'APPROVED',
        employeeId: { in: [...new Set(rows.map((r) => r.employeeId))] },
        to: { gte: fromLocalDate(yearStart) },
      },
      select: { employeeId: true, type: true, from: true, to: true },
    });
    const overlaps = (v: SickLeaveView, type: 'VACATION' | 'OVERTIME_OFF') =>
      vacations.some(
        (x) =>
          x.type === type &&
          x.employeeId === v.employeeId &&
          toLocalDate(x.from) <= v.to &&
          toLocalDate(x.to) >= v.from,
      );
    const inVacation = (v: SickLeaveView) =>
      v.kind === 'SICK' &&
      overlaps(v, 'VACATION') &&
      (v.certificateUntil === null || v.certificateUntil < (v.to < today ? v.to : today));
    const admin = user.role === 'ADMIN';
    return {
      certificateMissing: views.filter((v) => v.certificateMissing),
      vacationWithoutCertificate: views.filter(inVacation),
      sixWeeks: admin
        ? views.flatMap((v) => {
            const reachedOn = v.kind === 'SICK' ? sixWeeksReachedOn(v.from, v.to, today) : null;
            return reachedOn
              ? [
                  {
                    employeeId: v.employeeId,
                    employeeName: v.employeeName,
                    from: v.from,
                    reachedOn,
                  },
                ]
              : [];
          })
        : null,
      // Überstundenabbau an Krankheitstagen mit AU: nur Hinweis an den Admin (Abschnitt 4).
      overtimeOffDuringSickness: admin
        ? views.filter(
            (v) => v.kind === 'SICK' && v.certificateUntil !== null && overlaps(v, 'OVERTIME_OFF'),
          )
        : null,
      lastYear: admin ? lastYearSummary(views, yearStart, today) : null,
    };
  }

  private async view(user: AuthUser, id: string): Promise<SickLeaveView> {
    const row = await this.prisma.sickLeave.findUniqueOrThrow({ where: { id } });
    const [view] = await this.views(user, [row]);
    return view!;
  }

  private async views(user: AuthUser, rows: SickLeave[]): Promise<SickLeaveView[]> {
    if (!rows.length) return [];
    const today = this.clock.today();
    const people = await this.prisma.employee.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              rows.flatMap((r) => [r.employeeId, ...(r.reportedById ? [r.reportedById] : [])]),
            ),
          ],
        },
      },
      include: { terms: true },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    const first = rows.reduce((a, r) => (r.from < a ? r.from : a), rows[0]!.from);
    const last = rows.reduce((a, r) => (r.to > a ? r.to : a), rows[0]!.to);
    // Fälligkeit kann bis zu zwei Wochen nach dem Ende liegen (nächster Arbeitstag).
    const holidays = await holidaysBetween(
      this.prisma,
      toLocalDate(first),
      addDays(toLocalDate(last), 14),
    );
    return rows.map((r) => {
      const employee = byId.get(r.employeeId)!;
      const from = toLocalDate(r.from);
      const to = toLocalDate(r.to);
      const kind = r.kind === 'CHILD_SICK' ? 'CHILD_SICK' : 'SICK';
      const due = certificateDue({
        kind,
        from,
        to,
        fromDay1: employee.certificateFromDay1,
        workDays: (date) => termsAt(employee.terms, date)?.workDays ?? [],
        holidays: holidays.dates,
      });
      const certificateUntil = r.certificateUntil ? toLocalDate(r.certificateUntil) : null;
      const needed = to < today ? to : today;
      return {
        id: r.id,
        employeeId: r.employeeId,
        employeeName: employee.name,
        kind,
        from,
        to,
        sinceLocal: r.sinceMinute === null ? null : formatMinute(r.sinceMinute),
        certificateUntil,
        certificateDue: due,
        certificateMissing:
          due !== null && due <= today && (certificateUntil === null || certificateUntil < needed),
        reportedByName: r.reportedById ? (byId.get(r.reportedById)?.name ?? null) : null,
        reportedAt: r.reportedAt.toISOString(),
        canCertify: this.certifies(user, employee),
      };
    });
  }

  // ---------- Hilfen ----------

  private assertSelfAhead(to: LocalDate, today: LocalDate): void {
    if (to > addDays(today, SELF_AHEAD_DAYS))
      throw new BadRequestException(
        `Du kannst dich höchstens ${SELF_AHEAD_DAYS} Tage im Voraus krankmelden. Für längere Zeiträume wende dich an deine Vorgesetzte oder den Admin.`,
      );
  }

  private assertEmployed(subject: Employee, from: LocalDate, to: LocalDate): void {
    const entry = toLocalDate(subject.entryDate);
    const exit = subject.exitDate ? toLocalDate(subject.exitDate) : null;
    if (from < entry || (exit !== null && to > exit))
      throw new BadRequestException('Der Zeitraum liegt außerhalb des Beschäftigungszeitraums.');
  }

  private async assertOpenMonths(
    tx: Prisma.TransactionClient,
    employeeId: string,
    from: LocalDate,
    to: LocalDate,
    today: LocalDate,
  ): Promise<void> {
    const closed = await closedMonthErrors(tx, employeeId, { from, to }, today);
    if (closed.length) throw new ConflictException(closed.join(' '));
  }

  private record(
    tx: Prisma.TransactionClient,
    action: string,
    user: AuthUser,
    row: SickLeave,
    extra: Record<string, string> = {},
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        actorId: user.id,
        entityType: 'SickLeave',
        entityId: row.id,
        details: {
          kind: row.kind,
          from: toLocalDate(row.from),
          to: toLocalDate(row.to),
          ...extra,
        },
      },
      tx,
    );
  }

  /**
   * Neutrale E-Mail an die Vorgesetzte, bei ihrer Abwesenheit an die Vertretung, ohne Vorgesetzte an
   * den Admin (Abschnitt 7). Nennt „Kind krank“ nicht. Fehler brechen nichts ab, Log ohne Adresse.
   */
  private async notify(subject: Subject, row: SickLeave, extended: boolean): Promise<void> {
    try {
      const recipients = await this.recipients(subject);
      const text =
        `${subject.name} ist ab ${formatLocalDate(toLocalDate(row.from))} krankgemeldet, ` +
        `voraussichtlich bis ${formatLocalDate(toLocalDate(row.to))}.\n\n` +
        `In der Anwendung: ${this.config.appOrigin}/urlaubsuebersicht`;
      const subjectLine = `${extended ? 'Krankmeldung verlängert' : 'Krankmeldung'}: ${subject.name}`;
      await Promise.all(recipients.map((to) => this.mail.send({ to, subject: subjectLine, text })));
    } catch {
      this.logger.warn('Benachrichtigung zur Krankmeldung nicht versendet.');
    }
  }

  private async recipients(subject: Subject): Promise<string[]> {
    const today = this.clock.today();
    const active = {
      lockedAt: null,
      OR: [{ exitDate: null }, { exitDate: { gte: fromLocalDate(today) } }],
    };
    if (subject.leadId && subject.leadId !== subject.id) {
      const lead = await this.prisma.employee.findFirst({
        where: { id: subject.leadId, ...active },
      });
      if (lead && !(await isAbsent(this.prisma, lead.id, today))) return [lead.loginEmail];
      if (subject.deputyId && subject.deputyId !== subject.id) {
        const deputy = await this.prisma.employee.findFirst({
          where: { id: subject.deputyId, ...active },
        });
        if (deputy) return [deputy.loginEmail];
      }
      if (lead) return [lead.loginEmail];
    }
    const admins = await this.prisma.employee.findMany({
      where: { role: 'ADMIN', id: { not: subject.id }, ...active },
      select: { loginEmail: true },
    });
    return admins.map((a) => a.loginEmail);
  }
}

/** Krankheitstage (Kalendertage) je Person im Zeitraum bis heute, getrennt nach Art. */
function lastYearSummary(
  views: readonly SickLeaveView[],
  from: LocalDate,
  today: LocalDate,
): NonNullable<SickChecksView['lastYear']> {
  const byPerson = new Map<
    string,
    { employeeId: string; employeeName: string; sickDays: number; childSickDays: number }
  >();
  for (const v of views) {
    const start = v.from > from ? v.from : from;
    const end = v.to < today ? v.to : today;
    if (end < start) continue;
    const days = diffDays(start, end) + 1;
    const row = byPerson.get(v.employeeId) ?? {
      employeeId: v.employeeId,
      employeeName: v.employeeName,
      sickDays: 0,
      childSickDays: 0,
    };
    if (v.kind === 'CHILD_SICK') row.childSickDays += days;
    else row.sickDays += days;
    byPerson.set(v.employeeId, row);
  }
  return [...byPerson.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'de'));
}

/** Prüfung vor dem Ändern unter der Sperre wiederholen: Stand unverändert? (Sicherheitsreview) */
async function assertUnchanged(tx: Prisma.TransactionClient, row: SickLeave): Promise<void> {
  const fresh = await tx.sickLeave.findUnique({ where: { id: row.id } });
  if (
    !fresh ||
    fresh.to.getTime() !== row.to.getTime() ||
    (fresh.certificateUntil?.getTime() ?? null) !== (row.certificateUntil?.getTime() ?? null)
  )
    throw new ConflictException('Die Krankmeldung wurde inzwischen geändert. Bitte neu laden.');
}

function minuteOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function isOverlap(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}`
      : '';
  return text.includes('SickLeave_no_overlap') || text.includes('23P01');
}
