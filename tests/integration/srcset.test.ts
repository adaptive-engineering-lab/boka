import { describe, expect, it } from 'vitest';

import { imageSrcSet } from '@/lib/data/public-designs';

/**
 * Candidate-width arithmetic for `srcset` (T089, and the regression that followed it).
 *
 * ============================================================================
 * Two opposing mistakes are possible here, and this project has now made both.
 *
 * **Offering too much.** `/img` never upscales, so a `1280w` candidate for a 900px photo
 * returns 900px bytes under a 1280w label. The browser then picks it believing it will get
 * 1280px, and the descriptor is simply false — which is worse than a missing candidate,
 * because a false descriptor also poisons the choice between the *other* candidates.
 *
 * **Offering too little.** Filtering out everything wider than the source fixes the lie and
 * introduces a quality regression: a 477px cover photo matched only the 320w candidate, so
 * the browser had nothing better and rendered it at 320px. That shipped, and was caught on
 * the live site rather than here — the source images in the test fixtures are all 1600px+,
 * so no test had a source small enough to expose it.
 *
 * The resolution is that a descriptor must describe **the bytes that arrive**, not the number
 * in the URL. For a 477px source the honest entry is `/img/{id}/480 477w`: ask for 480, the
 * route's no-upscale fast path returns 477px, and the label says 477w. All three agree.
 * ============================================================================
 */

const GRID = [320, 480, 640] as const;
const DETAIL = [640, 828, 1080, 1280] as const;
const ID = '61552071-84ca-47e9-afdf-65b0f26f4892';

/** Parses `url 123w, url 456w` into the descriptor numbers, in order. */
function descriptors(srcSet: string): number[] {
  return srcSet.split(',').map((entry) => Number(entry.trim().split(' ')[1]?.replace('w', '')));
}

/** Parses the requested width out of each `/img/{id}/{width}` URL, in order. */
function requestedWidths(srcSet: string): number[] {
  return srcSet.split(',').map((entry) => Number(entry.trim().split(' ')[0]?.split('/').pop()));
}

describe('imageSrcSet', () => {
  it('offers every candidate when the source is larger than all of them', () => {
    const result = imageSrcSet(ID, GRID, 2048);
    expect(descriptors(result)).toEqual([320, 480, 640]);
    expect(requestedWidths(result)).toEqual([320, 480, 640]);
  });

  it('never labels a candidate wider than the source', () => {
    // The lie this filter exists to prevent: no descriptor may exceed the real width.
    for (const intrinsic of [200, 477, 640, 900, 1150, 2048]) {
      for (const widths of [GRID, DETAIL]) {
        const result = imageSrcSet(ID, widths, intrinsic);
        for (const descriptor of descriptors(result)) {
          expect(
            descriptor,
            `descriptor ${descriptor}w exceeds the ${intrinsic}px source in "${result}"`,
          ).toBeLessThanOrEqual(intrinsic);
        }
      }
    }
  });

  it('still offers the source at full resolution when it is narrower than the largest candidate', () => {
    // The live regression, pinned. 477px source: 320w is honest but not enough on its own.
    const result = imageSrcSet(ID, GRID, 477);

    expect(descriptors(result)).toEqual([320, 477]);
    // The second entry asks for 480 — the narrowest allowed width above the source — and the
    // route returns the untouched 477px original for it.
    expect(requestedWidths(result)).toEqual([320, 480]);
  });

  it('does the same on the detail surface', () => {
    const result = imageSrcSet(ID, DETAIL, 1150);
    expect(descriptors(result)).toEqual([640, 828, 1080, 1150]);
    expect(requestedWidths(result)).toEqual([640, 828, 1080, 1280]);
  });

  it('handles a source narrower than every allowed width', () => {
    const result = imageSrcSet(ID, GRID, 200);
    expect(descriptors(result)).toEqual([200]);
    expect(requestedWidths(result)).toEqual([320]);
  });

  it('adds no redundant candidate when the source matches one exactly', () => {
    const result = imageSrcSet(ID, GRID, 640);
    expect(descriptors(result)).toEqual([320, 480, 640]);
  });

  it('only ever requests widths the /img route accepts', () => {
    // Mirrors ALLOWED_WIDTHS in app/img/[photoId]/[width]/route.ts. A width outside that set
    // 404s, and because that 404 is deliberately indistinguishable from an unpublished design,
    // the symptom would be a blank tile with nothing in the logs to explain it.
    const allowed = new Set([320, 480, 640, 828, 1080, 1280, 1920]);

    for (const intrinsic of [100, 200, 321, 477, 639, 640, 900, 1150, 2048, 4000]) {
      for (const widths of [GRID, DETAIL]) {
        for (const requested of requestedWidths(imageSrcSet(ID, widths, intrinsic))) {
          expect(allowed.has(requested), `${requested} is not an allowed /img width`).toBe(true);
        }
      }
    }
  });
});
