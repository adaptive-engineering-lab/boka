# Phase 1 Data Model: Designer Portfolio Storefront

**Feature**: `001-designer-portfolio-storefront`
**Date**: 2026-07-26
**Depends on**: [research.md](./research.md) D2, D3, D4

Every table has Row Level Security enabled. The default posture is deny; each policy below is an
explicit, narrow grant. Column-level privacy is enforced structurally by the `public_designs` view
(D3), not by application-side filtering.

---

## Entity: `designer`

The single owner account. One row, seeded manually; public sign-up is disabled (research D2).

| Column | Type | Constraints | Source |
|---|---|---|---|
| `id` | `uuid` | PK, references `auth.users(id)` | — |
| `email` | `text` | not null, unique | Spec Key Entities |
| `name` | `text` | not null | Spec Key Entities |
| `bio` | `text` | nullable | FR-028 |
| `profile_photo_path` | `text` | nullable | FR-028 |
| `created_at` | `timestamptz` | not null, default `now()` | — |
| `updated_at` | `timestamptz` | not null, default `now()` | — |

**Validation**: `bio` capped at 2000 characters so the homepage layout stays predictable at mobile
width (edge case: very long text). `email` is where inquiry notifications are sent (FR-039).

**RLS**:
- Anonymous `SELECT` — **denied on this table**. Public access to `name`, `bio`, and
  `profile_photo_path` is granted through the `public_designer_profile` view only, so `email` is never
  reachable publicly.
- Owner `SELECT`/`UPDATE` where `id = auth.uid()`.
- No `INSERT`/`DELETE` policy — the row is provisioned out of band.

---

## Entity: `category`

An editable list backing the category dropdown (FR-015).

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `owner_id` | `uuid` | not null, FK → `designer(id)` |
| `name` | `text` | not null, unique per owner, 1–50 chars |
| `created_at` | `timestamptz` | not null, default `now()` |

**Seed**: `Dress`, `Outerwear`, `Accessory` (spec Assumptions — starter categories, extensible).

**Deletion rule**: A category in use by any design cannot be deleted; the designer must reassign those
designs first. This prevents a design silently losing its category.

**RLS**: Owner full access where `owner_id = auth.uid()`. Anonymous `SELECT` allowed — category names
appear in the public filter control (FR-030) and carry no private information.

---

## Entity: `design`

The central record. **This table is never read anonymously** (research D3).

| Column | Type | Constraints | Public? | Source |
|---|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | no | — |
| `owner_id` | `uuid` | not null, FK → `designer(id)` | no | FR-003 |
| `slug` | `text` | not null, unique | **yes** | FR-023a |
| `title` | `text` | not null, 1–120 chars | **yes** | FR-013 |
| `category_id` | `uuid` | nullable, FK → `category(id)` | **yes** | FR-013 |
| `collection` | `text` | nullable, ≤ 80 chars | **yes** | FR-016 |
| `notes` | `text` | nullable | **NO — never** | FR-024 |
| `public_description` | `text` | nullable, ≤ 2000 chars | **yes** | FR-025 |
| `published` | `boolean` | not null, default `false` | gate | FR-021 |
| `view_count` | `integer` | not null, default 0 | no | FR-034 |
| `seo_title` | `text` | nullable | stored, unused in v1 | FR-035 |
| `seo_description` | `text` | nullable | stored, unused in v1 | FR-035 |
| `created_at` | `timestamptz` | not null, default `now()` | **yes** | FR-014 |
| `updated_at` | `timestamptz` | not null, default `now()` | no | FR-014 |

**`published` defaults to `false`** (FR-021). This is the single most important default in the schema:
a design created by any means is invisible until deliberately published.

**`slug` generation** (FR-023a, research D4): computed once in a `BEFORE INSERT` trigger as
`kebab(title) || '-' || random_suffix(4)`. Never recomputed on `UPDATE`, satisfying FR-023b. On unique
violation, the suffix is regenerated and insertion retried.

