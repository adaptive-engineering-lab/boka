import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { signIn } from './helpers/studio';
import {
  PERF_COLLECTIONS,
  TARGET_DESIGNS,
  seedLaunchScale,
  teardownLaunchScale,
} from '../perf/seed';

/**
 * T079 — performance at launch scale (SC-004, SC-009, SC-012).
 *
 * ============================================================================
 * This is the only spec in the suite that measures rather than asserts a behaviour, and it is
 * the one most easily rendered meaningless without failing. Four things protect it:
 *
 *   1. **Realistic fixtures.** `tests/perf/seed.ts` synthesises photographic entropy rather
 *      than flat colour. A storefront of solid-colour tiles weighs almost nothing and would
 *      pass a 3-second budget on a 400 kbps link while proving nothing.
 *   2. **A floor on delivered image size**, asserted below. If the fixtures ever become
 *      trivially compressible again, this run fails as *unrealistic* instead of passing as
 *      fast.
 *   3. **A cold cache and a fresh context per measurement.** A warm second run measures the
 *      browser cache, not the site.
 *   4. **Chromium only, throttled via CDP.** The `throttled` project owns these specs and
 *      `mobile`/`desktop` ignore them, so an unthrottled green result cannot be produced by
 *      accident — see `playwright.config.ts`.
 * ============================================================================
 */

test.describe.configure({ mode: 'serial' });
// 150 real uploads through sharp on the first run, then several throttled page loads.
test.setTimeout(900_000);

/** SC-004's profile: 400 kbps down, 400 ms round trip. */
const THROTTLE = {
  offline: false,
  downloadThroughput: (400 * 1000) / 8, // 50,000 bytes/second
  uploadThroughput: (400 * 1000) / 8,
  latency: 400,
};

const LCP_BUDGET_MS = 3_000; // SC-004
const FILTER_BUDGET_MS = 1_000; // SC-009

/**
 * SC-012 says "no visible layout shift". 0.1 is the Web Vitals *good* threshold and is far too
 * loose for that wording — a 0.09 page visibly jumps. 0.01 is the practical reading of zero,
 * and the design is built to reach it exactly: stored width/height, `aspect-square`, and an
 * LQIP placeholder mean the box never changes size. Stated here rather than chosen silently.
 */
const CLS_BUDGET = 0.01;

/** Fixtures are heavy enough that a run producing tiny images is not measuring a storefront. */
const MIN_MEAN_IMAGE_BYTES = 15_000;

declare global {
  interface Window {
    __perf?: { lcp: number; cls: number; lcpUrl: string; lcpTag: string };
  }
}

interface Measurement {
  lcp: number;
  cls: number;
  /** What Chrome actually chose as the LCP element — see the note in `measure`. */
  lcpUrl: string;
  lcpTag: string;
  /** Time to the load event: what a visitor waits for the grid to finish. */
  loadMs: number;
  totalBytes: number;
  imageRequests: number;
  imageBytes: number;
  meanImageBytes: number;
  documentBytes: number;
}

/**
 * Loads a path over the throttled profile with a cold cache and reports what happened.
 *
 * A fresh context every time. Reusing one would leave the previous measurement's images in the
 * HTTP cache, and `/img` answers 304 for a matching ETag — so the second measurement would be
 * of a warm cache and would look wonderful.
 */
