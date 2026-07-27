-- T064 — the inquiry table (FR-038, FR-043, FR-044, FR-045).
--
-- An inquiry is the only thing a visitor can create, and it is the only table holding data
-- about someone other than the designer. Two decisions here are deliberately the opposite of
-- how `photo` behaves, and both are about the fact that an inquiry is a person waiting for a
-- reply rather than a part of a design.

create type inquiry_delivery_state as enum ('pending', 'delivered', 'undelivered');

comment on type inquiry_delivery_state is
  'pending -> delivered on a successful send; pending -> undelivered once retries are '
  'exhausted, which is what surfaces the dashboard banner (FR-040b).';

create table inquiry (
  id                    uuid primary key default gen_random_uuid(),

  -- ON DELETE SET NULL, not cascade. Deleting a design must not delete the people who wrote
  -- about it (FR-044) — the deliberate opposite of `photo`, which is constituent and cascades.
  design_id             uuid references design (id) on delete set null,

  -- Which is why the title is snapshotted at submission (FR-043): once design_id is null this
  -- is the only thing that makes the inquiry readable. Copying it is not denormalisation for
  -- speed, it is the record's independence from a row that may not survive.
  design_title_snapshot text not null check (char_length(trim(design_title_snapshot)) between 1 and 120),

  visitor_name          text not null check (char_length(trim(visitor_name)) between 1 and 120),
  -- Format is validated in the submission route (FR-037). The constraint here is a floor, not
  -- the check: a regex strict enough to be worth writing rejects valid addresses.
  visitor_email         text not null check (char_length(visitor_email) between 3 and 320),
  message               text check (char_length(message) <= 2000),

  -- v1.1-facing (FR-038). Nothing in v1 writes it: FR-042 gives v1 no inbox on which to mark
  -- anything read, so a `read` flag that the application flipped would be lying.
  read                  boolean not null default false,

  delivery_state        inquiry_delivery_state not null default 'pending',
  delivery_attempts     integer not null default 0 check (delivery_attempts >= 0),

  -- Clears the banner without deleting the record (FR-040c).
  acknowledged          boolean not null default false,

  -- A salted hash of the client IP, never the address itself (research D7). The row already
  -- holds the contact details the visitor chose to give; retaining their network address on
  -- top of that would be collecting more than they offered, for a counting problem.
  sender_hash           text not null,

  created_at            timestamptz not null default now()
);

comment on column inquiry.sender_hash is
  'Salted hash of the client IP, computed server-side (FR-041). Never the raw address. A '
  'client-supplied value would make the rate limit trivially evadable by varying it.';

comment on column inquiry.read is
  'Stored in v1, written by nothing in v1. FR-042 defers the inbox to v1.1.';

-- The rate-limit count: 5/hour and 20/day for one sender (FR-041).
create index inquiry_sender_window_idx on inquiry (sender_hash, created_at desc);

-- The dashboard banner and the cron sweep both read by state. Partial, because `delivered` is
-- the overwhelming majority and neither query ever wants it.
create index inquiry_unresolved_idx on inquiry (delivery_state, created_at)
  where delivery_state <> 'delivered';

alter table inquiry enable row level security;
