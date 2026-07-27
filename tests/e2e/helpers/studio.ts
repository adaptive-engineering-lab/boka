import type { Page } from '@playwright/test';
import sharp from 'sharp';

/** Seeded owner credentials (supabase/seed.sql). Overridable so the suite can run against
 *  a non-local stack without editing the test. */
export const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? 'designer@boka.local';
export const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? 'boka-local-dev';

/**
 * A real JPEG, generated rather than committed.
 *
 * The upload path runs `sharp` for real — decode, orientation, resize, LQIP — so a
 * placeholder byte string would be rejected at the first step and the test would pass or
 * fail for reasons unrelated to what it is checking. Generating it keeps the repository
 * free of binary fixtures and lets each test use a distinct colour, which makes a
 * cross-contaminated thumbnail obvious.
 */
export async function makeJpeg(
  colour: { r: number; g: number; b: number } = { r: 120, g: 90, b: 70 },
): Promise<Buffer> {
  return sharp({
    create: { width: 900, height: 1200, channels: 3, background: colour },
  })
    .jpeg({ quality: 70 })
    .toBuffer();
}

export async function signIn(page: Page): Promise<void> {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(OWNER_EMAIL);
  await page.getByLabel('Password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Waits for the dashboard heading, not just the URL. The sign-in action answers with a
  // 303 and the App Router finishes the navigation client-side, so the URL changes before
  // the destination has settled — a `waitForURL` alone returns early and the next
  // `page.goto` gets cancelled by the still-in-flight navigation (ERR_ABORTED).
  await page.getByRole('heading', { name: 'Your designs' }).waitFor({ timeout: 30_000 });
}

/**
 * Creates a design through the actual form and returns its id.
 *
 * Deliberately not seeded through the database: the point of SC-008 is that what the
 * designer *does* on one device is what she *finds* on another, and a row inserted behind
 * the interface would skip the entire upload path this is meant to exercise.
 */
export async function createDesign(
  page: Page,
  options: { title: string; notes?: string; collection?: string; photos?: number },
): Promise<string> {
  await page.goto('/studio/designs/new');
  await page.getByLabel('Title').fill(options.title);

  if (options.collection) {
    await page.getByLabel(/Collection/).fill(options.collection);
  }
  if (options.notes) {
    await page.getByLabel(/Private notes/).fill(options.notes);
  }

  const files = [];
  for (let index = 0; index < (options.photos ?? 1); index += 1) {
    files.push({
      name: `photo-${index + 1}.jpg`,
      mimeType: 'image/jpeg',
      buffer: await makeJpeg({ r: 40 + index * 60, g: 90, b: 140 }),
    });
  }

  await page.getByTestId('photo-library-input').setInputFiles(files);
  await page.getByRole('button', { name: 'Save design' }).click();

  // Image processing is real work; the default assertion timeout is not enough on a cold
  // sharp start.
  await page.waitForURL(/\/studio\/designs\/[0-9a-f-]{36}/, { timeout: 60_000 });

  const match = /\/studio\/designs\/([0-9a-f-]{36})/.exec(page.url());
  if (!match?.[1]) throw new Error(`Could not read the design id from ${page.url()}`);
  return match[1];
}

/**
 * Publishes or unpublishes through the real toggle (FR-026).
 *
 * Driven through the interface rather than by flipping the column directly, because the
 * revalidation the toggle performs is part of what makes withdrawal take effect — a test
 * that wrote the column would pass while the storefront kept serving a cached page.
 */
export async function setPublished(page: Page, id: string, publish: boolean): Promise<void> {
  await page.goto(`/studio/designs/${id}`);
  await page.getByRole('button', { name: publish ? 'Publish' : 'Unpublish' }).click();

  // The toggle re-renders in place, so wait for the state text rather than a navigation.
  await page
    .getByText(publish ? 'Live on your storefront' : 'Not on your storefront')
    .waitFor({ timeout: 30_000 });
}

/**
 * Saves the edit form and waits for the confirmation, not for the URL.
 *
 * `waitForURL(/saved=1/)` looks equivalent and is not. A server action answers with a 303 and
 * the App Router completes the navigation client-side, so the URL updates before the
 * destination has settled — the next `page.goto` then races the in-flight navigation and dies
 * with "interrupted by another navigation". It passes on Chromium and fails on WebKit, which
 * is the worst kind of flake: green locally, red on the engine iOS Safari actually uses.
 * Waiting on rendered content means the page is genuinely ready.
 */
export async function saveDesignChanges(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Changes saved.').waitFor({ timeout: 30_000 });
}

/** Adds a category and waits for the confirmation, for the same reason as above. */
export async function addCategory(page: Page, name: string): Promise<void> {
  await page.goto('/studio/categories');
  await page.getByLabel('New category').fill(name);
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByText('Category added.').waitFor({ timeout: 30_000 });
}

/** Reads the design's public slug off the edit page. */
export async function readSlug(page: Page, id: string): Promise<string> {
  await page.goto(`/studio/designs/${id}`);
  const text = await page.locator('code').first().innerText();
  const match = /\/d\/(\S+)/.exec(text);
  if (!match?.[1]) throw new Error(`Could not read a slug from "${text}"`);
  return match[1];
}

/**
 * A slug that certainly does not exist, of **exactly the same length and shape** as a real
 * one.
 *
 * Length matters: FR-023 requires a draft and a nonexistent design to be indistinguishable,
 * and if the probe slug were a different length the two 404s would differ in
 * `Content-Length` for a reason that has nothing to do with a leak. Matching the shape makes
 * the byte-comparison in `draft-invisibility.spec.ts` a genuinely strict assertion.
 */
export function absentSlugLike(slug: string): string {
  // Mutate only the 4-character random suffix, keeping the title stem and the total length.
  const stem = slug.slice(0, -4);
  const suffix = slug.slice(-4);
  return `${stem}${suffix === 'zzzz' ? 'qqqq' : 'zzzz'}`;
}

/**
 * Deletes a design, tolerating one that is already gone.
 *
 * The bounded wait is not defensive padding. Called from a `finally` block after an
 * assertion has failed, an unbounded locator wait sits there until the *test* timeout and
 * Playwright then reports "test timeout" instead of the assertion that actually broke —
 * turning every failure in a spec that cleans up into an unreadable one. Ask for the button
 * briefly; if the design is gone, so is the button, and there is nothing to do.
 */
export async function deleteDesign(page: Page, id: string): Promise<void> {
  await page.goto(`/studio/designs/${id}`);

  const trigger = page.getByRole('button', { name: 'Delete design' }).first();
  try {
    await trigger.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    return; // Already deleted.
  }

  await trigger.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete design' }).click();
  await page.waitForURL('**/studio', { timeout: 30_000 });
}
