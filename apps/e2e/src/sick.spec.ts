import { expect, test, type Page } from '@playwright/test';
import { createEmployee, queryDb, signInDirect } from './helpers';
import { clearMailbox, waitForMail } from './mailpit';

/**
 * Abnahme Phase 6 (Spezifikation Krankmeldungen, Abschnitt 10): Selbstmeldung mit neutraler E-Mail an
 * die Vorgesetzte, „krank“ in „Team heute“, Kollegen sehen im Kalender nur „abwesend“; AU-Vermerk bei
 * Krankheit im genehmigten Urlaub bucht die Urlaubstage zurück.
 */

function berlinToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
}
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Montag der übernächsten Woche: sicher in der Zukunft, ohne Bezug zu Seed-Daten. */
function mondayInTwoWeeks(): string {
  const today = berlinToday();
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(today, 14 - weekday);
}
async function api<T>(page: Page, method: string, path: string, body?: object): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${text}`);
      return text ? JSON.parse(text) : null;
    },
    { method, path, body },
  );
}

test('Selbstmeldung: neutrale E-Mail an die Vorgesetzte, „krank“ in Team heute, Kollegen sehen nur „abwesend“', async ({
  page,
  browser,
}) => {
  await signInDirect(page, 'katharina.brandl@example.com');
  const paula = await createEmployee(page, 'Paula Pause', 'paula.pause');
  await clearMailbox('tobias.lechner@example.com');

  // Elif ist im selben Team: Anzahl Abwesender am heutigen Tag vorher merken.
  const colleague = await (await browser.newContext()).newPage();
  await signInDirect(colleague, 'elif.aydin@example.com');
  const today = berlinToday();
  const month = today.slice(0, 7);
  type Calendar = { days: { date: string }[]; teamAbsentCounts: number[] | null };
  const countToday = (c: Calendar) =>
    c.teamAbsentCounts?.[c.days.findIndex((d) => d.date === today)] ?? 0;
  const before = countToday(
    await api<Calendar>(colleague, 'GET', `/api/leave/calendar?month=${month}`),
  );
  // Paula arbeitet Montag bis Samstag; an Sonn- und Feiertagen zählt sie nicht als abwesend.
  const holiday = await queryDb('SELECT 1 FROM "Holiday" WHERE active AND date = $1::date', [
    today,
  ]);
  const workday = new Date(`${today}T12:00:00Z`).getUTCDay() !== 0 && holiday.length === 0;

  // Ausdrücklich „Kind krank“: auch dann nennt nichts die Art (Review Web Phase 6, Befund 5).
  const person = await (await browser.newContext()).newPage();
  await signInDirect(person, paula.email);
  await person.getByRole('button', { name: 'Krank melden' }).first().click();
  await person.getByRole('radio', { name: 'Kind krank' }).check();
  await person.getByRole('button', { name: 'Krankmeldung speichern' }).click();
  await expect(person.getByText(/Heute krankgemeldet bis/)).toBeVisible();

  const mail = await waitForMail('tobias.lechner@example.com', /Krankmeldung/);
  expect(mail.text).toContain('Paula Pause ist ab');
  expect(mail.text).toContain('krankgemeldet');
  expect(`${mail.subject} ${mail.text}`).not.toMatch(/Kind/);

  const lead = await (await browser.newContext()).newPage();
  await signInDirect(lead, 'tobias.lechner@example.com');
  const presence = (
    await api<{ name: string; presence: string }[]>(lead, 'GET', '/api/time/team-today')
  ).find((r) => r.name === 'Paula Pause')?.presence;
  expect(presence).toBe(workday ? 'SICK' : 'NOT_WORKDAY');
  if (workday)
    await expect(lead.getByRole('row').filter({ hasText: 'Paula Pause' })).toContainText('krank');

  const calendar = await api<Calendar>(colleague, 'GET', `/api/leave/calendar?month=${month}`);
  expect(JSON.stringify(calendar)).not.toMatch(/SICK|krank|Paula/i);
  expect(countToday(calendar)).toBe(before + (workday ? 1 : 0));
  await colleague.getByRole('navigation').getByRole('link', { name: 'Urlaubsübersicht' }).click();
  await expect(colleague.getByRole('heading', { name: 'Urlaubsübersicht' })).toBeVisible();
  await expect(colleague.locator('main')).not.toContainText('krank');
  const sickOfOthers = await api<unknown[]>(colleague, 'GET', '/api/sick');
  expect(sickOfOthers).toEqual([]);
});

test('AU-Vermerk bei Krankheit im genehmigten Urlaub bucht die Urlaubstage zurück (§ 9 BUrlG)', async ({
  page,
}) => {
  await signInDirect(page, 'katharina.brandl@example.com');
  const otto = await createEmployee(page, 'Otto Urlaub', 'otto.urlaub');
  const monday = mondayInTwoWeeks();
  const year = Number(monday.slice(0, 4));
  await api(page, 'POST', '/api/leave/requests', {
    employeeId: otto.id,
    type: 'VACATION',
    from: monday,
    to: addDays(monday, 4),
    startHalf: false,
    endHalf: false,
  });
  const before = await api<{ rest: number }>(
    page,
    'GET',
    `/api/leave/account?employeeId=${otto.id}&year=${year}`,
  );
  const sickFrom = addDays(monday, 1);
  const sickTo = addDays(monday, 2);
  await api(page, 'POST', '/api/sick', {
    employeeId: otto.id,
    kind: 'SICK',
    from: sickFrom,
    to: sickTo,
  });

  // AU über die Oberfläche vermerken: Urlaubsübersicht, Liste, Krankmeldungen im Team.
  await page.getByRole('navigation').getByRole('link', { name: 'Urlaubsübersicht' }).click();
  await page.getByRole('tab', { name: 'Liste', exact: true }).click();
  // Jahr der Krankmeldung wählen (übernächste Woche kann im neuen Jahr liegen, Befund 4).
  await page.getByLabel('Jahr').selectOption(String(Number(sickFrom.slice(0, 4))));
  // Innerster Abschnitt (die Karte der Übersicht enthält ihn ebenfalls).
  const section = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Krankmeldungen im Team' }) })
    .last();
  await section.getByRole('button', { name: /^AU vermerken: Otto Urlaub/ }).click();
  await section.getByLabel('AU liegt vor bis').fill(sickTo);
  await section.getByRole('button', { name: 'Speichern' }).click();
  await expect(section).toContainText('AU liegt vor bis');

  const holidays = await queryDb<{ n: string }>(
    `SELECT count(*)::text AS n FROM "Holiday" WHERE active AND date IN ($1::date, $2::date)`,
    [sickFrom, sickTo],
  );
  const expected = (2 - Number(holidays[0]?.n ?? 0)) * 2;
  await expect
    .poll(async () => {
      const after = await api<{ rest: number }>(
        page,
        'GET',
        `/api/leave/account?employeeId=${otto.id}&year=${year}`,
      );
      return after.rest - before.rest;
    })
    .toBe(expected);
});
