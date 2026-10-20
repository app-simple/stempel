import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { berlinTime, localDateInBerlin } from '@as/shared';
import { businessDaysBetween } from '@as/time-rules';
import { Clock } from '../common/clock';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { holidaysBetween } from '../time/time-context';
import { LeaveMailService } from './leave-mail.service';

const CHECK_INTERVAL_MS = 15 * 60_000;
const OVERDUE_AFTER_BUSINESS_DAYS = 5;
const RUN_FROM = '07:00';

/**
 * Meldung offener Anträge an den Admin (Konzept 4.2, Spezifikation Phase 3, Entscheidung 12): ab 07:00
 * (Europe/Berlin) einmalig je Antrag, der länger als fünf Arbeitstage offen ist. Jeder Antrag wird vor
 * dem Versand einzeln über `overdueNotifiedAt` beansprucht; laufen mehrere Instanzen, meldet nur eine.
 * Scheitert der Versand, wird die Beanspruchung zurückgenommen. Bricht der Prozess genau zwischen
 * Beanspruchung und Versand ab, bleibt die Meldung aus; der Antrag ist in „Freigaben“ weiterhin als
 * überfällig markiert.
 */
@Injectable()
export class LeaveOverdueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('LeaveOverdue');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mails: LeaveMailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    // In Tests wird `runOnce` direkt aufgerufen.
    if (this.config.nodeEnv === 'test') return;
    this.timer = setInterval(() => {
      this.runOnce().catch((error: unknown) =>
        this.logger.error(
          `Lauf fehlgeschlagen: ${error instanceof Error ? error.name : 'unbekannt'}`,
        ),
      );
    }, CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Meldet neu überfällige Anträge und gibt ihre Anzahl zurück. */
  async runOnce(): Promise<number> {
    const now = this.clock.now();
    if (berlinTime(now) < RUN_FROM) return 0;
    const today = localDateInBerlin(now);
    const pending = await this.prisma.leaveRequest.findMany({
      where: { status: 'PENDING', overdueNotifiedAt: null },
      include: { employee: { select: { name: true } } },
      orderBy: { requestedAt: 'asc' },
    });
    const first = pending[0];
    if (!first) return 0;
    const holidays = await holidaysBetween(
      this.prisma,
      localDateInBerlin(first.requestedAt),
      today,
    );
    const claimed: typeof pending = [];
    for (const r of pending) {
      const open = businessDaysBetween(localDateInBerlin(r.requestedAt), today, holidays.dates);
      if (open <= OVERDUE_AFTER_BUSINESS_DAYS) continue;
      const { count } = await this.prisma.leaveRequest.updateMany({
        where: { id: r.id, status: 'PENDING', overdueNotifiedAt: null },
        data: { overdueNotifiedAt: now },
      });
      if (count === 1) claimed.push(r);
    }
    if (claimed.length === 0) return 0;
    const admins = await this.prisma.employee.findMany({
      where: {
        role: 'ADMIN',
        lockedAt: null,
        OR: [{ exitDate: null }, { exitDate: { gte: fromLocalDate(today) } }],
      },
      select: { loginEmail: true },
    });
    const sent = await this.mails.sendOverdue(
      admins.map((a) => a.loginEmail),
      claimed.map((r) => ({
        employeeName: r.employee.name,
        type: r.type,
        from: toLocalDate(r.from),
        to: toLocalDate(r.to),
        halfDays: r.halfDays,
      })),
    );
    if (!sent) {
      // Versand fehlgeschlagen: Anträge für den nächsten Lauf wieder freigeben (Befund 5).
      await this.prisma.leaveRequest.updateMany({
        where: { id: { in: claimed.map((r) => r.id) }, overdueNotifiedAt: now },
        data: { overdueNotifiedAt: null },
      });
      return 0;
    }
    return claimed.length;
  }
}
