-- T065 — inquiry access control (FR-041c, FR-046).
--
-- ===========================================================================
-- The anonymous INSERT that is not here is the point of this file.
--
-- The original design granted `anon` INSERT and put the honeypot and rate limit in the
-- submission route. That is enforcement by convention: the anon key ships in the browser
-- bundle by necessity, so a bot could POST straight to the REST endpoint, skip the route
-- entirely, and write unlimited rows while setting `sender_hash`, `delivery_state` and
-- `design_title_snapshot` to whatever it liked. FR-041 and FR-041a would have applied only to
-- clients that chose to cooperate.
--
-- A SECURITY DEFINER function callable by anon does not fix it either: the rate limit keys on
-- `sender_hash`, which Postgres cannot derive on its own, so a caller passing its own hash
-- evades the limit by varying it.
--
-- Making the server the only writer is the one arrangement where the checks cannot be routed
-- around — which is the "structural, not disciplinary" standard this project holds itself to.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- No anonymous access of any kind.
--
-- Not INSERT (see above) and not SELECT either: a visitor must not be able to read any
-- inquiry, including one they submitted themselves. There is no session to scope it to, and
-- FR-046 forbids revealing who has inquired — "has anyone asked about this piece?" is not a
-- visitor's question to answer.
-- ---------------------------------------------------------------------------
revoke all on inquiry from anon;
alter table inquiry force row level security;

-- ---------------------------------------------------------------------------
-- The owner.
--
-- Reached through the parent design's ownership, with orphaned rows included — an inquiry
-- whose design was deleted still belongs to her, and FR-044 exists precisely so those rows
-- survive. Excluding them would preserve the record and then hide it, which is worse than
-- deleting it because she would never know it was there.
-- ---------------------------------------------------------------------------
create policy inquiry_owner_all
  on inquiry for all
  to authenticated
  using (
    design_id is null
    or exists (
      select 1 from design d
      where d.id = inquiry.design_id
        and d.owner_id = (select auth.uid())
    )
  )
  with check (
    design_id is null
    or exists (
      select 1 from design d
      where d.id = inquiry.design_id
        and d.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Grants — and this is the half that migration 0011 exists to remind us about.
--
-- RLS and GRANTs are independent gates and both must be open. A policy filters rows a caller
-- is already privileged to touch; it cannot grant a privilege never given. The `postgres`
-- default privileges for schema public hand `authenticated` only TRUNCATE/REFERENCES/TRIGGER,
-- so without these lines the policy above would be a filter over nothing and the banner would
-- render empty forever.
--
-- SELECT and UPDATE only for the owner: UPDATE is `acknowledged` (FR-040c). No INSERT — she
-- does not write inquiries. No DELETE — FR-042 gives v1 no inbox, so FR-045 promises no
-- expiry rather than manual deletion, and a privilege with no surface is one a bug can reach.
-- ---------------------------------------------------------------------------
grant select, update on inquiry to authenticated;

-- The server-mediated write path (FR-041c). service_role bypasses RLS, so custody of the key
-- is what constrains it — never sent to a browser, enforced by `server-only`, an eslint rule
-- and a test against the built bundles.
grant select, insert, update on inquiry to service_role;

-- ---------------------------------------------------------------------------
-- Assertion 1: anon holds nothing on this table.
--
-- The failure this catches is someone hitting "permission denied" while building the form,
-- reaching for a grant, and including `anon` because it sat next to `authenticated` in an
-- example. That single word would undo the argument at the top of this file, and unlike a
-- policy it would not appear in `pg_policies` — so 0007's assertion would keep passing.
-- ---------------------------------------------------------------------------
do $$
declare
  offending text;
begin
  select string_agg(distinct privilege_type, ', ')
    into offending
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'inquiry'
    and grantee in ('anon', 'PUBLIC');

  if offending is not null then
    raise exception
      'FR-041c violation: anon holds % on inquiry. The submission route must be the only writer.',
      offending;
  end if;
end;
$$;

do $$
declare
  offending text;
begin
  select string_agg(policyname, ', ')
    into offending
  from pg_policies
  where schemaname = 'public'
    and tablename = 'inquiry'
    and ('anon' = any (roles) or 'public' = any (roles));

  if offending is not null then
    raise exception
      'FR-041c/FR-046 violation: anonymous policy on inquiry (%).', offending;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assertion 2: the owner can actually read her inquiries.
--
-- The positive half, for the same reason 0011 has one — a banner that is empty because of a
-- missing grant looks exactly like a banner that is empty because nothing failed to send.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(p.privilege, ', ')
    into missing
  from (values ('SELECT'), ('UPDATE')) as p(privilege)
  where not exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name = 'inquiry'
      and g.grantee = 'authenticated'
      and g.privilege_type = p.privilege
  );

  if missing is not null then
    raise exception
      'FR-040b violation: the owner cannot reach her own inquiries — missing grants: %', missing;
  end if;
end;
$$;
