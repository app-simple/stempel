import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { apiEnv, E2E } from './env';

const root = resolve(__dirname, '../../..');

/**
 * Legt die E2E-Datenbank bei Bedarf an, bringt sie auf den Migrationsstand und füllt sie neu mit dem Seed.
 * Nur für eine Datenbank mit Endung _e2e (Prüfung in env.ts).
 */
export default async function globalSetup(): Promise<void> {
  const url = new URL(E2E.databaseUrl);
  const dbName = url.pathname.slice(1);
  const admin = new pg.Client({
    connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString(),
  });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const env = { ...process.env, ...apiEnv };
  execSync('pnpm exec prisma migrate deploy --config apps/api/prisma.config.ts', {
    cwd: root,
    env,
    stdio: 'pipe',
  });

  const db = new pg.Client({ connectionString: E2E.databaseUrl });
  await db.connect();
  // AuditLog bleibt erhalten; alle anderen Tabellen starten leer. Buchungen und Revisionen sind per
  // Trigger geschützt, nur hier auf der E2E-Datenbank werden die Trigger im Replikationsmodus übergangen.
  await db.query('BEGIN');
  await db.query('SET LOCAL session_replication_role = replica');
  await db.query(
    'TRUNCATE "SchoolHoliday", "SickLeave", "ReminderLog", "PushSubscription", "LeaveNotice", "LeaveLedgerEntry", "LeaveRequest", "TimeEntryRevision", "TimeCorrectionRequest", "TimeEntryBreak", "TimeEntry", "MonthClosing", "OvertimeAdjustment", "Session", "LoginCode", "Passkey", "AuthChallenge", "RateLimitHit", "LeaveCarryOver", "EmploymentTerms", "Holiday", "CompanySettings", "LegalParameter", "Employee" CASCADE',
  );
  await db.query('COMMIT');
  await db.end();
  execSync('pnpm exec prisma db seed --config apps/api/prisma.config.ts', {
    cwd: root,
    env,
    stdio: 'pipe',
  });
}
