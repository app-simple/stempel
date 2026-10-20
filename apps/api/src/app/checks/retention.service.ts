import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { addDays, berlinInstant, type LocalDate, type RetentionSettingsView } from '@as/shared';
import { retentionCutoff } from '@as/time-rules';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { loadSubjectById, termsAt } from '../time/time-context';
import { TimeService } from '../time/time.service';
import { companySettings } from '../common/company-settings';

const RUN_EVERY_MS = 6 * 60 * 60_000;
const DAY_MS = 86_400_000;
export const ANONYMIZED_NAME = 'Ehemalige Person';
/** Kennung für Buchungen des Löschjobs selbst (Saldovortrag); keine Person. */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';
const RETENTION_LOCK = 'retention';

type Tx = Prisma.TransactionClient;

export interface PurgeResult {
  technical: number;
  /** Krankmeldungen, die am Ende des Folgejahres neutralisiert wurden (Phase 6, Abschnitt 9). */
  sickNeutralized: number;
  timeEntries: number;
  leaveRecords: number;
  auditEntries: number;
  anonymized: number;
}

/**
 * Löschjob (Spezifikation Phase 4, Abschnitt 6.5, Entscheidungen 6, 6a, 8).
 *
 * - Immer: abgelaufene Sitzungen, Anmeldecodes, WebAuthn-Challenges und Rate-Limit-Einträge nach einem Tag.
 * - Nur wenn eingeschaltet: Zeit-, Urlaubs- und Protokolldaten nach Ablauf der Fristen ab Ende des
 *   Kalenderjahres; Minijob-Zeiten als Lohnunterlagen mit eigener Frist; danach Stammdaten
 *   ausgeschiedener Personen anonymisieren. Gelöscht wird in einer Transaktion mit Löschfreigabe
 *   (`asos.purge`), die die Schutz-Trigger nur dort zulassen.
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Retention');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly time: TimeService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.nodeEnv === 'test') return;
    this.timer = setInterval(() => {
      this.runOnce().catch((error: unknown) =>
        this.logger.error(
          `Lauf fehlgeschlagen: ${error instanceof Error ? error.name : 'unbekannt'}`,
        ),
      );
    }, RUN_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async settings(db: Pick<Tx, 'companySettings'> = this.prisma): Promise<RetentionSettingsView> {
    const s = await companySettings(db);
    return {
      enabled: s.retentionEnabled,
      timeYears: s.retentionTimeYears,
      payrollYears: s.retentionPayrollYears,
      leaveYears: s.retentionLeaveYears,
      auditYears: s.retentionAuditYears,
    };
  }

  async updateSettings(
    user: AuthUser,
    input: RetentionSettingsView,
  ): Promise<RetentionSettingsView> {
    await this.prisma.$transaction(async (tx) => {
      // Gleiche Sperre wie der Löschlauf: Ein wartender Lauf liest danach die neuen Fristen (Befund 3).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${RETENTION_LOCK}, 0))`;
      await tx.companySettings.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          retentionEnabled: input.enabled,
          retentionTimeYears: input.timeYears,
          retentionPayrollYears: input.payrollYears,
          retentionLeaveYears: input.leaveYears,
          retentionAuditYears: input.auditYears,
        },
        update: {
          retentionEnabled: input.enabled,
          retentionTimeYears: input.timeYears,
          retentionPayrollYears: input.payrollYears,
          retentionLeaveYears: input.leaveYears,
          retentionAuditYears: input.auditYears,
        },
      });
      await this.audit.record(
        {
          action: 'settings.retention',
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

  /** Ein Lauf; mehrere Instanzen laufen über eine Datenbanksperre nacheinander, Löschen ist idempotent. */
  async runOnce(): Promise<PurgeResult> {
    const now = this.clock.now();
    const today = this.clock.today();
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${RETENTION_LOCK}, 0))`;
        // Einstellungen erst unter der Sperre lesen (Befund 3).
        const settings = await this.settings(tx);
        // Löschfreigabe nur für diese Transaktion (Befund 7). Schon vor der Neutralisierung nötig, die
        // auch ohne Löschschalter Audit-Einträge zu Krankmeldungen entfernt (Phase 6, Befund 1).
        await tx.$executeRaw`SELECT set_config('asos.purge', txid_current()::text, true)`;
        const result: PurgeResult = {
          technical: await this.cleanupTechnical(tx, now),
          // Gesundheitsdaten sparsam halten: unabhängig vom Löschschalter (Phase 6, Abschnitt 9).
          sickNeutralized: await this.neutralizeSickLeaves(tx, today),
          timeEntries: 0,
          leaveRecords: 0,
          auditEntries: 0,
          anonymized: 0,
        };
        if (settings.enabled) {
          await this.purge(tx, today, settings, result);
          await this.audit.record({ action: 'retention.purge', details: { ...result } }, tx);
        }
        return result;
      },
      { timeout: 120_000 },
    );
  }

  private async cleanupTechnical(tx: Tx, now: Date): Promise<number> {
    const before = new Date(now.getTime() - DAY_MS);
    const counts = await Promise.all([
      tx.session.deleteMany({ where: { expiresAt: { lt: before } } }),
      tx.loginCode.deleteMany({ where: { expiresAt: { lt: before } } }),
      tx.authChallenge.deleteMany({ where: { expiresAt: { lt: before } } }),
      tx.rateLimitHit.deleteMany({ where: { windowStart: { lt: before } } }),
    ]);
    return counts.reduce((sum, c) => sum + c.count, 0);
  }

  /**
   * Saldovortrag (Befund 1): Für Konten, die vor dem Stichtag beginnen, wird der Saldo bis zum Vortag
   * des Stichtags als Korrekturbuchung zum Stichtag gebucht und der Kontobeginn auf den Stichtag
   * gesetzt. Der Kontostand bleibt dadurch unverändert, auch wenn alte Buchungen gelöscht werden.
   */
  /**
   * Krankmeldungen am Ende des Kalenderjahres nach ihrem Ende neutralisieren: nur noch „abwesend“ mit
   * Zeitraum (für das Zeitkonto), ohne Art, Erfasser und AU-Vermerk.
   */
  private async neutralizeSickLeaves(tx: Tx, today: LocalDate): Promise<number> {
    const cut = `${Number(today.slice(0, 4)) - 1}-01-01`;
    // Audit-Einträge und AU-Erinnerungen nennen Art und Zeitraum: mit der Neutralisierung entfernen,
    // auch die zu gelöschten Krankmeldungen (Codex-Review Phase 6, Befund 1).
    await tx.auditLog.deleteMany({
      where: { entityType: 'SickLeave', details: { path: ['to'], lt: cut } },
    });
    await tx.reminderLog.deleteMany({
      where: { kind: 'CERTIFICATE', date: { lt: fromLocalDate(cut) } },
    });
    const { count } = await tx.sickLeave.updateMany({
      where: { kind: { not: 'NEUTRAL' }, to: { lt: fromLocalDate(cut) } },
      data: {
        kind: 'NEUTRAL',
        reportedById: null,
        certificateUntil: null,
        certificateAt: null,
        certificateById: null,
        endedAt: null,
      },
    });
    return count;
  }

  private async carryOvertime(tx: Tx, cutTime: LocalDate): Promise<void> {
    const accounts = await tx.employee.findMany({
      where: { overtimeAccountSince: { lt: fromLocalDate(cutTime) } },
      select: { id: true, overtimeAccountSince: true },
    });
    for (const account of accounts) {
      if (!account.overtimeAccountSince) continue;
      const since = toLocalDate(account.overtimeAccountSince);
      const subject = await loadSubjectById(this.prisma, account.id);
      const days = await this.time.daysFor(subject, since, addDays(cutTime, -1));
      const adjustments = await tx.overtimeAdjustment.aggregate({
        where: { employeeId: account.id, effectiveOn: { lt: fromLocalDate(cutTime) } },
        _sum: { minutes: true },
      });
      const balance =
        days.reduce((sum, d) => sum + (d.balanceMinutes ?? 0), 0) + (adjustments._sum.minutes ?? 0);
      await tx.overtimeAdjustment.deleteMany({
        where: { employeeId: account.id, effectiveOn: { lt: fromLocalDate(cutTime) } },
      });
      if (balance !== 0)
        await tx.overtimeAdjustment.create({
          data: {
            employeeId: account.id,
            minutes: balance,
            effectiveOn: fromLocalDate(cutTime),
            reason: `Saldovortrag bis ${addDays(cutTime, -1)} (Löschjob)`,
            createdById: SYSTEM_ACTOR_ID,
          },
        });
      await tx.employee.update({
        where: { id: account.id },
        data: { overtimeAccountSince: fromLocalDate(cutTime) },
      });
    }
  }

  private async purge(
    tx: Tx,
    today: LocalDate,
    s: RetentionSettingsView,
    result: PurgeResult,
  ): Promise<void> {
    const cutTime = retentionCutoff(today, s.timeYears);
    const cutPayroll = retentionCutoff(today, s.payrollYears);
    const cutLeave = retentionCutoff(today, s.leaveYears);
    const cutAudit = retentionCutoff(today, s.auditYears);

    // Überstundenkonten: Saldo bis zum Stichtag vortragen, bevor Buchungen verschwinden (Befund 1).
    await this.carryOvertime(tx, cutTime);

    // Zeitbuchungen: Frist für Zeiten; Minijob-Zeiten sind Lohnunterlagen mit eigener Frist.
    const oldest = cutTime < cutPayroll ? cutPayroll : cutTime;
    const candidates = await tx.timeEntry.findMany({
      where: { workDate: { lt: fromLocalDate(oldest) } },
      select: { id: true, employeeId: true, workDate: true },
    });
    const employees = await tx.employee.findMany({
      where: { id: { in: [...new Set(candidates.map((c) => c.employeeId))] } },
      include: { terms: true },
    });
    const terms = new Map(employees.map((e) => [e.id, e.terms]));
    const ids = candidates
      .filter((c) => {
        const date = toLocalDate(c.workDate);
        const minijob = termsAt(terms.get(c.employeeId) ?? [], date)?.type === 'MINIJOB';
        return date < (minijob ? cutPayroll : cutTime);
      })
      .map((c) => c.id);
    if (ids.length) {
      await tx.timeCorrectionRequest.deleteMany({ where: { entryId: { in: ids } } });
      await tx.timeEntryRevision.deleteMany({ where: { entryId: { in: ids } } });
      await tx.timeEntryBreak.deleteMany({ where: { entryId: { in: ids } } });
      result.timeEntries = (await tx.timeEntry.deleteMany({ where: { id: { in: ids } } })).count;
    }
    await tx.monthClosing.deleteMany({ where: { month: { lt: cutTime.slice(0, 7) } } });
    // Erinnerungsprotokoll (Phase 5) mit der Frist der Zeitbuchungen.
    await tx.reminderLog.deleteMany({ where: { date: { lt: fromLocalDate(cutTime) } } });
    // Neutralisierte Krankmeldungen folgen der Frist der Zeitbuchungen (Phase 6, Abschnitt 9).
    await tx.sickLeave.deleteMany({
      where: { kind: 'NEUTRAL', to: { lt: fromLocalDate(cutTime) } },
    });
    // Korrekturbuchungen beendeter Konten vor dem Stichtag; laufende Konten hat der Saldovortrag erfasst.
    await tx.overtimeAdjustment.deleteMany({
      where: {
        effectiveOn: { lt: fromLocalDate(cutTime) },
        employee: { overtimeAccountSince: null },
      },
    });

    // Urlaub: Anträge, Konten, Hinweise und Überträge vor dem Stichtag.
    const leaveYear = Number(cutLeave.slice(0, 4));
    const leave = await Promise.all([
      tx.leaveRequest.deleteMany({ where: { to: { lt: fromLocalDate(cutLeave) } } }),
      tx.leaveLedgerEntry.deleteMany({ where: { year: { lt: leaveYear } } }),
      tx.leaveNotice.deleteMany({ where: { year: { lt: leaveYear } } }),
      tx.leaveCarryOver.deleteMany({ where: { year: { lt: leaveYear } } }),
    ]);
    result.leaveRecords = leave.reduce((sum, c) => sum + c.count, 0);

    // Kalenderjahre gelten in Europe/Berlin (Befund 2).
    const auditCut = berlinInstant(cutAudit, '00:00') ?? new Date(`${cutAudit}T00:00:00Z`);
    result.auditEntries = (await tx.auditLog.deleteMany({ where: { at: { lt: auditCut } } })).count;

    // Ausgeschiedene: anonymisieren, wenn ihre Fristen abgelaufen und keine Daten mehr übrig sind
    // (Entscheidung 8, Befund 10). Die Minijob-Frist gilt nur für Personen mit Minijob-Verträgen.
    const leavers = await tx.employee.findMany({
      where: { exitDate: { not: null }, NOT: { name: ANONYMIZED_NAME } },
      select: { id: true, exitDate: true, terms: { select: { type: true } } },
    });
    const exited: { id: string }[] = [];
    for (const c of leavers) {
      const hadMinijob = c.terms.some((t) => t.type === 'MINIJOB');
      const due = [cutTime, cutLeave, ...(hadMinijob ? [cutPayroll] : [])].sort()[0] ?? cutTime;
      if (!c.exitDate || toLocalDate(c.exitDate) >= due) continue;
      const remaining = await Promise.all([
        tx.timeEntry.count({ where: { employeeId: c.id } }),
        tx.leaveRequest.count({ where: { employeeId: c.id } }),
        tx.leaveNotice.count({ where: { employeeId: c.id } }),
        tx.leaveLedgerEntry.count({ where: { employeeId: c.id } }),
        tx.monthClosing.count({ where: { employeeId: c.id } }),
        tx.overtimeAdjustment.count({ where: { employeeId: c.id } }),
        tx.reminderLog.count({ where: { employeeId: c.id } }),
      ]);
      if (remaining.every((n) => n === 0)) exited.push({ id: c.id });
    }
    for (const { id } of exited) {
      // Krankmeldungen verhindern die Anonymisierung nicht, sie werden mit ihr gelöscht (Phase 6).
      await tx.sickLeave.deleteMany({ where: { employeeId: id } });
      await tx.passkey.deleteMany({ where: { employeeId: id } });
      await tx.pushSubscription.deleteMany({ where: { employeeId: id } });
      await tx.session.deleteMany({ where: { employeeId: id } });
      await tx.loginCode.deleteMany({ where: { employeeId: id } });
      await tx.employmentTerms.deleteMany({ where: { employeeId: id } });
      await tx.leaveCarryOver.deleteMany({ where: { employeeId: id } });
      await tx.employee.update({
        where: { id },
        data: {
          name: ANONYMIZED_NAME,
          jobTitle: null,
          loginEmail: `ehemalig-${id}@invalid.local`,
          lockedAt: new Date(),
          overtimeAccountSince: null,
          // Jugendarbeitsschutz (Phase 7): Geburtsdatum und Schulpflicht mit löschen.
          birthDate: null,
          fullTimeSchoolUntil: null,
        },
      });
    }
    result.anonymized = exited.length;
  }
}
