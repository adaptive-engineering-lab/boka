-- T012 — the design table.
--
-- The single most important line in this file is the default on `published`. A design
-- created by any means is invisible until deliberately published (FR-021).

create table design (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references designer (id) on delete cascade,

  -- Public identifier: title-derived slug plus a random suffix, assigned once by the
  -- trigger in 0004 and never regenerated (FR-023a, FR-023b).
  slug               text not null unique,

  title              text not null check (char_length(trim(title)) between 1 and 120),
  category_id        uuid references category (id) on delete restrict,
  collection         text check (char_length(collection) <= 80),

  -- PRIVATE. Fabric, measurements, inspiration. Must never appear on a public
  -- surface (FR-024). Structurally enforced by omission from public_designs — there
  -- is no code path where an anonymous caller holds a row containing this column.
  notes              text,

  -- The only free-text field a visitor may see (FR-025).
  public_description text check (char_length(public_description) <= 2000),

  -- The sole gate on public visibility. DEFAULT FALSE IS LOAD-BEARING (FR-021).
  published          boolean not null default false,

  -- Recorded in v1, displayed in v1.1 (FR-034).
  view_count         integer not null default 0 check (view_count >= 0),

  -- Stored but never written in v1. The v1.1 renderer resolves defaults at read time
  -- via coalesce(seo_title, title) — materialising them here would go stale the
  -- moment the designer edits the source field (FR-035).
  seo_title          text check (char_length(seo_title) <= 120),
  seo_description    text check (char_length(seo_description) <= 320),

  created_at         timestamptz not null default now(),
  -- Maintained by the touch trigger in 0005, not by this default (FR-014).
  updated_at         timestamptz not null default now()
);

comment on column design.notes is
  'PRIVATE — designer only. Never selected by any public view. Adding this column to '
  'public_designs would violate FR-024 and Principle II.';

comment on column design.published is
  'The only gate on public visibility. Defaults to false so unfinished work cannot '
  'leak by omission (FR-021).';

-- Dashboard grid, newest first.
create index design_owner_created_idx on design (owner_id, created_at desc);
-- Storefront grid: partial index, since public queries only ever want published rows.
create index design_published_created_idx on design (created_at desc) where published;
-- Filter dimensions (FR-018, FR-030).
create index design_owner_category_idx on design (owner_id, category_id);
create index design_owner_collection_idx on design (owner_id, collection);
-- Title sort (FR-018, FR-030).
create index design_owner_title_idx on design (owner_id, lower(title));

alter table design enable row level security;
