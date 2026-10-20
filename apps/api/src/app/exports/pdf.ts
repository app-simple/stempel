import PDFDocument from 'pdfkit';
import {
  REPORT_COLUMNS,
  formatTimestamp,
  minijobLine,
  reportHeader,
  reportRows,
  reportTotals,
  type MonthReport,
  type ReportRow,
} from './month-report';

/** Spalten im PDF (Querformat A4) mit Breite in Punkt; Freitexte umbrechen. */
export const PDF_COLUMNS: readonly [keyof ReportRow, number][] = [
  ['date', 50],
  ['weekday', 18],
  ['start', 32],
  ['end', 40],
  ['breakMinutes', 30],
  ['work', 36],
  ['target', 32],
  ['balance', 34],
  ['absence', 60],
  ['source', 44],
  ['recordedAt', 62],
  ['reason', 100],
  // Ungültige Buchungen und Änderungen sichtbar (Codex-Review Phase 4 API, Befund 6).
  ['voided', 32],
  ['changed', 34],
  ['notes', 156],
];

/**
 * Arbeitszeitnachweis als PDF (Entscheidung 4): eingebaute Schrift Helvetica, keine externen Dienste.
 * Zeichen außerhalb von WinAnsi (z. B. das Minuszeichen U+2212) werden ersetzt.
 */
export function renderPdf(report: MonthReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );
  const text = (s: string) => s.replace(/\u2212/g, '-').replace(/[\u2009\u202f]/g, ' ');
  const headers = new Map(REPORT_COLUMNS);

  doc.info.Title = text(`Arbeitszeitnachweis ${report.monthLabel}`);
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(text(`Arbeitszeitnachweis ${report.monthLabel}`));
  doc.font('Helvetica').fontSize(10);
  for (const line of reportHeader(report)) doc.text(text(line));
  doc.moveDown(0.5);

  const left = doc.page.margins.left;
  const drawRow = (cells: string[], bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
    const cols = PDF_COLUMNS.map(([, width], i) => ({ width, value: text(cells[i] ?? '') }));
    const heights = cols.map((c) => doc.heightOfString(c.value, { width: c.width - 4 }));
    const height = Math.max(...heights, 9) + 4;
    if (doc.y + height > doc.page.height - doc.page.margins.bottom - 14) {
      doc.addPage();
    }
    const y = doc.y;
    let x = left;
    for (const c of cols) {
      doc.text(c.value, x + 2, y + 2, { width: c.width - 4 });
      x += c.width;
    }
    doc
      .moveTo(left, y + height)
      .lineTo(x, y + height)
      .lineWidth(0.3)
      .strokeColor('#999999')
      .stroke();
    doc.x = left;
    doc.y = y + height;
  };

  drawRow(
    PDF_COLUMNS.map(([key]) => headers.get(key) ?? key),
    true,
  );
  for (const row of reportRows(report)) drawRow(PDF_COLUMNS.map(([key]) => row[key]));
  const totals = reportTotals(report);
  drawRow(
    PDF_COLUMNS.map(([key]) =>
      key === 'date'
        ? 'Summe'
        : key === 'work'
          ? totals.work
          : key === 'target'
            ? totals.target
            : key === 'balance'
              ? totals.balance
              : '',
    ),
    true,
  );
  doc.moveDown(0.8).font('Helvetica').fontSize(9);
  if (report.minijob) doc.text(text(minijobLine(report.minijob, report.minijobWages)), left);
  doc.text(
    text(
      'Stempeluhr: Serverzeit. Nachtrag: von Hand erfasst, mit Erfassungszeitpunkt und Grund. ' +
        '„Geändert“: Anzahl der Korrekturen; der Verlauf mit altem und neuem Wert ist im System gespeichert.',
    ),
    left,
  );

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Fußzeile unterhalb des Satzspiegels, ohne neue Seite auszulösen.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .text(
        text(
          `Erstellt am ${formatTimestamp(report.createdAt)} · Seite ${i + 1} von ${range.count}`,
        ),
        left,
        doc.page.height - bottom + 8,
        { lineBreak: false },
      );
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
