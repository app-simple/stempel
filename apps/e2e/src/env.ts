import { resolve } from 'node:path';

/**
 * Abnahmetests laufen gegen eine eigene Datenbank (Endung _e2e) und eigene Ports,
 * damit sie weder Entwicklungsdaten noch einen laufenden Dev-Server berühren.
 */
try {
  process.loadEnvFile(resolve(__dirname, '../../../.env'));
} catch {
  // CI setzt die Variablen direkt.
}

const devUrl = process.env['DATABASE_URL'] ?? 'postgresql://asos:asos-dev@localhost:5442/asos';
const e2eUrl = process.env['E2E_DATABASE_URL'] ?? devUrl.replace(/\/[^/?]+(\?|$)/, '/asos_e2e$1');

export const E2E = {
  apiPort: Number(process.env['E2E_API_PORT'] ?? 3210),
  webPort: Number(process.env['E2E_WEB_PORT'] ?? 4310),
  databaseUrl: e2eUrl,
  mailpitUrl:
    process.env['E2E_MAILPIT_URL'] ?? `http://localhost:${process.env['MAILPIT_UI_PORT'] ?? 8036}`,
  smtpPort: process.env['E2E_SMTP_PORT'] ?? process.env['MAILPIT_SMTP_PORT'] ?? '1036',
};

if (!new URL(E2E.databaseUrl).pathname.endsWith('_e2e')) {
  throw new Error('E2E_DATABASE_URL muss auf eine Datenbank mit Endung _e2e zeigen.');
}

/** Umgebung für die API im Abnahmetest. */
export const apiEnv: Record<string, string> = {
  NODE_ENV: 'development',
  API_PORT: String(E2E.apiPort),
  DATABASE_URL: E2E.databaseUrl,
  APP_ORIGIN: `http://localhost:${E2E.webPort}`,
  WEBAUTHN_RP_ID: 'localhost',
  WEBAUTHN_RP_NAME: 'Zeit & Urlaub',
  AUTH_PEPPER: process.env['AUTH_PEPPER'] ?? 'e2e-only-pepper-0123456789abcdef0123456789',
  AUTH_FAILURE_FLOOR_MS: '0',
  COOKIE_SECURE: 'true',
  SMTP_HOST: 'localhost',
  SMTP_PORT: E2E.smtpPort,
  SMTP_SECURE: 'false',
  MAIL_FROM: 'Zeit & Urlaub <zeit@example.com>',
  // Ohne VAPID-Schlüssel: Erinnerungen nur als Banner und E-Mail, nie an echte Push-Dienste.
  VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
};
