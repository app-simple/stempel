import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Lokal kommen die Werte aus .env im Workspace-Root; gesetzte Umgebungsvariablen haben Vorrang.
try {
  process.loadEnvFile(resolve(import.meta.dirname, '../../.env'));
} catch {
  // keine .env, z. B. in CI oder Produktion
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx --tsconfig apps/api/tsconfig.json apps/api/prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
