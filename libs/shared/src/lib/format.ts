const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** Betrag in Cent als Euro, z. B. 1390 → „13,90 €“ (mit geschütztem Leerzeichen). */
export function formatEuro(cents: number): string {
  return euro.format(cents / 100);
}

/** Minuten als Stunden:Minuten wie im Prototyp, z. B. 462 → „7:42“, −90 → „−1:30“. */
export function formatHoursMinutes(minutes: number): string {
  const sign = minutes < 0 ? '−' : '';
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/** Dezimalzahl mit Komma, z. B. 43.38 → „43,4“ bei einer Nachkommastelle. */
export function formatDecimal(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits).replace('.', ',');
}

/** Tage aus halben Tagen, z. B. 5 → „2,5“, 4 → „2“, −3 → „−1,5“. */
export function formatHalfDays(halfDays: number): string {
  const sign = halfDays < 0 ? '−' : '';
  const abs = Math.abs(halfDays);
  return `${sign}${Math.floor(abs / 2)}${abs % 2 ? ',5' : ''}`;
}

/**
 * Geht „Stunden × Stundenlohn = Verdienst“ für den Minijob-Monat auf? Bei Lohnwechsel im Monat nicht:
 * Der Verdienst ist mit dem jeweils geltenden Lohn berechnet, `hourlyWageCents` ist der zuletzt
 * geltende (Codex-Review Phase 4, Befund Minijob-Gleichung).
 */
export function minijobEquationHolds(m: {
  workMinutes: number;
  hourlyWageCents: number;
  earningsCents: number;
}): boolean {
  return Math.round((m.workMinutes * m.hourlyWageCents) / 60) === m.earningsCents;
}
