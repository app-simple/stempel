import type { LocalDate } from '@as/shared';
import { addDays } from '@as/shared';
import type { BavarianHolidayOptions, HolidayDefinition } from './types';

/**
 * Gesetzliche Feiertage in Bayern für ein Jahr, aufsteigend nach Datum.
 *
 * Rechtsgrundlage: Art. 1 Abs. 1 Bayerisches Feiertagsgesetz (FTG); Arbeitsverbot an Feiertagen § 9 ArbZG.
 * Bewegliche Feiertage hängen am Ostersonntag (Gaußsche Osterformel wie `easter` im Prototyp).
 * Mariä Himmelfahrt nur mit `options.assumptionDay`. Das Augsburger Friedensfest gilt nur im
 * Stadtgebiet Augsburg und ist nicht enthalten.
 */
export function bavarianHolidays(
  year: number,
  options: BavarianHolidayOptions,
): HolidayDefinition[] {
  const easter = easterSunday(year);
  const holidays: HolidayDefinition[] = [
    { date: `${year}-01-01`, key: 'NEW_YEAR', name: 'Neujahr' },
    { date: `${year}-01-06`, key: 'EPIPHANY', name: 'Heilige Drei Könige' },
    { date: addDays(easter, -2), key: 'GOOD_FRIDAY', name: 'Karfreitag' },
    { date: addDays(easter, 1), key: 'EASTER_MONDAY', name: 'Ostermontag' },
    { date: `${year}-05-01`, key: 'LABOUR_DAY', name: 'Tag der Arbeit' },
    { date: addDays(easter, 39), key: 'ASCENSION_DAY', name: 'Christi Himmelfahrt' },
    { date: addDays(easter, 50), key: 'WHIT_MONDAY', name: 'Pfingstmontag' },
    { date: addDays(easter, 60), key: 'CORPUS_CHRISTI', name: 'Fronleichnam' },
    { date: `${year}-10-03`, key: 'GERMAN_UNITY_DAY', name: 'Tag der Deutschen Einheit' },
    { date: `${year}-11-01`, key: 'ALL_SAINTS_DAY', name: 'Allerheiligen' },
    { date: `${year}-12-25`, key: 'CHRISTMAS_DAY', name: '1. Weihnachtstag' },
    { date: `${year}-12-26`, key: 'BOXING_DAY', name: '2. Weihnachtstag' },
  ];
  if (options.assumptionDay) {
    holidays.push({ date: `${year}-08-15`, key: 'ASSUMPTION_DAY', name: 'Mariä Himmelfahrt' });
  }
  return holidays.sort((left, right) =>
    left.date < right.date ? -1 : left.date > right.date ? 1 : 0,
  );
}

/** Ostersonntag nach der Gaußschen Osterformel (gregorianischer Kalender). */
export function easterSunday(year: number): LocalDate {
  if (!Number.isInteger(year) || year < 1583 || year > 9999) {
    throw new RangeError('Das Jahr muss eine ganze Zahl zwischen 1583 und 9999 sein.');
  }

  // Anonymous Gregorian algorithm (Meeus/Jones/Butcher), as used in the prototype.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Ist `date` in der übergebenen Feiertagsliste enthalten? § 9 ArbZG. */
export function isHoliday(
  date: LocalDate,
  holidays: ReadonlySet<LocalDate> | Iterable<{ date: LocalDate }>,
): boolean {
  for (const holiday of holidays) {
    if ((typeof holiday === 'string' ? holiday : holiday.date) === date) return true;
  }
  return false;
}