**Indexes**: unique on `slug`; `(owner_id, created_at DESC)` for the dashboard grid;
`(published, created_at DESC)` for the storefront grid; `(owner_id, category_id)` and
`(owner_id, collection)` for filtering (FR-018, FR-030).

**State transitions**:

```
                    publish (FR-026)
   ┌─────────┐ ──────────────────────▶ ┌───────────┐
   │  draft  │                          │ published │
   │(default)│ ◀────────────────────── │           │
   └─────────┘      unpublish           └───────────┘
        │           (FR-026)                  │
        └──────────────┬─────────────────────┘
                       ▼  delete (FR-019)
                   [removed]
        photos cascade · inquiries survive (FR-044)
```

Both transitions are available at any time and take effect on the visitor's next load (FR-026). There
is no intermediate or approval state — the constitution's Principle V puts a status workflow out of
scope.

**RLS**:
- Owner: full `SELECT`/`INSERT`/`UPDATE`/`DELETE` where `owner_id = auth.uid()` (FR-003).
- Anonymous: **no policy at all**. With RLS enabled and no grant, anonymous reads return zero rows —
  the fail-closed property that makes Principle II structural rather than procedural.

---

## View: `public_designs`

The only path by which a visitor's request reaches design data.

```sql
create view public_designs
with (security_invoker = off) as
select id, slug, title, category_id, collection,
       public_description, created_at
from design
where published = true;
```

Two properties do the constitutional work:

1. **`notes` is not in the column list.** There is no code path where an anonymous caller holds a row
   containing it (FR-024). Adding a private column to `design` later does not widen this view.
2. **`where published = true`** means a draft and a non-existent design both produce zero rows, so
   "not found" is returned identically for each with no conditional logic (FR-023).

`view_count`, `seo_title`, `seo_description`, `owner_id`, and `updated_at` are also omitted — none is
needed by a public surface in v1.

A parallel `public_designer_profile` view exposes only `name`, `bio`, and `profile_photo_path` from
`designer`, keeping `email` unreachable (FR-028).

---

## Entity: `photo`

| Column | Type | Constraints | Source |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | — |
| `design_id` | `uuid` | not null, FK → `design(id)` **on delete cascade** | — |
| `position` | `integer` | not null, ≥ 0, unique per design | FR-012b |
| `original_path` | `text` | not null | FR-010 |
| `display_path` | `text` | not null | FR-009 |
| `blur_placeholder` | `text` | not null | FR-011 |
| `alt_text` | `text` | nullable, ≤ 250 chars | FR-012a |
| `width` / `height` | `integer` | not null, > 0 | SC-012 |
| `created_at` | `timestamptz` | not null, default `now()` | — |

**`alt_text` fallback** (FR-012b): when null or blank, rendered alt text is
`"{design.title}, photo {position + 1} of {count}"`. The fallback is computed at render time, not
stored, so it stays correct when the design is renamed or photos are reordered. **No photo ever renders
without alt text.**

**`width`/`height` are not optional.** They are required to reserve layout space before the image
loads, which is what SC-012 (no visible layout shift) actually depends on.

**`blur_placeholder`** holds a tiny inline base64 LQIP, available in the first server render with no
extra request (research D5).

**Cascade on design deletion** is correct here and deliberately differs from `inquiry` below: photos
are part of the design, inquiries are not.

**RLS**: Owner full access via join to the parent design's `owner_id`. Anonymous `SELECT` permitted
**only** for photos whose parent design is published — the same gate as `public_designs`, so a draft's
photos are unreachable even with a direct storage-path guess.

**Storage**: `originals/{design_id}/{photo_id}.{ext}` in a **private** bucket (designer-only, FR-010);
`display/{design_id}/{photo_id}.webp` in a **public** bucket (FR-009). Public surfaces reference the
display bucket exclusively.

---

## Entity: `inquiry`

Created by an unauthenticated visitor; readable only by the designer (FR-046).

