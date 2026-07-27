import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

import { acknowledgeInquiry } from '@/lib/data/designer-inquiries';

/**
 * T073 — `POST /studio/inquiries/{id}/acknowledge` (FR-040c).
 *
 * Clears one inquiry from the undelivered banner. **It does not delete the record**, and the
 * distinction is the requirement: the banner is a notification about a failed email, the row is
 * a person's message. FR-045 keeps it indefinitely, and manual deletion arrives with the v1.1
 * inbox (FR-042). The owner holds no DELETE privilege on `inquiry` at all (migration 0013), so
 * this route could not delete even if someone rewrote it to try.
 *
 * POST only. Acknowledging changes state, so it must not be reachable by a crawler, a
 * prefetcher, or anything else that follows a URL.
 *
 * Ownership is not checked here — RLS answers it (FR-003). An id belonging to someone else
 * simply matches no row, and the redirect below is identical either way.
 */
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.redirect(new URL('/studio', request.url), { status: 303 });
  }

  await acknowledgeInquiry(id);
  revalidatePath('/studio');

  // 303, so the browser follows with GET and a reload does not re-post.
  return NextResponse.redirect(new URL('/studio', request.url), { status: 303 });
}
