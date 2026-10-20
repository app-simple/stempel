import { expect, test, type Page } from '@playwright/test';
import { employeeId, queryDb, signInDirect } from './helpers';
import { clearMailbox, waitForMail } from './mailpit';

/**
 * Abnahme Phase 3: Antrag mit Vorschau, Mail an den Vorgesetzten, Ablehnen nur mit Begründung,
 * Überschneidung im Team sichtbar für den Entscheider, Genehmigung bucht vom Konto ab, eigener
 * Kalender zeigt die Abwesenheit, Kalender der Kollegin nur die Anzahl, ohne Namen und ohne Art.
 */

/** Erster Montag im März des Folgejahres: frei von den Beispielanträgen im Seed (alle 2026). */
function marchNextYear(): { mon: string; tue: string; wed: string; monthsAhead: number } {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const year = now.getFullYear() + 1;
  const first = new Date(year, 2, 1);
  const mon = new Date(year, 2, 1 + ((8 - first.getDay()) % 7));
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const plus = (days: number) => new Date(year, 2, mon.getDate() + days);
  return {
    mon: iso(mon),
    tue: iso(plus(1)),
    wed: iso(plus(2)),
    monthsAhead: (year - now.getFullYear()) * 12 + 2 - now.getMonth(),
  };
}

async function openCalendarMonth(page: Page, monthsAhead: number): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: 'Urlaubsübersicht' }).click();
  for (let i = 0; i < monthsAhead; i++)
    await page.getByRole('button', { name: 'Nächster Monat' }).click();
}

