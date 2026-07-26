-- Owner-side table grants (FR-003).
--
-- ===========================================================================
-- Why this migration exists, and why it was missing.
--
-- 0006 wrote owner-scoped RLS policies on all four base tables. 0007 revoked anonymous
-- access and asserted that no anon policy exists. Both are correct, and between them they
-- left the designer unable to read or write a single row of her own archive.
--
-- The reason is the one 0007's own comment states and then only half-applies: **RLS and
-- GRANTs are independent gates, and both must be open for a query to succeed.** A policy
-- is a filter on rows the caller is already permitted to touch. It cannot grant a
-- privilege that was never given.
--
-- The privileges were never given. Supabase's default privileges that grant ALL to anon,
-- authenticated and service_role are registered `FOR ROLE supabase_admin`, but migrations
-- run as `postgres`, and the `postgres` defaults for schema `public` grant only
-- TRUNCATE, REFERENCES and TRIGGER:
--
--   postgres | public | r | {postgres=arwdDxtm/postgres, anon=Dxtm/postgres,
--                            authenticated=Dxtm/postgres, service_role=Dxtm/postgres}
--
-- No `a`, `r`, `w` or `d` — no INSERT, SELECT, UPDATE or DELETE. Every table created by
-- 0001–0003 inherited that, so `authenticated` got policies granting access to rows it had
-- no privilege to read in the first place.
--
-- This was invisible to the Phase 2 verification because that pass checked the two things
-- the design was worried about: that anonymous callers are refused, and that the public
-- views return published rows only. Both passed. Nobody asked whether the *owner* could
-- still log in and see her work — the failure mode of a privacy-focused schema is
-- assumed to be "too open", so nothing was pointed at "too closed".
--
-- Granting here does not widen the public surface by one row. `anon` is named nowhere
-- below, RLS remains FORCE-enabled on all four tables, and every policy still keys on
-- `auth.uid()`. What changes is that the owner's policies can now do their job.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- authenticated — the single designer. RLS scopes every one of these to her rows.
-- ---------------------------------------------------------------------------

-- SELECT and UPDATE only. There is deliberately no INSERT or DELETE policy on `designer`
-- (0006): the account is provisioned out of band and the application must never be able
-- to create or remove one. Granting the privilege here would leave that resting on the
-- policy alone.
grant select, update on designer to authenticated;

grant select, insert, update, delete on category to authenticated;
grant select, insert, update, delete on design   to authenticated;
grant select, insert, update, delete on photo    to authenticated;

-- ---------------------------------------------------------------------------
-- service_role — the server-side key.
--
-- This role has rolbypassrls, so RLS is not what constrains it; custody of the key is.
-- It is never sent to a browser (enforced by `import 'server-only'`, by an eslint rule,
-- and by tests/integration/no-service-key.test.ts against the built bundles). It needs
-- table access for the server-mediated inquiry write (FR-041c), which reads `design` to
-- capture the title snapshot.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on designer to service_role;
grant select, insert, update, delete on category to service_role;
grant select, insert, update, delete on design   to service_role;
grant select, insert, update, delete on photo    to service_role;

-- ---------------------------------------------------------------------------
-- Assertion 1: anon gained nothing.
--
-- This is the check that matters. The natural way to hit the bug above is for someone to
-- see "permission denied", reach for a grant, and include `anon` in the list because it
-- was next to `authenticated` in an example. That single word would undo every guarantee
-- in 0007 and 0008 at once, and — unlike a policy — it would not show up in `pg_policies`,
-- so 0007's own assertion would keep passing.
-- ---------------------------------------------------------------------------
do $$
declare
  offending text;
begin
  select string_agg(format('%s: %s', table_name, privilege_type), ', ')
    into offending
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('designer', 'category', 'design', 'photo')
    and grantee in ('anon', 'PUBLIC')
    and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

  if offending is not null then
    raise exception
      'Principle II violation: anonymous DML privilege on a base table (%). Public reads go through a public_* view (FR-025a).',
      offending;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assertion 2: the owner can actually reach her archive.
--
-- The positive half. Without it this whole class of bug stays silent until someone tries
-- to sign in, which in this project meant an entire phase of schema work landing before
-- anyone noticed the studio could not read a row.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(format('%s.%s', t.table_name, p.privilege), ', ')
    into missing
  from (values ('category'), ('design'), ('photo')) as t(table_name)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(privilege)
  where not exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name = t.table_name
      and g.grantee = 'authenticated'
      and g.privilege_type = p.privilege
  );

  if missing is not null then
    raise exception
      'FR-003 violation: the owner cannot reach her own archive — missing grants: %', missing;
  end if;
end;
$$;
