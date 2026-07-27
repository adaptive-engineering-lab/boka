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
    /*
     * A PRODUCTION build by default, not `next dev`.
     *
     * This is not a preference. The two mandatory privacy gates assert on the raw bytes a
     * visitor receives — that a draft's 404 is indistinguishable from a nonexistent one
     * (T060), and that no `notes` content appears anywhere in a response body (T061). A dev
     * server embeds error-overlay payloads, HMR wiring and stack traces that no visitor will
     * ever see, so a byte-comparison against `next dev` output is a comparison of the wrong
     * artifact: it fails on dev noise, and it could equally pass while production leaked.
     *
     * `E2E_DEV=1` opts back into the dev server for fast iteration on the non-privacy specs.
     * The privacy gates should always be confirmed against the production build before merge.
     */
    command: process.env.E2E_DEV ? 'npm run dev' : 'npm run build && npm run start',
    // Readiness is probed against the sign-in page rather than `/`, because Playwright
    // treats 404 as "not ready" and a storefront with nothing published legitimately
    // renders — but any route can 404 while the app is mid-boot. Sign-in always exists.
    url: `${BASE_URL}/auth/sign-in`,
    reuseExistingServer: !process.env.CI,
    // A cold `next build` plus start needs more headroom than a dev boot.
    timeout: 240_000,
  },
});
