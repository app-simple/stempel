import { reconcileAffectedSickCredits } from '../sick/sick-credit';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CompanySettingsView, HolidayView, LocalDate } from '@as/shared';
import { Prisma, type Holiday } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { ensureStatutoryHolidays, HOLIDAY_LOCK } from './holiday-generation';
import { companySettings } from '../common/company-settings';

const PAST_YEAR =
  'Feiertage vergangener Jahre sind nicht änderbar, damit alte Monate richtig bleiben.';

/** Bearbeitbare Feiertagsliste (Spezifikation Phase 1, Abschnitt 8; Entscheidung 1). */
@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  private currentYear(): number {
    return Number(this.clock.today().slice(0, 4));
  }

  async settings(): Promise<CompanySettingsView> {
    const s = await companySettings(this.prisma);
    return { state: s.state, assumptionDayIsHoliday: s.assumptionDayIsHoliday };
  }

  async list(user: AuthUser, year: number): Promise<HolidayView[]> {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Bitte ein Jahr zwischen 2000 und 2100 angeben.');
    }
    const { state } = await this.settings();
    await this.prisma.$transaction((tx) => ensureStatutoryHolidays(tx, year));
    const rows = await this.prisma.holiday.findMany({
      where: {
        state,
        date: { gte: fromLocalDate(`${year}-01-01`), lte: fromLocalDate(`${year}-12-31`) },
        ...(user.role === 'ADMIN' ? {} : { active: true }),
      },
      orderBy: [{ date: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.toView(row, user));
  }

  /** Änderung und Protokoll in einer Transaktion; ins Protokoll kommen Datum und Feldnamen, kein Freitext. */
  async create(admin: AuthUser, date: LocalDate, name: string): Promise<HolidayView> {
    this.assertEditableYear(date);
    const { state } = await this.settings();
    const row = await this.prisma
      .$transaction(async (tx) => {
        await ensureStatutoryHolidays(tx, Number(date.slice(0, 4)));
        const created = await tx.holiday.create({
          data: { date: fromLocalDate(date), name, state, origin: 'MANUAL' },
        });
        await this.audit.record(
          {
            action: 'holiday.create',
            actorId: admin.id,
            entityType: 'Holiday',
            entityId: created.id,
            details: { date },
          },
          tx,
        );
        return created;
      })
      .catch(rethrowDuplicate);
    await reconcileAffectedSickCredits(this.prisma, { date }, admin.id);
    return this.toView(row, admin);
  }

  async update(
    admin: AuthUser,
    id: string,
    changes: { name?: string; active?: boolean },
  ): Promise<HolidayView> {
    const existing = await this.find(id);
    this.assertEditableYear(toLocalDate(existing.date));
    const row = await this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.holiday.update({
          where: { id },
          data: {
            ...(changes.name !== undefined ? { name: changes.name } : {}),
            ...(changes.active !== undefined ? { active: changes.active } : {}),
          },
        });
        await this.audit.record(
          {
            action: 'holiday.update',
            actorId: admin.id,
            entityType: 'Holiday',
            entityId: id,
            details: {
              date: toLocalDate(existing.date),
              fields: Object.keys(changes).sort(),
              ...(changes.active !== undefined ? { active: changes.active } : {}),
            },
          },
          tx,
        );
        return updated;
      })
      .catch(rethrowDuplicate);
    if (changes.active !== undefined)
      await reconcileAffectedSickCredits(
        this.prisma,
        { date: toLocalDate(existing.date) },
        admin.id,
      );
    return this.toView(row, admin);
  }

  async remove(admin: AuthUser, id: string): Promise<void> {
    const existing = await this.find(id);
    this.assertEditableYear(toLocalDate(existing.date));
    if (existing.origin !== 'MANUAL') {
      throw new ConflictException(
        'Gesetzliche Feiertage lassen sich nur abschalten, nicht löschen.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'holiday.delete',
          actorId: admin.id,
          entityType: 'Holiday',
          entityId: id,
          details: { date: toLocalDate(existing.date) },
        },
        tx,
      );
    });
    await reconcileAffectedSickCredits(this.prisma, { date: toLocalDate(existing.date) }, admin.id);
  }

  /** Mariä Himmelfahrt umschalten: gilt ab dem laufenden Jahr und für künftig erzeugte Jahre. */
  async updateSettings(
    admin: AuthUser,
    assumptionDayIsHoliday: boolean,
  ): Promise<CompanySettingsView> {
    await this.settings();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${HOLIDAY_LOCK})`;
      await tx.companySettings.update({ where: { id: 1 }, data: { assumptionDayIsHoliday } });
      await tx.holiday.updateMany({
        where: {
          key: 'ASSUMPTION_DAY',
          date: { gte: fromLocalDate(`${this.currentYear()}-01-01`) },
        },
        data: { active: assumptionDayIsHoliday },
      });
      await this.audit.record(
        {
          action: 'settings.update',
          actorId: admin.id,
          entityType: 'CompanySettings',
          entityId: '1',
          details: { assumptionDayIsHoliday },
        },
        tx,
      );
    });
    return this.settings();
  }

  private async find(id: string): Promise<Holiday> {
    const row = await this.prisma.holiday.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Feiertag nicht gefunden.');
    return row;
  }

  private assertEditableYear(date: LocalDate): void {
    if (Number(date.slice(0, 4)) < this.currentYear()) throw new ConflictException(PAST_YEAR);
  }

  private toView(row: Holiday, user: AuthUser): HolidayView {
    const date = toLocalDate(row.date);
    return {
      id: row.id,
      date,
      name: row.name,
      origin: row.origin,
      active: row.active,
      editable: user.role === 'ADMIN' && Number(date.slice(0, 4)) >= this.currentYear(),
    };
  }
}

function rethrowDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException('Diesen Feiertag gibt es an diesem Tag schon.');
  }
  throw error;
}
