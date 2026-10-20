import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, loginWithCode } from './helpers';

/** Abnahme Phase 1: Anmeldung per E-Mail-Code über Mailpit, danach Passkey anlegen und damit anmelden. */
test('Anmeldung per E-Mail-Code, Passkey anlegen und mit Passkey anmelden', async ({ page }) => {
  await addVirtualAuthenticator(page);
  const email = 'jonas.reitberger@example.com';

  await loginWithCode(page, email);
  await expect(page.getByRole('heading', { name: 'Guten Tag, Jonas' })).toBeVisible();
  await expect(page.getByText('Schneller anmelden mit Passkey')).toBeVisible();

  await page.getByRole('link', { name: 'Profil' }).click();
  await expect(page.getByTestId('login-email')).toHaveText(email);
  await page.getByLabel('Name des Geräts').fill('Testgerät');
  await page.getByRole('button', { name: 'Passkey anlegen' }).click();
  await expect(page.getByRole('status')).toContainText('Passkey angelegt');
  await expect(page.getByRole('cell', { name: 'Testgerät', exact: true })).toBeVisible();

  await page.getByRole('complementary').getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  // Die Sitzung ist serverseitig beendet, nicht nur in der Oberfläche.
  expect(await page.evaluate(async () => (await fetch('/api/auth/session')).status)).toBe(401);

  await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Guten Tag, Jonas' })).toBeVisible();
  await expect(page.getByTestId('current-user')).toHaveText('Jonas Reitberger');
  await expect(page.getByText('Schneller anmelden mit Passkey')).toHaveCount(0);
});

test('falscher Code wird abgelehnt, ohne zu verraten, ob die Adresse bekannt ist', async ({
  page,
}) => {
  await page.goto('/anmelden');
  await page.getByLabel('E-Mail-Adresse').fill('niemand@example.com');
  await page.getByRole('button', { name: 'Code anfordern' }).click();
  await expect(page.getByRole('heading', { name: 'Code eingeben' })).toBeVisible();
  await page.getByLabel('Code aus der E-Mail').fill('123456');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('alert')).toHaveText('Code ungültig oder abgelaufen.');
});

test('Mitarbeiter sehen keine Mitarbeiterverwaltung, auch nicht per direkter Adresse', async ({
  page,
}) => {
  await loginWithCode(page, 'elif.aydin@example.com');
  await expect(page.getByRole('heading', { name: 'Guten Tag, Elif' })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Mitarbeiter' })).toHaveCount(
    0,
  );
  await page.goto('/mitarbeiter');
  await expect(page.getByRole('heading', { name: 'Guten Tag, Elif' })).toBeVisible();
  const status = await page.evaluate(async () => (await fetch('/api/employees')).status);
  expect(status).toBe(403);
});

test('„Auf allen Geräten abmelden“ beendet auch andere Sitzungen', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await (await browser.newContext()).newPage();
  for (const page of [first, second]) {
    await loginWithCode(page, 'marco.pichler@example.com');
    await expect(page.getByRole('heading', { name: 'Guten Tag, Marco' })).toBeVisible();
  }
  await first.getByRole('link', { name: 'Profil' }).click();
  await first.getByRole('button', { name: 'Auf allen Geräten abmelden' }).click();
  await first.getByRole('button', { name: 'Wirklich auf allen Geräten abmelden' }).click();
  await expect(first.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  expect(await second.evaluate(async () => (await fetch('/api/auth/session')).status)).toBe(401);
});
