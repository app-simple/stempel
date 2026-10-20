import { expect, test, type Page } from '@playwright/test';
import { createEmployee, employeeId, queryDb, signInDirect } from './helpers';

function berlinToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
}
function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Abnahme Design: keine Seite scrollt seitlich, für jede Rolle; die Menü-Schublade ist bedienbar
 * (Spezifikation Design und Bedienung auf dem Handy, Abschnitt 7).
 */

const ROUTES = [
  '/',
  '/zeiten',
  '/urlaub',
  '/freigaben',
  '/urlaubsuebersicht',
  '/pruefungen',
  '/mitarbeiter',
  '/feiertage',
  '/profil',
];

async function minijobEmail(): Promise<string> {
  const [row] = await queryDb<{ email: string }>(
    `SELECT e."loginEmail" AS email FROM "Employee" e JOIN "EmploymentTerms" t ON t."employeeId" = e.id
      WHERE t.type = 'MINIJOB' ORDER BY e.name LIMIT 1`,
  );
  return row!.email;
}

/** Seitlicher Überstand der Seite oder (ab 360 px) einer Tabelle in ihrer Karte, sonst null. */
async function overflowOf(page: Page, tablesToo: boolean): Promise<string | null> {
  return page.evaluate((tables) => {
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth) {
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
      return `Seite ${doc.scrollWidth} > ${doc.clientWidth}: ${wide.join(', ')}`;
    }
    if (!tables) return null;
    // Der Monatskalender (ab 640 px) scrollt bewusst in seinem Bereich (Spezifikation Abschnitt 5).
    const table = [...document.querySelectorAll<HTMLTableElement>('table:not(.cal)')].find(
      (t) => t.offsetParent !== null && t.scrollWidth > (t.parentElement?.clientWidth ?? 0) + 1,
    );
    return table
      ? `Tabelle ${table.scrollWidth} > ${table.parentElement?.clientWidth}: ${table.querySelector('th')?.textContent?.trim()}`
      : null;
  }, tablesToo);
}

for (const width of [320, 360, 768]) {
  test(`keine Seite scrollt seitlich auf ${width} px`, async ({ browser }) => {
    test.setTimeout(240_000);
    const accounts = [
      'jonas.reitberger@example.com',
      'tobias.lechner@example.com',
      'katharina.brandl@example.com',
      await minijobEmail(),
    ];
    const employee = await employeeId('elif.aydin@example.com');
    for (const email of accounts) {
      const context = await browser.newContext({
        viewport: { width, height: 800 },
        isMobile: width < 768,
        hasTouch: true,
      });
      const page = await context.newPage();
      await signInDirect(page, email);
      for (const route of [...ROUTES, `/mitarbeiter/${employee}`]) {
        await page.goto(route);
        await expect(page.locator('main h1').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        // Tabellen in ihrer Karte auf 360 px (Handy). Auf 320 px bewusst toleriert, ab 640 px
        // vollständige Tabellen wie bisher mit eigenem Scrollbereich (Spezifikation Abschnitt 4 und 7).
        const tables = width === 360;
        expect(await overflowOf(page, tables), `${email} ${page.url()}`).toBeNull();
        // Aufklappen der ersten Zeile darf nichts verbreitern.
        const toggle = page.locator('app-row-toggle button:visible').first();
        if (await toggle.count()) {
          await toggle.click();
          expect(await overflowOf(page, tables), `${email} ${page.url()} Details`).toBeNull();
        }
        // Reiter der Urlaubsübersicht (Liste, Konten) ebenso prüfen.
        if (route === '/urlaubsuebersicht') {
          for (const tab of ['Liste', 'Urlaubskonten']) {
            const button = page.getByRole('tab', { name: tab, exact: true });
            // „Urlaubskonten“ gibt es nur für Vorgesetzte und Admin; „Liste“ für alle.
            if (tab === 'Liste') await expect(button).toBeVisible();
            if (!(await button.count())) continue;
            await button.click();
            await page.waitForLoadState('networkidle');
            expect(await overflowOf(page, tables), `${email} ${tab}`).toBeNull();
          }
        }
      }
      await context.close();
    }
  });
}

test('Zeiten mit Nachträgen auf 360 px: keine Überbreite, Eingabefelder ohne iOS-Zoom', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await signInDirect(page, 'katharina.brandl@example.com');
  // Eigene Person mit einem markierten Nachtrag (unabhängig von Seed-Daten und Uhrzeit).
  const nina = await createEmployee(page, 'Nina Nachtrag', 'nina.nachtrag');
  await queryDb(
    `INSERT INTO "TimeEntry" (id, "employeeId", "workDate", "startAt", "endAt", source, "recordedAt", "recordedById", reason)
       VALUES (gen_random_uuid(), $1, ((now() - interval '90 minutes') AT TIME ZONE 'Europe/Berlin')::date,
               now() - interval '90 minutes', now() - interval '60 minutes', 'MANUAL', now(), $1,
               'Stempeln vergessen')`,
    [nina.id],
  );
  await context.clearCookies();
  await signInDirect(page, nina.email);
  await page.goto('/zeiten');
  // Erst die geladene Woche abwarten (die Summenzeile erscheint mit den Daten), dann zählen.
  await expect(page.getByRole('cell', { name: 'Summe', exact: true })).toBeVisible();
  const marker = page.locator('td.col-narrow .pill.lv-warn', { hasText: 'Nachtrag' });
  // Kurz nach Mitternacht am Montag liegt der Nachtrag in der Vorwoche.
  if (!(await marker.count())) await page.getByRole('button', { name: 'Vorige Woche' }).click();
  await expect(marker.first()).toBeVisible();
  expect(await overflowOf(page, true)).toBeNull();
  // Unter 16 px zoomt iOS beim Antippen hinein (Spezifikation Design, Abschnitt 3).
  const sizes = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'input:not([type=checkbox]):not([type=radio]), select, textarea',
      ),
    ]
      .filter((el) => el.offsetParent !== null)
      .map((el) => parseFloat(getComputedStyle(el).fontSize)),
  );
  expect(sizes.length).toBeGreaterThan(0);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
  await context.close();
});

