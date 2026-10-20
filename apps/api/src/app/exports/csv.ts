/**
 * CSV für Tabellenkalkulationen (Spezifikation Phase 4, Entscheidung 4): UTF-8 mit BOM, Semikolon,
 * Zeilenende CRLF, Felder mit Semikolon, Anführungszeichen oder Zeilenumbruch in Anführungszeichen.
 * Werte, die mit =, +, - oder @ beginnen, werden mit ' entschärft (keine Formeln aus Freitexten).
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return '﻿' + rows.map((row) => row.map(field).join(';')).join('\r\n') + '\r\n';
}

function field(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(:\d{2})?$/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
