import { defineConfig, devices } from '@playwright/test';
import { apiEnv, E2E } from './src/env';

const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './src',
  globalSetup: './src/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  reporter: isCI
    ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]]
    : 'list',
  outputDir: '../../test-results',
  use: {
    baseURL: `http://localhost:${E2E.webPort}`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Gebaut und direkt gestartet, damit keine .env die Testumgebung überschreibt.
      command: 'pnpm nx run api:build --outputStyle=stream && node dist/apps/api/main.js',
      cwd: '../..',
      url: `http://localhost:${E2E.apiPort}/api/health`,
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `pnpm nx run web:serve --port=${E2E.webPort} --proxyConfig=apps/e2e/proxy.e2e.conf.json --outputStyle=stream`,
      cwd: '../..',
      url: `http://localhost:${E2E.webPort}`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
