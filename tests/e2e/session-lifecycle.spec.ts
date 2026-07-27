import { expect, test, type Page } from '@playwright/test';

import { canonicalizeBody } from './helpers/canonical';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './helpers/env';
import { createDesign, deleteDesign, readSlug, setPublished, signIn } from './helpers/studio';

/**
 * T085 and T086 — FR-001a (ending a session) and FR-002a (the way back).
 *
 * Both requirements came from using the application rather than from analysis: the spec
 * covered getting into the authenticated surface and said nothing about getting out of it, or
 * about getting back to it from the storefront.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test('signing out ends the session server-side', async ({ page, request }) => {
  /*
   * T085 — FR-001a.
   *
   * The failure this guards against is a sign-out that only *looks* like one. Clearing cookies
   * in the browser satisfies every naive test — the designer is bounced to sign-in, the studio
   * is unreachable, everything appears correct — while the refresh token stays valid at the
   * auth server. On the borrowed laptop this requirement exists for, that is the difference
   * between having signed out and believing you have.
   *
   * So this asserts on the token, not only on the redirect.
   */
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();

  // Capture the refresh token before signing out, so it can be tested directly afterwards.
  //
  // It comes from the COOKIE, not localStorage. `@supabase/ssr` keeps the session in a cookie
  // so the server can read it, and the first version of this test looked in localStorage —
  // found nothing, skipped the whole assertion behind an `if`, and passed while checking
  // precisely nothing. Hence `expect(...).toBeTruthy()` below: if extraction ever breaks
  // again, this test fails loudly instead of quietly becoming a no-op.
  const refreshToken = await readRefreshToken(page);
  expect(refreshToken, 'could not read the session cookie — the assertion below would be vacuous').toBeTruthy();

  await page.getByRole('button', { name: 'Sign out' }).click();

  // Lands on the storefront, not on a login form — a signed-out person is simply a visitor.
  await page.waitForURL((url) => url.pathname === '/', { timeout: 30_000 });

  // The studio is no longer reachable.
  await page.goto('/studio');
  await expect(page).toHaveURL(/\/auth\/sign-in/);

  // THE ASSERTION: the refresh token is genuinely revoked, not merely forgotten.
  //
  // This is what separates a real sign-out from a cosmetic one. A token that still mints
  // access tokens after the designer believes she has signed out is exactly the exposure
  // FR-001a exists to close, and it is invisible from inside the browser — every other
  // assertion in this test would pass with the token still live. `signOut()` defaults to
  // global scope for this reason.
  const response = await request.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { refresh_token: refreshToken },
    },
  );

  expect(
    response.status(),
    'the refresh token still works — sign-out cleared the browser but not the server',
  ).toBeGreaterThanOrEqual(400);
});

/**
 * Reads the refresh token out of the Supabase session cookie.
 *
 * `@supabase/ssr` stores the session in a cookie rather than localStorage so the server can
 * read it, chunks it across `.0`/`.1` suffixes when it exceeds the size limit, and may prefix
 * the value with `base64-`. All three have to be handled or the token comes back unparseable.
 */
async function readRefreshToken(page: Page): Promise<string | null> {
  const cookies = (await page.context().cookies())
    .filter((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))
    .sort((a, b) => a.name.localeCompare(b.name)); // `.0` before `.1`

  if (cookies.length === 0) return null;

  let raw = cookies.map((c) => c.value).join('');
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* already decoded */
  }
  if (raw.startsWith('base64-')) {
    raw = Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8');
  }

  try {
    return JSON.parse(raw)?.refresh_token ?? null;
  } catch {
    return null;
  }
}

