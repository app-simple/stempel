import type { INestApplication, LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Role } from '@as/shared';
import request from 'supertest';
import type { EmploymentType } from '../generated/prisma/client';
import { AppModule } from '../app/app.module';
import { setupApp } from '../app/app.setup';
import { SessionService } from '../app/auth/session.service';
import { Clock } from '../app/common/clock';
import { fromLocalDate } from '../app/common/dates';
import { MailService } from '../app/mail/mail.service';
import { PrismaService } from '../app/prisma/prisma.service';
import { FakeClock, FakeMailService, FakePushService } from './fakes';
import { PushService } from '../app/reminders/push.service';

export const ORIGIN = 'http://localhost:4200';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  clock: FakeClock;
  mail: FakeMailService;
  push: FakePushService;
  close(): Promise<void>;
}

export async function createTestApp(
  options: { logger?: LoggerService } = {},
): Promise<TestContext> {
  const clock = new FakeClock();
  const mail = new FakeMailService();
  const push = new FakePushService();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(PushService)
    .useValue(push)
    .compile();
  const app = moduleRef.createNestApplication({
    logger: options.logger ?? (process.env['TEST_LOG'] ? ['error', 'warn'] : false),
  });
  setupApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, clock, mail, push, close: () => app.close() };
}

/**
 * Leert alle Tabellen außer dem AuditLog. Buchungen und Revisionen sind per Trigger gegen Löschen
 * geschützt; nur hier, auf der Test-Datenbank, werden die Trigger dafür im Replikationsmodus übergangen.
 */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
    prisma.$executeRawUnsafe(
      'TRUNCATE "SchoolHoliday", "SickLeave", "ReminderLog", "PushSubscription", "LeaveNotice", "LeaveLedgerEntry", "LeaveRequest", "TimeEntryRevision", "TimeCorrectionRequest", "TimeEntryBreak", "TimeEntry", "MonthClosing", "OvertimeAdjustment", "Session", "LoginCode", "Passkey", "AuthChallenge", "RateLimitHit", "LeaveCarryOver", "EmploymentTerms", "Holiday", "CompanySettings", "LegalParameter", "Employee" CASCADE',
    ),
  ]);
}

export interface EmployeeSeed {
  name?: string;
  email?: string;
  role?: Role;
  leadId?: string | null;
  lockedAt?: Date | null;
  exitDate?: string | null;
  type?: EmploymentType;
}

let counter = 0;

export async function createEmployee(
  prisma: PrismaService,
  seed: EmployeeSeed = {},
): Promise<{ id: string; email: string }> {
  counter += 1;
  const email = seed.email ?? `person${counter}@example.com`;
  const employee = await prisma.employee.create({
    data: {
      name: seed.name ?? `Person ${counter}`,
      loginEmail: email,
      role: seed.role ?? 'EMPLOYEE',
      leadId: seed.leadId ?? null,
      lockedAt: seed.lockedAt ?? null,
      exitDate: seed.exitDate ? fromLocalDate(seed.exitDate) : null,
      entryDate: fromLocalDate('2026-01-01'),
      terms: {
        create: {
          validFrom: fromLocalDate('2026-01-01'),
          type: seed.type ?? 'FULL_TIME',
          weeklyMinutes: seed.type === 'MINIJOB' ? 480 : 2400,
          workDays: seed.type === 'MINIJOB' ? [2, 4] : [1, 2, 3, 4, 5],
          annualLeaveDays: seed.type === 'MINIJOB' ? 8 : 30,
          hourlyWageCents: seed.type === 'MINIJOB' ? 1400 : null,
        },
      },
    },
  });
  return { id: employee.id, email };
}

/** Sitzung direkt anlegen und als Cookie-Header zurückgeben. */
export async function sessionCookie(ctx: TestContext, employeeId: string): Promise<string> {
  const token = await ctx.app.get(SessionService).create(employeeId, 'EMAIL_CODE');
  return `__Host-asos_session=${token}`;
}

export function http(ctx: TestContext): ReturnType<typeof request> {
  return request(ctx.app.getHttpServer());
}

/** Liest Set-Cookie als einzelnen Cookie-Header für Folgeanfragen. */
export function cookiesFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).map((c) => c.split(';')[0]).join('; ');
}

/** Gesetzliche Werte 2026 und 2027 wie im Seed. */
export async function seedLegalParameters(prisma: PrismaService): Promise<void> {
  await prisma.legalParameter.createMany({
    data: [
      {
        key: 'MIN_WAGE_HOURLY_CENTS',
        value: 1390,
        validFrom: fromLocalDate('2026-01-01'),
        source: 'Test',
      },
      {
        key: 'MINIJOB_MONTHLY_LIMIT_CENTS',
        value: 60300,
        validFrom: fromLocalDate('2026-01-01'),
        source: 'Test',
      },
      {
        key: 'MIN_WAGE_HOURLY_CENTS',
        value: 1460,
        validFrom: fromLocalDate('2027-01-01'),
        source: 'Test',
      },
      {
        key: 'MINIJOB_MONTHLY_LIMIT_CENTS',
        value: 63300,
        validFrom: fromLocalDate('2027-01-01'),
        source: 'Test',
      },
    ],
  });
}
