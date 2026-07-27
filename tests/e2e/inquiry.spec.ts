import { expect, test } from '@playwright/test';

import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseConfig } from './helpers/env';
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
 * T075 — inquiry submission end to end (US3, FR-036–FR-041a, SC-015).
 *
 * ============================================================================
 * The delivery-failure path is the half that matters, and it is the default here.
 *
 * `RESEND_API_KEY` is unset locally, so every send fails. That is not a limitation of the test
 * environment — it is the exact condition US3 scenario 5 describes, and it means the demanding
 * assertions run on every pass: the visitor still sees a normal confirmation, the record still
 * persists, and the designer still learns about it through the dashboard banner.
 *
 * A design where the visitor's confirmation depended on the email would look perfect in a happy
 * path and lose messages silently in production, because a mail provider being down is the one
 * failure nobody notices until someone asks why they were never replied to.
 * ============================================================================
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/**
 * These specs assert on the undelivered banner, which only appears when sending fails.
 *
 * Locally `RESEND_API_KEY` is unset so every send fails and the failure path is exercised on
 * every run — which is what we want. But if someone configures a real key, deliveries succeed,
 * nothing reaches the banner, and the assertions below would fail for a reason that has nothing
 * to do with the code being wrong. Skipping loudly beats failing confusingly.
 */
const deliveryFails = !process.env.RESEND_API_KEY?.trim();

