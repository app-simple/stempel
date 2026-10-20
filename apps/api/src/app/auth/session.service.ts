import { Injectable } from '@nestjs/common';
import type { Role } from '@as/shared';
import type { LoginMethod } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { randomToken, sha256Hex } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { canLogIn } from './login-eligibility';
import { SESSION_TTL_MS } from './session-cookie';

/** Verlängerung der rollierenden Sitzung höchstens einmal pro Stunde. */
const TOUCH_INTERVAL_MS = 60 * 60_000;

export interface ResolvedSession {
  user: AuthUser;
  /** Cookie neu setzen, weil die Laufzeit verlängert wurde. */
  renewed: boolean;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Legt eine Sitzung an und gibt das Token für das Cookie zurück. Nur der Hash landet in der DB. */
  async create(employeeId: string, method: LoginMethod): Promise<string> {
    const token = randomToken();
    const now = this.clock.now();
    const session = await this.prisma.session.create({
      data: {
        employeeId,
        tokenHash: sha256Hex(token),
        method,
        createdAt: now,
        lastActiveAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      },
    });
    await this.audit.record({
      action: 'auth.login',
      actorId: employeeId,
      entityType: 'Session',
      entityId: session.id,
      details: { method },
    });
    return token;
  }

  /** Prüft Token, Ablauf und Anmeldesperre. Ungültige Sitzungen werden gelöscht. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: {
        employee: { select: { id: true, name: true, role: true, lockedAt: true, exitDate: true } },
      },
    });
    if (!session) return null;

    const now = this.clock.now();
    if (session.expiresAt <= now || !canLogIn(session.employee, this.clock.today())) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }

    let renewed = false;
    if (now.getTime() - session.lastActiveAt.getTime() >= TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastActiveAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
      });
      renewed = true;
    }

    const { id, name, role } = session.employee;
    return { user: { id, name, role: role as Role, sessionId: session.id }, renewed };
  }

  async revoke(user: AuthUser): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: user.sessionId } });
    await this.audit.record({
      action: 'auth.logout',
      actorId: user.id,
      entityType: 'Session',
      entityId: user.sessionId,
    });
  }

  async revokeAll(employeeId: string, actorId: string): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({ where: { employeeId } });
    await this.audit.record({
      action: 'auth.logout-all',
      actorId,
      entityType: 'Employee',
      entityId: employeeId,
      details: { sessions: count },
    });
    return count;
  }
}
