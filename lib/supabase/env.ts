/**
 * Supabase environment resolution.
 *
 * Supabase renamed the browser-safe key from "anon key" to "publishable key"; newer
 * projects issue `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` while older ones and most docs
 * use `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both name the same low-privilege key, so both are
 * accepted rather than forcing whoever set up the project to rename a working variable.
 *
 * Both must be referenced literally, not built dynamically: Next inlines
 * `process.env.NEXT_PUBLIC_*` at build time by static substitution, so
 * `process.env[someVariable]` would silently resolve to undefined in the browser.
 */

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL. Copy .env.example to .env.local.');
  }
  return url;
}

/** The browser-safe key. Subject to RLS, and therefore safe to ship to the client. */
export function supabasePublishableKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY). Copy .env.example to .env.local.',
    );
  }
  return key;
}

/**
 * Same pair, but returns null instead of throwing.
 *
 * Used by middleware, which runs on every matched request: throwing there would turn a
 * missing variable into a 500 on the sign-in page itself, leaving no way to see the
 * actual problem.
 */
export function supabaseConfigOrNull(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;
  return { url, key };
}
