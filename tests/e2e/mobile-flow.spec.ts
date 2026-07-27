import { expect, test } from '@playwright/test';

import {
  clearUndeliveredBanner,
  createDesign,
  deleteDesign,
  readSlug,
  setPublished,
  signIn,
} from './helpers/studio';

/**
 * T082 — the designer-facing flows at mobile width (SC-001, SC-005, SC-018).
 *
 * ============================================================================
 * **What this can and cannot prove.**
 *
 * SC-005 — "homepage to a design's full detail in two taps or fewer" — is a property of the
 * interface, and a machine counts taps exactly as well as a person. That half is settled here.
 *
 * SC-001 — "the designer can photograph a piece, add its details, and publish it from her phone
 * in under 3 minutes" — is a claim about a **person**, and no automated run can establish it. A
 * script types instantly, never hunts for a control, never re-reads a label. What the timing
 * below establishes is a **floor**: that the system's own latency leaves room inside the budget.
 * If the automated flow took two minutes, a human could not do it in three, and the claim would
 * be dead without anyone needing to hold a stopwatch. Passing does not prove SC-001; failing
 * disproves it. The manual pass recorded in quickstart.md is the actual evidence.
 *
 * Recording it this way rather than letting a green test stand in for the human one is the
 * point — the constitution asks for the flows to be *exercised* at mobile width, not for a
 * number that resembles the criterion.
 * ============================================================================
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

/** SC-001's budget. Asserted as a system-latency floor, not as the human measurement. */
const CAPTURE_TO_PUBLISH_BUDGET_MS = 180_000;

/** SC-005. */
const MAX_TAPS_TO_DETAIL = 2;

