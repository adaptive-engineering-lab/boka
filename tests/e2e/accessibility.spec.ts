import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  clearUndeliveredBanner,
  createDesign,
  deleteDesign,
  readSlug,
  setPublished,
  signIn,
  uniqueClientHeaders,
} from './helpers/studio';

/**
 * T077 — automated WCAG 2.1 AA check (FR-012c, SC-013).
 *
 * SC-013 asks for two things and this covers both: zero axe-core violations on the public
 * storefront and the designer dashboard, and non-empty alt text on every displayed photo.
 *
 * ============================================================================
 * **Scanning a page with nothing on it is the way this test fails silently.**
 *
 * An empty storefront has no images, no grid and almost no controls, so it passes a WCAG
 * sweep trivially — and every assertion below would stay green while the real grid regressed.
 * The same is true of a dashboard with no designs. So each scan is preceded by a guard that
 * the content under test is actually rendered, and the suite publishes its own design rather
 * than trusting whatever the database happens to hold.
 *
 * The states scanned deliberately include two that a "load each page and scan" version would
 * miss entirely, and they are where accessibility regressions actually live: the inquiry form
 * **displaying validation errors**, and the delete dialog **while open**. A modal's semantics
 * and an error's association with its field do not exist until they are on screen.
 * ============================================================================
 *
 * What this does not do is replace T076 or T078. axe finds a minority of WCAG failures — it
 * had nothing to say about the skip link that bypassed nothing, because every static property
 * of that markup was correct and only pressing Tab revealed it.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** WCAG 2.1 Level AA, which is what FR-012c names. */
const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Scans the current page and fails with something a person can act on.
 *
 * axe's raw output is a deep object; printed as-is into a Playwright failure it is unreadable,
 * and an unreadable failure is one that gets skipped rather than fixed.
 */
async function expectNoViolations(page: Page, surface: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_21_AA).analyze();

  const summary = violations
    .map((violation) => {
      const where = violation.nodes.map((node) => `      ${node.target.join(' ')}`).join('\n');
      return `  [${violation.impact ?? 'unknown'}] ${violation.id} — ${violation.help}\n${where}\n      ${violation.helpUrl}`;
    })
    .join('\n');

  expect(violations, `WCAG 2.1 AA violations on ${surface}:\n${summary}`).toEqual([]);
}

/**
 * FR-012b and the first half of SC-013: every displayed photo carries non-empty alt text.
 *
 * Checked separately from axe rather than left to it. axe's `image-alt` rule accepts `alt=""`,
 * because an empty alt is the correct marking for a decorative image — but on this site there
 * is no such thing as a decorative photograph. Every image is a piece of the designer's work,
 * and FR-012b provides a title-and-position fallback precisely so that none of them can end up
 * announced as nothing.
 */
async function expectEveryImageHasAltText(page: Page, surface: string): Promise<void> {
  const images = await page.locator('img').all();
  expect(images.length, `no images rendered on ${surface} — nothing was checked`).toBeGreaterThan(0);

  for (const image of images) {
    const alt = await image.getAttribute('alt');
    const src = await image.getAttribute('src');
    expect(alt, `an image on ${surface} has no alt attribute (src=${src})`).not.toBeNull();
    expect(alt?.trim(), `an image on ${surface} has empty alt text (src=${src})`).not.toBe('');
  }
}

test('the public storefront and a design detail page have no WCAG 2.1 AA violations', async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  await signIn(page);
  const id = await createDesign(page, { title: `Accessibility Subject ${stamp}`, photos: 2 });

  try {
    const slug = await readSlug(page, id);
    await setPublished(page, id, true);

    // A visitor's context: no session, so the owner bar is absent and what is scanned is what
    // the public actually receives.
    const visitorContext = await browser.newContext({ extraHTTPHeaders: uniqueClientHeaders() });
    const visitor = await visitorContext.newPage();

    try {
      await visitor.goto('/');
      // Guard: prove the grid is populated before concluding anything from a clean scan.
      await expect(visitor.locator(`a[href="/d/${slug}"]`)).toBeVisible();
      await expectEveryImageHasAltText(visitor, 'storefront');
      await expectNoViolations(visitor, 'storefront');

      await visitor.goto(`/d/${slug}`);
      await expect(visitor.getByRole('heading', { name: `Accessibility Subject ${stamp}` })).toBeVisible();
      await expectEveryImageHasAltText(visitor, 'design detail');
      await expectNoViolations(visitor, 'design detail');

      // The inquiry form showing a validation error. Error association only exists once an
      // error does, so a scan of the pristine form would never exercise it.
      await visitor.getByLabel('Your name').fill('Keyboard Visitor');
      await visitor.getByLabel('Your email').fill('not-an-address');
      await visitor.getByRole('button', { name: 'Send message' }).click();
      await expect(visitor.getByText(/does not look like an email address/)).toBeVisible();
      await expectNoViolations(visitor, 'design detail (inquiry form showing an error)');
    } finally {
      await visitorContext.close();
    }
  } finally {
    await deleteDesign(page, id).catch(() => {});
    await clearUndeliveredBanner(page).catch(() => {});
  }
});

test('the designer dashboard and its forms have no WCAG 2.1 AA violations', async ({ page }) => {
  const stamp = Date.now();
  await signIn(page);
  const id = await createDesign(page, { title: `Dashboard A11y Subject ${stamp}`, photos: 1 });

  try {
    await page.goto('/studio');
    // Guard: an empty dashboard is a different, much simpler page than a populated one.
    await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
    await expect(page.getByText(`Dashboard A11y Subject ${stamp}`)).toBeVisible();
    await expectEveryImageHasAltText(page, 'dashboard');
    await expectNoViolations(page, 'dashboard');

    for (const [path, heading] of [
      ['/studio/designs/new', 'Add a design'],
      ['/studio/categories', 'Categories'],
      ['/studio/settings', 'Settings'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expectNoViolations(page, path);
    }

    await page.goto(`/studio/designs/${id}`);
    await expect(page.getByRole('heading', { name: `Dashboard A11y Subject ${stamp}` })).toBeVisible();
    await expectNoViolations(page, 'design edit');

    // The delete dialog while open. A modal that traps focus correctly and announces itself
    // correctly is invisible to a scan of the page that merely contains it.
    await page.getByRole('button', { name: 'Delete design' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page, 'design edit (delete dialog open)');
    await page.keyboard.press('Escape');
  } finally {
    await deleteDesign(page, id).catch(() => {});
    await clearUndeliveredBanner(page).catch(() => {});
  }
});
