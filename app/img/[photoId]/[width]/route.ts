import { NextResponse } from 'next/server';

import { getPublicPhotoForDelivery } from '@/lib/data/public-designs';
import { signDisplayUrl } from '@/lib/images/storage';

/**
 * T022 — publication-gated image delivery (FR-009a).
 *
 * ============================================================================
 * This route is the fix for the most serious defect /speckit-analyze found.
 *
 * Display variants used to live in a PUBLIC storage bucket. RLS gates the `photo` row,
 * not the storage object — so once a design had been published its image URL was
 * disclosed permanently. Moving the design back to draft removed it from the storefront
 * while the photograph stayed downloadable forever by anyone holding the link. An
 * unpublished garment was one saved URL away from being public, and no test in the
 * original plan would have noticed.
 *
 * Now: both buckets are private, and every image request re-checks publication here.
 * Revocation is immediate. The 60-second signature is the only residual window, and it
 * cannot be renewed once the design is no longer published.
 *
 * Do not add caching that outlives the publication check, and do not "optimise" this
 * away by making the bucket public.
 * ============================================================================
 */

// sharp and the storage signing client need Node, not Edge.
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
  _request: Request,
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

  // THE GATE. `public_photos` is published-gated, so this returns null for a draft's
  // photo and for one that does not exist — indistinguishably.
  const photo = await getPublicPhotoForDelivery(photoId);
  if (!photo) return notFound();

  const signedUrl = await signDisplayUrl(photo.displayPath);
  if (!signedUrl) return notFound();

  // 302, not 301: a permanent redirect would be cached by the browser and would
  // outlive the publication check, quietly recreating the defect this route fixes.
  return NextResponse.redirect(signedUrl, {
    status: 302,
    headers: {
      // Allow a brief shared cache so the grid is not re-signing on every scroll,
      // but keep it far below any plausible publish/unpublish reaction time.
      'Cache-Control': 'private, max-age=30, must-revalidate',
    },
  });
}
