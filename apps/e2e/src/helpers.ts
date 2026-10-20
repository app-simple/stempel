import { expect, type Page } from '@playwright/test';
import { clearMailbox, waitForCode } from './mailpit';

/** Virtueller WebAuthn-Authenticator von Chromium als Passkey-Gerät. */
export async function addVirtualAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

export async function loginWithCode(page: Page, email: string): Promise<void> {
  await clearMailbox(email);
  await page.goto('/anmelden');
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByRole('button', { name: 'Code anfordern' }).click();
  await expect(page.getByRole('heading', { name: 'Code eingeben' })).toBeVisible();
  const code = await waitForCode(email);
  await page.getByLabel('Code aus der E-Mail').fill(code);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}

/**
 * Sitzung direkt in der E2E-Datenbank anlegen und als Cookie setzen. Für Tests, die nicht die Anmeldung
 * selbst prüfen; so bleibt das Rate-Limit für Code-Anforderungen (10 je IP in 15 Minuten) unberührt.
 */
export async function signInDirect(page: Page, email: string): Promise<void> {
  const { createHash, randomBytes } = await import('node:crypto');
  const { E2E } = await import('./env');
  const id = await employeeId(email);
  const token = randomBytes(32).toString('base64url');
  await queryDb(
    `INSERT INTO "Session" (id, "employeeId", "tokenHash", method, "createdAt", "lastActiveAt", "expiresAt")
       VALUES (gen_random_uuid(), $1, $2, 'EMAIL_CODE', now(), now(), now() + interval '1 day')`,
    [id, createHash('sha256').update(token).digest('hex')],
  );
  await page.context().addCookies([
    {
      name: '__Host-asos_session',
      value: token,
      url: `https://localhost:${E2E.webPort}`,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/');
}

/** Lesender bzw. vorbereitender Zugriff auf die E2E-Datenbank (nur für Nachweise im Test). */
export async function queryDb<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pg = (await import('pg')).default;
  const { E2E } = await import('./env');
  const db = new pg.Client({ connectionString: E2E.databaseUrl });
  await db.connect();
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.end();
  }
}

export async function employeeId(email: string): Promise<string> {
  const [row] = await queryDb<{ id: string }>('SELECT id FROM "Employee" WHERE "loginEmail" = $1', [
    email,
  ]);
  if (!row) throw new Error(`Kein Konto für ${email}`);
  return row.id;
}

/** Uhrzeit HH:MM in Europe/Berlin. */
export function berlinClock(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Neue Person ohne Stempelzeiten (also ohne gelernten Beginn), Montag bis Samstag, im Team von
 * Tobias Lechner. Eindeutige Adresse je Versuch: ein CI-Retry trifft nicht auf das Konto des
 * gescheiterten Laufs. `admin` muss als Admin angemeldet sein.
 */
export async function createEmployee(
  admin: Page,
  name: string,
  login: string,
): Promise<{ id: string; email: string }> {
  const email = `${login}.${Date.now()}@example.com`;
  const year = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
  }).format(new Date());
  const leadId = await employeeId('tobias.lechner@example.com');
  const result = await admin.evaluate(
    async (body) => {
      const response = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.text() };
    },
    {
      name,
      jobTitle: null,
      role: 'EMPLOYEE',
      loginEmail: email,
      leadId,
      deputyId: null,
      entryDate: `${year}-01-01`,
      exitDate: null,
      terms: {
        validFrom: `${year}-01-01`,
        type: 'FULL_TIME',
        weeklyMinutes: 2400,
        workDays: [1, 2, 3, 4, 5, 6],
        annualLeaveDays: 24,
        extraLeaveDays: 0,
        hourlyWageCents: null,
      },
      carryOverDays: 0,
    },
  );
  expect(result.status, result.body).toBe(201);
  return { id: await employeeId(email), email };
}
