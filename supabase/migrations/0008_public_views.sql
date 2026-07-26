-- T018 — the four public views (FR-024, FR-025a, FR-030a, FR-010).
--
-- This is the entire anonymous read surface. Every view has two properties doing the
-- constitutional work:
--
--   1. An EXPLICIT COLUMN LIST. Private columns are absent, so there is no code path
--      where an anonymous caller holds a row containing one. Adding a private column to
--      a base table later does not widen these views — which is exactly why this is
--      preferred over fetching a row and stripping fields afterward.
--   2. A PUBLISHED GATE. A draft and a non-existent design both produce zero rows, so
--      "not found" is identical for each with no conditional logic. The sameness that
--      FR-023 requires is structural, not something a route has to remember.
--
-- security_invoker = off (the default for views) means the view runs as its owner and
-- therefore sees through the base tables' RLS. That is intended: the view IS the
-- policy. Do not add security_invoker = on — the views would return nothing, and the
-- temptation would be to "fix" it by granting anon access to the base tables, which is
-- the defect this design exists to prevent.

-- ---------------------------------------------------------------------------
-- public_designs
-- ---------------------------------------------------------------------------
create view public_designs as
select
  d.id,
  d.slug,
  d.title,
  d.category_id,
  d.collection,
  d.public_description,
  d.created_at
from design d
where d.published;

comment on view public_designs is
  'The only path from a visitor request to design data. OMITS notes (FR-024), owner_id, '
  'view_count, seo_*, updated_at. Gated on published (FR-022, FR-023).';

-- ---------------------------------------------------------------------------
-- public_designer_profile
-- ---------------------------------------------------------------------------
create view public_designer_profile as
select
  dr.name,
  dr.bio,
  dr.profile_photo_path
from designer dr;

comment on view public_designer_profile is
  'OMITS email — the inquiry notification destination is not public contact info (FR-028).';

-- ---------------------------------------------------------------------------
-- public_categories — fixes finding N2
-- ---------------------------------------------------------------------------
create view public_categories as
select distinct
  c.id,
  c.name
from category c
join design d on d.category_id = c.id
where d.published;

comment on view public_categories is
  'OMITS owner_id. The join to published designs means a category used only by drafts '
  'never appears in a public filter control (FR-030a) — otherwise a visitor could infer '
  'that unreleased work exists.';

-- ---------------------------------------------------------------------------
-- public_photos — fixes finding N2
-- ---------------------------------------------------------------------------
create view public_photos as
select
  p.id,
  p.design_id,
  p.position,
  p.display_path,
  p.blur_placeholder,
  p.alt_text,
  p.width,
  p.height
from photo p
join design d on d.id = p.design_id
where d.published;

comment on view public_photos is
  'OMITS original_path (FR-010). Published-gated, so a draft photo is invisible. This '
  'view is what the /img route consults before signing a URL (FR-009a).';

-- ---------------------------------------------------------------------------
-- Grants: read-only, to both anon and authenticated.
-- ---------------------------------------------------------------------------
grant select on public_designs           to anon, authenticated;
grant select on public_designer_profile  to anon, authenticated;
grant select on public_categories        to anon, authenticated;
grant select on public_photos            to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assertion: no view may expose a column we have declared private.
--
-- Cheap, and it turns a silent Principle II regression into a failed migration.
-- ---------------------------------------------------------------------------
do $$
declare
  leaked text;
begin
  select string_agg(format('%s.%s', table_name, column_name), ', ')
    into leaked
  from information_schema.columns
  where table_schema = 'public'
    and table_name like 'public\_%'
    and column_name in ('notes', 'owner_id', 'original_path', 'email', 'view_count',
                        'seo_title', 'seo_description');

  if leaked is not null then
    raise exception
      'Principle II violation: private column exposed by a public view: %', leaked;
  end if;
end;
$$;
