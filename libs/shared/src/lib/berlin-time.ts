import type { LocalDate } from './domain';
import { addDays, isLocalDate, isoWeek, isoWeekday } from './local-date';

const BERLIN = 'Europe/Berlin';
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Eingabe einer Uhrzeit, optional mit „W“ für die zweite (Winterzeit-)Stunde am Tag der Zeitumstellung. */
const TIME_INPUT = /^([01]\d|2[0-3]):([0-5]\d)W?$/;

/** Uhrzeit HH:MM in Europe/Berlin für einen Zeitpunkt. */
export function berlinTime(instant: Date): string {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** Abstand von Europe/Berlin zu UTC in Minuten zu einem Zeitpunkt (60 oder 120). */
function offsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BERLIN,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/** Uhrzeit „HH:MM“ oder „HH:MMW“ (zweites Vorkommen der doppelten Stunde im Oktober). */
export function isTimeInput(value: unknown): value is string {
  return typeof value === 'string' && TIME_INPUT.test(value);
}

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && TIME.test(value);
}

/**
 * Alle Zeitpunkte zu Datum und Uhrzeit in Europe/Berlin: keiner, wenn die Uhrzeit wegen der Umstellung
 * auf Sommerzeit nicht existiert (29.03.2026 02:30), zwei, wenn sie bei der Rückstellung doppelt vorkommt
 * (25.10.2026 02:30), sonst einer.
 */
export function berlinInstants(date: LocalDate, time: string): Date[] {
  if (!isLocalDate(date) || !isTimeOfDay(time))
    throw new RangeError(`Ungültige Zeit: ${date} ${time}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  return [120, 60]
    .map((offset) => new Date(naive - offset * 60_000))
    .filter((candidate) => offsetMinutes(candidate) === (naive - candidate.getTime()) / 60_000);
}

/** Erster Zeitpunkt zu Datum und Uhrzeit in Europe/Berlin, oder null, wenn es die Uhrzeit nicht gibt. */
export function berlinInstant(date: LocalDate, time: string): Date | null {
  return berlinInstants(date, time)[0] ?? null;
}

/** Schlüssel der ISO-Kalenderwoche, z. B. „2026-W42“. */
export function isoWeekKey(date: LocalDate): string {
  const thursday = addDays(date, 4 - isoWeekday(date));
  return `${thursday.slice(0, 4)}-W${String(isoWeek(date)).padStart(2, '0')}`;
}

/** Montag einer ISO-Kalenderwoche „JJJJ-Www“, oder null bei ungültigem Schlüssel. */
export function mondayOfIsoWeek(key: string): LocalDate | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = `${year}-01-04`;
  const monday = addDays(addDays(jan4, 1 - isoWeekday(jan4)), (week - 1) * 7);
  return isoWeekKey(monday) === key ? monday : null;
}

/** Montag der Woche eines Datums. */
export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * Uhrzeit eines Zeitpunkts als eindeutige Eingabe: „HH:MM“, in der doppelten Stunde der Rückstellung
 * beim zweiten Vorkommen „HH:MMW“. Umkehrung zu `berlinInstants` mit Auswahl.
 */
export function berlinTimeInput(instant: Date): string {
  const time = berlinTime(instant);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const candidates = berlinInstants(date, time);
  return candidates.length > 1 &&
    candidates[1]?.getTime() === Math.floor(instant.getTime() / 60_000) * 60_000
    ? `${time}W`
    : time;
}
