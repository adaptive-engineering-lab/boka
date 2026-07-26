import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { supabasePublishableKey, supabaseUrl } from '@/lib/supabase/env';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Server-side Supabase client using the **anon** key, with the signed-in designer's
 * session read from cookies.
 *
 * This is the client every page and route should reach for. RLS still applies, which
 * is the point: an owner-scoped query returns the owner's rows because the policy says
 * so, not because the query remembered to filter. Anonymous requests get exactly the
 * public views and nothing else.
 *
 * For the one operation that must bypass RLS — writing an inquiry on behalf of a
 * visitor who has no database identity — see `lib/supabase/admin.ts`.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session instead, so this is safe to ignore.
        }
      },
    },
  });
}
