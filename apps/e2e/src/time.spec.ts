import { expect, test, type Page } from '@playwright/test';
import { berlinClock, employeeId, queryDb, signInDirect } from './helpers';

/**
 * Abnahme Phase 2: Stempeln mit Serverzeit, markierter Nachtrag mit Regelverstoß (blockiert nicht),
 * Korrekturantrag mit Freigabe, „Team heute“ nur für Vorgesetzte.
 */

/** Letzter Samstag vor heute (Europe/Berlin): ohne Beispielbuchungen und ohne Sonntagshinweis. */
function lastSaturday(): { iso: string; inCurrentWeek: boolean } {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const weekday = today.getDay() || 7;
  const back = weekday === 6 ? 7 : (weekday + 1) % 7;
  const date = new Date(today);
  date.setDate(today.getDate() - back);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { iso, inCurrentWeek: weekday === 7 };
}

async function openWeekOf(page: Page, inCurrentWeek: boolean): Promise<void> {
  if (!inCurrentWeek) await page.getByRole('button', { name: 'Vorige Woche' }).click();
}

test('Stempeluhr bucht Serverzeit, auch wenn die Geräteuhr drei Stunden vorgeht', async ({
  page,
}) => {
  const id = await employeeId('sebastian.wolf@example.com');
  await page.clock.install({ time: new Date(Date.now() + 3 * 60 * 60_000) });
  await signInDirect(page, 'sebastian.wolf@example.com');
  await expect(
    page.getByText(/weicht um etwa 1[78]\d Minuten von der Serverzeit ab/),
  ).toBeVisible();

  const before = Date.now();
  await page.getByRole('button', { name: 'Kommen' }).click();
  await expect(page.getByTestId('clock-status')).toContainText('Anwesend seit');
  const after = Date.now();
  const [open] = await queryDb<{ id: string; startAt: Date }>(
    'SELECT id, "startAt" FROM "TimeEntry" WHERE "employeeId" = $1 AND "endAt" IS NULL',
    [id],
  );
  expect(open).toBeDefined();
  const start = open!.startAt.getTime();
  expect(start).toBeGreaterThanOrEqual(before - 1000);
  expect(start).toBeLessThanOrEqual(after + 1000);
  await expect(page.getByTestId('clock-status')).toHaveText(
    `Anwesend seit ${berlinClock(open!.startAt)} Uhr`,
  );

  await page.getByRole('button', { name: 'Pause beginnen' }).click();
  await expect(page.getByTestId('clock-status')).toContainText('Pause seit');
  await page.getByRole('button', { name: 'Pause beenden' }).click();
  await expect(page.getByTestId('clock-status')).toContainText('Anwesend seit');
  await page.getByRole('button', { name: 'Gehen' }).click();
  await expect(page.getByRole('button', { name: 'Kommen' })).toBeVisible();
  const [closed] = await queryDb<{ endAt: Date | null; source: string }>(
    'SELECT "endAt", source FROM "TimeEntry" WHERE id = $1',
    [open!.id],
  );
  expect(closed?.source).toBe('CLOCK');
  expect(closed?.endAt).toBeInstanceOf(Date);
  expect(closed!.endAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  await expect(page.getByText(`Gegangen um ${berlinClock(closed!.endAt!)} Uhr`)).toBeVisible();
  await expect(page.getByTestId('clock-status')).toContainText('Erfasst:');
});

test('Nachtrag mit Verstoß wird gespeichert, markiert und gemeldet; Korrektur braucht Freigabe', async ({
  page,
  browser,
}) => {
  const saturday = lastSaturday();
  const elif = await employeeId('elif.aydin@example.com');
  await signInDirect(page, 'elif.aydin@example.com');
  await page.getByRole('navigation').getByRole('link', { name: 'Zeiten' }).click();
  const form = page.locator('section', {
    has: page.getByRole('heading', { name: /^Zeit nachtragen/ }),
  });
  await form.getByLabel('Datum').fill(saturday.iso);
  await form.getByLabel('Kommen', { exact: true }).fill('08:00');
  await form.getByLabel('Gehen (heute: leer, wenn noch da)').fill('15:01');
  await form.getByLabel('Begründung (Pflicht)').fill('Stempeln vergessen');
  await form.getByRole('button', { name: 'Nachtrag speichern' }).click();
  await expect(page.getByText(/gespeichert und als Nachtrag markiert/)).toBeVisible();
  // Verstoß gegen § 4 ArbZG wird gemeldet, die Buchung ist trotzdem gespeichert.
  await expect(page.getByText('Pause 0 statt 30 Min.').first()).toBeVisible();
  const [entry] = await queryDb<{ id: string; source: string; reason: string }>(
    `SELECT id, source, reason FROM "TimeEntry"
     WHERE "employeeId" = $1 AND "workDate" = $2::date AND "voidedAt" IS NULL`,
    [elif, saturday.iso],
  );
  expect(entry).toMatchObject({ source: 'MANUAL', reason: 'Stempeln vergessen' });

  await openWeekOf(page, saturday.inCurrentWeek);
  const row = page.locator(`tr[data-entry-id="${entry!.id}"]`);
  await expect(row.locator('td:visible').nth(1)).toHaveText('08:00');
  await expect(row).toContainText(/Nachgetragen (am|um)/);
  await expect(row).toContainText('Grund: Stempeln vergessen');
  await row.getByRole('button', { name: /^Korrektur beantragen für / }).click();
  const correction = page.locator('form', {
    has: page.getByRole('button', { name: 'Korrektur beantragen' }),
  });
  await correction.getByLabel('Kommen', { exact: true }).fill('07:30');
  await correction.getByLabel('Begründung (Pflicht)').fill('Früher angefangen');
  await correction.getByRole('button', { name: 'Korrektur beantragen' }).click();
  await expect(row).toContainText('Korrektur beantragt');
  // Vor der Freigabe bleibt die Buchung unverändert, ohne Revision.
  await expect(row.locator('td:visible').nth(1)).toHaveText('08:00');
  const [pending] = await queryDb<{ start: string; revisions: string }>(
    `SELECT to_char("startAt" AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS start,
            (SELECT count(*) FROM "TimeEntryRevision" r WHERE r."entryId" = e.id)::text AS revisions
     FROM "TimeEntry" e WHERE id = $1`,
    [entry!.id],
  );
  expect(pending).toEqual({ start: '08:00', revisions: '0' });

  // Tobias Lechner ist Elifs Vorgesetzter und gibt genau diesen Antrag frei.
  const leadPage = await (await browser.newContext()).newPage();
  await signInDirect(leadPage, 'tobias.lechner@example.com');
  await expect(leadPage.getByText('Team heute')).toBeVisible();
  await leadPage
    .getByRole('navigation')
    .getByRole('link', { name: /^Freigaben/ })
    .click();
  await leadPage
    .getByRole('button', { name: `Antrag von Elif Aydin für ${saturday.iso} freigeben` })
    .click();
  await expect(leadPage.getByText('Korrektur freigegeben.')).toBeVisible();

  await page.reload();
  await openWeekOf(page, saturday.inCurrentWeek);
  await expect(row.locator('td:visible').nth(1)).toHaveText('07:30');
  await expect(row).not.toContainText('Korrektur beantragt');
  await row.getByRole('button', { name: /^Verlauf für / }).click();
  const history = page.locator('app-entry-history');
  await expect(history).toContainText('Früher angefangen');
  await expect(history).toContainText('Tobias Lechner');
  await expect(history.getByText(/^Vorher: .*08:00/)).toBeVisible();
  await expect(history.getByText(/^Nachher: .*07:30/)).toBeVisible();
});

test('Mitarbeiter sehen kein „Team heute“ und keine Zeiten anderer', async ({ page }) => {
  const elif = await employeeId('elif.aydin@example.com');
  const [foreignEntry] = await queryDb<{ id: string }>(
    'SELECT id FROM "TimeEntry" WHERE "employeeId" = $1 LIMIT 1',
    [elif],
  );
  expect(foreignEntry).toBeDefined();
  await signInDirect(page, 'lena.hofbauer@example.com');
  await expect(page.getByTestId('clock-status')).toBeVisible();
  await expect(page.getByText('Team heute')).toHaveCount(0);
  await expect(page.getByRole('navigation').getByRole('link', { name: /^Freigaben/ })).toHaveCount(
    0,
  );
  const statuses = await page.evaluate(
    async ({ employee, entry }) => {
      const status = async (url: string) => (await fetch(url)).status;
      const week = '2026-W41';
      return {
        team: await status('/api/time/team-today'),
        ownWeek: await status(`/api/time/week?week=${week}`),
        week: await status(`/api/time/week?week=${week}&employeeId=${employee}`),
        month: await status(`/api/time/month?month=2026-10&employeeId=${employee}`),
        revisions: await status(`/api/time/entries/${entry}/revisions`),
        overtime: await status(`/api/time/overtime?employeeId=${employee}`),
      };
    },
    { employee: elif, entry: foreignEntry!.id },
  );
  expect(statuses).toEqual({
    team: 403,
    ownWeek: 200,
    week: 404,
    month: 404,
    revisions: 404,
    overtime: 404,
  });
});