| Column | Type | Constraints | Source |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | — |
| `design_id` | `uuid` | nullable, FK → `design(id)` **on delete set null** | FR-044 |
| `design_title_snapshot` | `text` | not null | FR-043 |
| `visitor_name` | `text` | not null, 1–120 chars | FR-037 |
| `visitor_email` | `text` | not null, format-validated | FR-037 |
| `message` | `text` | nullable, ≤ 2000 chars | FR-037 |
| `read` | `boolean` | not null, default `false` | FR-038 |
| `delivery_state` | enum | not null, default `pending` | FR-040b |
| `delivery_attempts` | `integer` | not null, default 0 | FR-040a |
| `acknowledged` | `boolean` | not null, default `false` | FR-040c |
| `sender_hash` | `text` | not null | FR-041 |
| `created_at` | `timestamptz` | not null, default `now()` | — |

**`on delete set null` with a title snapshot** is the mechanism behind Clarification Q3. Deleting a
design does not delete the inquiry; the visitor's contact details survive and the inquiry still reads
meaningfully via `design_title_snapshot` (FR-044). This is the deliberate opposite of `photo`'s cascade.

**`delivery_state`**: `pending` → `delivered` | `undelivered`.

```
  pending ──── send succeeds ────▶ delivered
     │
     └──── 3 attempts exhausted ──▶ undelivered ──▶ dashboard banner (FR-040b)
                                          │
                                          └── acknowledged = true ──▶ banner clears (FR-040c)
```

`acknowledged` clears the banner **without deleting the record** (FR-040c) — the inquiry remains
readable in the v1.1 inbox.

**`sender_hash`** is a salted hash of the client IP (research D7), never the raw address. Indexed with
`created_at` for the rate-limit count. Retaining a hash rather than an IP means the row holds no more
identifying data than the visitor deliberately submitted.

**Retention**: none. Rows persist until the designer deletes them (FR-045). No scheduled purge exists
in v1.

**RLS**:
- Anonymous `INSERT` — permitted, and it is the **only** anonymous write in the system (FR-004,
  Principle I). Guarded by the rate limit and honeypot before it is reached.
- Anonymous `SELECT` — **denied**. A visitor cannot read any inquiry, including their own; there is no
  session to scope it to and FR-046 forbids exposing who has inquired.
- Owner `SELECT`/`UPDATE`/`DELETE` where the inquiry belongs to their designs or is orphaned.

---

## Function: `increment_design_view(slug text)`

`SECURITY DEFINER`, callable anonymously. Increments `view_count` for one **published** design and
returns nothing (FR-034, research D8).

This is the only exception to "anonymous callers cannot write to `design`". It is deliberately
incapable of anything else: it takes a slug, touches one counter, ignores unpublished rows, and returns
no data — so it can neither be used to modify a design nor to probe whether a draft exists.

---

## Referential integrity summary

| Parent deleted | Child behaviour | Why |
|---|---|---|
| `design` → `photo` | **Cascade** | Photos are constituent parts of the design |
| `design` → `inquiry` | **Set null**, snapshot retained | FR-044: a real lead must outlive the piece |
| `category` → `design` | **Restricted** | Prevents a design silently losing its category |
| `designer` → everything | Cascade | Single-owner account; removal means removing the site |

## Requirements traceability

| Requirement | Enforced by |
|---|---|
| FR-021 (draft by default) | `design.published` default `false` |
| FR-022, FR-023 (drafts invisible, indistinguishable) | `public_designs` filter + absent anonymous RLS policy |
| FR-023a/b (non-enumerable, stable slug) | `slug` unique + insert-only trigger |
| FR-024 (`notes` never public) | Column omitted from `public_designs` |
| FR-012b (alt text always present) | Render-time fallback from title + position |
| FR-043/044/045 (inquiry survives, no expiry) | `on delete set null` + snapshot; no purge job |
| FR-046 (inquiries private) | No anonymous `SELECT` policy on `inquiry` |
| FR-003 (server-side ownership) | RLS `owner_id = auth.uid()` on every owner policy |
| SC-012 (no layout shift) | Non-null `photo.width`/`height` + `blur_placeholder` |
