import { expect, test } from '@playwright/test';

import { createDesign, deleteDesign, signIn } from './helpers/studio';

/**
 * T050 — the archive is the same from any device (SC-008, FR-020, Principle IV).
 *
 * ============================================================================
 * What this is really testing is that nothing important lives in the browser.
 *
 * Principle IV says the designer's archive is the product and cannot be hostage to one
 * phone. The way that promise breaks is never dramatic: some piece of state — a draft
 * being composed, a filter, an ordering, an uploaded photo held in memory — quietly ends
 * up in local storage or component state and is served from there on the device that
 * created it. Everything looks correct until she opens the site somewhere else.
 *
 * A single-context test cannot see that, because the device that wrote the data is the
 * device doing the reading. So this uses two fully independent browser contexts with
 * separate cookie jars and storage, signs in to both, and checks that the second sees
 * exactly what the first did — including after an edit and after a delete.
 * ============================================================================
 */

// Each test creates and removes its own designs; running them together against one seeded
// account makes the counts unreliable.
test.describe.configure({ mode: 'serial' });

// The default 30s is not enough: this walks two sign-ins, three real image uploads through
// sharp, an edit and two deletes. A generous ceiling here is not papering over slowness —
// the individual assertions still have their own timeouts, so a genuine hang still fails
// promptly rather than sitting until this expires.
test.setTimeout(180_000);

test('an archive built on one device is identical on another', async ({ browser }) => {
  const phone = await browser.newContext();
  const laptop = await browser.newContext();

  const phonePage = await phone.newPage();
  const laptopPage = await laptop.newPage();

  const stamp = Date.now();
  const title = `Parity Gown ${stamp}`;
  const secondTitle = `Parity Coat ${stamp}`;

  try {
    await signIn(phonePage);

    const designId = await createDesign(phonePage, {
      title,
      collection: `Parity ${stamp}`,
      notes: 'Private: 34-26-36, silk crepe from the Tuesday supplier.',
      photos: 2,
    });
    const secondId = await createDesign(phonePage, { title: secondTitle });

    // --- The second device. Separate context: no cookies, no storage, nothing shared. ---
    await signIn(laptopPage);
    await laptopPage.goto('/studio');

    await expect(laptopPage.getByText(title)).toBeVisible();
    await expect(laptopPage.getByText(secondTitle)).toBeVisible();

    // Both arrive as drafts (FR-021) — the default has to survive the round trip too.
    await laptopPage.goto(`/studio/designs/${designId}`);
    await expect(laptopPage.getByText('Draft').first()).toBeVisible();

    // Everything the phone typed, including the private notes, is on the laptop.
    await expect(laptopPage.getByLabel(/Private notes/)).toHaveValue(
      'Private: 34-26-36, silk crepe from the Tuesday supplier.',
    );
    await expect(laptopPage.getByLabel(/Collection/)).toHaveValue(`Parity ${stamp}`);

    // Both photos made the trip.
    await expect(laptopPage.getByRole('listitem').filter({ hasText: 'Describe this photo' })).toHaveCount(2);

    // --- Edit on the laptop, read it back on the phone. ---
    const editedTitle = `${title} (revised)`;
    await laptopPage.getByLabel('Title').fill(editedTitle);
    await laptopPage.getByRole('button', { name: 'Save changes' }).click();
    await laptopPage.waitForURL(/saved=1/);

    await phonePage.goto('/studio');
    await expect(phonePage.getByText(editedTitle)).toBeVisible();

    // --- Delete on the phone, confirm it is gone from the laptop. ---
    await deleteDesign(phonePage, secondId);

    await laptopPage.goto('/studio');
    await expect(laptopPage.getByText(secondTitle)).toHaveCount(0);
    // The other design is untouched — a delete that took a neighbour with it would be a
    // far worse failure than one that did nothing.
    await expect(laptopPage.getByText(editedTitle)).toBeVisible();

    await deleteDesign(laptopPage, designId);
  } finally {
    await phone.close();
    await laptop.close();
  }
});

test('a rename does not change the design’s public address', async ({ page }) => {
  // FR-023b, checked here rather than only in the integration suite because the trigger
  // guaranteeing it is invisible from the interface — the designer's evidence that her
  // shared links still work is this line of the edit screen.
  await signIn(page);

  const id = await createDesign(page, { title: `Slug Subject ${Date.now()}` });

  try {
    const address = await page.getByText('/d/', { exact: false }).first().innerText();

    await page.getByLabel('Title').fill('An Entirely New Name');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForURL(/saved=1/);

    await expect(page.getByText('An Entirely New Name').first()).toBeVisible();
    await expect(page.getByText('/d/', { exact: false }).first()).toHaveText(address);
  } finally {
    await deleteDesign(page, id);
  }
});

test('a design cannot be created without a photo', async ({ page }) => {
  // FR-013a. The rule is enforced server-side in `createDesign`, but the form states it
  // before spending an upload — and a regression that silently created a photoless design
  // would only surface as a broken tile on the public grid.
  await signIn(page);

  await page.goto('/studio/designs/new');
  await page.getByLabel('Title').fill('Photoless Attempt');
  await page.getByRole('button', { name: 'Save design' }).click();

  // Matched by text rather than by role: Next renders its own always-present
  // `role="alert"` route announcer, so a bare role query is ambiguous on every page.
  await expect(page.getByText('Add at least one photo', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/studio\/designs\/new/);
});
