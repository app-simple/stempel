import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { hmacHex, randomSixDigitCode, safeEqualHex } from '../common/crypto';
import { waitForFloor } from '../common/response-floor';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { loginCodeMail, MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { canLogIn } from './login-eligibility';
import { RATE_LIMITS, RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_FAILED_ATTEMPTS = 5;
export const INVALID_CODE_MESSAGE = 'Code ungültig oder abgelaufen.';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Anmeldung per E-Mail-Code nach Konzept 5.1 und Spezifikation Phase 1, Abschnitt 6.1. */
@Injectable()
export class LoginCodeService {
  private readonly logger = new Logger('LoginCode');
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly rateLimit: RateLimitService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private hash(employeeId: string, code: string): string {
    return hmacHex(this.config.authPepper, `login-code:${employeeId}:${code}`);
  }

  /**
   * Fordert einen Code an. Nach dem Rate-Limit antwortet die API sofort und für jede Adresse gleich;
   * Nachschlagen, Speichern und Versand laufen erst danach. So verraten weder Antwort noch
   * Antwortzeit, ob eine Adresse bekannt oder gesperrt ist.
   */
  async request(rawEmail: string, ip: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    await this.rateLimit.consume(RATE_LIMITS.codeRequestPerIp, ip);
    await this.rateLimit.consume(RATE_LIMITS.codeRequestPerEmail, email);
    const job = this.issueCode(email).catch(() =>
      this.logger.warn('Anmeldecode nicht ausgestellt oder nicht zugestellt.'),
    );
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }

  /** Für Tests: wartet, bis alle angestoßenen Code-Ausstellungen abgeschlossen sind. */
  async whenIdle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async issueCode(email: string): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
      where: { loginEmail: email },
      select: { id: true, lockedAt: true, exitDate: true },
    });
    if (!employee || !canLogIn(employee, this.clock.today())) return;

    const code = randomSixDigitCode();
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      // Anforderungen je Person serialisieren; zusätzlich erlaubt ein partieller Unique-Index
      // höchstens einen offenen Code je Person.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${employee.id}, 0))`;
      // Ein neuer Code entwertet ältere offene Codes.
      await tx.loginCode.deleteMany({ where: { employeeId: employee.id, usedAt: null } });
      await tx.loginCode.create({
        data: {
          employeeId: employee.id,
          codeHash: this.hash(employee.id, code),
          createdAt: now,
          expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        },
      });
    });
    await this.mail.send(loginCodeMail(email, code));
  }

  /**
   * Prüft den Code und gibt bei Erfolg das Sitzungstoken zurück. Jeder Fehler sieht gleich aus und
   * dauert mindestens `authFailureFloorMs`.
   */
  async verify(rawEmail: string, code: string, ip: string): Promise<string> {
    await this.rateLimit.consume(RATE_LIMITS.codeVerifyPerIp, ip);
    const startedAt = performance.now();
    const token = await this.tryVerify(normalizeEmail(rawEmail), code);
    if (token) return token;
    await waitForFloor(startedAt, this.config.authFailureFloorMs);
    throw new UnauthorizedException(INVALID_CODE_MESSAGE);
  }

  private async tryVerify(email: string, code: string): Promise<string | null> {
    const employee = await this.prisma.employee.findUnique({
      where: { loginEmail: email },
      select: { id: true, lockedAt: true, exitDate: true },
    });
    if (!employee) return null;

    // Fehlgeschlagene Prüfungen bekannter Personen werden mit Grund protokolliert, ohne Code oder Adresse.
    const fail = async (reason: string, loginCodeId?: string): Promise<null> => {
      await this.audit.record({
        action: 'auth.code.failed',
        actorId: employee.id,
        entityType: loginCodeId ? 'LoginCode' : 'Employee',
        entityId: loginCodeId ?? employee.id,
        details: { reason },
      });
      return null;
    };

    if (!canLogIn(employee, this.clock.today())) return fail('locked');
    if (!/^\d{6}$/.test(code)) return fail('format');

    const now = this.clock.now();
    const loginCode = await this.prisma.loginCode.findFirst({
      where: { employeeId: employee.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!loginCode) return fail('no-code');

    // Versuch atomar reservieren, bevor verglichen wird: Auch parallele Anfragen können
    // höchstens fünf Vergleiche je Code auslösen.
    const reserved = await this.prisma.loginCode.updateMany({
      where: {
        id: loginCode.id,
        usedAt: null,
        expiresAt: { gt: now },
        failedAttempts: { lt: MAX_FAILED_ATTEMPTS },
      },
      data: { failedAttempts: { increment: 1 } },
    });
    if (reserved.count !== 1) {
      const reason = loginCode.expiresAt <= now ? 'expired' : 'attempts';
      return fail(reason, loginCode.id);
    }

    if (!safeEqualHex(loginCode.codeHash, this.hash(employee.id, code)))
      return fail('mismatch', loginCode.id);

    // Einmal verwendbar; der reservierte Versuch zählt bei Erfolg nicht als Fehlversuch.
    const used = await this.prisma.loginCode.updateMany({
      where: { id: loginCode.id, usedAt: null },
      data: { usedAt: now, failedAttempts: { decrement: 1 } },
    });
    if (used.count !== 1) return fail('used', loginCode.id);

    return this.sessions.create(employee.id, 'EMAIL_CODE');
  }
}
