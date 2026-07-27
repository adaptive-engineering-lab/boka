import { expect, test } from '@playwright/test';

import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseConfig } from './helpers/env';
import {
  createDesign,
  deleteDesign,
  readSlug,
  saveDesignChanges,
  setPublished,
  signIn,
} from './helpers/studio';

/**
 * T061 — **MANDATORY** (constitution, Quality Gates). FR-024, SC-003.
 *
 * ============================================================================
 * `notes` must appear in no public response. Not "must not be displayed" — must not be
 * *present*.
 *
 * The distinction is the whole test. A field serialized into a hydration payload, a `<meta>`
 * tag, or an RSC flight stream and never rendered on screen has still been handed to every
 * visitor and every crawler. It looks perfect in a browser and leaks completely. So every
 * assertion below runs against a **raw response body**, never against the rendered DOM.
 *
 * What is in `notes` is fabric, suppliers and body measurements. The constitution calls
 * leaking one the worst outcome this application can produce, and it is right: it is personal
 * data about the designer's clients that nobody consented to publish.
 *
 * Four surfaces are checked, because a leak only needs one:
 *   1. the storefront HTML;
 *   2. the detail page HTML, including `<meta>` and JSON-LD;
 *   3. the RSC flight payload, which is where a field travels without being rendered;
 *   4. the data layer itself, queried with the anon key a browser actually holds.
 *
 * The first assertion is a **control**: it confirms the sentinel really was stored. Without
 * it, a typo in the fixture would make every "does not contain" assertion pass while proving
 * nothing at all.
 * ============================================================================
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test('private notes appear in no public response body', async ({ page, request }) => {
  const stamp = Date.now();
  // Shaped like the real thing: measurements and a supplier. Distinctive enough that a
  // substring match cannot collide with framework output.
  const sentinel = `NOTESLEAK${stamp}bust34waist26silkcrepeTuesdaySupplier`;
  const publicText = `PUBLICTEXT${stamp}`;

  await signIn(page);

  const id = await createDesign(page, {
    title: `Notes Privacy Subject ${stamp}`,
    notes: sentinel,
  });

  try {
    // --- CONTROL: the sentinel is genuinely stored and visible to the owner. ---
    await page.goto(`/studio/designs/${id}`);
    await expect(
      page.getByLabel(/Private notes/),
      'control: if the sentinel was never stored, every assertion below is vacuous',
    ).toHaveValue(sentinel);

    // Give the design a public description too, so the test also proves the *public* field
    // does come through — otherwise "no free text reaches the page" would pass trivially.
    await page.getByLabel(/Public description/).fill(publicText);
    await saveDesignChanges(page);

    const slug = await readSlug(page, id);
    await setPublished(page, id, true);

    // --- 1. Storefront HTML ---
    const home = await request.get('/');
    expect(home.status()).toBe(200);
    const homeBody = await home.text();
    expect(homeBody).toContain(`Notes Privacy Subject ${stamp}`); // it is published
    expect(homeBody, 'notes leaked into the storefront HTML').not.toContain(sentinel);

    // --- 2. Detail page HTML, meta tags included ---
    const detail = await request.get(`/d/${slug}`);
    expect(detail.status()).toBe(200);
    const detailBody = await detail.text();

    expect(detailBody).toContain(publicText); // public_description IS rendered (FR-025)
    expect(detailBody, 'notes leaked into the detail page HTML').not.toContain(sentinel);

    // The meta description must be built from `public_description`, never `notes`.
    const metaDescription =
      /<meta name="description" content="([^"]*)"/.exec(detailBody)?.[1] ?? '';
    expect(metaDescription).not.toContain(sentinel);

    // --- 3. The RSC flight payload — a field can travel here without being rendered ---
    for (const headers of [{ RSC: '1' }, { 'Next-Router-Prefetch': '1', RSC: '1' }]) {
      const flight = await request.get(`/d/${slug}`, { headers });
      const flightBody = await flight.text();
      expect(
        flightBody,
        `notes leaked into the RSC payload (${JSON.stringify(headers)})`,
      ).not.toContain(sentinel);
    }

    const homeFlight = await request.get('/', { headers: { RSC: '1' } });
    expect(await homeFlight.text()).not.toContain(sentinel);

    // --- 4. The data layer, with the key every browser is given ---
    test.skip(!hasSupabaseConfig, 'no Supabase configuration available');

    const anonHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

    // The view does not have the column, so asking for it must fail rather than return it.
    const selectNotes = await request.get(`${SUPABASE_URL}/rest/v1/public_designs?select=notes`, {
      headers: anonHeaders,
    });
    expect(selectNotes.status()).toBeGreaterThanOrEqual(400);

    // And `select=*` must not smuggle it in — this is what makes an explicit column list
    // in the view superior to fetching a row and stripping fields (Principle II).
    const selectAll = await request.get(`${SUPABASE_URL}/rest/v1/public_designs?select=*`, {
      headers: anonHeaders,
    });
    expect(selectAll.status()).toBe(200);
    const viewBody = await selectAll.text();
    expect(viewBody).not.toContain(sentinel);

    // Checked as JSON keys, not as a substring: the slug of a design titled "Notes Privacy
    // Subject" legitimately contains the word "notes", and a naive text match fails on that
    // while proving nothing. What matters is that no row carries the *column*.
    const rows: Array<Record<string, unknown>> = JSON.parse(viewBody);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('notes');
      // The same view must also withhold everything else Principle II calls private.
      for (const forbidden of [
        'owner_id',
        'view_count',
        'seo_title',
        'seo_description',
        'updated_at',
      ]) {
        expect(Object.keys(row), `public_designs exposed ${forbidden}`).not.toContain(forbidden);
      }
    }

    // The base table must refuse the anon key outright (migration 0007).
    const baseTable = await request.get(`${SUPABASE_URL}/rest/v1/design?select=notes`, {
      headers: anonHeaders,
    });
    expect(
      baseTable.status(),
      'the `design` base table must be unreachable with the anon key',
    ).toBeGreaterThanOrEqual(400);
  } finally {
    await deleteDesign(page, id).catch(() => {});
  }
});
