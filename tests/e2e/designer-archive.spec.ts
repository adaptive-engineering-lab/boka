import { expect, test } from '@playwright/test';

import { createDesign, deleteDesign, saveDesignChanges, signIn } from './helpers/studio';

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
    await saveDesignChanges(laptopPage);

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
    await saveDesignChanges(page);

    await expect(page.getByText('An Entirely New Name').first()).toBeVisible();
    await expect(page.getByText('/d/', { exact: false }).first()).toHaveText(address);
  } finally {
    await deleteDesign(page, id);
  }
});

test('draft thumbnails load in the dashboard', async ({ page }) => {
  /*
   * `/studio/img` is the owner-scoped counterpart to `/img`, and it exists precisely because
   * `/img` is published-gated and the dashboard is mostly drafts.
   *
   * Nothing else in the suite would notice it breaking. Every other studio test asserts on text
   * and form values, so a dashboard rendering a grid of broken tiles — the exact symptom of
   * `/img` being reused by mistake, or of the delivery helper failing — would pass everything and
   * look catastrophic to the designer.
   */
  await signIn(page);
  const id = await createDesign(page, { title: `Thumbnail Subject ${Date.now()}` });

  try {
    await page.goto('/studio');

    const tile = page.locator(`a[href="/studio/designs/${id}"] img`).first();
    await expect(tile).toBeVisible();

    const src = await tile.getAttribute('src');
    expect(src, 'the dashboard must use the owner-scoped route, not the published-gated one').toMatch(
      /^\/studio\/img\//,
    );

    // The browser's own request, with the session cookie — which is the part `next/image`'s
    // optimiser would have stripped, and why these tiles are rendered unoptimised.
    const response = await page.request.get(src!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/');

    // Drafts are the point: this design has never been published.
    expect((await page.request.get(`/img/${src!.split('/')[3]}/640`)).status()).toBe(404);
  } finally {
    await deleteDesign(page, id).catch(() => {});
  }
});

test('the photo pickers open without waiting for JavaScript', async ({ page }) => {
  /*
   * Regression test for a bug a real user hit and the whole suite missed.
   *
   * "Choose from library" used to be a `<button onClick={() => inputRef.current.click()}>`.
   * That is the common pattern for a styled file input and it has a hole: the uploader is a
   * client component, so until React hydrates, the handler does not exist and the click is
   * swallowed **with no feedback whatsoever**. On a phone loading a cold page that window is
   * seconds long, and the designer's experience is simply that the button does nothing.
   *
   * Every existing test missed it by reaching past the control — `setInputFiles` on the
   * input by test id, which never touches the button. The lesson is in the assertion below:
   * drive the thing a person actually clicks.
   *
   * The controls are now `<label htmlFor>`, so the browser opens the picker natively. The
   * two assertions pin exactly that: it works before hydration, and it works with
   * JavaScript switched off entirely.
   */
  await signIn(page);

  // `waitUntil: 'commit'` returns as soon as the response starts, so the click lands while
  // the page is still HTML with no React attached.
  await page.goto('/studio/designs/new', { waitUntil: 'commit' });

  const library = page.getByText('Choose from library', { exact: true });
  await library.waitFor({ state: 'attached', timeout: 30_000 });

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10_000 }),
    library.click({ force: true, noWaitAfter: true }),
  ]);
  expect(chooser.isMultiple(), 'the library picker must accept several photos (FR-006)').toBe(true);

  // One properly named tab stop, not an anonymous input plus a separate button.
  const named = await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="photo-library-input"]');
    return {
      labels: el?.labels?.length ?? 0,
      tabbable: (el?.tabIndex ?? -1) >= 0,
      strayButtons: [...document.querySelectorAll('button')].filter((b) =>
        /Choose from library|Take a photo/.test(b.textContent ?? ''),
      ).length,
    };
  });
  expect(named).toEqual({ labels: 1, tabbable: true, strayButtons: 0 });
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
