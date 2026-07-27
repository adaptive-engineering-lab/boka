import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT ?? '3000';
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Performance specs, matched once and used in three places so they cannot drift apart.
 *
 * The `throttled` project selects them; `mobile` and `desktop` must **ignore** them. Without
 * that exclusion a perf spec runs in all three projects — twice with no throttling at all,
 * where every budget passes trivially and the run reports three results for one measurement.
 * A green unthrottled LCP is not weaker evidence than no evidence; it is worse, because it
 * looks like evidence.
 */
const PERF_SPECS = /\.perf\.spec\.ts$/;

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
      testIgnore: PERF_SPECS,
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: PERF_SPECS,
    },
    {
      // SC-004 / SC-009: LCP under 3s at 400 kbps down, 400 ms RTT.
      // Throttling is applied per-test via CDP; this project exists so the
      // performance specs can be selected and run on their own.
      name: 'throttled',
      use: { ...devices['Desktop Chrome'] },
      testMatch: PERF_SPECS,
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
    /*
     * Never reuse a running server for the production path.
     *
     * `reuseExistingServer: !process.env.CI` is the usual default and it is actively dangerous
     * here. A leftover `next start` from an earlier session is indistinguishable from a fresh
     * one, so Playwright silently skips the build and runs the whole suite — T060 and T061
     * included — against **stale code**. That happened: the amended `/img` route was already
     * written and the suite still saw the old 302 redirect. The failure mode that matters is
     * the reverse, a mandatory privacy gate passing green against a build that no longer
     * exists, and nothing would have flagged it.
     *
     * Refusing to reuse costs one `next build` per run and turns a silent wrong answer into a
     * loud "port already in use". Dev iteration keeps the reuse behaviour.
     */
    reuseExistingServer: Boolean(process.env.E2E_DEV) && !process.env.CI,
    // A cold `next build` plus start needs more headroom than a dev boot.
    timeout: 240_000,
  },
});
