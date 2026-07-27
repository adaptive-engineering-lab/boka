import { NextResponse } from 'next/server';

import { getPublicDesignerProfile } from '@/lib/data/public-designs';
import { renderDisplayImage } from '@/lib/images/deliver';

/**
 * The designer's profile photo (FR-028, FR-029).
 *
 * Served through `/img` like every other visitor-facing image, rather than by embedding a
 * storage URL in the homepage HTML. Both approaches would work; this one keeps a property the
 * public-surface review checklist actually asserts — **every image a visitor loads comes from
 * `/img`, and no storage address ever reaches a client** — true without exception. An
 * exception here would be the first crack in the reasoning that makes the image gate
 * reviewable.
 *
 * Unlike `/img/{photoId}/{width}` there is no publication gate, and that is correct: the
 * designer's name, bio and photo are public by definition (FR-028). There is nothing to
 * withhold. The path still comes from `public_designer_profile`, which omits `email`.
 *
 * **No ETag here**, deliberately, and this is the one place it would be wrong. Design photos
 * are immutable — their id identifies their content — but the avatar is overwritten in place
 * at `profile/{ownerId}.webp` when the designer uploads a new one. An ETag keyed on the owner
 * would survive the replacement and serve the old face. The settings page appends a `?v=`
 * cache-buster for the same reason.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The avatar renders at 96px; ask for a little more so it stays sharp on a retina screen. */
const AVATAR_WIDTH = 320;

function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'Content-Length': '0' },
  });
}

export async function GET() {
  const profile = await getPublicDesignerProfile();
  if (!profile?.profilePhotoPath) return notFound();

  const image = await renderDisplayImage(profile.profilePhotoPath, AVATAR_WIDTH);
  if (!image) return notFound();

  return new NextResponse(new Uint8Array(image.bytes), {
    status: 200,
    headers: {
      'Content-Type': image.contentType,
      'Content-Length': String(image.bytes.byteLength),
      // Short, so replacing the photo takes effect promptly. `public` is safe here and
      // correct — unlike a design photo, this is the same image for every visitor and there
      // is no publication state for a shared cache to get wrong.
      'Cache-Control': 'public, max-age=60, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
