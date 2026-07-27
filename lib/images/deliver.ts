import 'server-only';

import sharp from 'sharp';

import { downloadDisplayObject } from '@/lib/images/storage';

/**
 * Image delivery — resize on request, serve the bytes (FR-009, FR-009a, SC-004).
 *
 * ============================================================================
 * This module is the amendment recorded in research D11 and in plan.md Complexity Tracking.
 *
 * The original design had `/img` redirect to a 60-second signed URL for the stored display
 * variant. Two problems, and the second is the one that justified the churn:
 *
 *   1. **The width in the path was ignored.** One variant is stored, longest edge 2048px, so
 *      a 640px grid tile downloaded a 2048px file. At 50 designs averaging 3 photos that is a
 *      live risk to SC-004's 3-second LCP budget on a 400 kbps connection.
 *
 *   2. **A signed URL is an address that outlives its own authorisation.** Once handed out it
 *      kept working for its full lifetime even if the design was unpublished a second later.
 *      D11 accepted that as a 60-second residual window.
 *
 * Serving the bytes ourselves fixes both at once. The width is honoured, and **no signed URL
 * is ever issued**, so the residual window is gone rather than merely short. That makes this
 * a Principle II improvement, not a privacy-for-speed trade.
 *
 * The cost is CPU per request instead of a CDN hop. That is the same trade the original
 * decision already made when it routed images through the application at all, and at this
 * scale it is immaterial (Principle V). Callers add an ETag so repeat views are 304s.
 * ============================================================================
 */

/**
 * Re-encode quality, by output width. Only used when an actual resize happens — see the fast
 * path below.
 *
 * A grid tile is displayed at roughly 240–560 CSS pixels. At that size the artefacts that
 * separate q80 from q65 are not resolvable, while the bytes very much are: T079 measured the
 * storefront's images at 3.0 MB after `srcset` landed, and quality is the remaining lever that
 * costs nothing structural.
 *
 * Detail-view widths keep the higher quality. That is the surface where a visitor looks
 * closely at a garment — the whole purpose of the page — and it carries one photograph at a
 * time rather than fifty, so the bytes are affordable there and the fidelity matters.
 */
const GRID_MAX_WIDTH = 640;
const GRID_QUALITY = 65;
const DETAIL_QUALITY = 80;

function qualityFor(width: number): number {
  return width <= GRID_MAX_WIDTH ? GRID_QUALITY : DETAIL_QUALITY;
}

export interface DeliverableImage {
  bytes: Buffer;
  contentType: string;
  /** Actual pixel width of the returned bytes, which may be less than requested. */
  width: number;
}

/**
 * Produces the bytes to serve for one display variant at one width.
 *
 * Returns null on any failure — a missing object, an undecodable file, a storage error. The
 * callers all answer null with the same 404 they use for "no such photo", so a storage
 * hiccup cannot be distinguished from an unpublished design.
 */
export async function renderDisplayImage(
  displayPath: string,
  requestedWidth: number,
): Promise<DeliverableImage | null> {
  const stored = await downloadDisplayObject(displayPath);
  if (!stored) return null;

  try {
    const image = sharp(stored);
    const metadata = await image.metadata();
    if (!metadata.width) return null;

    // Fast path: the request is for at least the stored size, so there is nothing to do.
    // Skipping it matters twice over — it avoids spending CPU to produce identical output,
    // and it avoids a WebP→WebP round trip, which is lossy even when the dimensions do not
    // change. The detail view at 1280 hits this for any photo stored narrower than that.
    if (requestedWidth >= metadata.width) {
      return { bytes: stored, contentType: 'image/webp', width: metadata.width };
    }

    const resized = await image
      // `withoutEnlargement` is belt-and-braces given the check above, but it guarantees we
      // never invent pixels: upscaling would cost bytes and quality to no benefit.
      .resize({ width: requestedWidth, withoutEnlargement: true })
      .webp({ quality: qualityFor(requestedWidth) })
      .toBuffer({ resolveWithObject: true });

    return {
      bytes: resized.data,
      contentType: 'image/webp',
      width: resized.info.width,
    };
  } catch {
    return null;
  }
}
