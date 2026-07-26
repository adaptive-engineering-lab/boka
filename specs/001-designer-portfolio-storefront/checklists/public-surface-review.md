# Public-Surface Review Gate

**Purpose**: Satisfy the constitution's mandated public-surface review (Quality Gates,
[constitution.md](../../../.specify/memory/constitution.md)).
**Created**: 2026-07-26

## When this applies

Run this checklist before merging any change that touches:

- a route under `app/(public)/` or `app/img/`
- any of the four public views, or `lib/data/public-designs.ts`
- the `published` flag, or anything that reads it
- RLS policies, storage bucket visibility, or storage paths
- the inquiry submission route or its abuse checks

Skipping it because a change "looks small" is how the defects below got in. Two of them were introduced
by a design that had already passed a Constitution Check.

## Checklist

### Principle II — nothing private becomes reachable

- [ ] Every new or changed public read goes through a `public_*` view with an **explicit column list**, not a base table
- [ ] No column added to a base table has silently entered a public view
- [ ] `notes`, `owner_id`, `original_path`, `view_count`, `seo_*`, `updated_at`, and designer `email` appear in no public response, page, metadata, or hydration payload
- [ ] Every public view is still gated on `published = true`
- [ ] No anonymous `SELECT`, `INSERT`, `UPDATE`, or `DELETE` grant has been added to any base table
- [ ] Draft, deleted, and nonexistent remain **byte-identical** in every not-found response
- [ ] Filter and facet options are derived from published rows only — no draft-only value can appear

### Storage and images

- [ ] Both buckets remain **private**; neither has been flipped to public
- [ ] Every image is served through `/img/{photo_id}/{width}`, which re-checks publication per request
- [ ] Signed URL lifetime is still short (60s) and cannot be renewed for an unpublished design
- [ ] Deleting a design still deletes both storage prefixes, not just the rows

### Principle I — the visitor can still only look

- [ ] No buy, cart, checkout, comment, favourite, upload, edit, or delete affordance is reachable by a visitor
- [ ] No public route requests authentication, and none creates a session or cookie
- [ ] Inquiry submission remains the only visitor action, and the **write is still server-mediated**
- [ ] Honeypot and rate-limit checks cannot be bypassed by calling the data layer directly

### Tests

- [ ] `draft-invisibility.spec.ts` still passes, **including the image-URL revocation assertion**
- [ ] `notes-privacy.spec.ts` still passes, asserting against raw response bodies
- [ ] `view-only.spec.ts` and `filter-leakage.spec.ts` still pass
- [ ] Any new public surface has been added to the relevant spec, not just manually checked

## Reviewer note

The three defects this gate exists to catch were all invisible to table-level reasoning:

1. A **public storage bucket** meant images outlived their design's publication — RLS protected the
   `photo` row while the object stayed world-readable.
2. **Anonymous grants on `category` and `photo`** leaked `owner_id` and `original_path` and let a visitor
   enumerate draft-only categories.
3. **Anonymous `INSERT` on `inquiry`** let a bot skip the submission route and its abuse checks entirely.

The common thread: each was correct at the layer it was reviewed at, and wrong end to end. Evaluate
per reachable surface — table, view, route, and stored object — not per table.
