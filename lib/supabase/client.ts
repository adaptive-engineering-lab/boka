import { createBrowserClient } from '@supabase/ssr';

import { supabasePublishableKey, supabaseUrl } from '@/lib/supabase/env';

/**
 * Browser Supabase client. Uses the anon key and is therefore fully subject to RLS.
 *
 * With the corrected schema this client can read *nothing* directly: every base table
 * denies anonymous access, and public data is exposed only through the four
 * published-gated `public_*` views. It cannot write anything at all — inquiry
 * submission goes through the server (FR-041c).
 */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
