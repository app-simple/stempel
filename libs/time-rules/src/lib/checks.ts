import type { LocalDate } from '@as/shared';
import { addDays, isoWeekday, yearOf } from '@as/shared';
import type {
  CompensationDay,
  CompensationResult,
  ForfeitureInput,
  ForfeitureResult,
} from './checks-types';

/**
 * Ausgleichszeitraum nach § 3 ArbZG (Spezifikation Phase 4, Entscheidung 7): 24 Wochen rückwärts ab
 * gestern, also von `today − 168 Tage` bis `today − 1 Tag`, beide inklusive.
 */
export function compensationWindow(today: LocalDate): { from: LocalDate; to: LocalDate } {
  return { from: addDays(today, -168), to: addDays(today, -1) };
}

/**
 * Durchschnittliche Arbeitszeit je Werktag nach § 3 ArbZG. Werktage sind Mo–Sa ohne Feiertage; Tage
 * mit ganztägiger genehmigter Abwesenheit sind keine Ausgleichstage und zählen weder im Zähler noch im
 * Nenner. Hinweis (`exceeds`), wenn der Durchschnitt 8 Stunden (480 Minuten) übersteigt.
 */
export function compensationAverage(days: readonly CompensationDay[]): CompensationResult {
  let workdays = 0;
  let totalMinutes = 0;
  for (const day of days) {
    if (isoWeekday(day.date) === 7 || day.holiday || day.absent) continue;
    workdays++;
    totalMinutes += day.workMinutes;
  }
  return {
    workdays,
    totalMinutes,
    averageMinutes: workdays === 0 ? null : Math.round(totalMinutes / workdays),
    exceeds: totalMinutes > 480 * workdays,
  };
}

/**
 * Verfallstage des Urlaubsjahres nach § 7 Abs. 3 BUrlG: 31.12. des Jahres für nicht übertragenen Rest,
 * 31.03. des Folgejahres für übertragene Tage.
 */
export function forfeitureDates(year: number): { rest: LocalDate; carried: LocalDate } {
  return { rest: `${year}-12-31`, carried: `${year + 1}-03-31` };
}

/**
 * Letzter Tag, an dem ein Urlaubshinweis rechtzeitig ist (Entscheidung 3a; BAG 9 AZR 423/16): drei
 * Monate vor dem Verfallstag, Tag auf das Monatsende begrenzt (31.12. → 30.09., 31.03. → 31.12. des
 * Vorjahres).
 */
export function noticeDeadline(forfeitsOn: LocalDate): LocalDate {
  const year = yearOf(forfeitsOn);
  const month = Number(forfeitsOn.slice(5, 7));
  const day = Number(forfeitsOn.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, month - 3, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 4, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/** Ist ein am `sentOn` (Europe/Berlin) versendeter Hinweis für den Verfallstag rechtzeitig? */
export function noticeIsTimely(sentOn: LocalDate, forfeitsOn: LocalDate): boolean {
  return sentOn <= noticeDeadline(forfeitsOn);
}

/**
 * Verfallbare Tage in halben Tagen nach § 7 Abs. 3 BUrlG (Entscheidung 3, 3a): am 31.12. der nicht
 * übertragene Rest, am 31.03. die übertragenen und bis dahin nicht genommenen Tage (übertragene Tage
 * gelten als zuerst genommen). Nie negativ. Ob ein rechtzeitiger Hinweis vorliegt, prüft der Aufrufer.
 */
export function forfeitableHalfDays(input: ForfeitureInput): ForfeitureResult {
  const restAtYearEnd = Math.max(0, input.restAtYearEnd);
  const carriedOver = Math.max(0, input.carriedOver);
  const takenByMarch31 = Math.max(0, input.takenByMarch31);
  return {
    atYearEnd: Math.max(0, restAtYearEnd - carriedOver),
    atMarch31: Math.max(0, carriedOver - takenByMarch31),
  };
}

/**
 * Stichtag der Aufbewahrung (§ 16 Abs. 2 ArbZG, § 17 Abs. 1 MiLoG, steuerliche Fristen; Entscheidung 6):
 * Die Frist läuft ab Ende des Kalenderjahres. Daten mit Datum vor dem Ergebnis dürfen gelöscht werden.
 * Ergebnis: 1. Januar des Jahres `Jahr(today) − years`. `years` unter 2 ist unzulässig (RangeError).
 */
export function retentionCutoff(today: LocalDate, years: number): LocalDate {
  if (!Number.isInteger(years) || years < 2) {
    throw new RangeError(
      'Die Aufbewahrungsfrist muss eine ganze Zahl von mindestens 2 Jahren sein.',
    );
  }
  return `${yearOf(today) - years}-01-01`;
}
