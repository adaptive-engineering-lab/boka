import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Shared setup for tests that talk to the local Supabase stack.
 *
 * These tests use the **service-role key deliberately**. They are asserting things the
 * database itself does — trigger behaviour, cascade behaviour, storage cleanup — and going
 * through RLS would mean authenticating as the seeded owner on every call while proving
 * nothing extra about the trigger. RLS has its own coverage: the four public views, the
 * deny-anon assertions in migration 0007, and the end-to-end draft-invisibility spec.
 */

const ROOT = path.resolve(__dirname, '../../..');

/** The seeded owner (supabase/seed.sql). */
export const OWNER_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Loads `.env.local` by hand.
 *
 * Vitest does not read it, and `next dev` is not involved here. Existing environment
 * variables win, so CI can point these tests at a different stack without editing a file.
 */
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
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * True when a local stack is reachable in configuration terms.
 *
 * Tests skip rather than fail when it is absent, so `npm test` stays useful on a machine
 * without Docker running. The skip is announced loudly — a silently green suite that
 * asserted nothing is worse than a red one.
 */
export const hasLocalStack = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

export function warnIfSkipped(testName: string): void {
  if (!hasLocalStack) {
    console.warn(
      `[${testName}] SKIPPED — no local Supabase stack configured. Run \`npm run db:start\` and \`npm run db:reset\`, then re-run.`,
    );
  }
}

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A design row with the required columns filled in. `slug` and `published` are
 *  deliberately never supplied — the trigger owns one and the column default owns the
 *  other, and a test that sets them proves nothing about production behaviour. */
export async function insertDesign(
  supabase: SupabaseClient,
  fields: { title: string; notes?: string | null; collection?: string | null },
): Promise<{ id: string; slug: string; created_at: string; updated_at: string }> {
  const { data, error } = await supabase
    .from('design')
    .insert({
      owner_id: OWNER_ID,
      title: fields.title,
      notes: fields.notes ?? null,
      collection: fields.collection ?? null,
    })
    .select('id, slug, created_at, updated_at')
    .single();

  if (error || !data) throw new Error(`insertDesign failed: ${error?.message}`);
  return data;
}

export async function deleteDesign(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from('design').delete().eq('id', id);
}
