import { expect, test } from '@playwright/test';

import { canonicalizeBody } from './helpers/canonical';

import {
  addCategory,
  createDesign,
  deleteDesign,
  saveDesignChanges,
  setPublished,
  signIn,
} from './helpers/studio';

/**
 * T063 — a draft-only category never reaches a public filter control (FR-030a).
 *
 * ============================================================================
 * This is the subtlest leak in the specification, and the easiest one to build by accident.
 *
 * Every design is hidden correctly, the grid is right, the detail pages 404 as they should —
 * and the category dropdown says "Bridal". There are no bridal designs published. A visitor
 * selects it, gets an empty grid, and now knows the designer is working on a bridal
 * collection she has told nobody about. **The absence of designs is the disclosure.**
 *
 * The fix is in the view, not in this component: `public_categories` joins to published
 * designs, so a category with nothing published has no row to return. That is why this test
 * asserts on the *rendered filter control* rather than on the query — the query is already
 * right, and what needs guarding is that nobody later "improves" the dropdown by sourcing it
 * from the category table, which is where the names obviously live.
 * ============================================================================
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test('a category used only by drafts is absent from the public filter', async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const secretCategory = `Bridal${stamp}`;
  const openCategory = `Daywear${stamp}`;

  await signIn(page);

  // Two categories, both created by the designer.
  await addCategory(page, secretCategory);
  await addCategory(page, openCategory);

  const draftId = await createDesign(page, {
    title: `Unreleased Bridal ${stamp}`,
    collection: `SecretCollection${stamp}`,
  });
  const publishedId = await createDesign(page, {
    title: `Everyday Dress ${stamp}`,
    collection: `OpenCollection${stamp}`,
  });

  try {
    // File the draft under the secret category and leave it unpublished.
    await page.goto(`/studio/designs/${draftId}`);
    await page.getByLabel('Category').selectOption({ label: secretCategory });
    await saveDesignChanges(page);

    // File the other under the open category and publish it, so the control is populated —
    // a filter bar that renders nothing would pass this test for the wrong reason.
    await page.goto(`/studio/designs/${publishedId}`);
    await page.getByLabel('Category').selectOption({ label: openCategory });
    await saveDesignChanges(page);
    await setPublished(page, publishedId, true);

    const body = await (await request.get('/')).text();

    // CONTROL: the published category IS offered, so the control is genuinely rendering.
    expect(body, 'control: the published category should appear in the filter').toContain(
      openCategory,
    );
    expect(body).toContain(`OpenCollection${stamp}`);

    // THE ASSERTION: the draft-only category and collection are absent everywhere in the
    // response — dropdown, hydration payload, anywhere.
    expect(body, 'a draft-only category leaked into the public filter').not.toContain(
      secretCategory,
    );
    expect(body, 'a draft-only collection leaked into the public filter').not.toContain(
      `SecretCollection${stamp}`,
    );
    expect(body).not.toContain(`Unreleased Bridal ${stamp}`);

    // Filtering by the secret category by hand must return the same empty state as any other
    // unmatched value — not an error, and not a hint that the category exists.
    const guessed = await request.get(`/?category=${encodeURIComponent(secretCategory)}`);
    expect(guessed.status()).toBe(200);
    const guessedBody = await guessed.text();
    expect(guessedBody).not.toContain(`Unreleased Bridal ${stamp}`);

    const nonsense = await request.get('/?category=NoSuchCategoryAtAll');
    expect(nonsense.status()).toBe(200);

    // Both unmatched filters produce the same state: a real-but-unpublished category is
    // indistinguishable from one that was never created.
    expect(canonicalizeBody(guessedBody, [secretCategory])).toBe(
      canonicalizeBody(await nonsense.text(), ['NoSuchCategoryAtAll']),
    );

    // Publishing the draft makes its category appear — proving the join is doing the work
    // rather than the name being filtered out by something incidental.
    await setPublished(page, draftId, true);
    const afterPublish = await (await request.get('/')).text();
    expect(afterPublish).toContain(secretCategory);
  } finally {
    await deleteDesign(page, draftId).catch(() => {});
    await deleteDesign(page, publishedId).catch(() => {});

    // Categories are only removable once nothing uses them, which is now the case.
    await page.goto('/studio/categories').catch(() => {});
    for (const name of [secretCategory, openCategory]) {
      const row = page.locator('li').filter({ hasText: name });
      const button = row.getByRole('button', { name: 'Remove' });
      if (await button.count())
        await button
          .first()
          .click()
          .catch(() => {});
    }
  }
});
