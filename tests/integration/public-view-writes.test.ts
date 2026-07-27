import { beforeAll, describe, expect, it } from 'vitest';

import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseConfig } from '../e2e/helpers/env';

/**
 * The public views must be readable and **not writable** by `anon` (Principle II, FR-025a).
 *
 * ============================================================================
 * This test exists because the thing it checks was true on a live site.
 *
 * On 2026-07-27 an anonymous caller holding only the publishable key — the one shipped in
 * every page's JavaScript — could `DELETE` published designs and rewrite the designer's
 * profile through `public_designs` and `public_designer_profile`. Measured against the
 * deployed project: `PATCH` returned 200 and `DELETE` returned 204.
 *
 * Three facts had to line up, and each was individually defensible:
 *
 *   1. The views inherited write privileges from the default ACL of the role that created
 *      them — see the warning below, because that role's defaults are **not the same locally
 *      and in production**.
 *   2. `public_designs` and `public_designer_profile` are simple single-table selects, which
 *      makes them **automatically updatable** — Postgres rewrites a view write into a base
 *      table write with no trigger involved.
 *   3. The views run as their owner (`postgres`, which holds `rolbypassrls`) and are not
 *      `security_invoker`, so the rewritten statement skips RLS entirely.
 *
 * ---------------------------------------------------------------------------
 * **⚠ Run locally, this file proves almost nothing. Point it at the deployment.**
 *
 * `pg_default_acl` for the `public` schema differs between environments for `postgres`, the
 * role migrations run as: hosted it grants `arwdDxtm` to `anon` (everything), locally only
 * `Dxtm` (no DML). So the local stack **never had this vulnerability**, and every assertion
 * below passes there whether or not migration 0015 exists.
 *
 * The production hole would therefore have survived a fully green local suite indefinitely.
 * `npm run test:deployed` points these tests at the hosted project, which is the only run
 * that can fail. Treat a green local run as "no regression", never as "production is safe".
 * ---------------------------------------------------------------------------
 *
 * Migration 0007 had asserted that `anon` holds no DML on the four **base tables**, and that
 * assertion passed — it was true, and it was answering a different question. The views were
 * reviewed for what they could *expose*, never for what they could *accept*.
 *
 * ---------------------------------------------------------------------------
 * **Why this is an outside-in test over HTTP rather than a SQL privilege check.**
 *
 * A migration can assert `has_table_privilege(...)`, and 0015 does. But that is the same kind
 * of check that missed this for two phases: it confirms the state someone thought to look at.
 * This test instead does what an attacker does — sends the request with the public key and
 * looks at the status code. It would have caught the defect with no knowledge of views,
 * ownership, `rolbypassrls`, or automatic updatability.
 * ---------------------------------------------------------------------------
 *
 * Every write below targets a filter matching **zero rows**, so a run against a database
 * where the hole is open still proves the hole without destroying anything. The point is the
 * status code, not the effect.
 * ============================================================================
 */

/**
 * Each view with a column that genuinely exists on it, and a value that cannot match.
 *
 * The per-view column is not fussiness. The first version filtered every view on `id`, and
 * `public_designer_profile` has no `id` — it exposes `name`, `bio`, `profile_photo_path`.
 * PostgREST answers an unknown column with **400**, and every write assertion here treats
 * `>= 400` as "refused". So on that view the tests passed while proving nothing: a malformed
 * request was being read as a permission denial. The read control is what caught it, by
 * failing with 400 where it demanded exactly 200.
 *
 * That is the same failure this whole file exists to guard against, one level up — an
 * assertion that cannot distinguish "the system refused me" from "I asked wrongly".
 */
const VIEWS = [
  { view: 'public_designs', column: 'slug', value: '___probe_no_such_slug___' },
  { view: 'public_designer_profile', column: 'name', value: '___probe_no_such_name___' },
  { view: 'public_categories', column: 'name', value: '___probe_no_such_category___' },
  { view: 'public_photos', column: 'display_path', value: '___probe_no_such_path___' },
] as const;

const noMatch = ({ column, value }: (typeof VIEWS)[number]) => `${column}=eq.${value}`;

/**
 * The statuses that count as "the write was refused", enumerated rather than `>= 400`.
 *
 * Two different mechanisms refuse here, and both are legitimate:
 *
 *   - **401** `permission denied for view` — the privilege revocation in 0015 doing its job.
 *     This is what `public_designs` and `public_designer_profile` return, and it is the one
 *     that actually closes the vulnerability, because those two views are auto-updatable and
 *     would otherwise have accepted the write.
 *   - **500** `cannot update view` — `public_categories` and `public_photos` are not simple
 *     enough to be automatically updatable, so Postgres cannot rewrite the statement at all.
 *     Structural rather than privilege-based, and it was already true before 0015.
 *
 * Listing them beats `>= 400` because an unexpected **400** then fails loudly instead of being
 * counted as a refusal. A malformed request looks exactly like a rejected one if the only
 * question asked is "was the status at least 400?" — which is how the first version of this
 * file passed on `public_designer_profile` while proving nothing.
 */
const REFUSED = [401, 403, 405, 500];

function headers(): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
}

describe('public views are read-only for anonymous callers', () => {
  beforeAll(() => {
    // Loud rather than skipped. A silent skip is how a security regression test stops
    // protecting anything: the suite goes green, nobody reads the reason, and the next run
    // that *could* have caught something never happens.
    if (!hasSupabaseConfig) {
      throw new Error(
        'No Supabase configuration found. This test guards a vulnerability that was live in ' +
          'production; it must not be skipped silently. Start the local stack or set ' +
          'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
      );
    }
  });

  it.each(VIEWS)('anon cannot UPDATE $view', async (target) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${target.view}?${noMatch(target)}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ [target.column]: target.value }),
    });

    expect(
      REFUSED,
      `anon can UPDATE through ${target.view} (HTTP ${response.status}). A visitor could rewrite ` +
        `the designer's data. Revoke write privileges — see migration 0015.`,
    ).toContain(response.status);
  });

  it.each(VIEWS)('anon cannot DELETE from $view', async (target) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${target.view}?${noMatch(target)}`, {
      method: 'DELETE',
      headers: headers(),
    });

    expect(
      REFUSED,
      `anon can DELETE through ${target.view} (HTTP ${response.status}). A visitor could destroy ` +
        `published work. Revoke write privileges — see migration 0015.`,
    ).toContain(response.status);
  });

  it.each(VIEWS)('anon cannot INSERT into $view', async (target) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${target.view}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ [target.column]: target.value }),
    });

    expect(
      REFUSED,
      `anon can INSERT through ${target.view} (HTTP ${response.status}).`,
    ).toContain(response.status);
  });

  /*
   * The control, and it is not optional.
   *
   * Without it, every assertion above would also pass on a database where the views had been
   * dropped, renamed, or had SELECT revoked — the storefront would be comprehensively broken
   * and this file would report success. "Writes are refused" is only meaningful alongside
   * "reads are not."
   */
  it.each(VIEWS)('anon CAN still SELECT from $view', async (target) => {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${target.view}?select=${target.column}&limit=1`,
      { headers: headers() },
    );

    expect(
      response.status,
      `anon cannot read ${target.view} (HTTP ${response.status}) — the storefront is broken. The ` +
        'write-revocation in 0015 must not remove SELECT.',
    ).toBe(200);
  });
});
