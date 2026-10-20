import { bavarianHolidays } from '@as/time-rules';
import type { Prisma } from '../../generated/prisma/client';
import { fromLocalDate } from '../common/dates';

/** Serialisiert Jahreserzeugung und Umschalten von Mariä Himmelfahrt (Codex-Review AP6/7, Befund 7). */
export const HOLIDAY_LOCK = 7_310_002;

/**
 * Legt die gesetzlichen Feiertage eines Jahres einmalig an (Spezifikation Phase 1, Abschnitt 8).
 * Alle 13 bayerischen Feiertage werden erzeugt; Mariä Himmelfahrt ist aktiv, wenn die Einstellung
 * des Betriebs es vorsieht. Danach ist die Liste maßgeblich und nur noch per Admin änderbar.
 *
 * Muss innerhalb einer Transaktion aufgerufen werden; die Sperre gilt bis zu deren Ende.
 *
 * @returns true, wenn das Jahr neu angelegt wurde
 */
export async function ensureStatutoryHolidays(
  tx: Prisma.TransactionClient,
  year: number,
): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${HOLIDAY_LOCK})`;
  const settings = await tx.companySettings.findUnique({ where: { id: 1 } });
  const state = settings?.state ?? 'BY';
  const existing = await tx.holiday.count({
    where: {
      state,
      origin: 'STATUTORY',
      date: { gte: fromLocalDate(`${year}-01-01`), lte: fromLocalDate(`${year}-12-31`) },
    },
  });
  if (existing > 0) return false;

  const assumptionDay = settings?.assumptionDayIsHoliday ?? true;
  await tx.holiday.createMany({
    data: bavarianHolidays(year, { assumptionDay: true }).map((h) => ({
      date: fromLocalDate(h.date),
      name: h.name,
      state,
      origin: 'STATUTORY' as const,
      key: h.key,
      active: h.key === 'ASSUMPTION_DAY' ? assumptionDay : true,
    })),
    skipDuplicates: true,
  });
  return true;
}
