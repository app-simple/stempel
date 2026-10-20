import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { hmacHex } from '../common/crypto';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

export interface RateLimitRule {
  scope: string;
  limit: number;
  windowMs: number;
}

const FIFTEEN_MINUTES = 15 * 60_000;

/** Spezifikation Phase 1, Abschnitt 6.1. */
export const RATE_LIMITS = {
  codeRequestPerEmail: { scope: 'code-request:email', limit: 3, windowMs: FIFTEEN_MINUTES },
  codeRequestPerIp: { scope: 'code-request:ip', limit: 10, windowMs: FIFTEEN_MINUTES },
  codeVerifyPerIp: { scope: 'code-verify:ip', limit: 10, windowMs: FIFTEEN_MINUTES },
  passkeyLoginPerIp: { scope: 'passkey-login:ip', limit: 30, windowMs: FIFTEEN_MINUTES },
  // Phase 5, Codex-Review API Befund 7: Push-Anmeldung und Testversand je Person begrenzen.
  pushSubscribePerUser: { scope: 'push-subscribe:user', limit: 20, windowMs: 60 * 60_000 },
  pushTestPerUser: { scope: 'push-test:user', limit: 5, windowMs: 60 * 60_000 },
} satisfies Record<string, RateLimitRule>;

export class TooManyAttemptsException extends HttpException {
  constructor() {
    super(
      'Zu viele Versuche. Bitte in einigen Minuten erneut versuchen.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Feste Zeitfenster, gezählt in der DB, damit das Limit auch bei mehreren API-Instanzen gilt.
 * Der Schlüssel ist ein HMAC aus Bereich und Kennung; Adressen und IPs stehen nie im Klartext in der DB.
 */
@Injectable()
export class RateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Zählt einen Versuch und wirft 429, wenn das Limit überschritten ist. */
  async consume(rule: RateLimitRule, identifier: string): Promise<void> {
    const key = hmacHex(this.config.authPepper, `${rule.scope}:${identifier}`);
    const now = this.clock.now().getTime();
    const windowStart = new Date(now - (now % rule.windowMs));
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitHit" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitHit"."count" + 1
      RETURNING "count"`;
    if ((rows[0]?.count ?? 0) > rule.limit) throw new TooManyAttemptsException();
  }
}
