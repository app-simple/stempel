import { expect, test, type Page } from '@playwright/test';
import { employeeId, queryDb, signInDirect } from './helpers';

/**
 * Abnahme Phase 7 (Spezifikation Jugendarbeitsschutz, Abschnitt 9): Der Admin legt eine jugendliche
 * Person an, ein Vertragsstand unter dem Jugendmindesturlaub lässt sich nicht speichern; eine Buchung bis
 * 20:30 erscheint als Verstoß nach § 14 in „Prüfungen“; bei Vollzeitschulpflicht ist Arbeit außerhalb der
 * Schulferien ein Verstoß. Vorgesetzte sehen die Meldungen, nie das Geburtsdatum.
 */

function berlinToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
}
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/**
 * Letzter Werktag Montag bis Freitag vor heute, der kein Feiertag ist, auch im Vorjahr: Der Test läuft
 * so auch Anfang Januar (Review Web Phase 7, Befund 3). Alle Jahreswerte leiten sich von diesem Tag ab.
 */
async function lastWorkday(): Promise<string> {
  for (let date = addDays(berlinToday(), -1); ; date = addDays(date, -1)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const holiday = await queryDb('SELECT 1 FROM "Holiday" WHERE active AND date = $1::date', [
      date,
    ]);
    if (weekday >= 1 && weekday <= 5 && holiday.length === 0) return date;
  }
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
async function findingsFor(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: 'Prüfungen' }).click();
  // Die Prüfungen rechnen für den Admin alle Personen über sechs Wochen; das dauert länger als 5 s.
  await expect(page.getByRole('heading', { name: 'Arbeitszeit' })).toBeVisible({ timeout: 30_000 });
  await page.locator('#finding-person').selectOption({ label: name });
}

test('Jugendliche: Mindesturlaub, Nachtarbeit nach § 14 und Schulpflicht in „Prüfungen“', async ({
  page,
  browser,
}) => {
  const day = await lastWorkday();
  const year = Number(day.slice(0, 4));
  const email = `jana.jung.${Date.now()}@example.org`;
  const name = `Jana Jung ${Date.now()}`;

  // Geboren am 01.01. 16 Jahre vor dem Jahr des Buchungstags: in diesem Jahr 16, am 1.1. ebenfalls 16
  // → 27 Werktage = 23 Tage; heute höchstens 17, also noch jugendlich.
  await signInDirect(page, 'katharina.brandl@example.com');
  await page.getByRole('navigation').getByRole('link', { name: 'Mitarbeiter' }).click();
  await page.getByRole('link', { name: 'Mitarbeiter anlegen' }).click();
  await page.locator('#employee-name').fill(name);
  await page.locator('#employee-email').fill(email);
  await page.locator('#employee-lead').selectOption({ label: 'Tobias Lechner' });
  await page.locator('#employee-entry').fill(`${year}-01-01`);
  await page.locator('#employee-birth').fill(`${year - 16}-01-01`);
  await expect(page.getByText(`Jugendarbeitsschutz gilt bis 31.12.${year + 1}`)).toBeVisible();
  await page.locator('#terms-date').fill(`${year}-01-01`);

  const save = page.getByRole('button', { name: 'Speichern', exact: true });
  await page.locator('#terms-annual').fill('20');
  await expect(page.getByText(/mindestens 23 Tage \(§ 19 Abs\. 2 JArbSchG\)/)).toBeVisible();
  await expect(save).toBeDisabled();
  await page.locator('#terms-annual').fill('23');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(`${name} gespeichert.`)).toBeVisible();
  const id = await employeeId(email);

  // Nachtrag durch den Admin: 12:00–20:30 mit einer Stunde Pause.
  await api(page, 'POST', '/api/time/entries', {
    employeeId: id,
    date: day,
    start: '12:00',
    end: '20:30',
    breaks: [{ start: '15:00', end: '16:00' }],
    reason: 'Abnahmetest Jugendarbeitsschutz',
  });
  await findingsFor(page, name);
  await expect(page.getByText('Arbeit vor 6 Uhr oder nach 20 Uhr')).toBeVisible();
  await expect(page.getByText(/§ 14 Abs\. 1 JArbSchG/)).toBeVisible();
  await expect(page.getByText('Beschäftigung nur in den Schulferien zulässig')).toHaveCount(0);

  // Die Vorgesetzte sieht die Meldung, aber kein Geburtsdatum.
  const lead = await (await browser.newContext()).newPage();
  await signInDirect(lead, 'tobias.lechner@example.com');
  const forLead = await api<Record<string, unknown>>(lead, 'GET', `/api/employees/${id}`);
  expect(forLead).not.toHaveProperty('birthDate');
  expect(JSON.stringify(forLead)).not.toContain(`${year - 16}-01-01`);
  await findingsFor(lead, name);
  await expect(lead.getByText('Arbeit vor 6 Uhr oder nach 20 Uhr')).toBeVisible();

  // Vollzeitschulpflicht ohne gepflegte Schulferien: die Buchung liegt außerhalb der Ferien.
  await page.goto(`/mitarbeiter/${id}`);
  await page.locator('#employee-school').fill(`${year + 1}-07-31`);
  await page
    .locator('form')
    .filter({ has: page.locator('#employee-school') })
    .getByRole('button', { name: 'Speichern', exact: true })
    .click();
  await expect(page.getByText(`${name} gespeichert.`)).toBeVisible();
  await findingsFor(page, name);
  await expect(page.getByText('Beschäftigung nur in den Schulferien zulässig')).toBeVisible();
});