async function measure(browser: Browser, path: string): Promise<Measurement> {
  const context: BrowserContext = await browser.newContext();
  const page: Page = await context.newPage();

  // Observers must exist before any navigation, so they see the entries they are meant to
  // buffer. `buffered: true` additionally picks up anything emitted before this ran.
  await page.addInitScript(() => {
    window.__perf = { lcp: 0, cls: 0, lcpUrl: '', lcpTag: '' };

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        url?: string;
        element?: Element | null;
      })[]) {
        // The last LCP candidate wins; it is replaced as larger content paints.
        window.__perf!.lcp = entry.startTime;
        // **Which** element was chosen matters as much as when.
        //
        // A grid of blurred LQIP placeholders can satisfy an LCP budget while the actual
        // photographs are still minutes from arriving, and the run would report a comfortable
        // pass. Recording the URL makes that visible: an empty URL means the LCP was text, and
        // a `/img/` URL means a real photograph genuinely painted.
        window.__perf!.lcpUrl = entry.url ?? '';
        window.__perf!.lcpTag = entry.element?.tagName ?? '';
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        // Shifts following a user interaction are expected and excluded by definition.
        if (!entry.hadRecentInput) window.__perf!.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.clearBrowserCache');
  await client.send('Network.emulateNetworkConditions', THROTTLE);

  try {
    await page.goto(path, { waitUntil: 'load', timeout: 300_000 });
    // Settle, so lazy images that genuinely entered the viewport are counted and LCP has
    // stopped moving. Nothing is scrolled, so below-fold tiles stay unrequested — which is
    // the real visitor's experience, not a trick to lower the number.
    await page.waitForLoadState('networkidle', { timeout: 300_000 }).catch(() => {});

    /*
     * Byte accounting comes from the Resource Timing API rather than from response headers.
     *
     * `content-length` is absent on a streamed HTML response, so header-based accounting
     * silently reported the document as 0 KB — an under-count on the one resource that gates
     * everything else. `transferSize` is what actually crossed the wire, compression included.
     */
    const observed = await page.evaluate(() => {
      const perf = window.__perf ?? { lcp: 0, cls: 0, lcpUrl: '', lcpTag: '' };
      const navigation = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

      const images = resources.filter((entry) => new URL(entry.name).pathname.startsWith('/img/'));
      const sum = (entries: PerformanceResourceTiming[]) =>
        entries.reduce((total, entry) => total + (entry.transferSize || 0), 0);

      return {
        ...perf,
        loadMs: Math.round(navigation?.loadEventEnd ?? 0),
        documentBytes: Math.round(navigation?.transferSize ?? 0),
        imageRequests: images.length,
        imageBytes: sum(images),
        totalBytes: Math.round((navigation?.transferSize ?? 0) + sum(resources)),
      };
    });

    return {
      lcp: Math.round(observed.lcp),
      cls: Number(observed.cls.toFixed(4)),
      lcpUrl: observed.lcpUrl,
      lcpTag: observed.lcpTag,
      loadMs: observed.loadMs,
      totalBytes: observed.totalBytes,
      imageRequests: observed.imageRequests,
      imageBytes: observed.imageBytes,
      meanImageBytes:
        observed.imageRequests > 0 ? Math.round(observed.imageBytes / observed.imageRequests) : 0,
      documentBytes: observed.documentBytes,
    };
  } finally {
    await context.close();
  }
}

function report(label: string, measurement: Measurement): void {
  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  console.log(
    [
      ``,
      `  ── ${label} ──`,
      `     LCP                ${measurement.lcp} ms   (budget ${LCP_BUDGET_MS} ms)`,
      `     LCP element        <${measurement.lcpTag.toLowerCase() || '?'}> ${measurement.lcpUrl || '(text — no image URL)'}`,
      `     CLS                ${measurement.cls}      (budget ${CLS_BUDGET})`,
      `     Fully loaded       ${(measurement.loadMs / 1000).toFixed(1)} s`,
      `     Document           ${kb(measurement.documentBytes)}`,
      `     Images             ${measurement.imageRequests} requests, ${kb(measurement.imageBytes)}`,
      `     Mean image         ${kb(measurement.meanImageBytes)}`,
      `     Total transferred  ${kb(measurement.totalBytes)}`,
      ``,
    ].join('\n'),
  );
}

/** Set once the fixture is confirmed present, so teardown does not run against a failed seed. */
let fixtureReady = false;

test.beforeAll(async ({ browser }) => {
  // Hook timeouts are independent of the describe-level test timeout, and the default is 30s —
  // nowhere near enough for 150 real uploads through sharp on a cold run.
  test.setTimeout(900_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page);
    const result = await seedLaunchScale(page);
    fixtureReady = true;
    console.log(
      `\n  Fixture: ${result.total} PERF designs present ` +
        `(${result.created.length} created this run, ${result.seconds}s)\n`,
    );
    expect(result.total, 'the fixture did not reach launch scale').toBeGreaterThanOrEqual(
      TARGET_DESIGNS,
    );
  } finally {
    await context.close();
  }
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(900_000);
  if (!fixtureReady) return;

  /*
   * `PERF_KEEP=1` leaves the fixture in place.
   *
   * Remediation is iterative — change one thing, re-measure, keep or revert — and a full
   * seed-and-teardown cycle costs minutes of real image processing each time. Keeping the
   * fixture between runs makes that loop tolerable. It is opt-in rather than the default
   * because 50 designs left in the database would quietly change what every other spec sees.
   */
  if (process.env.PERF_KEEP) {
    console.log('\n  PERF_KEEP set — leaving the fixture in place. Re-run without it to clean up.\n');
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page);
    await teardownLaunchScale(page);
  } finally {
    await context.close();
  }
});

test('the storefront meets its LCP and layout-shift budgets at launch scale', async ({
  browser,
}) => {
  const measurement = await measure(browser, '/');
  report('storefront, cold cache, 400 kbps / 400 ms', measurement);

  // The realism guard comes first. If it fails, every number above is void, and reporting a
  // budget pass alongside it would be actively misleading.
  expect(
    measurement.imageRequests,
    'no images were requested — the storefront rendered empty and nothing was measured',
  ).toBeGreaterThan(0);
  expect(
    measurement.meanImageBytes,
    `mean delivered image is ${measurement.meanImageBytes} B, below the ${MIN_MEAN_IMAGE_BYTES} B floor — ` +
      'the fixtures are compressing like flat colour, so this run measures nothing real',
  ).toBeGreaterThan(MIN_MEAN_IMAGE_BYTES);

  expect(measurement.cls, 'SC-012: image loading shifted the layout').toBeLessThanOrEqual(
    CLS_BUDGET,
  );
  expect(measurement.lcp, 'SC-004: largest contentful paint over budget').toBeLessThan(
    LCP_BUDGET_MS,
  );
});

