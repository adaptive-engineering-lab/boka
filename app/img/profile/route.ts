import { NextResponse } from 'next/server';

import { getPublicDesignerProfile } from '@/lib/data/public-designs';
import { signDisplayUrl } from '@/lib/images/storage';

/**
 * The designer's profile photo (FR-028, FR-029).
 *
 * Served through `/img` like every other visitor-facing image, rather than by embedding a
 * signed URL in the homepage HTML. Both approaches work; this one keeps a property the
 * public-surface review checklist actually asserts — **every image a visitor loads comes
 * from `/img`** — true without exception. An exception here would be the first crack in the
 * reasoning that makes the image gate reviewable.
 *
 * Unlike `/img/{photoId}/{width}` there is no publication gate, and that is correct: the
 * designer's name, bio and photo are public by definition (FR-028). There is nothing to
 * withhold. The path still comes from `public_designer_profile`, which omits `email`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'Content-Length': '0' },
  });
}

export async function GET() {
  const profile = await getPublicDesignerProfile();
  if (!profile?.profilePhotoPath) return notFound();

  const signedUrl = await signDisplayUrl(profile.profilePhotoPath);
  if (!signedUrl) return notFound();

  return NextResponse.redirect(signedUrl, {
    status: 302,
    // Short, because the designer replacing her photo should take effect promptly. Not
    // `private`: unlike a design photo this is the same for every visitor.
    headers: { 'Cache-Control': 'public, max-age=60, must-revalidate' },
  });
}
