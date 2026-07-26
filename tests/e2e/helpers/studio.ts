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

export async function deleteDesign(page: Page, id: string): Promise<void> {
  await page.goto(`/studio/designs/${id}`);
  await page.getByRole('button', { name: 'Delete design' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete design' }).click();
  await page.waitForURL('**/studio');
}
