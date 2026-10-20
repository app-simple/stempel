import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Bringt die Test-Datenbank einmal pro Lauf auf den aktuellen Migrationsstand (nicht zerstörend).
 * Die Tests leeren ihre Tabellen selbst (resetDb). Nach Änderungen an bestehenden Migrationen die
 * Test-DB von Hand neu anlegen, siehe README.
 */
export default function globalSetup(): void {
  const root = resolve(__dirname, '../../../..');
  try {
    process.loadEnvFile(resolve(root, '.env'));
  } catch {
    // CI setzt die Variablen direkt.
  }
  const url = process.env['TEST_DATABASE_URL'];
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error(
      'TEST_DATABASE_URL fehlt oder zeigt nicht auf eine Datenbank mit Endung _test.',
    );
  }
  execSync('pnpm exec prisma migrate deploy --config apps/api/prisma.config.ts', {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
