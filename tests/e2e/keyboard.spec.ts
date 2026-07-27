import { expect, test, type Page } from '@playwright/test';

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
 * T078 — a keyboard-only visitor can browse, open a design, and inquire (SC-014, FR-012c).
 *
 * ============================================================================
 * Nothing here uses the mouse. Every interaction is Tab, Enter or typing.
 *
 * That constraint is the test. Playwright's `click()` focuses and activates an element
 * regardless of whether a keyboard could ever have reached it, so a suite built on `click()`
 * will pass against a control that is unreachable by Tab, unlabelled once reached, or removed
 * from the tab order entirely. Every accessibility defect this file exists to catch is
 * invisible to a clicking test — which is exactly how the skip link shipped broken.
 * ============================================================================
 *
 * SC-014 has two halves and both are asserted: the journey completes (grid → design →
 * inquiry sent), and along the way no stop in the tab order is unlabelled.
 *
 * ---------------------------------------------------------------------------
 * **Chromium only, and the reason is a platform setting rather than a convenience.**
 *
 * WebKit does not put links in the tab order by default — Safari's "Press Tab to highlight
 * each item on a webpage" is off unless a user turns Full Keyboard Access on. Measured here:
 * the first Tab on the storefront lands on the Category `<select>`, skipping the skip link and
 * every header link. So on WebKit these assertions would be testing Safari's default
 * preference, not this application, and no change to the markup could make them pass.
 *
 * What that costs is worth stating plainly rather than burying in a skip: link-based keyboard
 * navigation is **unverified on WebKit**. Form controls are unaffected — they are in the tab
 * order on every engine — so the inquiry form itself is exercised on both projects by
 * `accessibility.spec.ts` and `inquiry.spec.ts`. The uncovered case is a visitor on Safari who
 * has enabled Full Keyboard Access, whose tab order then matches Chromium's, which is the
 * configuration this file checks.
 * ---------------------------------------------------------------------------
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** See the note above: WebKit's default tab order excludes links, so these cannot run there. */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'WebKit omits links from the tab order unless Full Keyboard Access is enabled, so these assertions would measure a Safari preference rather than the application',
);

type Stop = {
  tag: string;
  name: string;
  fieldName: string;
  href: string;
  type: string;
  isSubmit: boolean;
  inMain: boolean;
};

/**
 * Describes whatever currently has focus, including its accessible name.
 *
 * The name is computed the way assistive technology resolves it — `aria-label`, then
 * `aria-labelledby`, then an associated `<label>`, then the element's own text, then `alt`
 * or `value` — rather than read off a single attribute. A control labelled by any of those
 * routes is correctly labelled, and insisting on one of them would fail perfectly good markup.
 */
async function focusedStop(page: Page): Promise<Stop> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element) {
      return { tag: '', name: '', fieldName: '', href: '', type: '', isSubmit: false, inMain: false };
    }

    const byLabelledBy = (): string =>
      (element.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ')
        .trim();

    const byLabelElement = (): string => {
      if (!element.id) return '';
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      return label?.textContent?.trim() ?? '';
    };

    const input = element as HTMLInputElement;
    const name =
      element.getAttribute('aria-label')?.trim() ||
      byLabelledBy() ||
      byLabelElement() ||
      element.closest('label')?.textContent?.trim() ||
      element.textContent?.trim() ||
      element.getAttribute('alt')?.trim() ||
      element.getAttribute('title')?.trim() ||
      (element.tagName === 'INPUT' && input.type === 'submit' ? input.value.trim() : '') ||
      '';

    return {
      tag: element.tagName,
      name,
      fieldName: element.getAttribute('name') ?? '',
      href: element.getAttribute('href') ?? '',
      type: element.getAttribute('type') ?? '',
      isSubmit:
        element.tagName === 'BUTTON' &&
        (element.getAttribute('type') ?? 'submit') === 'submit',
      inMain: Boolean(element.closest('main')),
    };
  });
}

/** One Tab press, then a description of wherever focus landed. */
async function tabTo(page: Page): Promise<Stop> {
  await page.keyboard.press('Tab');
  return focusedStop(page);
}

/**
 * The honeypot must never be a tab stop.
 *
 * `_website` is `sr-only` rather than `display:none` so that it stays in the accessibility
 * tree for the bots that read it — which means it is one forgotten `tabIndex={-1}` away from
 * being in the tab order too. If it ever were, a keyboard user would Tab into an invisible
 * field, type into it, and have their message **silently discarded** by the spam check, with
 * a normal "sent" confirmation and no reply ever arriving (FR-041a makes the discard
 * indistinguishable from success, which is right for bots and catastrophic for a person).
 * The people most likely to hit that are exactly the ones this test represents.
 */
const HONEYPOT_FIELD = '_website';