test('the owner bar is invisible to visitors and changes nothing for them', async ({
  page,
  request,
}) => {
  /*
   * T086 — FR-002a, and this phase's constitutional guard.
   *
   * FR-002a is a deliberate exception to "the public surface shows nothing about
   * authentication". The only thing keeping it narrow is the third constraint: an
   * unauthenticated response must be unchanged. Everything else about the feature could be
   * right and it would still be a Principle I violation if a visitor's page shifted because
   * the designer happened to be signed in somewhere.
   *
   * Asserting "the bar is absent for visitors" is not enough — that would pass while the page
   * changed in some other way. So this captures the anonymous response, signs in, confirms the
   * response *does* change for her, signs out, and requires the anonymous response to come back
   * **byte-identical to the original capture**. A real before/after within one run, rather than
   * a comparison against a build that no longer exists.
   */
  const stamp = Date.now();
  await signIn(page);
  const id = await createDesign(page, { title: `Owner Bar Subject ${stamp}` });

  try {
    const slug = await readSlug(page, id);
    await setPublished(page, id, true);

    // --- BEFORE: the anonymous view, captured. `request` has its own empty cookie jar. ---
    const beforeHome = await (await request.get('/')).text();
    const beforeDetail = await (await request.get(`/d/${slug}`)).text();

    for (const [path, body] of [
      ['/', beforeHome],
      [`/d/${slug}`, beforeDetail],
    ] as const) {
      expect(body, `the owner bar leaked to a visitor on ${path}`).not.toContain('Back to the studio');
      expect(body).not.toContain('viewing your storefront');
      // Constraint 2: nothing tells a visitor an authenticated surface exists.
      expect(body).not.toContain('/studio');
      expect(body).not.toContain('/auth/sign-in');
    }

    // --- The designer, on the same URLs, does get the bar. Otherwise the test above would
    //     pass on a feature that never worked at all. ---
    await page.goto('/');
    await expect(page.getByText('You are viewing your storefront as a visitor sees it.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the studio' })).toBeVisible();

    await page.goto(`/d/${slug}`);
    await expect(page.getByRole('link', { name: 'Back to the studio' })).toBeVisible();

    // It is a way back, not a claim of privilege — following it lands in the studio.
    await page.getByRole('link', { name: 'Back to the studio' }).click();
    await expect(page).toHaveURL(/\/studio$/);

    // --- AFTER: sign out, re-request anonymously, require an identical response. ---
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL((url) => url.pathname === '/', { timeout: 30_000 });

    const afterHome = await (await request.get('/')).text();
    const afterDetail = await (await request.get(`/d/${slug}`)).text();

    // Canonicalised only for React's non-deterministic flight-chunk ordering — see
    // helpers/canonical.ts. No rendered markup is normalized, so any real difference fails.
    expect(
      canonicalizeBody(afterHome),
      'the storefront a visitor receives changed as a side effect of the owner bar',
    ).toBe(canonicalizeBody(beforeHome));
    expect(
      canonicalizeBody(afterDetail, [slug]),
      'the detail page a visitor receives changed as a side effect of the owner bar',
    ).toBe(canonicalizeBody(beforeDetail, [slug]));
  } finally {
    await signIn(page).catch(() => {});
    await deleteDesign(page, id).catch(() => {});
  }
});

test('a draft still 404s identically for the designer and for a stranger', async ({
  page,
  request,
}) => {
  /*
   * The specific way FR-002a could have broken FR-023.
   *
   * The owner check on the detail page runs only after the design has been found. If it ran
   * before the not-found gate, the designer's 404 would carry an owner bar and a visitor's
   * would not — and "draft, deleted and nonexistent are indistinguishable" would quietly become
   * "…for anonymous requests only". A response refusing to say whether something exists must
   * not vary with who is asking.
   */
  const stamp = Date.now();
  await signIn(page);
  const id = await createDesign(page, { title: `Draft 404 Subject ${stamp}` });

  try {
    const slug = await readSlug(page, id); // never published

    const asOwner = await page.request.get(`/d/${slug}`); // carries her session
    const asVisitor = await request.get(`/d/${slug}`); // carries nothing

    expect(asOwner.status()).toBe(404);
    expect(asVisitor.status()).toBe(404);

    const ownerBody = await asOwner.text();
    expect(ownerBody, 'the owner bar reached a not-found response').not.toContain(
      'Back to the studio',
    );
    expect(canonicalizeBody(ownerBody, [slug])).toBe(
      canonicalizeBody(await asVisitor.text(), [slug]),
    );
  } finally {
    await deleteDesign(page, id).catch(() => {});
  }
});
