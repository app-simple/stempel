import type { CompanySettings, Prisma } from '../../generated/prisma/client';

/**
 * Liest die einzige Zeile der Betriebseinstellungen und legt sie bei Bedarf an. `createMany` mit
 * `skipDuplicates` ist ein `INSERT … ON CONFLICT DO NOTHING`; ein `upsert` mit leerem `update` liest
 * erst und legt dann an und scheitert bei parallelen Aufrufen am Primärschlüssel.
 */
export async function companySettings(
  db: Pick<Prisma.TransactionClient, 'companySettings'>,
): Promise<CompanySettings> {
  await db.companySettings.createMany({ data: [{ id: 1 }], skipDuplicates: true });
  return db.companySettings.findUniqueOrThrow({ where: { id: 1 } });
}
