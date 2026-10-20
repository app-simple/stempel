import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { localDateInBerlin } from '@as/shared';
import { validateEmploymentTerms } from '@as/time-rules';
import { PrismaClient } from '../src/generated/prisma/client';
import { fromLocalDate } from '../src/app/common/dates';
import { ensureStatutoryHolidays } from '../src/app/holidays/holiday-generation';
import { loadLegalValues } from '../src/app/legal/legal-values';
import { seedEmployees, seedLegalParameters } from './seed-data';
import { seedTimeEntries } from './seed-time';
import { seedLeaveRequests } from './seed-leave';

class SeedValidationError extends Error {}

/**
 * Mit `--nur-stammdaten` legt der Seed nur gesetzliche Werte, Einstellungen und Feiertage an, ohne
 * Beispielpersonen. So ist er auch für die Ersteinrichtung in Produktion geeignet.
 */
const onlyMasterData = process.argv.includes('--nur-stammdaten');

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new SeedValidationError('Seed abgebrochen: DATABASE_URL fehlt.');
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const createdEmployees = await prisma.$transaction(
      async (tx) => {
        for (const parameter of seedLegalParameters) {
          const validFrom = fromLocalDate(parameter.validFrom);
          await tx.legalParameter.upsert({
            where: { key_validFrom: { key: parameter.key, validFrom } },
            create: { ...parameter, validFrom },
            update: {},
          });
        }
        await tx.companySettings.upsert({
          where: { id: 1 },
          create: { id: 1, state: 'BY', assumptionDayIsHoliday: true },
          update: {},
        });
        for (let year = 2025; year <= 2028; year++) {
          await ensureStatutoryHolidays(tx, year);
        }
        if (onlyMasterData || (await tx.employee.count()) > 0) return 0;

        // Alle Vertragsstände prüfen, bevor Mitarbeiter geschrieben werden.
        for (const employee of seedEmployees) {
          const legal = await loadLegalValues(tx, employee.terms.validFrom);
          if (!legal.current) {
            throw new SeedValidationError(
              'Seed abgebrochen: Gesetzliche Werte am Stichtag fehlen.',
            );
          }
          const { errors } = validateEmploymentTerms(employee.terms, legal.current, legal.upcoming);
          if (errors.length > 0) {
            throw new SeedValidationError(
              `Seed abgebrochen: Ungültiger Vertragsstand. ${errors.map((error) => error.text).join(' ')}`,
            );
          }
        }

        const ids = new Map(seedEmployees.map((employee) => [employee.id, randomUUID()]));
        const databaseId = (reference: string): string => {
          const id = ids.get(reference);
          if (!id) throw new SeedValidationError('Seed abgebrochen: Mitarbeiterreferenz fehlt.');
          return id;
        };

        // Ein gemeinsames INSERT löst auch Referenzen unabhängig von der Reihenfolge auf.
        await tx.employee.createMany({
          data: seedEmployees.map((employee) => ({
            id: databaseId(employee.id),
            name: employee.name,
            jobTitle: employee.jobTitle,
            role: employee.role,
            loginEmail: employee.loginEmail,
            entryDate: fromLocalDate(employee.entryDate),
            leadId: employee.leadId === null ? null : databaseId(employee.leadId),
            deputyId: null,
          })),
        });
        for (const employee of seedEmployees) {
          const employeeId = databaseId(employee.id);
          await tx.employmentTerms.create({
            data: {
              ...employee.terms,
              employeeId,
              validFrom: fromLocalDate(employee.terms.validFrom),
              workDays: [...employee.terms.workDays],
            },
          });
          if (employee.carryOver) {
            await tx.leaveCarryOver.create({ data: { ...employee.carryOver, employeeId } });
          }
          await tx.auditLog.create({
            data: {
              action: 'employee.create',
              actorId: null,
              entityType: 'Employee',
              entityId: employeeId,
              details: { source: 'seed' },
            },
          });
        }
        await seedTimeEntries(tx, ids, localDateInBerlin(new Date()));
        await seedLeaveRequests(tx, ids);
        return seedEmployees.length;
        // Eine Transaktion für die ganze Befüllung; die Prisma-Vorgabe von 5 s reicht auf ausgelasteten
        // Rechnern nicht.
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
    console.log(
      onlyMasterData ? 'Stammdaten angelegt.' : `${createdEmployees} Mitarbeiter angelegt.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Prisma-Fehler können Namen, Adressen und Verbindungsdaten enthalten.
  console.error(
    error instanceof SeedValidationError
      ? error.message
      : 'Seed fehlgeschlagen: Datenbankzugriff oder Schreibvorgang fehlgeschlagen.',
  );
  process.exitCode = 1;
});
