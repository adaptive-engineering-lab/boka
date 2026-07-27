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

> ### Run 2 — the `/img` amendment (2026-07-27)
>
> `/img`, `/studio/img` and `/img/profile` stopped redirecting to signed URLs and now return the
> object's bytes, resized to the requested width. This touches a public route, the image gate and
> the storage access path, so the whole checklist was re-run rather than only the image section.
>
> **Everything ticked in Run 1 still holds**; Run 2 annotations appear inline where an item's
> *reason* changed. Two items in "Storage and images" were rewritten because they no longer
> described the system, and one new item was added for the conditional-request ordering.
>
> The change is a Principle II improvement, not a performance trade: the previous design accepted a
> 60-second window during which an already-issued signature kept working after its design was
> unpublished. That window is now zero, because nothing is issued.
>
> 22/22 end-to-end specs pass on both engines against a fresh production build.
>
> **Process defect found and fixed during this run.** `playwright.config.ts` had
> `reuseExistingServer: !process.env.CI`, so a leftover `next start` was silently reused and the
> suite ran against stale code — the amended route was already written and the tests still observed
> the old 302. The dangerous version of that is a mandatory gate passing green against a build that
> no longer exists. The production path now refuses to reuse a running server.

> ### Run 3 — session lifecycle and the owner bar (2026-07-27)
>
> FR-001a (ending a session) and FR-002a (the designer's way back from the storefront). FR-002a is a
> deliberate, narrow exception to "the public surface shows nothing about authentication" — it puts a
> session read on public pages for the first time — so the whole checklist was re-run.
>
> **Everything ticked in Runs 1 and 2 still holds.** One item gained a Run 3 annotation because its
> *reason* changed, and three new items were added, inline below.
>
> The exception stays narrow because of one testable property: an unauthenticated response is
> unchanged. `session-lifecycle.spec.ts` proves it with a real before/after inside a single run —
> capture anonymous, sign in, confirm it differs for her, sign out, require byte-identical.
>
> 32/32 end-to-end specs pass on both engines.
>
> **A vacuous assertion was caught and fixed during this run**, worth recording because it is the
> failure this project keeps guarding against elsewhere. The sign-out test first read the session from
> `localStorage` — but `@supabase/ssr` stores it in a **cookie**, so the lookup returned null, the
> revocation check sat behind an `if (session)` that never ran, and the test passed having verified
> nothing. It now reads the cookie, asserts the token was extracted before using it, and was checked
> adversarially: the token refreshes with **200 before** sign-out and **400 after**.

> ### Run 4 — US3, the inquiry surface (2026-07-27)
>
> The first submission a visitor can make anywhere on this site, so the whole checklist was
> re-run. **The two items marked N/A since Run 1 are now assessable and ticked** — they described
> code that did not exist until this increment.
>
> One new item was added for FR-046 (inquiry data is the designer's alone), and the Principle I
> item gained a Run 4 note: the public surface now has exactly one write, and it is the one the
> constitution explicitly permits.
>
> 38/38 end-to-end specs and 16/16 integration tests pass on both engines, across two
> consecutive full runs.
>
> **A test-isolation defect was found and fixed during this run.** The E2E suite ran every
> submission from one machine, so all tests shared a `sender_hash` and consumed the 5-per-hour
> limit between them; a genuine submission started answering 429 while a honeypot submission
> answered 200, and the honeypot assertion failed for a reason unrelated to the honeypot. Each
> visitor context now carries its own `x-forwarded-for`. The first fix — a per-process counter —
> was **not** sufficient: it restarts on every invocation, and with an hour-long window the
> previous run's submissions were still counted. It is now random across three octets.

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
      *Run 2:* unchanged, and now stronger — the application no longer produces any URL into either bucket at all.
- [X] Every image is served through `/img/{photo_id}/{width}`, which re-checks publication per request
      — `view-only.spec.ts` extracts every `<img src>` on the detail page and requires each to start with `/img/`.
      **One deliberate exception, recorded rather than ticked blindly:** `/img/profile` has **no publication gate**. The designer's name, bio and photo are public by definition (FR-028), so there is nothing to withhold. It still reads its path from `public_designer_profile` (which omits `email`) and still issues only a short-lived signed URL into the private `display` bucket. Covered by its own test.
      A second exception exists but is **not a public surface**: `/studio/img/{photo}/{width}` serves the owner's drafts to the dashboard, session-required and RLS-scoped. `/img` was deliberately *not* relaxed for signed-in requests — a conditional inside the publication gate is the one change that could make T060 pass while visitors leaked.
- [X] ~~Signed URL lifetime is still short (60s) and cannot be renewed for an unpublished design~~
      **No signed URL is issued anywhere.** *(Item rewritten in Run 2 — it no longer described the system.)*
      `/img`, `/studio/img` and `/img/profile` read the object and return the bytes, so there is no address for a client to retain and **no residual window at all**, where the previous design accepted 60 seconds. `signDisplayUrl` and `IMAGE_SIGNED_URL_TTL_SECONDS` are gone; `grep` for either must return nothing outside the specs. Verified: no response from any image route carries a `Location` header.
- [X] Conditional requests cannot short-circuit the publication gate *(new in Run 2)*
      — `/img` answers `If-None-Match` with 304 **only after** the `public_photos` lookup succeeds. A 304 returned ahead of the gate would confirm to anyone holding a stale ETag that a withdrawn image still exists. `view-only.spec.ts` asserts that the same conditional request returns **404, not 304**, once the design is unpublished.
- [X] Deleting a design still deletes both storage prefixes, not just the rows
      — `storage-cleanup.test.ts` asserts both prefixes empty after delete; `draft-invisibility.spec.ts` independently confirms the image URL 404s after deletion.

### Principle I — the visitor can still only look

- [X] No buy, cart, checkout, comment, favourite, upload, edit, or delete affordance is reachable by a visitor
      — `view-only.spec.ts` scans for twelve commerce/interaction phrases, requires every public `<form>` to be `method="get"`, and asserts no `/studio` link appears.
- [X] No public route requests authentication, and none creates a session or cookie
      — asserted on `/` and on a 404 slug: no `/auth/sign-in` reference, no "sign in to" copy, no `sb-` cookie in any `Set-Cookie`.
      *Run 3:* public pages now **read** a session (FR-002a) to decide whether to render the owner's way back to the studio. Reading is not requesting: no visitor is prompted, no cookie is set, and a request without one is answered exactly as before. `lib/auth/owner-view.ts` checks for a Supabase cookie locally first and returns false without constructing a client or making any network call, so the anonymous path is unchanged by construction rather than by care. `session-lifecycle.spec.ts` captures the anonymous response, signs in, confirms it changes for her, signs out, and requires the anonymous response to return **byte-identical**.
- [X] An owner-only affordance on a public page discloses nothing to a visitor *(new in Run 3, FR-002a)*
      — the bar carries no sign-in control and no hint that an authenticated surface exists; the anonymous body contains none of `Back to the studio`, `viewing your storefront`, `/studio` or `/auth/sign-in`. It changes navigation only, never which data the page reads — public pages still read published, public fields for everyone, including for her.
- [X] The owner check cannot reach a not-found response *(new in Run 3)*
      — on the detail page `isOwnerViewing()` runs **after** the design has been found. Resolving the viewer before the gate would make the designer's 404 differ from a visitor's, and FR-023's "draft, deleted and nonexistent are indistinguishable" would silently narrow to "…for anonymous requests only". `session-lifecycle.spec.ts` requests a draft slug with and without a session and requires both 404s to match.
- [X] Inquiry data is reachable by the designer alone, and its existence is not disclosed *(new in Run 4, FR-046)*
      — no public page reveals that anyone has written, or how many have. `inquiry` denies `anon` SELECT outright, so a visitor cannot read inquiries **including their own** — there is no session to scope "their own" to, and the fact that someone wrote is itself the disclosure. Acknowledging one clears the banner without deleting the record (FR-040c); the owner holds no DELETE privilege at all, so v1 cannot destroy a lead even by accident (FR-045).
- [X] The designer can end her session, and ending it revokes it server-side *(new in Run 3, FR-001a)*
      — `signOut()` runs at its default global scope, so the refresh token is revoked at the auth server rather than merely dropped from the browser. Verified adversarially: the captured refresh token returns **200 before** sign-out and **400 after**, so the assertion can genuinely fail.
- [X] Inquiry submission remains the only visitor action, and the **write is still server-mediated** *(N/A in Runs 1–3; first assessable in Run 4)*
      — the form is the one submission on the public surface; everything else remains a read. The insert happens in `app/(public)/d/{slug}/inquire/route.ts` using the service-role key, after the honeypot, rate-limit and validation checks. `view-only.spec.ts` still finds no other non-GET form on any public page, and submitting grants no account, session or cookie (asserted in `inquiry.spec.ts`, FR-004).
      An inquiry about a **draft** is refused with the same 404 a nonexistent slug gets — the route resolves the design through `public_designs`, so it cannot become an enumeration oracle for unpublished work.
- [X] Honeypot and rate-limit checks cannot be bypassed by calling the data layer directly *(N/A in Runs 1–3; first assessable in Run 4)*
      — `inquiry` grants `anon` nothing at all: migration 0013 revokes everything, forces RLS, and asserts in a DO block that no anonymous grant *or* policy exists. `inquiry-abuse.test.ts` attacks the REST endpoint with the key a browser actually holds and requires ≥400 for INSERT, SELECT, PATCH and DELETE — including an insert that tries to choose its own `sender_hash` and `delivery_state`, which is exactly what a bypass would want.
      The sender identity is computed from the request and never accepted from the caller, so the limit cannot be evaded by varying a string.

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
