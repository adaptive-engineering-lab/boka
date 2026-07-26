-- T017 — no anonymous access to any base table (FR-025a, Principle II).
--
-- This file exists because of finding N2. The original design granted anonymous SELECT
-- directly on `category` and `photo`, which:
--
--   * returned category.owner_id to visitors;
--   * returned photo.original_path — the storage path of the full-resolution original,
--     which FR-010 forbids outright;
--   * let a visitor enumerate categories belonging ONLY to draft designs, leaking the
--     shape of unreleased work (FR-030a).
--
-- The mistake was applying "select public fields explicitly" to `design` and then
-- assuming it held everywhere. It has to be checked per entity.
--
-- With RLS enabled and NO policy granted to `anon`, reads return zero rows and writes
-- are rejected. That is the fail-closed property that makes Principle II structural
-- rather than procedural: a query written next year inherits the protection.
--
-- Public data is reachable only through the four views in 0008, each with an explicit
-- column list and a published gate.

-- Revoke table-level privileges so a future policy cannot accidentally combine with a
-- lingering grant. RLS and GRANTs are independent gates; both must be shut.
revoke all on designer from anon;
revoke all on category from anon;
revoke all on design   from anon;
revoke all on photo    from anon;

-- Force RLS even for the table owner, so a definer-context mistake cannot read around
-- the policies.
alter table designer force row level security;
alter table category force row level security;
alter table design   force row level security;
alter table photo    force row level security;

-- ---------------------------------------------------------------------------
-- Assertion: fail the migration if any anon policy exists on a base table.
--
-- The deny here is the ABSENCE of a policy, which is invisible in a diff — nothing
-- shows up when someone adds a grant later. This check makes the absence explicit and
-- self-enforcing.
-- ---------------------------------------------------------------------------
do $$
declare
  offending text;
begin
  select string_agg(format('%s.%s (%s)', schemaname, tablename, policyname), ', ')
    into offending
  from pg_policies
  where schemaname = 'public'
    and tablename in ('designer', 'category', 'design', 'photo')
    and ('anon' = any (roles) or 'public' = any (roles));

  if offending is not null then
    raise exception
      'Principle II violation: anonymous policy on a base table: %. Public reads must go through a public_* view (FR-025a).',
      offending;
  end if;
end;
$$;
