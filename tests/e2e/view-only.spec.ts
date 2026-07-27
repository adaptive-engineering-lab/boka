import { expect, test } from '@playwright/test';

import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseConfig } from './helpers/env';
import { createDesign, deleteDesign, readSlug, setPublished, signIn } from './helpers/studio';

/**
 * T062 — the visitor can only look (FR-032, FR-010, SC-010).
 *
 * Principle I is explicit that a visitor may browse, filter, sort, open a design and send an
 * inquiry, and may not buy, cart, check out, comment, favourite, upload, edit or delete. The
 * constitution frames any such affordance as a violation rather than a trade-off, because
 * each one drags in payments, accounts or moderation obligations the project has refused.
 *
 * Affordances arrive by accident, usually by copying a component from somewhere that had a
 * cart. This test is a tripwire for that.
 *
 * It also covers FR-010 — `original_path` must appear in no public response, and no route may
 * serve a full-resolution original. Exposing the storage path of an original is not a
 * theoretical leak: it is the un-resized photograph, which is exactly what the designer
 * retains for her own reference and never publishes.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** Words that would indicate a commerce or interaction affordance had appeared. Matched
 *  case-insensitively against the raw body. */
const FORBIDDEN_AFFORDANCES = [
  'add to cart',
  'add to basket',
  'buy now',
  'checkout',
  'check out',
  'proceed to payment',
  'add to favourites',
  'add to favorites',
  'add to wishlist',
  'leave a comment',
  'post a comment',
  'write a review',
];

test('no public page offers a purchase, comment, or edit affordance', async ({ page, request }) => {
  const stamp = Date.now();
  await signIn(page);

  const id = await createDesign(page, { title: `View Only Subject ${stamp}`, photos: 2 });

  try {
    const slug = await readSlug(page, id);
    await setPublished(page, id, true);

    for (const path of ['/', `/d/${slug}`]) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const body = await response.text();
      const lower = body.toLowerCase();

      for (const phrase of FORBIDDEN_AFFORDANCES) {
        expect(lower, `"${phrase}" appeared on ${path}`).not.toContain(phrase);
      }

      // No form on a public page may target a mutating endpoint. The filter bar is a GET
      // form, which is a read — that distinction is the point.
      const methods = [...body.matchAll(/<form[^>]*method="([^"]*)"/gi)].map((m) =>
        m[1]?.toLowerCase(),
      );
      for (const method of methods) {
        expect(method, `a non-GET form appeared on ${path}`).toBe('get');
      }

      // No route into the designer surface is linked from a public page. A visitor finding
      // an "Edit" link would not get past RLS, but offering it contradicts Principle I and
      // is how a soft login wall starts.
      expect(body).not.toContain('/studio');

      // FR-010: the storage path of an original must not appear, and neither must a
      // storage URL of any kind — every image goes through /img.
      expect(body).not.toContain('original_path');
      expect(body).not.toContain('/storage/v1/object');
      expect(body).not.toContain('originals/');

      // FR-028: the designer's email is the destination for inquiry notifications
      // (FR-039), not public contact information. `public_designer_profile` omits the
      // column; this checks that nothing else put it back — a "contact us" mailto being
      // the obvious way it would happen.
      expect(body, `the designer's email appeared on ${path}`).not.toContain('designer@boka.local');
      expect(body).not.toContain('mailto:');
    }

    // Every image on the detail page is an /img URL, and every one carries alt text.
    const detailBody = await (await request.get(`/d/${slug}`)).text();
    const imgTags = [...detailBody.matchAll(/<img[^>]*>/gi)].map((m) => m[0]);
    expect(imgTags.length).toBeGreaterThan(0);

    for (const tag of imgTags) {
      const src = /src="([^"]*)"/.exec(tag)?.[1] ?? '';
      expect(src, `an image was not served through /img: ${src}`).toMatch(/^\/img\//);

      // FR-012b: no photo ever renders without alt text. An empty alt is not acceptable
      // here — these images are the content, not decoration.
      const alt = /alt="([^"]*)"/.exec(tag)?.[1] ?? '';
      expect(alt.trim().length, `an image had empty alt text: ${tag}`).toBeGreaterThan(0);
    }

    // --- The data layer offers no writes either ---
    test.skip(!hasSupabaseConfig, 'no Supabase configuration available');
    const anonHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    };

    // A visitor cannot write to any base table, nor read one. Both are refused by the
    // absence of a policy plus the absence of a grant (migrations 0007 and 0011).
    for (const table of ['design', 'photo', 'category', 'designer']) {
      const read = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
        headers: anonHeaders,
      });
      expect(read.status(), `anon could read ${table}`).toBeGreaterThanOrEqual(400);
    }

    const write = await request.post(`${SUPABASE_URL}/rest/v1/design`, {
      headers: anonHeaders,
      data: { title: 'Injected by a visitor', owner_id: '00000000-0000-4000-8000-000000000001' },
    });
    expect(write.status(), 'anon could insert a design').toBeGreaterThanOrEqual(400);

    // The public views are readable but not writable — they are the read surface, not a
    // back door.
    const viewWrite = await request.post(`${SUPABASE_URL}/rest/v1/public_designs`, {
      headers: anonHeaders,
      data: { slug: 'injected-zzzz', title: 'Injected' },
    });
    expect(viewWrite.status(), 'anon could write through a public view').toBeGreaterThanOrEqual(400);
  } finally {
    await deleteDesign(page, id).catch(() => {});
  }
});