test('Urlaubsantrag: Vorschau, Mail, Ablehnen nur mit Begründung, Überschneidung, Konto, Kalender', async ({
  page,
  browser,
}) => {
  const { mon, tue, wed, monthsAhead } = marchNextYear();
  const year = Number(mon.slice(0, 4));
  const sebastian = await employeeId('sebastian.wolf@example.com');
  const elif = await employeeId('elif.aydin@example.com');
  const tobias = await employeeId('tobias.lechner@example.com');
  await clearMailbox('tobias.lechner@example.com');
  // Kollegin im selben Team hat am Dienstag schon genehmigten Urlaub.
  await queryDb(
    `INSERT INTO "LeaveRequest" (id, "employeeId", type, "from", "to", "halfDays", status,
       "requestedAt", "requestedById", "decidedAt", "decidedById")
     VALUES (gen_random_uuid(), $1, 'VACATION', $2::date, $2::date, 2, 'APPROVED', now(), $1, now(), $3)`,
    [elif, tue, tobias],
  );

  // Sebastian Wolf (Mo–Mi) beantragt Montag bis Mittwoch.
  await signInDirect(page, 'sebastian.wolf@example.com');
  const before = (await page.evaluate(
    async (y) => (await fetch(`/api/leave/account?year=${y}`)).json(),
    year,
  )) as { entitlement: number; approved: number; rest: number };
  await page.getByRole('navigation').getByRole('link', { name: 'Mein Urlaub' }).click();
  await page.getByLabel('Erster Tag', { exact: true }).fill(mon);
  await page.getByLabel('Letzter Tag', { exact: true }).fill(wed);
  await expect(page.getByText('3 Arbeitstage Urlaub.')).toBeVisible();
  await page.getByRole('button', { name: 'Antrag stellen' }).click();
  await expect(page.getByText('Antrag über 3 Tage an Tobias Lechner gesendet.')).toBeVisible();
  const [request] = await queryDb<{ id: string; status: string; halfDays: number }>(
    `SELECT id, status, "halfDays" FROM "LeaveRequest" WHERE "employeeId" = $1 AND "from" = $2::date`,
    [sebastian, mon],
  );
  expect(request).toMatchObject({ status: 'PENDING', halfDays: 6 });

  const mail = await waitForMail('tobias.lechner@example.com', /Neuer Antrag: Sebastian Wolf/);
  expect(mail.text).toContain('Sebastian Wolf, Urlaub');
  expect(mail.text).toContain('3 Tage');
  expect(mail.text).toContain('/freigaben');

  // Tobias Lechner sieht die Überschneidung, lehnt ohne ausreichende Begründung ab (geht nicht),
  // bricht ab und genehmigt.
  const lead = await (await browser.newContext()).newPage();
  await signInDirect(lead, 'tobias.lechner@example.com');
  await lead
    .getByRole('navigation')
    .getByRole('link', { name: /^Freigaben/ })
    .click();
  const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  const range = `${de(mon).slice(0, 6)} – ${de(wed)}`;
  const card = lead.getByRole('article', { name: `Sebastian Wolf, ${range}` });
  await expect(card).toContainText(
    `Gleichzeitig abwesend: Elif Aydin (genehmigt, ${de(tue).slice(0, 6)}–${de(tue).slice(0, 6)})`,
  );
  await expect(card).toContainText(`Urlaubskonto ${year} nach Genehmigung`);
  await lead.getByRole('button', { name: `Antrag von Sebastian Wolf, ${range} ablehnen` }).click();
  await lead.getByLabel(/Begründung der Ablehnung/).fill('Nein');
  await lead.getByRole('button', { name: 'Ablehnung senden' }).click();
  await expect(lead.getByRole('alert')).toContainText('mindestens ein Satz');
  await lead.getByRole('button', { name: 'Abbrechen' }).click();
  const status = async () =>
    (
      await queryDb<{ status: string }>('SELECT status FROM "LeaveRequest" WHERE id = $1', [
        request!.id,
      ])
    )[0]?.status;
  expect(await status()).toBe('PENDING');
  await lead
    .getByRole('button', { name: `Antrag von Sebastian Wolf, ${range} genehmigen` })
    .click();
  await expect(
    lead.getByText('Urlaub von Sebastian Wolf genehmigt.', { exact: false }),
  ).toBeVisible();
  await expect.poll(status).toBe('APPROVED');

  // Sebastian: genehmigt, drei Tage vom Konto des Jahres abgebucht, Kalender zeigt die Tage.
  await page.reload();
  await expect(page.locator(`tr[data-request="${request!.id}"]`)).toContainText('genehmigt');
  const after = (await page.evaluate(
    async (y) => (await fetch(`/api/leave/account?year=${y}`)).json(),
    year,
  )) as { entitlement: number; approved: number; rest: number };
  expect(after.approved - before.approved).toBe(6);
  expect(before.rest - after.rest).toBe(6);
  await openCalendarMonth(page, monthsAhead);
  const ownRow = page.getByRole('row', { name: /^Sebastian Wolf/ });
  await expect(ownRow.getByRole('img', { name: 'abwesend' })).toHaveCount(3);

  // Elif Aydin (gleiches Team) sieht im Kalender nur die Anzahl, keinen Namen und keine Art.
  const colleague = await (await browser.newContext()).newPage();
  await signInDirect(colleague, 'elif.aydin@example.com');
  const calendar = await colleague.evaluate(
    async (m) => (await fetch(`/api/leave/calendar?month=${m}`)).json(),
    mon.slice(0, 7),
  );
  const json = JSON.stringify(calendar);
  expect(json).not.toContain('Sebastian');
  expect(json).not.toContain(sebastian);
  expect(json).not.toMatch(/VACATION|SPECIAL_LEAVE|OVERTIME_OFF/);
  await openCalendarMonth(colleague, monthsAhead);
  const teamRow = colleague.getByRole('row', { name: /^Im Team abwesend/ });
  const cells = teamRow.locator('td');
  const day = Number(mon.slice(8, 10)) - 1;
  // Mo, Di, Mi: Sebastian; Elifs eigener Urlaub am Dienstag zählt nicht mit.
  await expect(cells.nth(day)).toHaveText('1');
  await expect(cells.nth(day + 1)).toHaveText('1');
  await expect(cells.nth(day + 2)).toHaveText('1');
  await expect(colleague.locator('.cal')).not.toContainText('Sebastian');
  await expect(colleague.getByRole('row', { name: /^Elif Aydin/ }).getByRole('img')).toHaveCount(1);
});
