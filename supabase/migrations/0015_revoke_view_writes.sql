-- 0015 — revoke write privileges on the public views (Principle II, FR-025a).
--
-- ===========================================================================
-- FOUND ON THE LIVE SITE, 2026-07-27. An anonymous visitor could DELETE published
-- designs and rewrite the designer's profile, using only the publishable key that
-- ships in every page's JavaScript.
--
-- Proven against the deployed project before this migration was written, with filters
-- matching zero rows so nothing was altered:
--
--   PATCH /rest/v1/public_designer_profile  -> 200   (accepted)
--   DELETE /rest/v1/public_designs          -> 204   (accepted)
--   PATCH /rest/v1/design   (base table)    -> 401   permission denied  <- 0007 working
--
-- The base tables were correctly locked down by 0007. The defect is one layer out, in
-- the views 0008 created, and it needed three things to line up:
--
--   1. Supabase's default privileges grant ALL on new objects in `public` to `anon`
--      and `authenticated`. The views inherited that on creation. 0007 revoked on the
--      four base tables and stopped there, because "the views only expose safe
--      columns" answered the question of what could be *read*, and nobody asked what
--      could be *written*.
--   2. `public_designs` and `public_designer_profile` are simple single-table selects,
--      which makes them **automatically updatable** — Postgres will translate an
--      UPDATE or DELETE on the view into one on the base table. No trigger required.
--   3. The views are owned by `postgres`, which holds `rolbypassrls`, and they are not
--      declared `security_invoker`. So the rewritten statement runs as the owner and
--      **RLS on the base table never applies**.
--
-- Any one of those alone is harmless. Together they turn a read-only projection into a
-- write channel that bypasses every policy in 0006 and 0016.
--
-- `security_invoker = true` is NOT the fix here. These views are deliberately
-- owner-executed: that is what lets an anonymous caller read published rows without
-- holding any privilege on the base tables, which is the whole design in 0008 and D3.
-- Switching it on would break every public read. The fix is to remove the write
-- privileges that should never have been granted.
-- ===========================================================================

revoke insert, update, delete, truncate on public_designs            from anon, authenticated;
revoke insert, update, delete, truncate on public_designer_profile   from anon, authenticated;
revoke insert, update, delete, truncate on public_categories         from anon, authenticated;
revoke insert, update, delete, truncate on public_photos             from anon, authenticated;

-- Reads are the entire purpose of these views; restate the grant so this migration is a
-- complete statement of intent rather than a subtraction from an assumed baseline.
grant select on public_designs          to anon, authenticated;
grant select on public_designer_profile to anon, authenticated;
grant select on public_categories       to anon, authenticated;
grant select on public_photos           to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assertion, in both directions — the pattern 0011 established.
--
-- One direction alone is how this defect survived. 0007 asserted that anon holds no DML
-- on the base tables and passed, which was true and insufficient. A check that only
-- confirms the lock-down would also pass on a database where the views are wide open,
-- so this asserts the reads still work AND the writes are gone.
-- ---------------------------------------------------------------------------
do $$
declare
  views text[] := array[
    'public_designs', 'public_designer_profile', 'public_categories', 'public_photos'
  ];
  target text;
  role_name text;
  offending text := '';
begin
  foreach target in array views loop
    -- Writes must be impossible for both client-facing roles.
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_table_privilege(role_name, format('public.%I', target), 'INSERT')
         or has_table_privilege(role_name, format('public.%I', target), 'UPDATE')
         or has_table_privilege(role_name, format('public.%I', target), 'DELETE')
         or has_table_privilege(role_name, format('public.%I', target), 'TRUNCATE') then
        offending := offending || format('%s holds a write privilege on %s; ', role_name, target);
      end if;
    end loop;

    -- And reads must still work, or the storefront is broken instead of insecure.
    if not has_table_privilege('anon', format('public.%I', target), 'SELECT') then
      offending := offending || format('anon lost SELECT on %s; ', target);
    end if;
  end loop;

  if offending <> '' then
    raise exception 'Principle II violation on the public views: %', offending;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recurrence is the real risk, so name it.
--
-- Any NEW view added to `public` inherits the same permissive default and arrives with
-- anon holding ALL over again. `alter default privileges` is not used to fix that,
-- because it applies only to objects created by the role that set it and Supabase owns
-- those defaults — changing them is a fight with the platform.
--
-- Instead: every migration that creates a public view must revoke writes on it and
-- extend the assertion above. `tests/integration/public-view-writes.test.ts` checks this
-- from outside, over the REST API with the publishable key, which is the only vantage
-- point that would have caught the original defect.
-- ---------------------------------------------------------------------------