test('a keyboard-only visitor can browse, open a design, and send an inquiry', async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  await signIn(page);
  const id = await createDesign(page, { title: `Keyboard Subject ${stamp}`, photos: 1 });

  try {
    const slug = await readSlug(page, id);
    await setPublished(page, id, true);

    const visitorContext = await browser.newContext({ extraHTTPHeaders: uniqueClientHeaders() });
    const visitor = await visitorContext.newPage();

    try {
      await visitor.goto('/');
      await expect(visitor.locator(`a[href="/d/${slug}"]`)).toBeVisible();

      // --- The skip link must actually skip. ---
      //
      // This is the regression guard for the T076 fix. Before it, activating the link left
      // focus on <body>, so the next Tab resumed at the top of the document. The assertion
      // that matters is not "focus moved" but "the *next* Tab is past the header" — the
      // broken version could still satisfy a weaker check by accident.
      const first = await tabTo(visitor);
      expect(first.name, 'the skip link must be the first tab stop').toBe('Skip to content');

      await visitor.keyboard.press('Enter');
      const landed = await focusedStop(visitor);
      expect(landed.inMain, 'activating the skip link must move focus into <main>').toBe(true);

      // --- Walk the tab order to the design, checking every stop is labelled. ---
      let stop: Stop | null = null;
      const visited: string[] = [];

      for (let step = 0; step < 40; step += 1) {
        const current = await tabTo(visitor);
        visited.push(`<${current.tag}> "${current.name}"`);

        expect(
          current.fieldName,
          'the honeypot is a tab stop — a keyboard user would fill it and be silently discarded',
        ).not.toBe(HONEYPOT_FIELD);
        expect(
          current.name,
          `an unlabelled control is reachable by Tab: <${current.tag}> after ${visited.slice(-3).join(' → ')}`,
        ).not.toBe('');

        if (current.href === `/d/${slug}`) {
          stop = current;
          break;
        }
      }

      expect(stop, `never reached the design by Tab. Visited: ${visited.join(' → ')}`).not.toBeNull();

      // --- Open it with the keyboard. ---
      await visitor.keyboard.press('Enter');
      await expect(
        visitor.getByRole('heading', { name: `Keyboard Subject ${stamp}` }),
      ).toBeVisible();

      // --- Reach and complete the inquiry form, still without a click. ---
      //
      // Driven by what each stop *is* rather than by a fixed number of Tab presses, so the
      // test does not have to be rewritten every time a control is added to the page — and so
      // a control appearing in an unexpected place is reported rather than silently absorbed.
      let filledName = false;
      let filledEmail = false;
      let filledMessage = false;
      let submitted = false;

      for (let step = 0; step < 60; step += 1) {
        const current = await tabTo(visitor);

        expect(
          current.fieldName,
          'the honeypot is a tab stop on the detail page',
        ).not.toBe(HONEYPOT_FIELD);
        expect(current.name, `an unlabelled control is reachable by Tab: <${current.tag}>`).not.toBe('');

        if (current.fieldName === 'visitorName' && !filledName) {
          await visitor.keyboard.type(`Keyboard Visitor ${stamp}`);
          filledName = true;
        } else if (current.fieldName === 'visitorEmail' && !filledEmail) {
          await visitor.keyboard.type(`keyboard-${stamp}@example.com`);
          filledEmail = true;
        } else if (current.fieldName === 'message' && !filledMessage) {
          await visitor.keyboard.type(`Sent using only a keyboard, ${stamp}.`);
          filledMessage = true;
        } else if (current.isSubmit && current.name.includes('Send message')) {
          expect(
            filledName && filledEmail && filledMessage,
            'reached the submit button before all three fields were reachable',
          ).toBe(true);
          await visitor.keyboard.press('Enter');
          submitted = true;
          break;
        }
      }

      expect(submitted, 'never reached the send button by Tab').toBe(true);

      // SC-014 is only met if the journey actually completes.
      await expect(visitor.getByText('Your message has been sent.')).toBeVisible({ timeout: 30_000 });
    } finally {
      await visitorContext.close();
    }
  } finally {
    await deleteDesign(page, id).catch(() => {});
    await clearUndeliveredBanner(page).catch(() => {});
  }
});

test('the skip link bypasses the studio navigation', async ({ page }) => {
  /*
   * The public surface has a short header; the studio has a real navigation bar, so this is
   * where a broken skip link costs a keyboard user the most — five stops on every page load.
   *
   * The assertion is deliberately about the stop *after* skipping. Checking only that focus
   * moved would have passed the original broken implementation on a page whose first tab stop
   * happened to be inside <main> anyway.
   */
  await signIn(page);
  await page.goto('/studio', { waitUntil: 'load' });

  const first = await tabTo(page);
  expect(first.name).toBe('Skip to content');

  await page.keyboard.press('Enter');
  expect((await focusedStop(page)).inMain, 'focus must move into <main>').toBe(true);

  const next = await tabTo(page);
  expect(
    next.inMain,
    `the Tab after skipping landed on "${next.name}", which is outside <main> — the skip link bypassed nothing`,
  ).toBe(true);
});
