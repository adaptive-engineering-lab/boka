import 'server-only';

import { Resend } from 'resend';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * T070 — notifying the designer (FR-039, FR-040, FR-040a, FR-040b).
 *
 * ============================================================================
 * This module runs AFTER the visitor has been told their message was sent, inside `after()`.
 *
 * That ordering is the requirement, not an optimisation. US3 scenario 5 says a visitor gets a
 * normal confirmation while email is entirely down, and FR-040 says the record persists
 * regardless. Sending before responding would make the visitor's only available action depend
 * on a third party being up — and, worse, would tempt someone into failing the submission when
 * the send failed, which is exactly the outcome the requirement forbids.
 *
 * So nothing here can fail the visitor's request. The only thing failure changes is the row's
 * `delivery_state`, which is what raises the dashboard banner (FR-040b).
 * ============================================================================
 */

/** FR-040a. Three attempts, then the row is surfaced to the designer instead. */
const MAX_ATTEMPTS = 3;

/** Backoff between attempts. Short, because this runs inside the request's `after()` and a
 *  serverless function will not wait minutes for us. The `pg_cron` sweep is the backstop for
 *  anything this cannot finish. */
const BACKOFF_MS = [400, 1600];

function renderEmail(inquiry: InquiryNotification): { subject: string; text: string } {
  return {
    // The design is in the subject line because that is what the designer needs before she
    // opens it — FR-039 requires the notification to identify which piece it concerns.
    subject: `Enquiry about ${inquiry.designTitle} — from ${inquiry.visitorName}`,
    text: [
      `${inquiry.visitorName} <${inquiry.visitorEmail}> asked about "${inquiry.designTitle}".`,
      '',
      inquiry.message ? inquiry.message : '(No message was included.)',
      '',
      '—',
      'Reply directly to this address to answer them.',
      `Received ${new Date(inquiry.createdAt).toUTCString()}.`,
    ].join('\n'),
  };
}

export interface InquiryNotification {
  id: string;
  designTitle: string;
  visitorName: string;
  visitorEmail: string;
  message: string | null;
  createdAt: string;
  /** The designer's address, from her `designer` row (FR-039). Never public. */
  to: string;
}

/**
 * Attempts delivery, records the outcome, and never throws.
 *
 * Returns the state it settled on so callers can log it; the authoritative record is the row.
 */
export async function deliverInquiryNotification(
  inquiry: InquiryNotification,
): Promise<'delivered' | 'undelivered'> {
  const admin = createAdminClient();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.INQUIRY_FROM_EMAIL?.trim();

  const settle = async (state: 'delivered' | 'undelivered', attempts: number) => {
    await admin
      .from('inquiry')
      .update({ delivery_state: state, delivery_attempts: attempts })
      .eq('id', inquiry.id);
    return state;
  };

  // Missing configuration is a delivery failure, not a crash. It lands the inquiry on the
  // banner — visible and actionable — rather than throwing inside `after()` where nobody sees
  // it and the row sits `pending` forever.
  if (!apiKey || !from) {
    return settle('undelivered', 0);
  }

  const resend = new Resend(apiKey);
  const { subject, text } = renderEmail(inquiry);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const { error } = await resend.emails.send({
        from,
        to: inquiry.to,
        // So she can hit reply and reach the visitor rather than the sending domain.
        replyTo: inquiry.visitorEmail,
        subject,
        text,
      });

      if (!error) return settle('delivered', attempt);
    } catch {
      // Network failure, DNS, a thrown SDK error — all the same thing here: not delivered yet.
    }

    // Record the attempt as it happens, not at the end. If the function is frozen or killed
    // mid-retry the row still shows how far it got, and the sweep can tell a stalled delivery
    // from one that was never tried.
    await admin.from('inquiry').update({ delivery_attempts: attempt }).eq('id', inquiry.id);

    const pause = BACKOFF_MS[attempt - 1];
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
  }

  return settle('undelivered', MAX_ATTEMPTS);
}
