import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { fromLocalDate } from '../src/app/common/dates';
import { parseCreateAdminArgs } from './create-admin-args';

/**
 * Legt den ersten Admin an (Spezifikation 6.5). Es gibt keine Selbstregistrierung; weitere Konten legt
 * der Admin in der Oberfläche an. Den Vertragsstand pflegt der Admin danach unter „Mitarbeiter“.
 *
 * Aufruf: pnpm nx run api:create-admin --args="--name='…' --email=… --entry=JJJJ-MM-TT"
 */
async function main(): Promise<void> {
  const args = parseCreateAdminArgs(process.argv.slice(2));
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL fehlt.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await prisma.$transaction(async (tx) => {
      if (await tx.employee.findUnique({ where: { loginEmail: args.email } })) {
        throw new Error('Diese Anmeldeadresse ist bereits vergeben.');
      }
      const admin = await tx.employee.create({
        data: {
          name: args.name,
          loginEmail: args.email,
          role: 'ADMIN',
          entryDate: fromLocalDate(args.entryDate),
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'employee.create',
          entityType: 'Employee',
          entityId: admin.id,
          details: { source: 'cli' },
        },
      });
    });
    // Keine personenbezogenen Daten in der Ausgabe.
    console.log('Admin angelegt. Anmeldung per E-Mail-Code ist jetzt möglich.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const known = error instanceof Error && /^(Bitte|Diese|DATABASE_URL)/.test(error.message);
  console.error(known ? (error as Error).message : 'Anlegen fehlgeschlagen.');
  process.exitCode = 1;
});
