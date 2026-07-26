import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT ?? '3000';
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      // Mobile first, and listed first deliberately: Principle III makes the phone the
      // primary target, and the constitution requires designer-facing flows to be
      // exercised at mobile width before a feature counts as done.
      name: 'mobile',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // SC-004 / SC-009: LCP under 3s at 400 kbps down, 400 ms RTT.
      // Throttling is applied per-test via CDP; this project exists so the
      // performance specs can be selected and run on their own.
      name: 'throttled',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /.*\.perf\.spec\.ts/,
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
