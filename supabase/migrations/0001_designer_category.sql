-- T011 — designer and category tables.
--
-- Boka has exactly one designer. The owner_id columns throughout the schema exist for
-- server-side authorization (FR-003) and referential integrity, not as a basis for
-- multi-tenant signup.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- designer — the single owner account
-- ---------------------------------------------------------------------------
create table designer (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null unique,
  name               text not null check (char_length(trim(name)) between 1 and 120),
  -- Shown on the public homepage (FR-028). Capped so the homepage layout stays
  -- predictable at mobile width — the "very long text" edge case.
  bio                text check (char_length(bio) <= 2000),
  profile_photo_path text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table designer is
  'The single owner account. email is the inquiry notification destination (FR-039) and '
  'must never reach a public surface — see the public_designer_profile view.';

comment on column designer.email is
  'PRIVATE. Notification destination, not public contact info. Omitted from public_designer_profile.';

-- ---------------------------------------------------------------------------
-- category — editable list backing the category control (FR-015)
-- ---------------------------------------------------------------------------
create table category (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references designer (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 50),
  created_at timestamptz not null default now(),

  constraint category_name_unique_per_owner unique (owner_id, name)
);

comment on table category is
  'Category names appear in public filter controls, but ONLY through the '
  'public_categories view, which omits owner_id and is gated on the category having '
  'at least one published design (FR-030a).';

-- RLS is enabled here; policies arrive in 0006 (owner grants) and 0007 (deny anon).
alter table designer enable row level security;
alter table category enable row level security;
