import { expect, test, type Page } from '@playwright/test';
import { createEmployee, queryDb, signInDirect } from './helpers';

/**
 * Abnahme Phase 5: Einstempel-Banner mit „Heute nicht erinnern“, Ausstempel-Banner nach über
 * 10 Stunden, Nachtrags-Auswertung nur für das eigene Team, Profil ohne VAPID-Schlüssel.
 */

function berlinNow(): { date: string; weekday: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts['year']}-${parts['month']}-${parts['day']}`,
    weekday: parts['weekday'] ?? '',
    minutes: Number(parts['hour']) * 60 + Number(parts['minute']),
  };
}

type ReminderSettings = Record<string, string | number>;

async function reminderSettings(admin: Page): Promise<ReminderSettings> {
  return admin.evaluate(async () => (await fetch('/api/settings/reminders')).json());
}

async function putReminderSettings(admin: Page, settings: ReminderSettings): Promise<void> {
  const status = await admin.evaluate(
    async (body) =>
      (
        await fetch('/api/settings/reminders', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
    settings,
  );
  expect(status).toBe(200);
}

/** Einstempel-Erinnerungen gibt es nur an Arbeitstagen ohne Feiertag (Sonntag ist nie Arbeitstag). */
async function skipUnlessClockInPossible(): Promise<void> {
  const now = berlinNow();
  const holiday = await queryDb('SELECT 1 FROM "Holiday" WHERE date = $1::date', [now.date]);
  test.skip(now.weekday === 'Sun', 'Sonntag ist nie Arbeitstag, also keine Einstempel-Erinnerung.');
  test.skip(holiday.length > 0, 'Feiertag: keine Einstempel-Erinnerung.');
  test.skip(now.minutes < 16, 'Vor 00:16 Uhr ist auch ein Beginn um 00:00 noch nicht fällig.');
}

test('Einstempel-Erinnerung mit gelerntem Beginn, für heute ausschaltbar', async ({
  page,
  browser,
}) => {
  await skipUnlessClockInPossible();
  await signInDirect(page, 'katharina.brandl@example.com');
  const erika = await createEmployee(page, 'Erika Erinnerung', 'erika.erinnerung');
  // Drei Stempelbuchungen am selben Wochentag der Vorwochen, jeweils 00:00 bis 01:00 Uhr Berliner
  // Zeit: Der gelernte Beginn ist 00:00, die Erinnerung also ab 00:15 fällig (Vorbereitung in der DB).
  await queryDb(
    `INSERT INTO "TimeEntry" (id, "employeeId", "workDate", "startAt", "endAt", source, "recordedAt", "recordedById")
       SELECT gen_random_uuid(), $1, d, d::timestamp AT TIME ZONE 'Europe/Berlin',
              (d::timestamp + interval '1 hour') AT TIME ZONE 'Europe/Berlin', 'CLOCK',
              (d::timestamp + interval '1 hour') AT TIME ZONE 'Europe/Berlin', $1
         FROM (SELECT $2::date - 7 * k AS d FROM generate_series(1, 3) AS k) AS days`,
    [erika.id, berlinNow().date],
  );
  const person = await (await browser.newContext()).newPage();
  await signInDirect(person, erika.email);
  const banner = person.locator('[data-reminder]').filter({ hasText: 'noch nicht gestempelt' });
  await expect(banner).toContainText('Du hast heute noch nicht gestempelt.');
  await expect(banner).toContainText(/beginnst du meist gegen 00:00 Uhr/);
  await expect(banner).toContainText('aus deinen bisherigen Stempelzeiten');
  await expect(banner.getByRole('link', { name: 'Bin schon länger da: nachtragen' })).toBeVisible();

  await banner.getByRole('button', { name: 'Heute nicht erinnern' }).click();
  await expect(person.getByText('Für heute keine weitere Erinnerung.')).toBeVisible();
  await expect(banner).toHaveCount(0);
  // Gilt für den ganzen Tag, auch nach dem Neuladen; gestempelt wurde nicht.
  await person.reload();
  await expect(person.getByRole('button', { name: 'Kommen' })).toBeVisible();
  await expect(person.locator('[data-reminder]')).toHaveCount(0);
  const rows = await queryDb<{ muted: boolean }>(
    `SELECT muted FROM "ReminderLog" WHERE "employeeId" = $1 AND kind = 'CLOCK_IN' AND stage = 0`,
    [erika.id],
  );
  expect(rows).toEqual([{ muted: true }]);
  const today = await queryDb(
    'SELECT 1 FROM "TimeEntry" WHERE "employeeId" = $1 AND "workDate" = $2::date',
    [erika.id, berlinNow().date],
  );
  expect(today).toHaveLength(0);
});

test('Einstempel-Erinnerung mit Standardzeit, vom Admin auf der Prüfseite eingestellt', async ({
  page,
  browser,
}) => {
  await skipUnlessClockInPossible();
  await signInDirect(page, 'katharina.brandl@example.com');
  const sven = await createEmployee(page, 'Sven Standard', 'sven.standard');
  // Vorherigen Stand vor der ersten Änderung sichern und in jedem Fall wiederherstellen (Befund 7).
  const before = await reminderSettings(page);
  try {
    await page.getByRole('navigation').getByRole('link', { name: 'Prüfungen' }).click();
    await page.getByLabel('Standardzeit').fill('00:00');
    await page.getByRole('button', { name: 'Erinnerungen speichern' }).click();
    await expect(page.getByText('Erinnerungen gespeichert.').first()).toBeVisible();
    const person = await (await browser.newContext()).newPage();
    await signInDirect(person, sven.email);
    await expect(person.locator('[data-reminder]')).toContainText(
      'Erinnert wird ab 00:00 Uhr plus 15 Minuten (Standardzeit).',
    );
  } finally {
    await putReminderSettings(page, before);
  }
});

test('Ausstempel-Erinnerung nach über 10 Stunden, Gehen schließt die Buchung', async ({
  page,
  browser,
}) => {
  await signInDirect(page, 'katharina.brandl@example.com');
  const otto = await createEmployee(page, 'Otto Offen', 'otto.offen');
  // Offene Stempelbuchung seit 10 Stunden und 5 Minuten (nur Vorbereitung in der E2E-Datenbank).
  await queryDb(
    `INSERT INTO "TimeEntry" (id, "employeeId", "workDate", "startAt", source, "recordedAt", "recordedById")
       VALUES (gen_random_uuid(), $1, ((now() - interval '605 minutes') AT TIME ZONE 'Europe/Berlin')::date,
               now() - interval '605 minutes', 'CLOCK', now() - interval '605 minutes', $1)`,
    [otto.id],
  );
  const person = await (await browser.newContext()).newPage();
  await signInDirect(person, otto.email);
  const banner = person.locator('[data-reminder]').filter({ hasText: 'seit über 10 Stunden' });
  await expect(banner).toContainText('Ausstempeln vergessen?');
  await banner.getByRole('button', { name: 'Gehen – Erinnerung ans Ausstempeln' }).click();
  await expect(person.getByText(/Gegangen um \d\d:\d\d Uhr/)).toBeVisible();
  // Nur der Ausstempel-Hinweis verschwindet. Lag der Beginn am Vortag, kann heute zusätzlich die
  // Einstempel-Erinnerung fällig sein; das ist richtig und wird hier nicht ausgeschlossen (Befund 6).
  await expect(banner).toHaveCount(0);
  const open = await queryDb(
    'SELECT 1 FROM "TimeEntry" WHERE "employeeId" = $1 AND "endAt" IS NULL',
    [otto.id],
  );
  expect(open).toHaveLength(0);
});

test('Nachtrags-Auswertung: Vorgesetzte sehen nur ihr Team, Mitarbeiter nur die eigene Quote', async ({
  page,
  browser,
}) => {
  await signInDirect(page, 'tobias.lechner@example.com');
  await page.getByRole('navigation').getByRole('link', { name: 'Prüfungen' }).click();
  const section = page.locator('#late-entries');
  await expect(section.getByRole('heading', { name: 'Nachträge' })).toBeVisible();
  await expect(section).toContainText('Auffällig ist, wenn mindestens 3 Buchungen und 20 %');
  const view = (await page.evaluate(async () =>
    (await fetch('/api/checks/late-entries')).json(),
  )) as { rows: { employeeName: string }[] };
  const names = view.rows.map((r) => r.employeeName);
  expect(names).not.toContain('Lena Hofbauer');
  expect(names).not.toContain('Miriam Stadler');
  await expect(section).not.toContainText('Lena Hofbauer');
  // Einstellungen sind Sache des Admins.
  await expect(page.getByRole('heading', { name: 'Erinnerungen und Auswertung' })).toHaveCount(0);

  const person = await (await browser.newContext()).newPage();
  await signInDirect(person, 'elif.aydin@example.com');
  const status = await person.evaluate(
    async () => (await fetch('/api/checks/late-entries')).status,
  );
  expect(status).toBe(403);
  await person.getByRole('navigation').getByRole('link', { name: 'Zeiten' }).click();
  await expect(person.locator('[data-late-summary]')).toContainText(
    'Deine Nachträge in den letzten 6 Wochen:',
  );
});

test('Profil: ohne VAPID-Schlüssel nur Banner und E-Mail, E-Mail-Rückfall abschaltbar', async ({
  page,
}) => {
  await signInDirect(page, 'sebastian.wolf@example.com');
  await page.goto('/profil');
  const section = page.locator('app-reminder-settings');
  await expect(section.getByRole('heading', { name: 'Erinnerungen' })).toBeVisible();
  await expect(section).toContainText('Benachrichtigungen sind auf dem Server nicht eingerichtet.');
  await expect(section).toContainText('Keine Geräte angemeldet.');
  await expect(section).toContainText('nie an Vorgesetzte');
  const checkbox = section.getByLabel('Erinnerung per E-Mail, wenn kein Gerät angemeldet ist');
  await expect(checkbox).toBeChecked();
  // Die Seite übernimmt den neuen Zustand erst nach dem Speichern, daher Klick statt uncheck().
  await checkbox.click();
  await expect(page.getByText('E-Mail-Erinnerung gespeichert.')).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await page.reload();
  await expect(
    page.getByLabel('Erinnerung per E-Mail, wenn kein Gerät angemeldet ist'),
  ).not.toBeChecked();
  await page.getByLabel('Erinnerung per E-Mail, wenn kein Gerät angemeldet ist').click();
  await expect(
    page.getByLabel('Erinnerung per E-Mail, wenn kein Gerät angemeldet ist'),
  ).toBeChecked();
});
