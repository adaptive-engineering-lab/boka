-- T016 — owner-scoped RLS policies (FR-003).
--
-- Every policy keys on auth.uid(). This is what makes ownership checks structural: a
-- query written next year returns the owner's rows because the policy says so, not
-- because the query remembered to filter. Hiding a control in the UI is never the
-- barrier (FR-003).

-- ---------------------------------------------------------------------------
-- designer
-- ---------------------------------------------------------------------------
create policy designer_select_own
  on designer for select
  to authenticated
  using (id = (select auth.uid()));

create policy designer_update_own
  on designer for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No INSERT or DELETE policy. The single owner row is provisioned by seed.sql, out of
-- band — the application must never be able to create or remove an account.

-- ---------------------------------------------------------------------------
-- category
-- ---------------------------------------------------------------------------
create policy category_all_own
  on category for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- design
-- ---------------------------------------------------------------------------
create policy design_all_own
  on design for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- photo — ownership is reached through the parent design
-- ---------------------------------------------------------------------------
create policy photo_all_own
  on photo for all
  to authenticated
  using (
    exists (
      select 1 from design d
      where d.id = photo.design_id
        and d.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from design d
      where d.id = photo.design_id
        and d.owner_id = (select auth.uid())
    )
  );
