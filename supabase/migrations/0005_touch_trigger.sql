-- T015 — updated_at maintenance (FR-014).
--
-- `default now()` fires only on INSERT. Without this trigger the "last-updated time"
-- FR-014 asks for would silently remain the creation time forever — a gap
-- /speckit-analyze caught as C3.

create or replace function boka_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  -- created_at is immutable: an UPDATE must never be able to rewrite history.
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger design_touch_updated_at
  before update on design
  for each row
  execute function boka_touch_updated_at();

create trigger designer_touch_updated_at
  before update on designer
  for each row
  execute function boka_touch_updated_at();
