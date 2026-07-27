import { NextResponse } from 'next/server';

import { getPublicPhotoForDelivery } from '@/lib/data/public-designs';
import { renderDisplayImage } from '@/lib/images/deliver';

/**
 * T022 — publication-gated image delivery (FR-009a). **Amended: see research D11.**
 *
 * ============================================================================
 * This route is the fix for the most serious defect /speckit-analyze found.
 *
 * Display variants used to live in a PUBLIC storage bucket. RLS gates the `photo` row, not
 * the storage object — so once a design had been published its image URL was disclosed
 * permanently. Moving the design back to draft removed it from the storefront while the
 * photograph stayed downloadable forever by anyone holding the link. An unpublished garment
 * was one saved URL away from being public, and no test in the original plan would have
 * noticed.
 *
 * Now: both buckets are private, and every image request re-checks publication here.
 *
 * **This route used to redirect to a 60-second signed URL. It no longer does** — it reads the
 * object and serves the bytes, resized to the requested width. Two reasons, recorded in D11:
 * the width in the path was previously ignored (a 640px tile fetched a 2048px file, risking
 * SC-004), and a signed URL is an address that keeps working after the design behind it is
 * withdrawn. Serving bytes ourselves means revocation is total and immediate, with no
 * residual window at all.
 *
 * Do not add caching that outlives the publication check, do not make the bucket public, and
 * do not go back to handing out storage URLs.
 * ============================================================================
 */

// sharp needs Node, not Edge.
export const runtime = 'nodejs';

// Never statically cached: the answer depends on mutable publication state.
export const dynamic = 'force-dynamic';

const ALLOWED_WIDTHS = new Set([320, 480, 640, 828, 1080, 1280, 1920]);

/**
 * One 404 for every failure mode.
 *
 * A draft's photo, a deleted design's photo, a nonexistent id, and a bad width must all
 * produce the same response. Any observable difference — status, body, headers — would
 * let a visitor distinguish "exists but unpublished" from "does not exist", which is
 * exactly what FR-023 forbids.
 */
function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Length': '0',
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ photoId: string; width: string }> },
) {
  const { photoId, width } = await params;

  const requestedWidth = Number.parseInt(width, 10);
  if (!Number.isFinite(requestedWidth) || !ALLOWED_WIDTHS.has(requestedWidth)) {
    return notFound();
  }

  // Basic shape check before touching the database. A malformed id is not an error
  // worth distinguishing from a missing one.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(photoId)) {
    return notFound();
  }

  // THE GATE, and it comes first. `public_photos` is published-gated, so this returns null
  // for a draft's photo and for one that does not exist — indistinguishably.
  const photo = await getPublicPhotoForDelivery(photoId);
  if (!photo) return notFound();

  /*
   * Conditional request handling, deliberately placed AFTER the gate.
   *
   * A photo is immutable once uploaded — removing one deletes it, adding one mints a new id —
   * so photo id plus width identifies the content exactly.
   *
   * The ordering is the security-relevant part. Answering 304 before checking publication
   * would tell a visitor holding an old ETag that the image still exists, which is precisely
   * the inference FR-023 forbids. An unpublished design must reach the 404 above and never
   * get here.
   */
  const etag = `"${photoId}-${requestedWidth}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'private, max-age=60, must-revalidate' },
    });
  }

  const image = await renderDisplayImage(photo.displayPath, requestedWidth);
  if (!image) return notFound();

  return new NextResponse(new Uint8Array(image.bytes), {
    status: 200,
    headers: {
      'Content-Type': image.contentType,
      'Content-Length': String(image.bytes.byteLength),
      ETag: etag,
      /*
       * `private`, and short. A shared cache holding this would keep serving a withdrawn
       * photograph after the publication check had started refusing it — the same class of
       * bug as the public bucket, one layer out. `must-revalidate` means the browser asks
       * again rather than extending the window on its own.
       */
      'Cache-Control': 'private, max-age=60, must-revalidate',
      // The bytes are derived from the stored variant; nothing downstream should sniff them
      // as anything other than the image type we declared.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
