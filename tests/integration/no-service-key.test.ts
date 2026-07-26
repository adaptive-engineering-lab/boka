import { describe, expect, it } from 'vitest';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * T031 — the service-role key must never reach the browser.
 *
 * Why this is worth a test rather than a code-review habit: the service-role key bypasses
 * Row Level Security completely, and RLS is where every privacy guarantee in this project
 * lives. If it leaks into a client bundle, anyone can read every draft design, every
 * private note, and every visitor's inquiry. It is the single most damaging mistake
 * available in this codebase, and the mistake is one character wide — prefixing the
 * variable with NEXT_PUBLIC_.
 *
 * Two layers are checked:
 *   1. Static: no source file outside a server-only module reaches for the key.
 *   2. Built output: no client chunk contains the key's value.
 */

const ROOT = path.resolve(__dirname, '../..');
const SERVICE_KEY_NAME = 'SUPABASE_SERVICE_ROLE_KEY';

/**
 * Files permitted to name the service-role key at all.
 *
 * Listed one by one rather than exempting `tests/` wholesale. The point of this check is
 * that adding a new reader of the key requires an edit here, where someone has to look at
 * it — a directory-wide exemption would let one appear silently.
 */
const ALLOWED = new Set([
  'lib/supabase/admin.ts',
  '.env.example',
  'tests/integration/no-service-key.test.ts',
  // Integration tests assert database-level behaviour (triggers, cascades, storage
  // cleanup) and connect directly. Nothing under tests/ is shipped to a browser.
  'tests/integration/helpers/db.ts',
]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'coverage',
  'test-results',
  'playwright-report',
  'supabase',
  'specs',
  '.claude',
  '.specify',
]);

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), acc);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

describe('service-role key isolation', () => {
  it('is never prefixed with NEXT_PUBLIC_', async () => {
    const files = await walk(ROOT);
    const offenders: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      if (contents.includes(`NEXT_PUBLIC_${SERVICE_KEY_NAME}`)) {
        offenders.push(path.relative(ROOT, file));
      }
    }

    expect(
      offenders,
      'NEXT_PUBLIC_ exposes a variable to the browser. The service-role key bypasses RLS entirely.',
    ).toEqual([]);
  });

  it('is referenced only from server-only modules', async () => {
    const files = await walk(ROOT);
    const offenders: string[] = [];

    for (const file of files) {
      const relative = path.relative(ROOT, file);
      if (ALLOWED.has(relative)) continue;

      const contents = await readFile(file, 'utf8');
      if (contents.includes(SERVICE_KEY_NAME)) offenders.push(relative);
    }

    expect(
      offenders,
      `Only lib/supabase/admin.ts may read ${SERVICE_KEY_NAME}. Import createAdminClient() instead.`,
    ).toEqual([]);
  });

  it('does not appear in any built client chunk', async () => {
    const clientChunks = path.join(ROOT, '.next', 'static');

    // Skips cleanly before the first build rather than failing; CI runs it after `next build`.
    const built = await stat(clientChunks).catch(() => null);
    if (!built) {
      console.warn('[no-service-key] .next/static absent — run `npm run build` to check bundles.');
      return;
    }

    const actualKey = process.env[SERVICE_KEY_NAME];
    const files = await walk(clientChunks);
    const offenders: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      if (contents.includes(SERVICE_KEY_NAME)) offenders.push(path.relative(ROOT, file));
      // The value matters more than the name — catches it being inlined via an alias.
      if (actualKey && actualKey.length > 20 && contents.includes(actualKey)) {
        offenders.push(`${path.relative(ROOT, file)} (contains the key VALUE)`);
      }
    }

    expect(offenders, 'The service-role key reached a browser bundle.').toEqual([]);
  });
});
