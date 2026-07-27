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

**RLS**: Owner full access where `owner_id = auth.uid()`. **Anonymous `SELECT` is denied on this table.**
Public filter options come from the `public_categories` view below.

> Granting anonymous `SELECT` here was the original design and it was wrong on two counts: it returns
> `owner_id` to visitors, and it lets a visitor enumerate categories that exist only on **draft**
> designs — leaking the shape of unreleased work and contradicting FR-030a.

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
| `seo_title` | `text` | nullable — see note | stored, unused in v1 | FR-035 |
| `seo_description` | `text` | nullable — see note | stored, unused in v1 | FR-035 |

**SEO fields stay null in v1, and the default is resolved at read time, not stored.** FR-035 says they
"default to" the title and public description. Materialising that on insert would leave the copies stale
the moment the designer edits either source field. Both columns are therefore nullable, no v1 code writes
them, and the v1.1 renderer coalesces: `coalesce(seo_title, title)` and
`coalesce(seo_description, public_description)`.
| `created_at` | `timestamptz` | not null, default `now()` | **yes** | FR-014 |
| `updated_at` | `timestamptz` | not null, default `now()`, **maintained by trigger** | no | FR-014 |

**`updated_at` requires a `BEFORE UPDATE` trigger**, not just a default. A column default fires only on
insert, so without the trigger the "last-updated time" FR-014 asks for would silently remain the
creation time forever. The same trigger is applied to `designer`.

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

---

## The other three public views

Anonymous callers reach **no base table**. Every public read goes through one of four views, each with an
explicit column list and a published gate. FR-025a requires this for every publicly reachable entity, not
just designs.

### `public_designer_profile`

```sql
create view public_designer_profile
with (security_invoker = off) as
select name, bio, profile_photo_path
from designer;
```

`email` is omitted, keeping the notification address unreachable (FR-028).

### `public_categories`

```sql
create view public_categories
with (security_invoker = off) as
select distinct c.id, c.name
from category c
join design d on d.category_id = c.id
where d.published = true;
```

Two things this fixes. `owner_id` is omitted. And the join to published designs means **a category used
only by drafts does not appear** — without it, a visitor reading the filter control could infer that
unreleased work exists in a category with nothing published in it (FR-030a). The same pattern applies to
the collection filter, which is derived from `public_designs.collection` rather than a table.

### `public_photos`

```sql
create view public_photos
with (security_invoker = off) as
select p.id, p.design_id, p.position, p.display_path,
       p.blur_placeholder, p.alt_text, p.width, p.height
from photo p
join design d on d.id = p.design_id
where d.published = true;
```

**`original_path` is omitted.** Exposing it handed visitors the storage path of the full-resolution
original, which FR-010 forbids outright. The published gate means a draft's photo rows are invisible.

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

**RLS**: Owner full access via join to the parent design's `owner_id`. **Anonymous `SELECT` is denied on
this table**; public reads go through `public_photos`.

### Storage and image delivery (FR-009a)

| Bucket | Visibility | Contents |
|---|---|---|
| `originals` | **private** | `originals/{design_id}/{photo_id}.{ext}` — never served to a visitor (FR-010) |
| `display` | **private** | `display/{design_id}/{photo_id}.webp` — compressed variants (FR-009) |

**Both buckets are private.** Visitors receive images through an application route,
`/img/{photo_id}/{width}`, which on every request:

1. looks the photo up in `public_photos` — so an unpublished or deleted design yields nothing;
2. returns an identical 404 if there is no row;
3. otherwise reads the display object and returns its **bytes, resized to the requested width**.

**No signed URL is issued and no storage address reaches a client** (research D11, as amended
2026-07-27). An earlier form of this route redirected to a 60-second signed URL; that address kept
working for its full lifetime even if the design was unpublished a second later, and it ignored the width
in the path, so a 640px grid tile fetched the stored 2048px variant. Serving the bytes closes both.

Conditional requests are answered with an `ETag` of `{photo_id}-{width}` — but **only after step 1**. A
`304` returned ahead of the publication check would confirm to anyone holding a stale ETag that a
withdrawn image still exists, which is the inference FR-023 forbids.

> **Why not a public `display` bucket.** A public bucket was the original design and it broke FR-023. RLS
> gates the `photo` *table*, not the storage object, so once a design had been published its image URL
> was disclosed permanently — moving the design back to draft removed it from the storefront while the
> photograph itself stayed downloadable forever by anyone who had the link. The route re-checks
> publication on every request, so revocation is immediate — and because the route returns the bytes
> rather than an address, there is **no residual window at all**: nothing is left holding a key.
>
> The cost is that image requests hit the application rather than the CDN edge directly, and spend CPU
> resizing. At the launch scale of 50 designs this is immaterial (Principle V); repeat views revalidate
> to `304`, and a request at or above the stored width returns the stored bytes without re-encoding.

