-- T013 — the photo table.
--
-- Note the deliberate asymmetry with `inquiry`: photos CASCADE when their design is
-- deleted because they are constituent parts of it, whereas inquiries survive because
-- a real lead must outlive the piece (FR-044).
--
-- A row cascade does not touch object storage. Deleting a design must also delete both
-- storage prefixes — that is application work, done in lib/data/designer-designs.ts
-- (FR-019). See the note at the bottom of this file.

create table photo (
  id               uuid primary key default gen_random_uuid(),
  design_id        uuid not null references design (id) on delete cascade,

  -- Ordering is meaningful (front, back, detail) and feeds the alt-text fallback.
  position         integer not null check (position >= 0),

  -- PRIVATE. Full-resolution original, retained for the designer's reference only
  -- (FR-010). Omitted from public_photos: exposing it would hand visitors the storage
  -- path of the original.
  original_path    text not null,

  -- Compressed variant. Still not directly reachable — the bucket is private and
  -- access goes through /img (FR-009a).
  display_path     text not null,

  -- Inline base64 LQIP, available in the first server render with no extra request.
  -- This is what makes zero layout shift achievable rather than aspirational (SC-012).
  blur_placeholder text not null,

  -- Optional designer-authored alt text (FR-012a). When null or blank, the renderer
  -- falls back to "{title}, photo {n} of {total}" (FR-012b). The fallback is computed
  -- at read time, not stored, so it stays correct after a rename or a reorder.
  alt_text         text check (char_length(alt_text) <= 250),

  -- NOT NULLABLE. Required to reserve layout space before the image loads, which is
  -- what SC-012 actually depends on.
  width            integer not null check (width > 0),
  height           integer not null check (height > 0),

  created_at       timestamptz not null default now(),

  constraint photo_position_unique_per_design unique (design_id, position)
);

comment on column photo.original_path is
  'PRIVATE. Omitted from public_photos (FR-010). No route serves originals.';

comment on table photo is
  'Rows cascade on design delete; STORAGE OBJECTS DO NOT. Deleting a design must also '
  'remove originals/{design_id}/ and display/{design_id}/ (FR-019).';

create index photo_design_position_idx on photo (design_id, position);

alter table photo enable row level security;