test('image delivery costs little enough server-side to stay on the request path', async ({
  browser,
}) => {
  /*
   * Unthrottled, deliberately — this measures the **server**, not the network.
   *
   * `/img` downloads the stored 2048px variant and resizes it with sharp on every request, and
   * `Cache-Control: private` means no CDN may ever cache the result (which is the point: a
   * shared cache would outlive the publication check). On Netlify that is one function
   * invocation per tile, so at 50 designs a cold storefront view costs 50 invocations.
   *
   * research D11 records pre-generated variants as the follow-up "if T079 shows the per-request
   * CPU is a problem". This is the measurement that decides it. Building that cache without
   * this number would be adding a caching layer next to the privacy gate on a hunch, which is
   * exactly the kind of complexity Principle V exists to refuse.
   *
   * No budget is asserted beyond a generous ceiling — the purpose is the recorded number.
   */
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('/', { waitUntil: 'load', timeout: 300_000 });

    const urls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img[src^="/img/"]'))
        .slice(0, 12)
        .map((img) => (img as HTMLImageElement).getAttribute('src') ?? ''),
    );
    expect(urls.length, 'no image URLs found to time').toBeGreaterThan(0);

    // Serially, so each timing is one request's own cost rather than a share of the pipe.
    const timings: number[] = [];
    for (const url of urls) {
      const startedAt = Date.now();
      const response = await page.request.get(url, { headers: { 'cache-control': 'no-cache' } });
      expect(response.status()).toBe(200);
      timings.push(Date.now() - startedAt);
    }

    const mean = Math.round(timings.reduce((a, b) => a + b, 0) / timings.length);
    const slowest = Math.max(...timings);

    // The conditional path, which is what a returning visitor actually gets.
    const firstUrl = urls[0]!;
    const first = await page.request.get(firstUrl);
    const etag = first.headers()['etag'] ?? '';
    const conditionalStart = Date.now();
    const conditional = await page.request.get(firstUrl, { headers: { 'if-none-match': etag } });
    const conditionalMs = Date.now() - conditionalStart;
    expect(conditional.status(), 'the ETag path did not produce a 304').toBe(304);

    console.log(
      `\n  ── /img server cost (unthrottled, ${urls.length} distinct images) ──\n` +
        `     Mean            ${mean} ms\n` +
        `     Slowest         ${slowest} ms\n` +
        `     Repeat (304)    ${conditionalMs} ms\n`,
    );

    expect(mean, 'per-image server cost is high enough to justify pre-generated variants').toBeLessThan(
      2_000,
    );
  } finally {
    await context.close();
  }
});

test('applying a filter returns an updated grid within a second', async ({ browser }) => {
  /*
   * SC-009 says the filter "returns an updated grid within 1 second". That is the grid, not
   * the photographs — a visitor sees the filtered set the moment the new markup arrives, and
   * the images stream in behind it. So this measures navigation to the first tile of the new
   * grid existing in the document, and deliberately does not wait for `load`.
   */
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', THROTTLE);

    /*
     * Let the first load settle before starting the clock.
     *
     * Without this the measurement is dominated by contention rather than by the filter: the
     * previous page's images are still streaming, so the new navigation queues behind megabytes
     * of in-flight requests on a 400 kbps pipe. That produced an 18-second reading which says
     * something true about page weight but nothing about SC-009, which asks how quickly
     * *applying a filter* returns an updated grid. Page weight is measured properly in the
     * first test; this one measures the filter.
     */
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await page.waitForLoadState('networkidle', { timeout: 300_000 }).catch(() => {});

    const collection = PERF_COLLECTIONS[1];
    const startedAt = Date.now();
    await page.goto(`/?collection=${encodeURIComponent(collection)}`, {
      waitUntil: 'commit',
      timeout: 300_000,
    });
    await page.locator('main a[href^="/d/"]').first().waitFor({ state: 'attached', timeout: 60_000 });
    const elapsed = Date.now() - startedAt;

    console.log(`\n  ── filter response ──\n     ${elapsed} ms   (budget ${FILTER_BUDGET_MS} ms)\n`);

    // Guard: a filter that matched nothing would return instantly and pass trivially.
    const tiles = await page.locator('main a[href^="/d/"]').count();
    expect(tiles, 'the filtered grid was empty — nothing was measured').toBeGreaterThan(0);

    expect(elapsed, 'SC-009: filter response over budget').toBeLessThan(FILTER_BUDGET_MS);
  } finally {
    await context.close();
  }
});
