const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 180000,
  expect: { timeout: 90000 },
  workers: 1,
  fullyParallel: false,
  outputDir: 'test-results/local',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/local', open: 'never' }]],
  use: {
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:8080',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node scripts/serve.cjs dist',
    url: 'http://127.0.0.1:8080',
    reuseExistingServer: false,
    timeout: 10000
  }
});
