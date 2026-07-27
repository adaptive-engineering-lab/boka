import { NextResponse } from 'next/server';

import { getOwnPhotoForDelivery } from '@/lib/data/designer-designs';
import { renderDisplayImage } from '@/lib/images/deliver';

/**
 * Owner-scoped image delivery for the studio.
 *
 * ============================================================================
 * Why this exists alongside `/img`, rather than the dashboard reusing it.
 *
 * `/img` reads `public_photos`, which is gated on `published`. That is the whole point of
 * it (FR-009a) — and it means the public route returns 404 for every draft. The dashboard
 * is mostly drafts. Reusing `/img` would leave the designer looking at a grid of broken
 * tiles for exactly the work she has not finished yet.
 *
 * The tempting fix — relaxing `/img` for signed-in requests — is the one to avoid. It
 * would put a conditional inside the gate that the draft-invisibility test (T060) exists
 * to protect, and a bug in that conditional leaks unpublished work to visitors. So the two
 * surfaces get two routes, each with one rule:
 *
 *   /img            → published only, no session, ever.
 *   /studio/img     → the owner's own photos, session required.
 *
 * This route reads the `photo` base table through the session client, so RLS answers the
 * ownership question (FR-003). It is under `/studio`, so middleware redirects an
 * unauthenticated request before it arrives, and RLS refuses it even if that fails.
 *
 * Like `/img`, it serves resized bytes rather than redirecting to a signed URL (research
 * D11, as amended). The dashboard grid asks for 640px tiles, so without the resize it would
 * pull a 2048px file per tile — the designer is on the same phone connection as everyone
 * else.
 * ============================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_WIDTHS = new Set([320, 480, 640, 828, 1080, 1280, 1920]);

function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'Content-Length': '0' },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ photoId: string; width: string }> },
) {
  const { photoId, width } = await params;

  const requestedWidth = Number.parseInt(width, 10);
  if (!Number.isFinite(requestedWidth) || !ALLOWED_WIDTHS.has(requestedWidth)) return notFound();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(photoId)) {
    return notFound();
  }

  // RLS is the gate: a photo belonging to anyone else simply is not returned. It comes
  // first, for the same reason as in the public route — a 304 answered ahead of it would
  // confirm the photo exists to someone not entitled to know.
  const photo = await getOwnPhotoForDelivery(photoId);
  if (!photo) return notFound();

  const etag = `"${photoId}-${requestedWidth}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'private, no-store' },
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
      // `no-store` rather than a max-age: this response is scoped to one signed-in designer
      // and must never sit in any cache, shared or otherwise. The ETag still spares the
      // re-encode on revalidation.
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