test('a visitor reaches a design\'s full detail in two taps or fewer', async ({ page, browser }) => {
  const stamp = Date.now();
  await signIn(page);
  const id = await createDesign(page, { title: `Mobile Taps Subject ${stamp}`, photos: 2 });

  try {
    const slug = await readSlug(page, id);
    await setPublished(page, id, true);

    // A visitor, with no session — the storefront a real person lands on.
    //
    // `hasTouch` is set explicitly rather than inherited from the project. SC-005 counts *taps*,
    // and `tap()` throws outright when a context has no touch support — so on the desktop project
    // this asserted nothing and failed for a reason unrelated to the criterion. Enabling touch
    // runs the real tap path on both engines instead of narrowing the test to one.
    const visitorContext = await browser.newContext({ hasTouch: true });
    const visitor = await visitorContext.newPage();

    try {
      let taps = 0;
      await visitor.goto('/');

      // Tap one: the design's tile in the grid. No interstitial, no "view collection" step —
      // FR-027 makes the grid the homepage precisely so this is a single tap.
      await visitor.locator(`a[href="/d/${slug}"]`).first().tap();
      taps += 1;
      await visitor.waitForURL(`**/d/${slug}`, { timeout: 30_000 });

      expect(taps, 'SC-005: too many taps from homepage to detail').toBeLessThanOrEqual(
        MAX_TAPS_TO_DETAIL,
      );

      // "Full detail" is the requirement, so check the page is actually complete rather than
      // merely reached — a detail page that needed a further tap to reveal its photographs
      // would satisfy the count and not the criterion.
      await expect(
        visitor.getByRole('heading', { name: `Mobile Taps Subject ${stamp}` }),
      ).toBeVisible();
      await expect(visitor.locator('img[src^="/img/"]').first()).toBeVisible();
      await expect(visitor.getByRole('heading', { name: 'Ask about this piece' })).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  } finally {
    await deleteDesign(page, id).catch(() => {});
    await clearUndeliveredBanner(page).catch(() => {});
  }
});

test('the capture-to-publish flow leaves room inside the SC-001 budget', async ({ page }) => {
  const stamp = Date.now();
  await signIn(page);

  const startedAt = Date.now();
  const id = await createDesign(page, {
    title: `Mobile Flow Subject ${stamp}`,
    collection: 'Autumn Studies',
    notes: 'Hem taken up 2cm.',
    photos: 2,
  });
  await setPublished(page, id, true);
  const elapsed = Date.now() - startedAt;

  try {
    console.log(
      `\n  ── capture → publish (automated floor) ──\n` +
        `     ${(elapsed / 1000).toFixed(1)}s   (SC-001 budget ${CAPTURE_TO_PUBLISH_BUDGET_MS / 1000}s for a human)\n`,
    );

    expect(
      elapsed,
      'system latency alone consumes the SC-001 budget — a person cannot beat it',
    ).toBeLessThan(CAPTURE_TO_PUBLISH_BUDGET_MS);
  } finally {
    await deleteDesign(page, id).catch(() => {});
    await clearUndeliveredBanner(page).catch(() => {});
  }
});

test('every designer-facing page is usable at phone width', async ({ page }) => {
  /*
   * The constitution requires designer-facing flows to be exercised at mobile width before a
   * feature counts as done. Rendering is not the same as being usable: a control pushed off a
   * 390px viewport is invisible to a designer holding a phone and perfectly visible to a
   * desktop test, which is exactly the gap this closes.
   *
   * `toBeInViewport` rather than `toBeVisible` is the whole point — an element can be visible
   * in the DOM sense while sitting outside the screen.
   */
  await signIn(page);

  /*
   * The role is part of the fixture, not an assumption.
   *
   * `/studio`'s "Add a design" is a `<Link>`, and asserting it as a button found nothing — a
   * failure that read as "the control is off-screen" when the control was there all along. A
   * viewport test that cannot tell "outside the viewport" from "I looked for the wrong thing" is
   * worse than no viewport test, because the message points at the wrong file.
   */
  const surfaces = [
    ['/studio', 'Your designs', 'link', 'Add a design'],
    ['/studio/designs/new', 'Add a design', 'button', 'Save design'],
    ['/studio/categories', 'Categories', 'button', 'Add'],
    ['/studio/settings', 'Settings', 'button', 'Save profile'],
  ] as const;

  for (const [path, heading, role, control] of surfaces) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: heading, level: 1 }),
      `${path} did not render its heading`,
    ).toBeVisible();

    const primary = page.getByRole(role, { name: control }).first();
    // Prove it exists before asking where it is, so the two failures stay distinguishable.
    await expect(primary, `${path}: no ${role} named "${control}"`).toBeVisible();

    /*
     * Reachable, not necessarily on the first screen.
     *
     * The first version asserted `toBeInViewport()` outright and failed on "Save design" — which
     * sits at the bottom of a long form, exactly where a submit button belongs. Demanding that
     * every control fit the initial viewport is not a usability requirement, it is a demand that
     * forms be short. Scrolling to it and *then* checking still catches the real defect: a
     * control that cannot be brought into view at all, because something clips or overlays it.
     */
    await primary.scrollIntoViewIfNeeded();
    await expect(
      primary,
      `${path}: the "${control}" ${role} cannot be scrolled into view`,
    ).toBeInViewport();

    /*
     * Horizontal clipping is the failure that actually strands a designer on a phone. Below the
     * fold is a scroll away; off the right edge is unreachable, and invisible to a desktop test.
     */
    const box = await primary.boundingBox();
    const viewport = page.viewportSize();
    if (box && viewport) {
      expect(box.x, `${path}: "${control}" starts off the left edge`).toBeGreaterThanOrEqual(-1);
      expect(
        Math.round(box.x + box.width),
        `${path}: "${control}" extends past the right edge of a ${viewport.width}px screen`,
      ).toBeLessThanOrEqual(viewport.width + 1);
    }

    // Nothing may overflow horizontally: a designer should never have to pan sideways to reach
    // a control, and a horizontal scrollbar on a phone is how that starts.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} scrolls horizontally at this width`).toBeLessThanOrEqual(1);
  }
});