**Deletion removes files, not just rows.** The `photo` row cascades when its design is deleted, but a
cascade does not touch object storage. Deleting a design MUST also delete both the `originals/{design_id}/`
and `display/{design_id}/` prefixes (FR-019). Without that, a deleted design's photographs would remain in
the bucket indefinitely — recoverable by anyone who could obtain a signed URL, and a silent privacy debt.

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
| `read` | `boolean` | not null, default `false` — **written by nothing in v1** | FR-038 |
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

**Retention**: no automatic expiry in v1. Rows persist indefinitely; manual deletion arrives with the
v1.1 inbox, since FR-042 gives v1 no surface offering it (FR-045).

**RLS**:

- Anonymous `INSERT` — **denied.** Writes happen only in the submission route, using a server-side key,
  after the honeypot and rate-limit checks have passed (FR-041c).
- Anonymous `SELECT` — denied. A visitor cannot read any inquiry, including their own; there is no
  session to scope it to and FR-046 forbids exposing who has inquired.
- Owner `SELECT`/`UPDATE`/`DELETE` where the inquiry belongs to their designs or is orphaned.

> **Why anonymous `INSERT` had to go.** The original design granted it, with the honeypot and rate limit
> living in the route handler. But the anon key is published in the browser bundle by necessity — so a bot
> could POST straight to the data layer's REST endpoint, skip the route entirely, and write unlimited
> inquiries while setting `sender_hash`, `delivery_state`, and `design_title_snapshot` to anything it
> liked. FR-041 and FR-041a were enforced only for clients that chose to cooperate.
>
> A `SECURITY DEFINER` RPC callable by anon does not fix this either: the rate limit keys on
> `sender_hash`, which Postgres cannot derive itself, so a caller passing its own hash could evade the
> limit by varying it. Making the server the only writer is the one arrangement where the checks cannot
> be routed around — which is the "structural, not disciplinary" standard the plan sets for itself.

**Server-side write path**: the route computes `sender_hash` from the request IP, enforces the honeypot
and both rate-limit windows, captures `design_title_snapshot`, and only then inserts. The service-role
key used for this insert is server-only and MUST NOT reach any client bundle.

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
| `design` → `photo` | **Cascade** (rows) **+ explicit file deletion** | Photos are constituent parts of the design; a row cascade does not touch object storage |
| `design` → `inquiry` | **Set null**, snapshot retained | FR-044: a real lead must outlive the piece |
| `category` → `design` | **Restricted** | Prevents a design silently losing its category |
| `designer` → everything | Cascade | Single-owner account; removal means removing the site |

## Anonymous access surface

The complete list of what an unauthenticated caller can reach. Anything not on it is denied.

| Surface | Kind | Notes |
|---|---|---|
| `public_designs` | view, read | Published only; `notes` absent |
| `public_designer_profile` | view, read | `email` absent |
| `public_categories` | view, read | Published-gated; `owner_id` absent |
| `public_photos` | view, read | Published-gated; `original_path` absent |
| `increment_design_view(slug)` | function, write | Increments one counter on a published row; returns nothing |
| `/img/{photo_id}/{width}` | route, read | Re-checks publication, then returns resized bytes — no signed URL, no storage address |
| `/img/profile` | route, read | The designer's avatar. No publication gate: `name`, `bio` and photo are public by definition (FR-028). Path from `public_designer_profile`, so `email` is unreachable |

**No base table is anonymously readable. No table is anonymously writable.** Inquiry submission is
server-mediated (FR-041c), so it does not appear here.

## Requirements traceability

| Requirement | Enforced by |
|---|---|
| FR-021 (draft by default) | `design.published` default `false` |
| FR-022, FR-023 (drafts invisible, indistinguishable) | Published gate on all four public views + no anonymous policy on any base table |
| FR-023a/b (non-enumerable, stable slug) | `slug` unique + insert-only trigger |
| FR-024 (`notes` never public) | Column omitted from `public_designs` |
| FR-025a (explicit projections) | Four column-listed views; zero anonymous table grants |
| FR-009a (image access revoked on unpublish) | Private buckets + `/img` route re-checking `public_photos` per request |
| FR-010 (originals never public) | `original_path` omitted from `public_photos`; `originals` bucket private |
| FR-019 (delete removes files) | Explicit deletion of both storage prefixes alongside the row cascade |
| FR-030a (filter options from published only) | `public_categories` join to published designs |
| FR-012b (alt text always present) | Render-time fallback from title + position |
| FR-013a (no zero-photo design) | Design not inserted until one photo is processed |
| FR-014 (last-updated maintained) | `BEFORE UPDATE` touch trigger on `design` and `designer` |
| FR-041/041a/041c (abuse checks unbypassable) | No anonymous `INSERT`; server-only write after checks |
| FR-043/044/045 (inquiry survives, no expiry) | `on delete set null` + snapshot; no purge job |
| FR-046 (inquiries private) | No anonymous `SELECT` policy on `inquiry` |
| FR-003 (server-side ownership) | RLS `owner_id = auth.uid()` on every owner policy |
| SC-012 (no layout shift) | Non-null `photo.width`/`height` + `blur_placeholder` |
