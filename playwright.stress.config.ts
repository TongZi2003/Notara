import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/stress',
  testMatch: 'browser.spec.ts',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  workers: 1,
  outputDir: '.runtime/stress-browser',
  reporter: [['list'], ['json', { outputFile: '.runtime/stress-browser-results.json' }]],
  use: { browserName: 'chromium', headless: true, viewport: { width: 1360, height: 900 }, actionTimeout: 20_000, navigationTimeout: 30_000 },
});
