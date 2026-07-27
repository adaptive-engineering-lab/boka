import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads the browser-safe Supabase settings for end-to-end tests.
 *
 * Deliberately exposes **only** the URL and the publishable (anon) key. The service-role key
 * is not read here and must not be: `tests/integration/no-service-key.test.ts` allow-lists
 * every file permitted to name it, and an e2e helper has no business bypassing RLS.
 *
 * The anon key is the right credential for these tests anyway — it is exactly what a visitor
 * holds, which is what makes "can a visitor reach this?" a meaningful question.
 */

const ROOT = path.resolve(__dirname, '../../..');

function loadLocalEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  } catch {
    return;
  }

  for (const line of contents.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key]) continue;
    process.env[key] = rawValue?.trim().replace(/^["']|["']$/g, '') ?? '';
  }
}

loadLocalEnv();

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

/** The key shipped to every browser. Subject to RLS, which is the entire point. */
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  '';

export const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
