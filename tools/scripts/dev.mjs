#!/usr/bin/env node
// Lokaler Start mit einem Befehl: `pnpm dev`.
// Legt .env an, startet PostgreSQL und Mailpit, bringt die DB auf Stand und startet API und Web.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\nFehlgeschlagen: ${cmd} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
};

if (!existsSync(resolve(root, '.env'))) {
  copyFileSync(resolve(root, '.env.example'), resolve(root, '.env'));
  console.log('.env aus .env.example angelegt.');
}

run('docker', ['compose', '--env-file', '.env', 'up', '-d', '--wait']);
run('pnpm', ['nx', 'run', 'api:prisma-generate', '--outputStyle=stream']);
run('pnpm', ['nx', 'run', 'api:migrate', '--outputStyle=stream']);
// Idempotent: legt Beispieldaten nur in einer leeren Datenbank an.
run('pnpm', ['nx', 'run', 'api:seed', '--outputStyle=stream']);

const serve = spawn(
  'pnpm',
  ['nx', 'run-many', '-t', 'serve', '-p', 'api', 'web', '--outputStyle=stream'],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
serve.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => serve.kill(signal));
