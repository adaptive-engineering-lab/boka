import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Owner-side inquiry reads (FR-040b, FR-040c, FR-042, FR-046).
 *
 * Separate from `designer-designs.ts` because inquiries are not designs — they outlive them
 * (FR-044) and answer to different rules.
 *
 * **This module is deliberately incapable of listing all inquiries.** FR-042 forbids an inbox
 * in v1, and the exception in FR-040b is narrow: inquiries whose *email failed*, until they are
 * acknowledged. A `listInquiries()` here would be an inbox in everything but name, and would
 * ship the v1.1 surface the spec explicitly defers. If you need one, that is a spec change.
 *
 * Everything goes through the session client, so RLS scopes it to her rows (migration 0013) —
 * including orphaned inquiries whose design was deleted, which is exactly why FR-044 keeps them.
 */

export interface UndeliveredInquiry {
  id: string;
  designTitle: string;
  visitorName: string;
  visitorEmail: string;
  message: string | null;
  createdAt: string;
  /** Null once the design has been deleted (FR-044). The snapshot still names it. */
  designId: string | null;
}

/**
 * Inquiries the designer needs to see because email did not reach her (FR-040b).
 *
 * Reads the title from `design_title_snapshot` rather than joining `design`, and that is the
 * point of the snapshot: a deleted design leaves `design_id` null, and a join would drop the
 * lead from the banner at exactly the moment it is the only record of the person who wrote.
 */
export async function listUndeliveredInquiries(): Promise<UndeliveredInquiry[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('inquiry')
    .select('id, design_id, design_title_snapshot, visitor_name, visitor_email, message, created_at')
    .eq('delivery_state', 'undelivered')
    .eq('acknowledged', false)
    .order('created_at', { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    designId: row.design_id,
    designTitle: row.design_title_snapshot,
    visitorName: row.visitor_name,
    visitorEmail: row.visitor_email,
    message: row.message,
    createdAt: row.created_at,
  }));
}

/**
 * Clears one inquiry from the banner (FR-040c).
 *
 * Sets `acknowledged` and **does not delete the record**. The distinction matters: the banner
 * is a notification, the row is a person's message. FR-045 keeps it indefinitely, and manual
 * deletion arrives with the v1.1 inbox — there is deliberately no delete function in this file,
 * and migration 0013 grants the owner no DELETE privilege to back that up.
 */
export async function acknowledgeInquiry(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase.from('inquiry').update({ acknowledged: true }).eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
