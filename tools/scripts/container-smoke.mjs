#!/usr/bin/env node
// Smoke-Test der ausgelieferten Container: nginx-Header, SPA-Fallback, Rendern unter CSP, API-Health.
// Erwartet laufende Container: Web unter WEB_URL (Standard http://localhost:18080), API unter API_URL
// (Standard http://localhost:13000).
import { chromium } from '@playwright/test';

const web = process.env.WEB_URL ?? 'http://localhost:18080';
const api = process.env.API_URL ?? 'http://localhost:13000';
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FEHL'} ${message}`);
  if (!ok) failures.push(message);
};

const root = await fetch(`${web}/`);
const csp = root.headers.get('content-security-policy') ?? '';
check(root.status === 200, 'Web liefert / mit 200');
check(
  csp.includes("default-src 'self'") && !csp.includes('unsafe-inline'),
  'CSP streng ohne unsafe-inline',
);
check(root.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options gesetzt');
check(
  (root.headers.get('cache-control') ?? '').includes('no-store'),
  'index.html wird nicht gecacht',
);
check((await fetch(`${web}/mitarbeiter/123`)).status === 200, 'SPA-Fallback für Unterseiten');
check((await fetch(`${web}/api/health`)).status === 404, 'nginx beantwortet /api nicht selbst');

const browser = await chromium.launch();
const page = await browser.newPage();
const violations = [];
page.on('console', (m) => {
  if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
});
await page.goto(`${web}/anmelden`);
const heading = await page
  .getByRole('heading', { name: 'Anmelden' })
  .waitFor({ state: 'visible', timeout: 30_000 })
  .then(
    () => true,
    () => false,
  );
check(heading, 'Anmeldeseite rendert im ausgelieferten Build');
check(
  violations.length === 0,
  `keine CSP-Verstöße im Browser${violations.length ? `: ${violations.join(' | ')}` : ''}`,
);
const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
check(font.includes('IBM Plex Sans'), 'lokale Schrift aktiv');
await browser.close();

const health = await fetch(`${api}/api/health`).catch(() => null);
check(health?.status === 200, 'API-Image antwortet auf /api/health');

if (failures.length) {
  console.error(`\n${failures.length} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
