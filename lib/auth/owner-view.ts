import 'server-only';

import { cookies } from 'next/headers';

import { createClient } from '@/lib/supabase/server';

/**
 * Is the person requesting this public page the signed-in designer? (FR-002a)
 *
 * ============================================================================
 * The two-step check is the whole point of this file, not an optimisation.
 *
 * Public routes are deliberately excluded from the middleware matcher so that **no session
 * work happens on a visitor's request** — that exclusion is what keeps Principle I's "reachable
 * with a URL alone" true in practice rather than merely in intent. Calling `getUser()` on every
 * public render would undo it for everyone, and `getUser()` is not a cookie read: it validates
 * the token against the auth server, so it is a network round trip on the critical path of the
 * page SC-004 measures.
 *
 * So the cookie is checked first, locally. A visitor carries no Supabase auth cookie, returns
 * `false` immediately, and pays exactly nothing — no client construction, no network call. Only
 * a request that already looks authenticated goes on to verify.
 *
 * That ordering also makes FR-002a's third constraint — an unauthenticated response is
 * unchanged — true by construction rather than by care. There is no branch a visitor can take
 * that differs from the behaviour before this file existed.
 * ============================================================================
 *
 * **This must never gate content.** It decides whether to render one extra navigation
 * affordance and nothing else. Public pages read published, public fields only, for everyone,
 * and must still render completely when this returns false (FR-002a constraint 4). If you find
 * yourself using it to decide what *data* to show, the answer is wrong — that is a publication
 * question, and publication is settled in the views.
 */
export async function isOwnerViewing(): Promise<boolean> {
  const cookieStore = await cookies();

  // Supabase SSR names its cookie `sb-<project-ref>-auth-token`, and chunks it as `.0`, `.1`
  // when it exceeds the size limit. Matching the shape rather than an exact name keeps this
  // working across projects and across chunking.
  const hasAuthCookie = cookieStore
    .getAll()
    .some((cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('auth-token'));

  if (!hasAuthCookie) return false;

  // A cookie is not proof. `getUser()` validates with the auth server rather than trusting
  // whatever the browser sent, so a forged or expired cookie resolves to nobody.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return Boolean(user);
}
