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

> ### Run 1 — Phase 4 / US2, the storefront increment (2026-07-26)
>
> The first time this gate has been exercised. Every public route in the project was created
> in this increment, so the review covers all of them: `/`, `/d/{slug}`, `/img/{photo}/{width}`
> and the newly added `/img/profile`.
>
> Verified against a **production build**, not `next dev` — see the note under "Tests" below.
> Marks below refer to that run.

### Principle II — nothing private becomes reachable

- [X] Every new or changed public read goes through a `public_*` view with an **explicit column list**, not a base table
      — every public route imports `lib/data/public-designs.ts` and nothing else; that module touches only the four views.
- [X] No column added to a base table has silently entered a public view — no base-table columns were added this increment.
- [X] `notes`, `owner_id`, `original_path`, `view_count`, `seo_*`, `updated_at`, and designer `email` appear in no public response, page, metadata, or hydration payload
      — `notes-privacy.spec.ts` asserts the first six as absent JSON keys on `public_designs` *and* as absent substrings of the HTML, the `<meta>` description and the RSC flight payload; `view-only.spec.ts` covers `original_path` and `email`.
- [X] Every public view is still gated on `published = true` — unchanged; verified behaviourally by `draft-invisibility.spec.ts`.
- [X] No anonymous `SELECT`, `INSERT`, `UPDATE`, or `DELETE` grant has been added to any base table
      — `view-only.spec.ts` reads and writes all four base tables with the anon key and requires ≥400 on every attempt. Migration `0011` grants DML to `authenticated` and `service_role` **only**, and asserts `anon` holds none.
- [X] Draft, deleted, and nonexistent remain **byte-identical** in every not-found response
      — `draft-invisibility.spec.ts` compares raw bodies for all three, using a probe slug of identical length and shape so `Content-Length` cannot differ innocently.
      Exactly two normalizations are applied, both in `tests/e2e/helpers/canonical.ts`: **(1)** the requested path, which Next echoes into the router payload and which the visitor already knows; **(2)** the *order* of React's streamed `self.__next_f.push(...)` flight chunks, which is non-deterministic — two 404s of identical length (12622 bytes each) were observed diverging at offset 8675 purely in chunk sequence. Chunk *contents* are untouched and no rendered markup, attribute or value is normalized, so a response that mentions a draft's title, category or notes still fails. This was a fix to a **flaky mandatory gate**, which is worse than a strict one because it gets ignored.
- [X] Filter and facet options are derived from published rows only — no draft-only value can appear
      — `filter-leakage.spec.ts`, with a control asserting a published category *does* appear, so it cannot pass by rendering nothing.

### Storage and images

- [X] Both buckets remain **private**; neither has been flipped to public
      — migration `0010`'s assertion still runs, and `view-only.spec.ts` confirms unsigned access to both buckets is refused.
- [X] Every image is served through `/img/{photo_id}/{width}`, which re-checks publication per request
      — `view-only.spec.ts` extracts every `<img src>` on the detail page and requires each to start with `/img/`.
      **One deliberate exception, recorded rather than ticked blindly:** `/img/profile` has **no publication gate**. The designer's name, bio and photo are public by definition (FR-028), so there is nothing to withhold. It still reads its path from `public_designer_profile` (which omits `email`) and still issues only a short-lived signed URL into the private `display` bucket. Covered by its own test.
      A second exception exists but is **not a public surface**: `/studio/img/{photo}/{width}` serves the owner's drafts to the dashboard, session-required and RLS-scoped. `/img` was deliberately *not* relaxed for signed-in requests — a conditional inside the publication gate is the one change that could make T060 pass while visitors leaked.
- [X] Signed URL lifetime is still short (60s) and cannot be renewed for an unpublished design
      — `IMAGE_SIGNED_URL_TTL_SECONDS` defaults to 60 and is capped at 300 in code; renewal requires a `public_photos` row, which an unpublished design does not have.
- [X] Deleting a design still deletes both storage prefixes, not just the rows
      — `storage-cleanup.test.ts` asserts both prefixes empty after delete; `draft-invisibility.spec.ts` independently confirms the image URL 404s after deletion.

### Principle I — the visitor can still only look

- [X] No buy, cart, checkout, comment, favourite, upload, edit, or delete affordance is reachable by a visitor
      — `view-only.spec.ts` scans for twelve commerce/interaction phrases, requires every public `<form>` to be `method="get"`, and asserts no `/studio` link appears.
- [X] No public route requests authentication, and none creates a session or cookie
      — asserted on `/` and on a 404 slug: no `/auth/sign-in` reference, no "sign in to" copy, no `sb-` cookie in any `Set-Cookie`.
- [ ] Inquiry submission remains the only visitor action, and the **write is still server-mediated**
      — **N/A this increment.** There is no inquiry surface until T066–T069 (US3). Left unticked deliberately: ticking it now would record a guarantee about code that does not exist.
- [ ] Honeypot and rate-limit checks cannot be bypassed by calling the data layer directly
      — **N/A this increment.** Same reason. `inquiry` has no table yet (T064).

### Tests

- [X] `draft-invisibility.spec.ts` still passes, **including the image-URL revocation assertion**
      — the URL is captured while published, then re-requested after unpublish (404), after republish (200) and after delete (404).
- [X] `notes-privacy.spec.ts` still passes, asserting against raw response bodies
      — HTML, `<meta>`, and the RSC flight payload under both `RSC: 1` and prefetch headers. Includes a control confirming the sentinel really was stored, so the negative assertions cannot pass vacuously.
- [X] `view-only.spec.ts` and `filter-leakage.spec.ts` still pass
- [X] Any new public surface has been added to the relevant spec, not just manually checked
      — `/img/profile` has its own test in `view-only.spec.ts`.

> **The suite runs against a production build.** `playwright.config.ts` builds and starts the
> app rather than using `next dev`, because these gates assert on the bytes a visitor
> receives. A dev server embeds error-overlay payloads and stack traces that no visitor sees:
> the byte-identical 404 comparison fails on that noise, and — worse — a comparison of dev
> output could pass while production leaked. `E2E_DEV=1` opts back into the dev server for
> iterating on non-privacy specs only.

## Reviewer note

The three defects this gate exists to catch were all invisible to table-level reasoning:

1. A **public storage bucket** meant images outlived their design's publication — RLS protected the
   `photo` row while the object stayed world-readable.
2. **Anonymous grants on `category` and `photo`** leaked `owner_id` and `original_path` and let a visitor
   enumerate draft-only categories.
3. **Anonymous `INSERT` on `inquiry`** let a bot skip the submission route and its abuse checks entirely.

The common thread: each was correct at the layer it was reviewed at, and wrong end to end. Evaluate
per reachable surface — table, view, route, and stored object — not per table.