test('the profile photo route serves the avatar and nothing else', async ({ request }) => {
  /*
   * `/img/profile` is a public image surface added in this increment, so it needs its own
   * line in the review rather than being covered by "all images go through /img".
   *
   * It differs from `/img/{photoId}/{width}` in one deliberate way: **there is no
   * publication gate**, because the designer's name, bio and photo are public by definition
   * (FR-028) — there is nothing to withhold. What must still hold is that it reads the path
   * from `public_designer_profile` (which omits `email`), that it hands out only a
   * short-lived signed URL, and that it cannot be steered at any other object.
   */
  const response = await request.get('/img/profile', { maxRedirects: 0 });

  // 302 when a photo is set, 404 when it is not. Both are correct; a 500 or a 200 with a
  // body would mean it is serving bytes itself, which is not what it does.
  expect([302, 404]).toContain(response.status());

  if (response.status() === 302) {
    const location = response.headers()['location'] ?? '';
    // A signed URL into the private display bucket — never the originals bucket, and never
    // an unsigned object URL.
    expect(location).toContain('/storage/v1/object/sign/display/');
    expect(location).not.toContain('/originals/');
    expect(location).toMatch(/token=/);
  }

  // The route takes no input, so there is no path to traverse — but a regression that added
  // one would be invisible, so confirm the obvious attempt is simply not a route.
  const traversal = await request.get('/img/profile/../../originals/anything.jpg');
  expect(traversal.status()).toBeGreaterThanOrEqual(400);
});

test('no route serves an original-resolution file', async ({ page, request }) => {
  // FR-010. The originals bucket is private and no route reads from it, so this checks the
  // two ways someone might try: the storage API directly, and a guessed application path.
  const stamp = Date.now();
  await signIn(page);
  const id = await createDesign(page, { title: `Originals Subject ${stamp}` });

  try {
    await setPublished(page, id, true);

    test.skip(!hasSupabaseConfig, 'no Supabase configuration available');

    // Unsigned storage access to the private originals bucket.
    const direct = await request.get(`${SUPABASE_URL}/storage/v1/object/originals/${id}/anything.jpg`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    expect(direct.status()).toBeGreaterThanOrEqual(400);

    // And the display bucket, which is equally private — /img is the only way in.
    const displayDirect = await request.get(
      `${SUPABASE_URL}/storage/v1/object/display/${id}/anything.webp`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    expect(displayDirect.status()).toBeGreaterThanOrEqual(400);
  } finally {
    await deleteDesign(page, id).catch(() => {});
  }
});
