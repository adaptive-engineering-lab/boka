-- T014 — slug generation (FR-023a, FR-023b).
--
-- Two properties matter:
--
--   1. The random suffix makes the identifier space non-enumerable. A sequential id or
--      a bare title slug would let a visitor probe for unpublished work by guessing
--      neighbouring URLs, which FR-023 forbids.
--   2. Generation happens on INSERT ONLY. Renaming a design must not change its public
--      URL, so links already shared keep resolving (FR-023b).

-- Deliberately excludes look-alike characters (0/o, 1/l/i) — these end up read aloud
-- and typed by hand.
create or replace function boka_random_suffix(len integer default 4)
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  result   text := '';
  i        integer;
begin
  for i in 1..len loop
    result := result || substr(alphabet, 1 + floor(random() * char_length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function boka_slugify(input text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      trim(both '-' from
        regexp_replace(
          regexp_replace(lower(input), '[^a-z0-9]+', '-', 'g'),
          '-{2,}', '-', 'g'
        )
      ),
      ''
    ),
    'design'  -- a title of only punctuation still needs a usable stem
  );
$$;

create or replace function boka_assign_slug()
returns trigger
language plpgsql
as $$
declare
  stem      text;
  candidate text;
  attempts  integer := 0;
begin
  -- Never regenerate. An UPDATE that changes the title leaves the slug alone (FR-023b).
  if new.slug is not null and new.slug <> '' then
    return new;
  end if;

  stem := left(boka_slugify(new.title), 60);

  loop
    candidate := stem || '-' || boka_random_suffix(4);
    exit when not exists (select 1 from design where slug = candidate);

    attempts := attempts + 1;
    if attempts >= 10 then
      -- ~1M combinations per stem against a catalogue of 50 designs: reaching this
      -- means something is wrong, so fail loudly rather than loop forever.
      raise exception 'Could not generate a unique slug for % after % attempts', new.title, attempts;
    end if;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

-- BEFORE INSERT only. Not BEFORE UPDATE — that is the whole point.
create trigger design_assign_slug
  before insert on design
  for each row
  execute function boka_assign_slug();
