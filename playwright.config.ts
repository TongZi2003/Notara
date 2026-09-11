import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '.runtime/e2e-results.json' }]],
  use: { browserName: 'chromium', headless: true, actionTimeout: 15_000, navigationTimeout: 20_000 },
});