test('Krankmeldungen auf 360 px: Formulare, Detailzeilen und AU-Vermerk ohne Überbreite (Review Web Phase 6, Befund 6)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const phone = { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true };
  const admin = await (await browser.newContext(phone)).newPage();
  await signInDirect(admin, 'katharina.brandl@example.com');
  const rita = await createEmployee(admin, 'Rita Rückenschmerz-Langname', 'rita.ruecken');
  const today = berlinToday();
  const status = await admin.evaluate(
    async (body) =>
      (
        await fetch('/api/sick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
    { employeeId: rita.id, kind: 'SICK', from: shift(today, -5), to: shift(today, 2) },
  );
  expect(status).toBe(201);

  // Vorgesetzte: Liste der Krankmeldungen im Team, Details, AU-Formular.
  const lead = await (await browser.newContext(phone)).newPage();
  await signInDirect(lead, 'tobias.lechner@example.com');
  await lead.goto('/urlaubsuebersicht');
  await lead.getByRole('tab', { name: 'Liste', exact: true }).click();
  const section = lead
    .locator('section')
    .filter({ has: lead.getByRole('heading', { name: 'Krankmeldungen im Team' }) })
    .last();
  await expect(section).toContainText('Rita');
  await section.locator('app-row-toggle button:visible').first().click();
  expect(await overflowOf(lead, true), 'Detailzeile').toBeNull();
  await section
    .getByRole('button', { name: /^AU vermerken: Rita/ })
    .first()
    .click();
  await expect(section.getByLabel('AU liegt vor bis')).toBeFocused();
  expect(await overflowOf(lead, true), 'AU-Formular').toBeNull();
  await lead.goto('/pruefungen');
  await expect(lead.locator('[data-sick-checks]')).toContainText('Rita');
  expect(await overflowOf(lead, true), 'Prüfungen').toBeNull();

  // Die Person selbst: Status in „Heute“, Verlängern, „Mein Urlaub“ mit Meldeformular.
  const person = await (await browser.newContext(phone)).newPage();
  await signInDirect(person, rita.email);
  await expect(person.getByText(/Heute krankgemeldet bis/)).toBeVisible();
  expect(await overflowOf(person, true), 'Heute').toBeNull();
  await person.goto('/urlaub');
  await person.getByRole('button', { name: 'Krank melden' }).first().click();
  expect(await overflowOf(person, true), 'Meldeformular').toBeNull();
});

test('Schublade: öffnen, Bereich wählen, schließt, Fokus zurück; Escape schließt', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await signInDirect(page, 'jonas.reitberger@example.com');
  const menu = page.getByRole('button', { name: /^Menü öffnen/ });
  await menu.click();
  const drawer = page.getByRole('dialog', { name: 'Menü' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Zeiten' }).click();
  await expect(page).toHaveURL(/\/zeiten$/);
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await expect(page.locator('[data-page-title]')).toHaveText('Zeiten');
  await menu.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await context.close();
});
