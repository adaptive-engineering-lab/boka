import { describe, expect, it } from 'vitest';

import { canonicalizeBody } from '../e2e/helpers/canonical';

/**
 * Regression tests for the response canonicaliser.
 *
 * This helper is not incidental test plumbing — `draft-invisibility.spec.ts` (T060) and
 * `filter-leakage.spec.ts` (T063) decide whether FR-023 holds by comparing two response
 * bodies through it. So it has two ways to be wrong, and they fail in opposite directions:
 *
 *   - **Too weak** and it flakes. A privacy gate that fails at random gets re-run until it is
 *     green, which is operationally identical to re-running until a real leak is waved
 *     through. That is not hypothetical: the first version sorted whole `push()` calls and
 *     failed a full-suite run for no reason but stream packing.
 *   - **Too strong** and it launders a genuine leak into a passing comparison.
 *
 * The tests below pin both edges, which is why the leak case matters as much as the flake
 * case. They are pure string manipulation — no database, no browser — so they belong here
 * rather than in the Playwright suite they protect.
 */

/** Builds one streamed chunk exactly as React emits it. */
function chunk(payload: string): string {
  return `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
}

const HTML = '<!DOCTYPE html><html lang="en"><body><main id="main">Nothing here</main>';
const BOOTSTRAP = '<script>(self.__next_f=self.__next_f||[]).push([0])</script>';

const RECORD_A = '1:"$Sreact.fragment"';
const RECORD_B = '2:I[9766,[],""]';
const RECORD_C = '8:{"metadata":[["$","title","0",{"children":"Boka"}]],"error":null}';

describe('canonicalizeBody', () => {
  it('is unaffected by how records are packed into chunks', () => {
    // The exact failure observed on a full run: identical records, but React flushed the
    // metadata record on its own in one response and packed it alongside the module record
    // in the other. Sorting whole chunks cannot reconcile these two strings.
    const split = HTML + chunk(`${RECORD_A}\n${RECORD_B}\n`) + chunk(`${RECORD_C}\n`);
    const packed = HTML + chunk(`${RECORD_A}\n${RECORD_B}\n${RECORD_C}\n`);

    expect(split).not.toBe(packed); // precondition: the raw bodies genuinely differ
    expect(canonicalizeBody(split)).toBe(canonicalizeBody(packed));
  });

  it('is unaffected by the order records arrive in', () => {
    const one = HTML + chunk(`${RECORD_A}\n`) + chunk(`${RECORD_C}\n`);
    const other = HTML + chunk(`${RECORD_C}\n`) + chunk(`${RECORD_A}\n`);

    expect(one).not.toBe(other);
    expect(canonicalizeBody(one)).toBe(canonicalizeBody(other));
  });

  it('still fails when a record carries something the other does not', () => {
    // The property that makes the helper safe to use in a privacy gate. If normalization
    // ever swallowed this, T060 and T063 would pass against a leaking build.
    const clean = HTML + chunk(`${RECORD_A}\n${RECORD_C}\n`);
    const leaking =
      HTML + chunk(`${RECORD_A}\n${RECORD_C}\n9:{"notes":"hem needs taking up 2cm"}\n`);

    expect(canonicalizeBody(clean)).not.toBe(canonicalizeBody(leaking));
  });

  it('fails when rendered markup differs, even with identical flight payloads', () => {
    const shared = chunk(`${RECORD_A}\n`);
    const draft = `${HTML}<h1>Unreleased Gown</h1>` + shared;
    const missing = `${HTML}<h1>Nothing here</h1>` + shared;

    expect(canonicalizeBody(draft)).not.toBe(canonicalizeBody(missing));
  });

  it('does not split a value that itself contains an escaped newline', () => {
    // A designer's bio is multi-line. In the flight payload that newline is the two-character
    // escape `\n`, while the record separator is a real newline — splitting the raw HTML by
    // hand would confuse the two and shred one record into several.
    const bio = String.raw`7:{"bio":"Made by hand.\n\nCut and sewn in one studio."}`;
    const body = HTML + chunk(`${bio}\n${RECORD_A}\n`);

    const canonical = canonicalizeBody(body);
    expect(canonical).toContain(String.raw`\n\nCut and sewn`);
    // Two records survived as two, not four.
    expect(canonical.split('<<FLIGHT>>')[1]?.trim().split('\n')).toHaveLength(2);
  });

  it('replaces visitor-supplied values wherever they appear', () => {
    const guessed = `${HTML}<p>No match for Bridal</p>` + chunk(`4:{"category":"Bridal"}\n`);
    const nonsense = `${HTML}<p>No match for Absent</p>` + chunk(`4:{"category":"Absent"}\n`);

    expect(canonicalizeBody(guessed, ['Bridal'])).toBe(canonicalizeBody(nonsense, ['Absent']));
  });

  it('tolerates the bootstrap chunk, which carries no payload', () => {
    const body = HTML + BOOTSTRAP + chunk(`${RECORD_A}\n`);
    expect(() => canonicalizeBody(body)).not.toThrow();
    expect(canonicalizeBody(body)).toContain(RECORD_A);
  });

  it('leaves a body with no flight chunks alone apart from echoed values', () => {
    expect(canonicalizeBody(HTML)).toBe(HTML);
  });
});
