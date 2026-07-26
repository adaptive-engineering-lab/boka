-- T020 — storage buckets (FR-009, FR-009a, FR-010).
--
-- BOTH BUCKETS ARE PRIVATE. This is finding N1, and it is the most consequential
-- correction in the schema.
--
-- The original design made `display` public. RLS gates the `photo` ROW, not the storage
-- OBJECT — so once a design had been published its image URL was disclosed permanently.
-- Moving the design back to draft removed it from the storefront while the photograph
-- itself stayed downloadable forever by anyone who had saved the link. An unpublished
-- garment was one bookmark away from being public.
--
-- Instead, visitors reach images only through /img/{photo_id}/{width}, which consults
-- public_photos on EVERY request and issues a 60-second signed URL. Revocation is
-- immediate; the signature window is the only residual exposure and cannot be renewed
-- once the design is unpublished.
--
-- Do not set either bucket to public. If images appear broken, the bug is in the route
-- or the view, not the bucket visibility.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'originals',
    'originals',
    false,                                  -- FR-010: never served to a visitor
    31457280,                               -- 30 MiB backstop; FR-012 caps a photo at 25 MB
    array['image/jpeg', 'image/png', 'image/heic', 'image/heif']
  ),
  (
    'display',
    'display',
    false,                                  -- FR-009a: private, gated by /img
    10485760,                               -- 10 MiB; compressed variants are far smaller
    array['image/webp']
  )
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Object policies: the owner manages files; anon gets nothing.
--
-- The server reads display objects with the service-role key in order to sign URLs, and
-- service-role bypasses RLS, so no anon policy is needed or wanted here.
-- ---------------------------------------------------------------------------
create policy storage_owner_manages_originals
  on storage.objects for all
  to authenticated
  using (bucket_id = 'originals')
  with check (bucket_id = 'originals');

create policy storage_owner_manages_display
  on storage.objects for all
  to authenticated
  using (bucket_id = 'display')
  with check (bucket_id = 'display');

-- ---------------------------------------------------------------------------
-- Assertion: neither bucket may be public.
--
-- This is the single check that would have caught N1. Keep it.
-- ---------------------------------------------------------------------------
do $$
declare
  offending text;
begin
  select string_agg(id, ', ') into offending
  from storage.buckets
  where id in ('originals', 'display') and public;

  if offending is not null then
    raise exception
      'FR-009a violation: storage bucket(s) % are PUBLIC. A public display bucket leaves images downloadable after unpublish.',
      offending;
  end if;
end;
$$;
