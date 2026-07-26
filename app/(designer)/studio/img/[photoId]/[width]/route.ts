import { NextResponse } from 'next/server';

import { getOwnPhotoForDelivery } from '@/lib/data/designer-designs';
import { signDisplayUrl } from '@/lib/images/storage';

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
  _request: Request,
  { params }: { params: Promise<{ photoId: string; width: string }> },
) {
  const { photoId, width } = await params;

  const requestedWidth = Number.parseInt(width, 10);
  if (!Number.isFinite(requestedWidth) || !ALLOWED_WIDTHS.has(requestedWidth)) return notFound();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(photoId)) {
    return notFound();
  }

  // RLS is the gate: a photo belonging to anyone else simply is not returned.
  const photo = await getOwnPhotoForDelivery(photoId);
  if (!photo) return notFound();

  const signedUrl = await signDisplayUrl(photo.displayPath);
  if (!signedUrl) return notFound();

  return NextResponse.redirect(signedUrl, {
    status: 302,
    // `private` matters here: this response is scoped to one signed-in designer and must
    // never be held in a shared cache.
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
