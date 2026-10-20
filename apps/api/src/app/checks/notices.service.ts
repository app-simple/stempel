import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  formatHalfDays,
  formatLocalDate,
  localDateInBerlin,
  type ForfeitureKind,
  type ForfeitureSuggestion,
  type LeaveNoticeView,
  type LocalDate,
  type NoticeStatusRow,
} from '@as/shared';
import {
  forfeitableHalfDays,
  forfeitureDates,
  leaveHalfDaysByYear,
  noticeIsTimely,
} from '@as/time-rules';
import type { LeaveNotice } from '../../generated/prisma/client';
import { employeeScope } from '../access/employee-scope';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { fromLocalDate } from '../common/dates';
import type { Prisma } from '../../generated/prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
  holidaysFor,
  loadLeaveSubjects,
  spanOf,
  workDaysAtFor,
  yearAccount,
  type LeaveSubject,
} from '../leave/leave-context';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { holidaysBetween, lockEmployeeTime } from '../time/time-context';

type Tx = Prisma.TransactionClient;

/** Marker im Vermerk der Verfallsbuchung; verhindert doppelte Buchungen. */
const forfeitNote = (forfeitsOn: LocalDate) => `Verfall zum ${formatLocalDate(forfeitsOn)}`;

/**
 * Jährlicher Urlaubshinweis und Verfall (Spezifikation Phase 4, Entscheidungen 2, 3, 3a;
 * § 7 Abs. 3 BUrlG, BAG 9 AZR 423/16). Kein automatischer Versand und kein automatischer Verfall.
 */
@Injectable()
export class NoticesService {
  private readonly logger = new Logger('LeaveNotice');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private view(n: LeaveNotice, name: string, sentByName: string | null): LeaveNoticeView {
    const sentOn = localDateInBerlin(n.sentAt);
    const dates = forfeitureDates(n.year);
    return {
      id: n.id,
      employeeId: n.employeeId,
      employeeName: name,
      year: n.year,
      restHalfDays: n.restHalfDays,
      text: n.text,
      sentAt: n.sentAt.toISOString(),
      sentByName,
      readAt: n.readAt?.toISOString() ?? null,
      emailSentAt: n.emailSentAt?.toISOString() ?? null,
      timelyForYearEnd: noticeIsTimely(sentOn, dates.rest),
      timelyForMarch31: noticeIsTimely(sentOn, dates.carried),
    };
  }