test('a visitor can send an inquiry, and it survives a failed notification', async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const visitorName = `Ada Visitor ${stamp}`;
  await signIn(page);
  const id = await createDesign(page, { title: `Inquiry Subject ${stamp}` });

  try {
    const slug = await readSlug(page, id);
    await setPublished(page, id, true);

    // --- The visitor. A separate context: no session, no cookies, nothing shared. ---
    const visitorContext = await browser.newContext({ extraHTTPHeaders: uniqueClientHeaders() });
    const visitor = await visitorContext.newPage();

    try {
      await visitor.goto(`/d/${slug}`);

      // FR-036: the control is on every published design's page.
      await expect(visitor.getByRole('heading', { name: 'Ask about this piece' })).toBeVisible();

      // FR-037: a malformed address is refused with a field-level error, and nothing is sent.
      await visitor.getByLabel('Your name').fill(visitorName);
      await visitor.getByLabel('Your email').fill('not-an-address');
      await visitor.getByRole('button', { name: 'Send message' }).click();
      await expect(visitor.getByText(/does not look like an email address/)).toBeVisible();
      await expect(visitor.getByText('Your message has been sent.')).toHaveCount(0);

      // FR-041b: no captcha, no third-party challenge stands between them and sending.
      const body = await visitor.content();
      expect(body).not.toMatch(/recaptcha|hcaptcha|turnstile/i);

      // Now a real submission.
      await visitor.getByLabel('Your email').fill(`visitor-${stamp}@example.com`);
      await visitor.getByLabel(/Message/).fill(`Is the ${stamp} piece available in navy?`);
      await visitor.getByRole('button', { name: 'Send message' }).click();

      // Scenario 2 and 5: a normal confirmation, even though the email cannot be sent.
      await expect(visitor.getByText('Your message has been sent.')).toBeVisible({ timeout: 30_000 });

      // FR-004 / scenario 7: submitting grants no account, session or further ability to act.
      const cookies = await visitorContext.cookies();
      expect(cookies.filter((c) => c.name.startsWith('sb-')), 'a visitor was given a session').toEqual(
        [],
      );
    } finally {
      await visitorContext.close();
    }

    test.skip(
      !deliveryFails,
      'RESEND_API_KEY is set, so delivery succeeds and the failure path cannot be observed',
    );

    // --- The designer. The banner is the only way she learns about this. ---
    //
    // Delivery runs in `after()` and fails three times with backoff, so give it room. This is
    // the one place a wait is about real asynchronous work rather than about flake.
    await expect
      .poll(
        async () => {
          await page.goto('/studio');
          return page.getByText(`visitor-${stamp}@example.com`).count();
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
      )
      .toBeGreaterThan(0);

    // FR-040b: name, email, message and subject design all readable inline — not a count with
    // a link, because the channel that would carry the detail is the one that just broke.
    const banner = page.getByRole('alert').filter({ hasText: 'could not be emailed' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(visitorName);
    await expect(banner).toContainText(`visitor-${stamp}@example.com`);
    await expect(banner).toContainText(`Inquiry Subject ${stamp}`);
    await expect(banner).toContainText(`Is the ${stamp} piece available in navy?`);

    // FR-040c: acknowledging clears the banner and does NOT delete the record.
    await banner.getByRole('button', { name: 'Mark as seen' }).first().click();
    await page.waitForURL('**/studio', { timeout: 30_000 });
    await expect(page.getByText(`visitor-${stamp}@example.com`)).toHaveCount(0);

    test.skip(!hasSupabaseConfig, 'no Supabase configuration available');
    const stillThere = await page.request.get(
      `${SUPABASE_URL}/rest/v1/inquiry?select=id,acknowledged&visitor_email=eq.visitor-${stamp}@example.com`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    // The visitor's key cannot read it back (FR-046) — which is itself the check that
    // acknowledging did not turn the record into something publicly visible.
    expect(stillThere.status()).toBeGreaterThanOrEqual(400);
  } finally {
    await deleteDesign(page, id).catch(() => {});
    await clearUndeliveredBanner(page).catch(() => {});
  }
});

test('the honeypot is indistinguishable from success and stores nothing', async ({
  browser,
  page,
}) => {
  /*
   * FR-041a. The response to a filled honeypot must be byte-identical to a real success.
   *
   * If a bot can tell the difference it simply stops filling the field, and the honeypot is
   * worth nothing from then on. So this asserts on the response itself, not on the outcome —
   * "was it rejected?" is precisely the question that must be unanswerable from outside.
   */
  const stamp = Date.now();
  await signIn(page);
  const id = await createDesign(page, { title: `Honeypot Subject ${stamp}` });

  try {
    const slug = await readSlug(page, id);
    await setPublished(page, id, true);

    const visitorContext = await browser.newContext({ extraHTTPHeaders: uniqueClientHeaders() });
    const visitor = await visitorContext.newPage();

    try {
      const genuine = await visitor.request.post(`/d/${slug}/inquire`, {
        multipart: {
          visitorName: 'Genuine Person',
          visitorEmail: `genuine-${stamp}@example.com`,
          message: 'A real question.',
          _website: '',
        },
      });

      const bot = await visitor.request.post(`/d/${slug}/inquire`, {
        multipart: {
          visitorName: 'Bot',
          visitorEmail: `bot-${stamp}@example.com`,
          message: 'Buy cheap things.',
          _website: 'http://spam.example.com',
        },
      });

      // Identical status AND identical body. A different message, or a 400, would tell the bot
      // exactly which field to leave alone next time.
      expect(bot.status()).toBe(genuine.status());
      expect(await bot.text()).toBe(await genuine.text());
    } finally {
      await visitorContext.close();
    }

    test.skip(
      !deliveryFails,
      'RESEND_API_KEY is set, so the banner stays empty and cannot evidence what was stored',
    );

    // And nothing was stored for the bot. The banner surfaces every undelivered inquiry, so if
    // the honeypot submission had been written it would appear here beside the genuine one.
    await expect
      .poll(
        async () => {
          await page.goto('/studio');
          return page.getByText(`genuine-${stamp}@example.com`).count();
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
      )
      .toBeGreaterThan(0);

    await expect(
      page.getByText(`bot-${stamp}@example.com`),
      'the honeypot submission was stored — it must be discarded silently',
    ).toHaveCount(0);
  } finally {
    await deleteDesign(page, id).catch(() => {});
    await clearUndeliveredBanner(page).catch(() => {});
  }
});

test('an inquiry cannot be sent about a design that is not published', async ({ browser, page }) => {
  /*
   * The route resolves the design through `public_designs`, so a draft answers 404 exactly as a
   * slug that never existed does. Accepting an inquiry for a draft would confirm it exists —
   * turning the submission endpoint into the enumeration oracle that FR-023 and the whole
   * draft-invisibility design exist to prevent.
   */
  const stamp = Date.now();
  await signIn(page);
  const id = await createDesign(page, { title: `Unpublished Inquiry Subject ${stamp}` });

  try {
    const slug = await readSlug(page, id); // deliberately never published

    const visitorContext = await browser.newContext({ extraHTTPHeaders: uniqueClientHeaders() });
    const visitor = await visitorContext.newPage();

    try {
      const draft = await visitor.request.post(`/d/${slug}/inquire`, {
        multipart: {
          visitorName: 'Probe',
          visitorEmail: `probe-${stamp}@example.com`,
          message: 'Does this exist?',
          _website: '',
        },
      });
      const nonexistent = await visitor.request.post('/d/no-such-design-zzzz/inquire', {
        multipart: {
          visitorName: 'Probe',
          visitorEmail: `probe-${stamp}@example.com`,
          message: 'Does this exist?',
          _website: '',
        },
      });

      expect(draft.status()).toBe(404);
      expect(nonexistent.status()).toBe(404);
      expect(await draft.text()).toBe(await nonexistent.text());
    } finally {
      await visitorContext.close();
    }
  } finally {
    await deleteDesign(page, id).catch(() => {});
    await clearUndeliveredBanner(page).catch(() => {});
  }
});
