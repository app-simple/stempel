import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { employeeId, queryDb, signInDirect } from './helpers';
import { clearMailbox, waitForMail } from './mailpit';

/**
 * Abnahme Phase 4: Vorgesetzte sehen auf der Prüfseite nur ihr Team; der Admin sendet einen
 * Urlaubshinweis, die Person erhält ihn per E-Mail und bestätigt das Lesen in der Anwendung;
 * der Monatsexport lädt eine Datei mit den Buchungen.
 */

test('Prüfseite zeigt Vorgesetzten nur ihr Team', async ({ page }) => {
  await signInDirect(page, 'tobias.lechner@example.com');
  await page.getByRole('navigation').getByRole('link', { name: 'Prüfungen' }).click();
  await expect(page.getByRole('heading', { name: 'Arbeitszeit' })).toBeVisible();
  const view = (await page.evaluate(async () => (await fetch('/api/checks')).json())) as {
    findings: { employeeName: string }[];
    notices: { rows: { employeeName: string }[] };
  };
  const names = new Set([
    ...view.findings.map((f) => f.employeeName),
    ...view.notices.rows.map((r) => r.employeeName),
  ]);
  expect(names.has('Elif Aydin')).toBe(true);
  // Miriam Stadler und ihr Team (z. B. Lena Hofbauer) gehören nicht zu Tobias Lechner.
  expect(names.has('Lena Hofbauer')).toBe(false);
  expect(names.has('Miriam Stadler')).toBe(false);
  await expect(page.locator('main')).not.toContainText('Lena Hofbauer');
  // Verfall und Aufbewahrung sind Sache des Admins.
  await expect(page.getByRole('heading', { name: 'Aufbewahrung und Löschung' })).toHaveCount(0);
});

test('Urlaubshinweis: Admin sendet, Person erhält ihn per E-Mail und bestätigt das Lesen', async ({
  page,
  browser,
}) => {
  const elif = await employeeId('elif.aydin@example.com');
  await clearMailbox('elif.aydin@example.com');
  await signInDirect(page, 'katharina.brandl@example.com');
  await page.getByRole('navigation').getByRole('link', { name: 'Prüfungen' }).click();
  await page.getByRole('button', { name: 'Hinweis senden an Elif Aydin' }).click();
  await expect
    .poll(
      async () =>
        (
          await queryDb<{ n: string }>(
            'SELECT count(*)::text AS n FROM "LeaveNotice" WHERE "employeeId" = $1',
            [elif],
          )
        )[0]?.n,
    )
    .toBe('1');
  const mail = await waitForMail('elif.aydin@example.com', /Hinweis zu deinem Resturlaub/);
  expect(mail.text).toContain('Hallo Elif,');
  expect(mail.text).toContain('verfällt am 31.12.');

  const person = await (await browser.newContext()).newPage();
  await signInDirect(person, 'elif.aydin@example.com');
  await person.getByRole('navigation').getByRole('link', { name: 'Mein Urlaub' }).click();
  await expect(person.getByText('Hallo Elif,')).toBeVisible();
  await person.getByRole('button', { name: /als gelesen markieren$/ }).click();
  await expect(person.getByText(/gelesen am/)).toBeVisible();
  const [row] = await queryDb<{ readAt: Date | null }>(
    'SELECT "readAt" FROM "LeaveNotice" WHERE "employeeId" = $1',
    [elif],
  );
  expect(row?.readAt).toBeInstanceOf(Date);
});

test('Export: Monat mit bekannter Buchung als CSV und PDF', async ({ page }) => {
  // Bekannte Buchung vor den Beispieldaten (ab 31.08.2026): Mo 03.08.2026, 07:15–15:45, Nachtrag.
  const elif = await employeeId('elif.aydin@example.com');
  await queryDb(
    `INSERT INTO "TimeEntry" (id, "employeeId", "workDate", "startAt", "endAt", source, reason, "recordedAt", "recordedById")
     VALUES (gen_random_uuid(), $1, '2026-08-03', '2026-08-03T05:15:00Z', '2026-08-03T13:45:00Z', 'MANUAL',
             'Abnahmetest Export', '2026-08-04T07:00:00Z', $1)`,
    [elif],
  );
  await signInDirect(page, 'elif.aydin@example.com');
  await page.getByRole('navigation').getByRole('link', { name: 'Zeiten' }).click();
  await page.getByLabel('Monat exportieren').fill('2026-08');
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Monat als CSV exportieren' }).click(),
  ]);
  expect(csv.suggestedFilename()).toBe('arbeitszeit-2026-08-elif-aydin.csv');
  const text = await readFile((await csv.path()) ?? '', 'utf8');
  const lines = text.split('\r\n');
  expect(lines[0]).toBe(
    '\uFEFFDatum;Tag;Kommen;Gehen;Pause (Min.);Arbeitszeit (Std.);Soll (Std.);Saldo (Std.);Abwesenheit;Quelle;Erfasst am;Erfasst von;Grund des Nachtrags;Ungültig;Geändert;Hinweise',
  );
  expect(lines).toContain(
    '03.08.2026;Mo;07:15;15:45;0;8:30;8:00;0:30;;Nachtrag;04.08.2026 09:00;;Abnahmetest Export;;;"Über 8 Std., Ausgleich nötig (§ 3 ArbZG); Pause 0 statt 30 Min. (§ 4 ArbZG); Mehr als 6 Std. ohne Pause (§ 4 ArbZG)"',
  );
  // Summe = Summe der Arbeitszeiten aller Zeilen (am 31.08. liegt zusätzlich eine Beispielbuchung).
  const minutes = (hm: string) => {
    const [h, m] = hm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const rows = lines.filter((l) => /^\d{2}\.08\.2026;/.test(l));
  const total = rows.reduce((sum, l) => sum + minutes(l.split(';')[5] || '0:00'), 0);
  const sumLine = lines.find((l) => l.startsWith('Summe;')) ?? '';
  expect(minutes(sumLine.split(';')[5] ?? '')).toBe(total);
  expect(total).toBeGreaterThanOrEqual(510);
  expect(text).toContain('Erstellt am');
  expect(text).not.toContain('@example.com');
  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Monat als PDF exportieren' }).click(),
  ]);
  expect(pdf.suggestedFilename()).toBe('arbeitszeit-2026-08-elif-aydin.pdf');
  const body = await readFile((await pdf.path()) ?? '');
  expect(body.subarray(0, 5).toString()).toBe('%PDF-');
});
