import { NextResponse, after } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPublishedDesignRef } from '@/lib/data/public-designs';
import { deliverInquiryNotification } from '@/lib/inquiries/deliver';
import { checkRateLimit, computeSenderHash } from '@/lib/inquiries/rate-limit';
import { validateInquiry } from '@/lib/inquiries/validate';

/**
 * T069 — `POST /d/{slug}/inquire` (FR-036, FR-037, FR-040, FR-041, FR-041a, FR-041c, FR-043).
 *
 * ============================================================================
 * The order of the six steps below is the contract, not an implementation preference.
 *
 *   1. Honeypot   — a filled hidden field responds as if successful and stores nothing.
 *   2. Rate limit — against a server-computed sender hash.
 *   3. Validate   — field-level errors, nothing written.
 *   4. Persist    — server-side insert, with the title snapshot and a pending state.
 *   5. Respond    — the visitor is confirmed HERE, before any email is attempted.
 *   6. Deliver    — inside `after()`, so a slow or dead mail provider cannot delay or fail
 *                   the visitor's only available action.
 *
 * Steps 5 and 6 are ordered deliberately: US3 scenario 5 requires a normal confirmation while
 * email is entirely down, and FR-040 requires the record to persist regardless. Sending before
 * responding would couple the visitor's experience to a third party, and would invite failing
 * the submission when the send failed — which is precisely what the requirement forbids.
 *
 * Steps 1–3 are unbypassable **because step 4 is server-only**. `inquiry` grants `anon`
 * nothing (migration 0013), so there is no second way in. Were anonymous INSERT available, a
 * bot would skip this route entirely and the checks would apply only to clients that chose to
 * cooperate.
 * ============================================================================
 */

export const runtime = 'nodejs';

/** FR-041a. The field a human never sees and a naive bot always fills. */
const HONEYPOT_FIELD = '_website';

/**
 * One response shape for success and for a tripped honeypot.
 *
 * A bot must learn nothing from the difference, so this is returned verbatim in both cases —
 * same status, same body. Telling it "rejected" would tell it which field to leave alone next
 * time, which is the one thing that would make the honeypot useless.
 */
function accepted(): NextResponse {
  return NextResponse.json({ ok: true, message: 'Your message has been sent.' }, { status: 200 });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'That submission could not be read.' }, { status: 400 });
  }

  // --- 1. Honeypot (FR-041a) ---
  if (String(form.get(HONEYPOT_FIELD) ?? '').trim() !== '') {
    return accepted();
  }

  // --- 2. Rate limit (FR-041) ---
  // The hash comes from the request, never from the client. A caller-supplied sender identity
  // would make the limit evadable by varying a string.
  const senderHash = computeSenderHash(request);
  const limit = await checkRateLimit(senderHash);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, error: limit.reason }, { status: 429 });
  }

  // --- 3. Validate (FR-037) ---
  const validation = validateInquiry({
    visitorName: String(form.get('visitorName') ?? ''),
    visitorEmail: String(form.get('visitorEmail') ?? ''),
    message: String(form.get('message') ?? ''),
  });
  if (!validation.ok) {
    return NextResponse.json({ ok: false, errors: validation.errors }, { status: 400 });
  }

  /*
   * The design is resolved through `public_designs`, so an inquiry about a draft, a deleted
   * design, or a slug that never existed all reach the same 404 — the same answer the page
   * itself gives (FR-023). Accepting an inquiry for an unpublished design would confirm it
   * exists, turning this route into the enumeration oracle the whole design avoids.
   */
  const design = await getPublishedDesignRef(slug);
  if (!design) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  // --- 4. Persist (FR-040, FR-043) ---
  const admin = createAdminClient();
  const { data: designer } = await admin.from('designer').select('id, email, name').limit(1).single();

  const { data: inquiry, error } = await admin
    .from('inquiry')
    .insert({
      design_id: design.id,
      // Snapshotted now (FR-043), so the record still reads meaningfully if the design is
      // later deleted and `design_id` becomes null (FR-044).
      design_title_snapshot: design.title,
      visitor_name: validation.value.visitorName,
      visitor_email: validation.value.visitorEmail,
      message: validation.value.message,
      sender_hash: senderHash,
      // `delivery_state` and `delivery_attempts` take their defaults. The client supplies
      // none of these four, which is the point of the write being server-side.
    })
    .select('id, created_at')
    .single();

  if (error || !inquiry) {
    // The one case where the visitor is told something went wrong: nothing was recorded, so
    // telling them it was sent would lose the message silently.
    return NextResponse.json(
      { ok: false, error: 'Your message could not be sent. Please try again.' },
      { status: 500 },
    );
  }

  // --- 6. Deliver, scheduled to run after the response (FR-039, FR-040a) ---
  if (designer?.email) {
    after(async () => {
      await deliverInquiryNotification({
        id: inquiry.id,
        designTitle: design.title,
        visitorName: validation.value.visitorName,
        visitorEmail: validation.value.visitorEmail,
        message: validation.value.message,
        createdAt: inquiry.created_at,
        to: designer.email,
      });
    });
  }

  // --- 5. Respond. Reached whether or not the email above ever succeeds. ---
  return accepted();
}
