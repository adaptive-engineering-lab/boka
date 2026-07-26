-- T019 — increment_design_view (FR-034).
--
-- The only anonymous write in the system, and deliberately the narrowest possible one.
-- It takes a slug, touches one counter on an already-published row, and returns
-- nothing — so it can neither modify a design nor be used to probe whether a draft
-- exists (a call for an unpublished slug is indistinguishable from one for a slug that
-- does not exist).

create or replace function increment_design_view(design_slug text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update design
     set view_count = view_count + 1
   where slug = design_slug
     and published;  -- unpublished rows are silently ignored, not reported
$$;

comment on function increment_design_view(text) is
  'FR-034. SECURITY DEFINER so an anonymous visitor can increment a counter without any '
  'write grant on `design`. Returns void: no information flows back to the caller, so it '
  'cannot be used to detect unpublished designs.';

-- Deliberately NOT granted to anon for UPDATE on design — only EXECUTE on this function.
revoke all on function increment_design_view(text) from public;
grant execute on function increment_design_view(text) to anon, authenticated;
