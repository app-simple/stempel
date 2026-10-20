import { BadRequestException, Injectable } from '@nestjs/common';
import {
  addDays,
  isLocalDate,
  type LateEntriesView,
  type LateEntryRow,
  type LocalDate,
  type ReminderSettingsView,
} from '@as/shared';
import { lateEntryStats, lateInfo } from '@as/time-rules';
import { employeeScope } from '../access/employee-scope';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { companySettings } from '../common/company-settings';

/**
 * Auswertung der Nachträge (Konzept 4.1, Spezifikation Phase 5, Entscheidung 8): je Person Buchungen,
 * Nachträge, Anteil, Ø Verzug, „auffällig“ ab den Schwellen. Mitarbeiter nur eigene, Vorgesetzte ihr
 * Team, Admin alle. Dazu die Einstellungen für Standardzeit und Schwellen (nur Admin).
 */
@Injectable()
export class LateEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async settings(): Promise<ReminderSettingsView> {
    const s = await companySettings(this.prisma);
    return {
      defaultStart: s.reminderDefaultStart,
      lateFlagMinCount: s.lateFlagMinCount,
      lateFlagMinPercent: s.lateFlagMinPercent,
      lateFlagWeeks: s.lateFlagWeeks,
    };
  }

  async updateSettings(user: AuthUser, input: ReminderSettingsView): Promise<ReminderSettingsView> {
    const data = {
      reminderDefaultStart: input.defaultStart,
      lateFlagMinCount: input.lateFlagMinCount,
      lateFlagMinPercent: input.lateFlagMinPercent,
      lateFlagWeeks: input.lateFlagWeeks,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.companySettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
      });
      await this.audit.record(
        {
          action: 'settings.reminders',
          actorId: user.id,
          entityType: 'CompanySettings',
          entityId: '1',
          details: { ...input },
        },
        tx,
      );
    });
    return this.settings();
  }

  /** Team bzw. alle (Vorgesetzte, Admin). */
  team(user: AuthUser, range: { from?: string; to?: string }): Promise<LateEntriesView> {
    return this.view(employeeScope(user), range);
  }

  /** Eigene Quote (alle Rollen). */
  own(user: AuthUser): Promise<LateEntriesView> {
    return this.view({ id: user.id }, {});
  }

  private async view(
    scope: ReturnType<typeof employeeScope>,
    range: { from?: string; to?: string },
  ): Promise<LateEntriesView> {
    const settings = await this.settings();
    const to = range.to ?? this.clock.today();
    const from = range.from ?? addDays(to, -settings.lateFlagWeeks * 7 + 1);
    if (!isLocalDate(from) || !isLocalDate(to) || from > to)
      throw new BadRequestException('Bitte einen gültigen Zeitraum angeben.');
    const people = await this.prisma.employee.findMany({
      where: { AND: [scope, { entryDate: { lte: fromLocalDate(to) } }] },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        employeeId: { in: people.map((p) => p.id) },
        workDate: { gte: fromLocalDate(from), lte: fromLocalDate(to) },
      },
      select: {
        employeeId: true,
        workDate: true,
        startAt: true,
        source: true,
        recordedAt: true,
        voidedAt: true,
      },
    });
    const thresholds = {
      minCount: settings.lateFlagMinCount,
      minPercent: settings.lateFlagMinPercent,
    };
    const rows: LateEntryRow[] = people.map((p) => {
      const stats = lateEntryStats(
        entries
          .filter((e) => e.employeeId === p.id)
          .map((e) => ({
            source: e.source,
            voided: e.voidedAt !== null,
            late: lateInfo({
              workDate: toLocalDate(e.workDate) as LocalDate,
              start: e.startAt,
              source: e.source,
              recordedAt: e.recordedAt,
            }),
          })),
        thresholds,
      );
      return { employeeId: p.id, employeeName: p.name, ...stats };
    });
    return {
      from,
      to,
      thresholds: { ...thresholds, weeks: settings.lateFlagWeeks },
      rows,
    };
  }
}
