import { expect, test } from '@playwright/test';
import { signInDirect } from './helpers';

/** Abnahme Phase 1: Ein Jahresurlaub unter dem gesetzlichen Minimum wird in der Oberfläche abgelehnt. */
test('Admin legt Mitarbeiter an; Urlaub unter dem Minimum lässt sich nicht speichern', async ({
  page,
}) => {
  await signInDirect(page, 'katharina.brandl@example.com');
  await expect(page.getByRole('heading', { name: 'Guten Tag, Katharina' })).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Mitarbeiter' }).click();
  await expect(page.getByRole('row', { name: /Jonas Reitberger/ })).toBeVisible();
  // Anna Kroiß (13,90 €) und Hannelore Fuchs (14,00 €) liegen unter dem Mindestlohn ab 2027: vor 2027 als
  // Hinweis auf die künftige Änderung, danach als Verstoß. Beide Texte nennen 14,60 €.
  const warning = /Mindestlohn von 14,60/;
  await expect(page.getByRole('row', { name: /Anna Kroiß/ }).getByText(warning)).toBeVisible();
  await expect(page.getByText(warning)).toHaveCount(2);

  await page.getByRole('link', { name: 'Mitarbeiter anlegen' }).click();
  await page.locator('#employee-name').fill('Erika Beispiel');
  await page.locator('#employee-email').fill('erika.beispiel@example.org');
  await page.locator('#employee-lead').selectOption({ label: 'Tobias Lechner' });
  await page.locator('#employee-entry').fill('2026-11-01');
  await page.locator('#terms-date').fill('2026-11-01');

  const save = page.getByRole('button', { name: 'Speichern' });
  await page.locator('#terms-annual').fill('19');
  await expect(
    page.getByText('Jahresurlaub liegt unter dem gesetzlichen Minimum von 20 Tagen.'),
  ).toBeVisible();
  await expect(save).toBeDisabled();

  await page.locator('#terms-annual').fill('20');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('Erika Beispiel gespeichert.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Erika Beispiel/ })).toBeVisible();
});

test('Feiertage des laufenden Jahres mit Mariä Himmelfahrt', async ({ page }) => {
  await signInDirect(page, 'lena.hofbauer@example.com');
  await page.getByRole('navigation').getByRole('link', { name: 'Feiertage' }).click();
  await expect(page.getByRole('cell', { name: 'Mariä Himmelfahrt' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Fronleichnam' })).toBeVisible();
  await expect(
    page.getByText('Mariä Himmelfahrt (15.08.) ist am Betriebssitz Feiertag'),
  ).toHaveCount(0);
});