  private async views(rows: LeaveNotice[]): Promise<LeaveNoticeView[]> {
    const people = await this.prisma.employee.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => [r.employeeId, r.sentById]))] } },
      select: { id: true, name: true },
    });
    const names = new Map(people.map((p) => [p.id, p.name]));
    return rows.map((r) =>
      this.view(r, names.get(r.employeeId) ?? '', names.get(r.sentById) ?? null),
    );
  }

  /** Hinweise: eigene für alle; Vorgesetzte zusätzlich ihr Team, Admin alle. */
  async list(
    user: AuthUser,
    filter: { employeeId?: string; year?: number },
  ): Promise<LeaveNoticeView[]> {
    const rows = await this.prisma.leaveNotice.findMany({
      where: {
        employee: user.role === 'EMPLOYEE' ? { id: user.id } : employeeScope(user),
        ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
        ...(filter.year ? { year: filter.year } : {}),
      },
      orderBy: { sentAt: 'desc' },
      take: 500,
    });
    return this.views(rows);
  }

  async statusRows(employeeIds: readonly string[], year: number): Promise<NoticeStatusRow[]> {
    const subjects = await loadLeaveSubjects(this.prisma, employeeIds);
    const notices = await this.prisma.leaveNotice.findMany({
      where: { employeeId: { in: [...employeeIds] }, year },
      orderBy: { sentAt: 'desc' },
    });
    const views = await this.views(notices);
    const rows: NoticeStatusRow[] = [];
    for (const id of employeeIds) {
      const subject = subjects.get(id);
      if (!subject) continue;
      rows.push({
        employeeId: id,
        employeeName: subject.name,
        year,
        rest: (await yearAccount(this.prisma, subject, year)).rest,
        latest: views.find((v) => v.employeeId === id) ?? null,
      });
    }
    return rows;
  }

  /**
   * Hinweis versenden (Admin, Entscheidung 2): an die genannten Personen bzw. an alle, die im Jahr
   * beschäftigt sind und noch keinen Hinweis für das Jahr haben. Per E-Mail und in der Anwendung.
   */
  async send(
    user: AuthUser,
    input: { year: number; employeeIds?: string[] },
  ): Promise<LeaveNoticeView[]> {
    const ids =
      input.employeeIds ??
      (
        await this.prisma.employee.findMany({
          where: {
            entryDate: { lte: fromLocalDate(`${input.year}-12-31`) },
            OR: [{ exitDate: null }, { exitDate: { gte: fromLocalDate(this.clock.today()) } }],
            leaveNotices: { none: { year: input.year } },
          },
          select: { id: true },
        })
      ).map((e) => e.id);
    const subjects = await loadLeaveSubjects(this.prisma, ids);
    if (input.employeeIds && subjects.size !== new Set(ids).size)
      throw new NotFoundException('Mitarbeiter nicht gefunden.');
    const created: LeaveNotice[] = [];
    const now = this.clock.now();
    for (const subject of subjects.values()) {
      const rest = Math.max(0, (await yearAccount(this.prisma, subject, input.year)).rest);
      const text = noticeText(
        subject,
        input.year,
        rest,
        localDateInBerlin(now),
        this.config.appOrigin,
      );
      const notice = await this.prisma.$transaction(async (tx) => {
        const row = await tx.leaveNotice.create({
          data: {
            employeeId: subject.id,
            year: input.year,
            restHalfDays: rest,
            text,
            sentAt: now,
            sentById: user.id,
          },
        });
        await this.audit.record(
          {
            action: 'leave.notice.send',
            actorId: user.id,
            entityType: 'LeaveNotice',
            entityId: row.id,
            details: { year: input.year },
          },
          tx,
        );
        return row;
      });
      // E-Mail getrennt vom Bereitstellen erfassen (Befund 8): Fehler bleiben sichtbar.
      const mailed = await this.mail
        .send({
          to: subject.loginEmail,
          subject: `Hinweis zu deinem Resturlaub ${input.year}`,
          text,
        })
        .then(
          () => true,
          () => {
            this.logger.warn('Urlaubshinweis nicht per E-Mail versendet.');
            return false;
          },
        );
      created.push(
        mailed
          ? await this.prisma.leaveNotice.update({
              where: { id: notice.id },
              data: { emailSentAt: this.clock.now() },
            })
          : notice,
      );
    }
    return this.views(created);
  }

  /** Lesebestätigung, nur für eigene Hinweise und nur einmal. */
  async markRead(user: AuthUser, id: string): Promise<LeaveNoticeView> {
    // Bestätigung und Protokoll gemeinsam (Befund 9).
    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.leaveNotice.updateMany({
        where: { id, employeeId: user.id, readAt: null },
        data: { readAt: this.clock.now() },
      });
      const notice = await tx.leaveNotice.findFirst({ where: { id, employeeId: user.id } });
      if (!notice) throw new NotFoundException('Hinweis nicht gefunden.');
      if (count === 1)
        await this.audit.record(
          {
            action: 'leave.notice.read',
            actorId: user.id,
            entityType: 'LeaveNotice',
            entityId: id,
          },
          tx,
        );
      return notice;
    });
    const [view] = await this.views([row]);
    if (!view) throw new NotFoundException('Hinweis nicht gefunden.');
    return view;
  }

  /** Vorschläge zum Verfall nach dem Verfallstag, noch nicht gebucht (Entscheidung 3). */
  async forfeitureSuggestions(
    subjects: readonly { id: string }[],
    today: LocalDate,
  ): Promise<ForfeitureSuggestion[]> {
    const leaveSubjects = await loadLeaveSubjects(
      this.prisma,
      subjects.map((s) => s.id),
    );
    const currentYear = Number(today.slice(0, 4));
    const out: ForfeitureSuggestion[] = [];
    for (const subject of leaveSubjects.values()) {
      for (const year of [currentYear - 2, currentYear - 1]) {
        for (const kind of ['YEAR_END', 'MARCH31'] as const) {
          const s = await this.suggestion(subject, year, kind, today);
          if (s && s.halfDays > 0 && !(await this.alreadyBooked(subject.id, s))) out.push(s);
        }
      }
    }
    return out;
  }

  /**
   * Vorschlag für einen Verfallstag. Maßgeblich ist der letzte Hinweis für das Jahr, der vor dem
   * Verfallstag versendet wurde (Befund 4); er muss rechtzeitig sein, und der Verfall ist auf den darin
   * genannten Rest begrenzt. `db` ist in der Buchung die Transaktion (Befund 5).
   */
  private async suggestion(
    subject: LeaveSubject,
    year: number,
    kind: ForfeitureKind,
    today: LocalDate,
    db: Tx | PrismaService = this.prisma,
  ): Promise<ForfeitureSuggestion | null> {
    const dates = forfeitureDates(year);
    const forfeitsOn = kind === 'YEAR_END' ? dates.rest : dates.carried;
    if (today <= forfeitsOn) return null;
    const account = await yearAccount(db, subject, year);
    const next = await db.leaveCarryOver.findUnique({
      where: { employeeId_year: { employeeId: subject.id, year: year + 1 } },
    });
    const restAtYearEnd =
      account.entitlement.halfDays + account.carryOver + account.corrections - account.approved;
    const result = forfeitableHalfDays({
      restAtYearEnd,
      carriedOver: (next?.days ?? 0) * 2,
      takenByMarch31: kind === 'MARCH31' ? await this.takenByMarch31(subject, year + 1, db) : 0,
    });
    const decisive = (
      await db.leaveNotice.findMany({
        where: { employeeId: subject.id, year },
        orderBy: { sentAt: 'desc' },
      })
    ).find((n) => localDateInBerlin(n.sentAt) <= forfeitsOn);
    const computed = kind === 'YEAR_END' ? result.atYearEnd : result.atMarch31;
    return {
      employeeId: subject.id,
      employeeName: subject.name,
      year,
      kind,
      forfeitsOn,
      halfDays: decisive ? Math.min(computed, decisive.restHalfDays) : computed,
      noticeTimely: !!decisive && noticeIsTimely(localDateInBerlin(decisive.sentAt), forfeitsOn),
    };
  }

  /** Bis einschließlich 31.03. genommene Urlaubstage im Folgejahr (übertragene Tage gelten als zuerst genommen). */
  private async takenByMarch31(
    subject: LeaveSubject,
    year: number,
    db: Tx | PrismaService = this.prisma,
  ): Promise<number> {
    const until = `${year}-03-31`;
    const rows = await db.leaveRequest.findMany({
      where: {
        employeeId: subject.id,
        type: 'VACATION',
        status: 'APPROVED',
        from: { lte: fromLocalDate(until) },
        to: { gte: fromLocalDate(`${year}-01-01`) },
      },
    });
    const holidays = await holidaysFor(
      db,
      rows.map((r) => spanOf(r)),
    );
    let total = 0;
    for (const r of rows) {
      const span = spanOf(r);
      const clipped = {
        from: span.from < `${year}-01-01` ? `${year}-01-01` : span.from,
        to: span.to > until ? until : span.to,
        startHalf: span.from >= `${year}-01-01` && span.startHalf,
        endHalf: span.to <= until && span.endHalf,
      };
      total +=
        leaveHalfDaysByYear(clipped, workDaysAtFor(subject), holidays.dates).find(
          (y) => y.year === year,
        )?.halfDays ?? 0;
    }
    return total;
  }

  private async alreadyBooked(
    employeeId: string,
    s: ForfeitureSuggestion,
    db: Tx | PrismaService = this.prisma,
  ): Promise<boolean> {
    const count = await db.leaveLedgerEntry.count({
      where: {
        employeeId,
        kind: 'FORFEIT',
        year: s.kind === 'YEAR_END' ? s.year : s.year + 1,
        note: forfeitNote(s.forfeitsOn),
      },
    });
    return count > 0;
  }

  /**
   * Verfall buchen (Admin, Entscheidung 3): nur nach dem Verfallstag, nur mit rechtzeitigem Hinweis,
   * nur einmal. Gebucht wird als `FORFEIT` in dem Jahr, dessen Konto die Tage enthält.
   */
  async bookForfeiture(
    user: AuthUser,
    input: { employeeId: string; year: number; kind: ForfeitureKind },
  ): Promise<ForfeitureSuggestion> {
    const subject = (await loadLeaveSubjects(this.prisma, [input.employeeId])).get(
      input.employeeId,
    );
    if (!subject) throw new NotFoundException('Mitarbeiter nicht gefunden.');
    const today = this.clock.today();
    // Feiertage der beteiligten Jahre vor der Transaktion sicherstellen.
    await holidaysBetween(this.prisma, `${input.year}-01-01`, `${input.year + 1}-12-31`);
    // Berechnung und Buchung unter derselben Personensperre wie Anträge, Übertrag und Korrekturen (Befund 5).
    return this.prisma.$transaction(async (tx) => {
      await lockEmployeeTime(tx, subject.id);
      const s = await this.suggestion(subject, input.year, input.kind, today, tx);
      if (!s) throw new UnprocessableEntityException('Der Verfallstag ist noch nicht erreicht.');
      // Vor der Prüfung der Tage: Nach der Buchung ist der Rest bereits gemindert.
      if (await this.alreadyBooked(subject.id, s, tx))
        throw new ConflictException('Der Verfall ist bereits gebucht.');
      if (!s.noticeTimely)
        throw new UnprocessableEntityException(
          'Ohne rechtzeitigen Urlaubshinweis verfällt kein Urlaub (BAG 9 AZR 423/16).',
        );
      if (s.halfDays <= 0) throw new UnprocessableEntityException('Es sind keine Tage verfallen.');
      const row = await tx.leaveLedgerEntry.create({
        data: {
          employeeId: subject.id,
          year: s.kind === 'YEAR_END' ? s.year : s.year + 1,
          kind: 'FORFEIT',
          halfDays: -s.halfDays,
          note: forfeitNote(s.forfeitsOn),
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          action: 'leave.forfeit',
          actorId: user.id,
          entityType: 'LeaveLedgerEntry',
          entityId: row.id,
          details: { year: s.year, kind: s.kind, halfDays: s.halfDays },
        },
        tx,
      );
      return s;
    });
  }
}

/** Wortlaut des Hinweises (Entscheidung 2, Abschnitt 6.2). */
export function noticeText(
  subject: Pick<LeaveSubject, 'name'>,
  year: number,
  restHalfDays: number,
  asOf: LocalDate,
  origin: string,
): string {
  const firstName = subject.name.split(' ')[0] ?? subject.name;
  const days = formatHalfDays(restHalfDays);
  return [
    `Hallo ${firstName},`,
    '',
    `du hast für ${year} noch ${days} ${restHalfDays === 2 ? 'Urlaubstag' : 'Urlaubstage'} (Stand ${formatLocalDate(asOf)}). Beantragte, aber noch nicht entschiedene Tage sind darin bereits abgezogen.`,
    '',
    `Bitte beantrage deinen Urlaub so, dass du ihn bis zum 31.12.${year} nehmen kannst. Nicht genommener Urlaub verfällt am 31.12.${year}. Soweit Urlaub ausnahmsweise ins nächste Jahr übertragen wird, verfällt er am 31.03.${year + 1}.`,
    '',
    `Dein Urlaubskonto: ${origin}/urlaub`,
  ].join('\n');
}
