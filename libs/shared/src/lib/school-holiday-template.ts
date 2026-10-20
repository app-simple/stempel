import type { LocalDate } from './domain';

export interface SchoolHolidaySuggestion {
  name: string;
  from: LocalDate;
  to: LocalDate;
}

/**
 * Vorlage der bayerischen Schulferien zum Übernehmen durch den Admin (Spezifikation Phase 7,
 * Abschnitt 3). Nur ein Vorschlag: maßgeblich sind die gepflegten `SchoolHoliday`-Zeilen.
 * Quelle: Bayerisches Staatsministerium für Unterricht und Kultus, „Ferien und Feiertage“
 * (km.bayern.de/termine/ferien-und-feiertage), abgerufen am 16.10.2026. Einzelne
 * unterrichtsfreie Tage (Buß- und Bettag) sind keine Schulferien und fehlen bewusst.
 */
export const BAVARIAN_SCHOOL_HOLIDAYS: readonly SchoolHolidaySuggestion[] = [
  { name: 'Sommerferien', from: '2026-08-03', to: '2026-09-14' },
  { name: 'Herbstferien', from: '2026-11-02', to: '2026-11-06' },
  { name: 'Weihnachtsferien', from: '2026-12-24', to: '2027-01-08' },
  { name: 'Frühjahrsferien', from: '2027-02-08', to: '2027-02-12' },
  { name: 'Osterferien', from: '2027-03-22', to: '2027-04-02' },
  { name: 'Pfingstferien', from: '2027-05-18', to: '2027-05-28' },
  { name: 'Sommerferien', from: '2027-08-02', to: '2027-09-13' },
];

/** Vorlagezeiträume, die das Jahr berühren und noch nicht mit gleichem Beginn und Ende gepflegt sind. */
export function schoolHolidaySuggestions(
  year: number,
  existing: readonly { from: LocalDate; to: LocalDate }[],
): SchoolHolidaySuggestion[] {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  return BAVARIAN_SCHOOL_HOLIDAYS.filter(
    (s) =>
      s.from <= last && s.to >= first && !existing.some((e) => e.from === s.from && e.to === s.to),
  );
}
