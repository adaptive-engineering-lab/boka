-- T021 — seed the single owner account and starter categories.
--
-- Public signup is disabled (config.toml), so the owner cannot self-register. That is
-- deliberate: Principle I's premise is that there is no visitor role to authenticate,
-- and an open signup endpoint would hand anyone a session.
--
-- LOCAL DEVELOPMENT ONLY. On the hosted project, create the user through the Supabase
-- dashboard or the Admin API and insert the matching `designer` row — that is task T081.
-- Never commit real credentials here.

do $$
declare
  -- v_ prefix is not decoration. Naming these `owner_id`/`owner_email` makes
  -- `insert into category (owner_id, ...) values (owner_id, ...)` ambiguous: Postgres
  -- cannot tell the variable from the column and raises 42702.
  v_owner_id    uuid := '00000000-0000-4000-8000-000000000001';
  v_owner_email text := 'designer@boka.local';
begin
  -- auth.users is normally written by GoTrue. Inserting directly is acceptable for a
  -- local seed and nowhere else.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  values (
    v_owner_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_owner_email,
    crypt('boka-local-dev', gen_salt('bf')),   -- local only
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
  )
  on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  )
  values (
    gen_random_uuid(), v_owner_id, v_owner_id::text, 'email',
    format('{"sub":"%s","email":"%s","email_verified":true}', v_owner_id, v_owner_email)::jsonb,
    now(), now(), now()
  )
  on conflict do nothing;

  insert into designer (id, email, name, bio)
  values (
    v_owner_id,
    v_owner_email,
    'Boka',
    'Made by hand, in small numbers.'
  )
  on conflict (id) do nothing;

  -- Starter categories (FR-015). The designer can extend this list.
  -- Column names here stay `owner_id`; only the VALUES use the variable.
  insert into category (owner_id, name)
  values (v_owner_id, 'Dress'), (v_owner_id, 'Outerwear'), (v_owner_id, 'Accessory')
  on conflict (owner_id, name) do nothing;

  raise notice 'Seeded owner % — sign in with % / boka-local-dev', v_owner_id, v_owner_email;
end;
$$;
