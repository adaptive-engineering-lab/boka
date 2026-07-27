import { expect, test } from '@playwright/test';

import { canonicalizeBody } from './helpers/canonical';
import {
  absentSlugLike,
  createDesign,
  deleteDesign,
  readSlug,
  setPublished,
  signIn,
} from './helpers/studio';

/**
 * T060 — **MANDATORY** (constitution, Quality Gates). FR-023, FR-009a, SC-002, SC-017.
 *
 * ============================================================================
 * Two promises are checked here, and the second one is the reason this file exists.
 *
 * **1. A draft is indistinguishable from a design that never existed.** Not merely absent
 * from the grid — unreachable by its exact URL, and answering identically to a slug nobody
 * ever used. A visitor who can tell "unpublished" from "nonexistent" can enumerate
 * unreleased work, which is the disclosure FR-023 forbids.
 *
 * **2. An image URL captured while a design was published stops working when it is
 * withdrawn.** This is the assertion that would have caught the original defect. Display
 * variants used to live in a *public* storage bucket: RLS gated the `photo` row while the
 * storage object stayed world-readable, so once a design had been published its photograph
 * was downloadable forever by anyone holding the link. Unpublishing removed the design from
 * the storefront and did nothing to the image. Nothing in the original test plan would have
 * noticed — every test asserted on pages, and the leak was in an object.
 *
 * So this test does what an adversary would: it saves the image URL while it works, then
 * checks it after unpublish and again after delete.
 * ============================================================================
 *
 * Anonymous requests go through the `request` fixture, which has its own empty cookie jar.
 * Using `page.request` would inherit the signed-in session and quietly test the wrong thing.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** See `helpers/canonical.ts` for exactly what is normalized and why: the visitor's own
 *  requested slug, and the non-deterministic order of React's streamed flight chunks.
 *  Nothing rendered is touched, so a 404 that mentions a draft still fails. */
const normalize = (body: string, slug: string) => canonicalizeBody(body, [slug]);

test('a draft is unreachable and indistinguishable from a nonexistent design', async ({
  page,
  request,
}) => {
  await signIn(page);

  const id = await createDesign(page, { title: `Invisible Piece ${Date.now()}` });
  const slug = await readSlug(page, id);
  const absent = absentSlugLike(slug);

  // Same length and shape, so Content-Length cannot differ for an innocent reason.
  expect(absent).toHaveLength(slug.length);

  try {
    // --- While it is a draft ---
    const draftResponse = await request.get(`/d/${slug}`);
    const absentResponse = await request.get(`/d/${absent}`);

    expect(draftResponse.status()).toBe(404);
    expect(absentResponse.status()).toBe(404);

    const draftBody = await draftResponse.text();
    const absentBody = await absentResponse.text();

    // THE ASSERTION. Identical once the echoed path is accounted for.
    expect(normalize(draftBody, slug)).toBe(normalize(absentBody, absent));

    // The draft's title must not appear in either response — a 404 that leaks the title of
    // the thing it is refusing to serve has refused nothing.
    expect(draftBody).not.toContain('Invisible Piece');

    // Absent from the grid too (FR-022).
    const home = await request.get('/');
    expect(await home.text()).not.toContain('Invisible Piece');

    // --- Publish, and capture an image URL the way a visitor would ---
    await setPublished(page, id, true);

    const published = await request.get(`/d/${slug}`);
    expect(published.status()).toBe(200);
    const publishedBody = await published.text();
    expect(publishedBody).toContain('Invisible Piece');

    const imageMatch = /\/img\/[0-9a-f-]{36}\/\d+/.exec(publishedBody);
    expect(imageMatch, 'the detail page should serve images through /img').not.toBeNull();
    const imageUrl = imageMatch![0];

    // It works now — 302 to a signed URL, followed to the bytes.
    const liveImage = await request.get(imageUrl);
    expect(liveImage.status()).toBe(200);
    expect(liveImage.headers()['content-type']).toContain('image/');

    // --- Unpublish. The captured URL must stop working. ---
    await setPublished(page, id, false);

    const revokedImage = await request.get(imageUrl);
    expect(
      revokedImage.status(),
      'an image URL captured while published must 404 after unpublish — this is the public-bucket defect',
    ).toBe(404);

    const backToDraft = await request.get(`/d/${slug}`);
    expect(backToDraft.status()).toBe(404);
    expect(normalize(await backToDraft.text(), slug)).toBe(normalize(absentBody, absent));

    const homeAfter = await request.get('/');
    expect(await homeAfter.text()).not.toContain('Invisible Piece');

    // --- Republish, then delete. The URL must stop working again, permanently. ---
    await setPublished(page, id, true);
    expect((await request.get(imageUrl)).status()).toBe(200);

    await deleteDesign(page, id);

    expect(
      (await request.get(imageUrl)).status(),
      'a deleted design’s image URL must 404 — the row cascade does not remove the object, so the route must refuse it',
    ).toBe(404);

    const deletedPage = await request.get(`/d/${slug}`);
    expect(deletedPage.status()).toBe(404);
    // Deleted, draft, and nonexistent: all three now answer the same way.
    expect(normalize(await deletedPage.text(), slug)).toBe(normalize(absentBody, absent));
  } finally {
    // The delete may not have run if an assertion failed earlier.
    await deleteDesign(page, id).catch(() => {});
  }
});

test('no public route ever asks a visitor to authenticate', async ({ request }) => {
  // Principle I. A soft login wall on a public route is a violation, not a trade-off, and it
  // is the kind of thing that arrives by accident — one over-broad middleware matcher.
  for (const path of ['/', '/d/does-not-exist-zzzz']) {
    const response = await request.get(path);
    const body = await response.text();

    expect([200, 404]).toContain(response.status());
    expect(body).not.toContain('/auth/sign-in');
    expect(body.toLowerCase()).not.toContain('sign in to');

    // No session cookie is set for a visitor (FR-004).
    const setCookie = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
    for (const cookie of setCookie) {
      expect(cookie.value).not.toContain('sb-');
    }
  }
});
