import { legalValuesAt, type LegalValuesAt, type LocalDate } from '@as/shared';
import type { PrismaClient } from '../../generated/prisma/client';
import { toLocalDate } from '../common/dates';

type Db = Pick<PrismaClient, 'legalParameter'>;

export type { LegalValuesAt };

/** Gesetzliche Werte aus `LegalParameter` zu einem Stichtag (CLAUDE.md: nie als Konstante im Code). */
export async function loadLegalValues(db: Db, date: LocalDate): Promise<LegalValuesAt> {
  const rows = await db.legalParameter.findMany();
  return legalValuesAt(
    rows.map((r) => ({ key: r.key, value: r.value, validFrom: toLocalDate(r.validFrom) })),
    date,
  );
}
