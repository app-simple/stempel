import type { IsoWeekday, LocalDate } from './domain';

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BERLIN = 'Europe/Berlin';
const DAY_MS = 86_400_000;

/** Prüft Format und Kalendergültigkeit (kein 31.02.). */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toUtcMs(date: LocalDate): number {
  if (!isLocalDate(date)) throw new RangeError(`Ungültiges Datum: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Rechnet in reinen Kalendertagen, unabhängig von Sommerzeit. */
export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Anzahl Tage von `from` bis `to` (negativ, wenn `to` früher liegt). */
export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function isoWeekday(date: LocalDate): IsoWeekday {
  const day = new Date(toUtcMs(date)).getUTCDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}

export function yearOf(date: LocalDate): number {
  toUtcMs(date);
  return Number(date.slice(0, 4));
}

/** Alle Tage von `from` bis `to`, beide inklusive. Leer, wenn `from` nach `to` liegt. */
export function eachDay(from: LocalDate, to: LocalDate): LocalDate[] {
  const days: LocalDate[] = [];
  for (let ms = toUtcMs(from), end = toUtcMs(to); ms <= end; ms += DAY_MS) days.push(fromUtcMs(ms));
  return days;
}

/** Lokales Datum in Europe/Berlin für einen Zeitpunkt. */
export function localDateInBerlin(instant: Date): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Datum mit Jahr, z. B. 01.01.2027. */
export function formatLocalDate(date: LocalDate): string {
  toUtcMs(date);
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

/** ISO-Kalenderwoche (Woche mit dem ersten Donnerstag ist KW 1). */
export function isoWeek(date: LocalDate): number {
  const thursday = addDays(date, 4 - isoWeekday(date));
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(diffDays(yearStart, thursday) / 7) + 1;
}
