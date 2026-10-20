import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

const HOUR_MS = 60 * 60_000;
/** Rate-Limit-Fenster sind höchstens 15 Minuten lang; ältere Zähler werden nicht mehr gebraucht. */
const RATE_LIMIT_RETENTION_MS = HOUR_MS;
/** Verbrauchte oder abgelaufene Codes bleiben einen Tag für die Nachvollziehbarkeit. */
const LOGIN_CODE_RETENTION_MS = 24 * HOUR_MS;

/** Räumt stündlich abgelaufene Sitzungen, Codes, Challenges und Rate-Limit-Zähler auf. */
@Injectable()
export class AuthCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AuthCleanup');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.nodeEnv === 'test') return;
    this.timer = setInterval(
      () => void this.run().catch(() => this.logger.warn('Aufräumen fehlgeschlagen.')),
      HOUR_MS,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    const now = this.clock.now();
    await this.prisma.$transaction([
      this.prisma.session.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.prisma.authChallenge.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.prisma.loginCode.deleteMany({
        where: { expiresAt: { lte: new Date(now.getTime() - LOGIN_CODE_RETENTION_MS) } },
      }),
      this.prisma.rateLimitHit.deleteMany({
        where: { windowStart: { lte: new Date(now.getTime() - RATE_LIMIT_RETENTION_MS) } },
      }),
    ]);
  }
}
