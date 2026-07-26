import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. **This bypasses Row Level Security completely.**
 *
 * RLS is where every privacy guarantee in this project lives (Principle II): drafts
 * stay invisible and private notes stay private because policies say so. A client
 * holding this key is subject to none of that.
 *
 * It exists for exactly one reason. A visitor submitting an inquiry has no database
 * identity, and anonymous `INSERT` on `inquiry` is denied on purpose — granting it
 * would let a bot POST straight to the REST endpoint and skip the honeypot and rate
 * limit entirely (FR-041c, research D12). So the server performs that write.
 *
 * Rules:
 *  - Never import this from a component. `server-only` makes that a build error, and
 *    eslint's `no-restricted-imports` flags it earlier still.
 *  - Never widen its use. If you reach for it to make a query "just work", the real
 *    problem is a missing policy or a missing view.
 *  - Never expose its results wholesale to a caller. Select the columns you need.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  if (serviceRoleKey === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is set to the anon key. The inquiry write would fail silently under RLS.',
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
