const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: [/[\\/]e2e[\\/]batch\.spec\.cjs$/, /[\\/]live[\\/](online|offline)\.spec\.cjs$/],
  timeout: 240000,
  expect: { timeout: 90000 },
  workers: 1,
  fullyParallel: false,
  outputDir: 'test-results/live',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/live', open: 'never' }],
    ['json', { outputFile: '.test-cache/live-results.json' }]],
  use: {
    serviceWorkers: 'block',
    channel: 'chrome',
    baseURL: process.env.LIVE_BASE_URL || 'https://online-conversion.pages.dev/',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});
