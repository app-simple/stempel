import { resolve } from 'node:path';

// Läuft vor jeder Integrationstest-Datei: Tests verwenden ausschließlich die Test-Datenbank.
try {
  process.loadEnvFile(resolve(__dirname, '../../../../.env'));
} catch {
  // CI setzt die Variablen direkt.
}
const testUrl = process.env['TEST_DATABASE_URL'];
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL fehlt oder zeigt nicht auf eine Datenbank mit Endung _test.');
}
process.env['DATABASE_URL'] = testUrl;
process.env['NODE_ENV'] = 'test';
process.env['APP_ORIGIN'] = process.env['APP_ORIGIN'] ?? 'http://localhost:4200';
process.env['WEBAUTHN_RP_ID'] = process.env['WEBAUTHN_RP_ID'] ?? 'localhost';
process.env['AUTH_PEPPER'] =
  process.env['AUTH_PEPPER'] ?? 'test-only-pepper-0123456789abcdef0123456789';
process.env['SMTP_HOST'] = process.env['SMTP_HOST'] ?? 'localhost';
process.env['SMTP_PORT'] = process.env['SMTP_PORT'] ?? '1025';
process.env['COOKIE_SECURE'] = 'true';
// Die Angleichung der Antwortzeiten testet response-floor.spec.ts; hier würde sie die Tests nur verlangsamen.
process.env['AUTH_FAILURE_FLOOR_MS'] = '0';
// Tests setzen X-Forwarded-For, um verschiedene Client-IPs zu simulieren.
process.env['TRUST_PROXY_HOPS'] = '1';
