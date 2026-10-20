import { isLocalDate, type LocalDate } from '@as/shared';

/** Prisma liefert `@db.Date` als Date um 00:00 UTC. */
export function toLocalDate(date: Date): LocalDate {
  return date.toISOString().slice(0, 10);
}

export function fromLocalDate(date: LocalDate): Date {
  if (!isLocalDate(date)) throw new RangeError(`Ungültiges Datum: ${date}`);
  return new Date(`${date}T00:00:00.000Z`);
}
