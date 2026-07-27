---
description: "Task list for Designer Portfolio Storefront implementation"
---

# Tasks: Designer Portfolio Storefront

**Input**: Design documents from `/specs/001-designer-portfolio-storefront/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Revision**: Rewritten 2026-07-26 after `/speckit-analyze`. Two CRITICAL and one HIGH Principle II
defects were found in the previous design — a public image bucket, anonymous grants on base tables, and
bypassable abuse checks — so the foundational phase changed materially. 82 tasks, up from 71.

**Tests**: Test tasks are included here, but not because TDD was requested. The constitution's Quality
Gates *mandate* automated coverage for exactly two things — that unpublished designs are unreachable
publicly (T060) and that `notes` never appears in a public response (T061) — and SC-013 requires an
automated accessibility check before release (T077). Those three are non-negotiable. The rest cover
behaviour that is genuinely hard to verify by hand: image-access revocation, the delivery-failure path,
and the direct-write bypass.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3, matching spec.md
- File paths are exact

---

## Phase 1: Setup

- [X] T001 Initialize Next.js 15 App Router project with TypeScript at repository root (`package.json`, `tsconfig.json`, `next.config.ts`)
- [X] T002 [P] Configure Tailwind with the **default** theme — no custom palette, per Principle V — in `tailwind.config.ts` and `app/globals.css`
- [X] T003 [P] Initialize the local Supabase stack in `supabase/config.toml`
- [X] T004 [P] Create `.env.example` with every variable listed in `specs/001-designer-portfolio-storefront/quickstart.md`
- [X] T005 Create Supabase client factories in `lib/supabase/client.ts` (browser, anon) and `lib/supabase/server.ts` (server anon + service-role, service-role never importable from a client component)
- [X] T006 [P] Configure Vitest for integration tests in `vitest.config.ts` targeting `tests/integration/`
- [X] T007 [P] Configure Playwright with axe-core in `playwright.config.ts` and scaffold `tests/e2e/`
- [X] T008 [P] Configure ESLint and Prettier in `eslint.config.mjs` and `.prettierrc`
- [X] T009 Verify `sharp` decodes HEIC on both the dev machine and the deploy target, recording the result in `specs/001-designer-portfolio-storefront/quickstart.md`
- [X] T010 Verify `pg_cron` is available on the target Supabase project, recording the result in `specs/001-designer-portfolio-storefront/quickstart.md`

> **T009 and T010 are gates, not chores.** If HEIC decoding is unavailable, the image pipeline (T027)
> needs the client-side WebAssembly fallback instead. If `pg_cron` is unavailable, FR-040a/b need a
> different mechanism and [plan.md](./plan.md) Complexity Tracking must be revised **before** T067 is
> written. Both are cheap now and expensive after the pipeline exists.

---

## Phase 2: Foundational

**Blocking**: every user story depends on this phase. This is where Principle II is actually enforced —
the analysis found that all three of its serious defects lived here, in the schema and storage design,
not in the feature code. T017–T022 deserve review before anything is built on them.

> ### ✓ Migrations verified against a live database (2026-07-26)
>
> All 10 migrations applied cleanly from an empty database, plus the seed. The three guard
> assertions in 0007, 0008 and 0010 executed and passed. Enforcement was then exercised
> directly: every base table returns `permission denied` for `anon`, the four views expose
> published rows only, `notes` and `original_path` are absent from them, a draft-only
> category never reaches `public_categories`, and the `/img` gate returns 302 for a published
> photo, 404 for the same URL after unpublishing, and 302 again after republishing.
>
> Local stack runs on port **55321** — the 543xx defaults were held by another project.
> See `quickstart.md` for the full result table.

- [X] T011 Migration for `designer` and `category` tables with constraints from data-model.md in `supabase/migrations/0001_designer_category.sql`
- [X] T012 Migration for the `design` table — `published boolean not null default false` (FR-021), nullable `seo_title`/`seo_description` (FR-035), and indexes on `slug`, `(owner_id, created_at)`, `(published, created_at)`, `(owner_id, category_id)` — in `supabase/migrations/0002_design.sql`
- [X] T013 Migration for the `photo` table with non-null `width`/`height`/`blur_placeholder`, nullable `alt_text`, and cascade-on-design-delete in `supabase/migrations/0003_photo.sql`
- [X] T014 Migration for the BEFORE INSERT slug trigger — generate once, never on UPDATE (FR-023a/b), retry suffix on unique violation — in `supabase/migrations/0004_slug_trigger.sql`
- [X] T015 Migration for the `BEFORE UPDATE` touch trigger maintaining `updated_at` on `design` and `designer` (FR-014) in `supabase/migrations/0005_touch_trigger.sql`
- [X] T016 Migration for owner-scoped RLS policies on `designer`, `category`, `design`, `photo` — `owner_id = auth.uid()` (FR-003) — in `supabase/migrations/0006_rls_owner.sql`
- [X] T017 Migration asserting **zero anonymous grants on every base table**, including `category` and `photo` (FR-025a), in `supabase/migrations/0007_rls_deny_anon.sql`
- [X] T018 Migration for the four public views — `public_designs`, `public_designer_profile`, `public_categories`, `public_photos` — each with an explicit column list and a published gate, omitting `notes`, `email`, `owner_id`, and `original_path` (FR-024, FR-025a, FR-030a, FR-010) — in `supabase/migrations/0008_public_views.sql`
- [X] T019 Migration for the `increment_design_view(slug)` SECURITY DEFINER function, published-rows-only (FR-034), in `supabase/migrations/0009_view_count.sql`
- [X] T020 [P] Create storage buckets — `originals` **private** and `display` **private** (FR-009a) — in `supabase/migrations/0010_storage.sql`
- [X] T021 [P] Seed the owner account and starter categories (Dress, Outerwear, Accessory) in `supabase/seed.sql`
- [X] T022 Build the publication-gated image route: look up `public_photos`, return an identical 404 when absent, else ~~redirect to a 60-second signed URL~~ **return the display object's bytes resized to the requested width** (FR-009a) in `app/img/[photoId]/[width]/route.ts` — *the redirect form shipped and was superseded on 2026-07-27; see the amendment under Phase 4*
- [X] T023 Build the sign-in page in `app/auth/sign-in/page.tsx` (FR-001)
- [X] T024 Add session middleware protecting all `/studio` routes in `middleware.ts` (FR-001)
- [X] T025 [P] Build the public data access module, reading the four `public_*` views **only** and never a base table, in `lib/data/public-designs.ts`
- [X] T026 [P] Build the owner data access module in `lib/data/designer-designs.ts`
- [X] T027 [P] Build the image pipeline — HEIC conversion, resize to display variants, LQIP generation, EXIF orientation (FR-007, FR-009, FR-011) — in `lib/images/pipeline.ts`
- [X] T028 [P] Build signed-URL issuance and storage-prefix deletion helpers in `lib/images/storage.ts`
- [X] T029 [P] Build the root layout and the mobile-first responsive grid primitive (2 columns mobile / 4+ desktop, FR-017) in `app/layout.tsx` and `components/DesignGrid.tsx`
- [X] T030 [P] Build the alt-text resolver applying the title-plus-position fallback (FR-012b) in `lib/images/alt-text.ts`
- [X] T031 [P] Integration test asserting the service-role key appears in no client bundle, in `tests/integration/no-service-key.test.ts`

**Checkpoint**: schema, policies, four public views, private buckets, the image gate, auth, and the image
pipeline exist. User stories can begin.

---

## Phase 3: User Story 1 — Designer builds her design archive (P1) 🎯 MVP

**Goal**: The designer signs in, uploads designs with photos and metadata from her phone, organizes
them, and finds the identical archive from any other device.

**Independent test**: Sign in on a phone, upload a design with three photos and full metadata, sign in
on a second device, confirm parity. Edit one field and delete a second design; both persist.

- [X] T032 [US1] Build the dashboard grid of the owner's designs, draft and published visually distinct, in `app/(designer)/studio/page.tsx`
- [X] T033 [P] [US1] Build the empty-archive onboarding prompt (FR-033) in `components/studio/EmptyState.tsx`
- [X] T034 [US1] Build the new-design form with title, category, collection, notes, and public description in `app/(designer)/studio/designs/new/page.tsx`
- [X] T035 [US1] Build the photo uploader with camera/library selection and progress indication (FR-005, FR-006, FR-008) in `components/studio/PhotoUploader.tsx`
- [X] T036 [P] [US1] Build the optional per-photo alt-text input (FR-012a) in `components/studio/AltTextField.tsx`
- [X] T037 [US1] Implement `createDesign` — reject the design outright if no photo processes successfully (FR-013a), else persist the record and store originals plus display variants — in `lib/data/designer-designs.ts`
- [X] T038 [US1] Build the edit page, with `slug` immutable on rename (FR-023b), in `app/(designer)/studio/designs/[id]/page.tsx`
- [X] T039 [US1] Implement delete: remove the row, cascade `photo` rows, and **explicitly delete both `originals/{design_id}/` and `display/{design_id}/` prefixes** (FR-019) in `lib/data/designer-designs.ts`
- [X] T040 [US1] Build the delete confirmation stating that inquiries are kept (FR-044) in `components/studio/DeleteDesignDialog.tsx`
- [X] T041 [P] [US1] Build filter controls (category, collection) and sort controls (newest, oldest, title) as independent dimensions (FR-018) in `components/studio/FilterBar.tsx`
- [X] T042 [P] [US1] Build category management, blocking deletion of a category still in use, in `app/(designer)/studio/categories/page.tsx`
- [X] T043 [P] [US1] Build profile settings for name, bio, and profile photo (FR-029) in `app/(designer)/studio/settings/page.tsx`
- [X] T044 [US1] Handle interrupted uploads — no broken record, retry without duplicating (FR-013a) — in `lib/images/pipeline.ts`
- [X] T045 [P] [US1] Reject unsupported types **and files over 25 MB**, naming the accepted formats and the limit, without affecting other photos in the upload (FR-012), in `lib/images/validate.ts`
- [X] T046 [P] [US1] Warn on session expiry rather than silently discarding unsaved entries in `components/studio/SessionGuard.tsx`
- [X] T047 [P] [US1] Integration test: slug is generated once and survives a rename, in `tests/integration/slug.test.ts`
- [X] T048 [P] [US1] Integration test: `updated_at` advances on update and `created_at` does not (FR-014), in `tests/integration/timestamps.test.ts`
- [X] T049 [P] [US1] Integration test: deleting a design removes both storage prefixes (FR-019), in `tests/integration/storage-cleanup.test.ts`
- [X] T050 [US1] E2E test: archive parity across two sessions (SC-008) in `tests/e2e/designer-archive.spec.ts`

> **The notes/description split is a UI responsibility.** T034 and T038 must label the two fields
> unmistakably — "Private notes — only you see this" against "Public description — visitors see this".
> FR-025 gives no per-design override, so the form is the only place this can be communicated, and
> getting it wrong is how private measurements reach the public internet.
<!-- -->
> ### ✓ US1 verified against a live stack (2026-07-26)
>
> All 19 tasks implemented; `typecheck`, `lint`, `build`, 11 integration tests and 3 end-to-end
> specs pass. The archive-parity spec runs green on **both** Playwright projects — desktop
> Chromium and iPhone 14 WebKit — which discharges the constitution's mobile-verification
> requirement for the flows US1 touches.
>
> **Three defects in already-completed work were found and fixed while building on it.** Each was
> invisible to the phase that introduced it:
>
> | Defect | Why it was invisible | Fix |
> | --- | --- | --- |
> | `authenticated` and `service_role` held **no SELECT/INSERT/UPDATE/DELETE on any base table** — the designer could not read or write a single row. Supabase's permissive default privileges are registered `FOR ROLE supabase_admin`, but migrations run as `postgres`, whose `public`-schema defaults grant only TRUNCATE/REFERENCES/TRIGGER. | Phase 2's verification asked whether anonymous callers were *refused* and whether the views were *gated*. Both passed. Nothing asked whether the owner could still get in — the assumed failure mode of a privacy-first schema is "too open". | `0011_grants_authenticated.sql`, with assertions in both directions: anon still holds no DML, **and** the owner does. |
> | The local seed left `auth.users` token columns NULL, so every sign-in failed with a 500 and the opaque message "Database error querying schema". | The row looks entirely correct in psql. GoTrue reads those columns into Go strings, which cannot hold NULL — and only a hand-written `auth.users` insert can produce it. | `seed.sql` now writes `''` for all eight token columns. |
> | Playwright's `webServer` probed `/`, which has no page until T052, so the whole suite timed out before running. | Playwright treats 404 as "not ready". Nothing had run the suite yet. | Readiness now probes `/auth/sign-in`. |
>
> **One route was added beyond the task list**: `app/(designer)/studio/img/[photoId]/[width]/route.ts`.
> The public `/img` route is published-gated by design (FR-009a), so it returns 404 for every draft —
> and the dashboard is mostly drafts. Relaxing `/img` for signed-in requests was rejected: it would
> put a conditional inside the exact gate T060 exists to protect. Two surfaces, two routes, one rule
> each.
>
> **Migration numbering moved.** `0011` is now the grants migration, so Phase 5's migrations shift to
> `0012`/`0013`/`0014` — already corrected in T064, T065 and T071 below.

**Checkpoint**: US1 is independently shippable as a private catalogue.

---

## Phase 4: User Story 2 — Visitors browse the public storefront (P2)

**Goal**: Anyone with the URL browses published designs with no account, filters and sorts them, opens a
piece, and can reach nothing the designer has not published — including no image file.

**Independent test**: With seeded published and draft designs, open the site in a private window with no
session. Published designs browse, filter, and sort; drafts are absent from the grid, unreachable by
direct URL, and their image URLs 404; no private note text appears anywhere in the page.

- [X] T051 [US2] Build the published/draft toggle (FR-021, FR-026) in `components/studio/PublishToggle.tsx`
- [X] T052 [US2] Build the storefront homepage — the grid *is* the homepage (FR-027) — in `app/(public)/page.tsx`
- [X] T053 [P] [US2] Build the designer bio and profile photo header from `public_designer_profile` (FR-028) in `components/public/DesignerHeader.tsx`
- [X] T054 [US2] Build the public grid using `next/image` against the `/img` route, with stored dimensions and blur placeholders (FR-011, SC-012) in `components/public/PublicGrid.tsx`
- [X] T055 [US2] Build the design detail page rendering all photos in order plus `public_description` (FR-031) in `app/(public)/d/[slug]/page.tsx`
- [X] T056 [P] [US2] Build public filter controls (category, collection — sourced from `public_categories` so draft-only values never appear) and sort controls (newest, oldest, title) (FR-030, FR-030a) in `components/public/PublicFilterBar.tsx`
- [X] T057 [P] [US2] Build the "coming soon" and "nothing matches" states (FR-033) in `components/public/EmptyStorefront.tsx`
- [X] T058 [US2] Implement the not-found path so draft, deleted, and nonexistent slugs return **byte-identical** 404s (FR-023) in `app/(public)/d/[slug]/not-found.tsx`
- [X] T059 [US2] Call `increment_design_view` on detail render, storing without displaying (FR-034), in `app/(public)/d/[slug]/page.tsx`
- [X] T060 [US2] **MANDATORY** E2E test: draft, deleted, and nonexistent slugs are indistinguishable; drafts absent from the grid; **and an image URL captured while published returns 404 after unpublish and after delete** (FR-023, FR-009a, SC-002, SC-017), in `tests/e2e/draft-invisibility.spec.ts`
- [X] T061 [US2] **MANDATORY** E2E test: a `notes` sentinel appears nowhere in the raw response body, metadata, or hydration payload (FR-024, SC-003), in `tests/e2e/notes-privacy.spec.ts`
- [X] T062 [P] [US2] E2E test: no buy, cart, checkout, comment, favourite, or edit affordance on any public page; no `original_path` in any response (FR-032, FR-010, SC-010) in `tests/e2e/view-only.spec.ts`
- [X] T063 [P] [US2] E2E test: a category used only by drafts is absent from the public filter control (FR-030a) in `tests/e2e/filter-leakage.spec.ts`

> **T061 must assert against the raw response body, not the rendered DOM.** A field serialized into a
> hydration payload but never displayed is still a leak, and is precisely the failure this gate exists
> to catch.
<!-- -->
> **T060's image-revocation assertion is the one that would have caught the original defect.** The first
> design served display variants from a public bucket, so a photograph stayed downloadable forever once
> its design had been published. Nothing in the previous test plan would have noticed.
<!-- -->
> ### ✓ US2 verified against a production build (2026-07-26)
>
> All 13 tasks implemented. 9 end-to-end specs pass on **both** Playwright projects (desktop
> Chromium, iPhone 14 WebKit), plus `typecheck`, `lint`, `build` and 11 integration tests. The
> mandated public-surface review has been run for the first time and is recorded in
> [checklists/public-surface-review.md](./checklists/public-surface-review.md) — 17 items ticked,
> 2 marked N/A because the inquiry surface does not exist until US3.
>
> **The E2E suite now runs against a production build**, not `next dev`. T060 and T061 assert on
> the bytes a visitor receives, and a dev server embeds error-overlay payloads and stack traces
> that no visitor ever sees: the byte-identical 404 comparison failed on that noise, and — the
> real problem — a passing comparison of dev output would have proved nothing about production.
> `E2E_DEV=1` opts back into the dev server for non-privacy specs.
>
> **T060's byte comparison had a latent flake, now fixed.** React streams the RSC payload as a
> series of `self.__next_f.push(...)` chunks whose emission order is non-deterministic: two 404s
> of identical length (12622 bytes each) were caught diverging at offset 8675 purely in chunk
> sequence. It surfaced in T063 first and would eventually have hit T060 — and a mandatory gate
> that fails at random gets ignored, which is worse than having no gate on a non-negotiable
> principle. `tests/e2e/helpers/canonical.ts` now sorts the chunks before comparing while leaving
> their contents and all rendered markup untouched, so the assertion stays strict about content.
> Confirmed with three consecutive full-suite runs: 20/20 on both engines.
>
> **Two public surfaces were added beyond the task list**, both because T053 and T054 could not
> be built without them:
>
> | Addition | Why | How it is gated |
> | --- | --- | --- |
> | `app/img/profile/route.ts` | FR-028 requires the profile photo on the homepage, and both buckets are private. Embedding a signed URL in the HTML would have worked, but it breaks the property the review checklist asserts — *every* visitor-facing image comes from `/img`. | No publication gate, deliberately: name, bio and photo are public by definition. Reads the path from `public_designer_profile` (no `email`), issues a 60s signed URL into the private `display` bucket. Has its own test. |
> | `incrementDesignView()` in `public-designs.ts` | T059 needed a data-layer call for the existing `increment_design_view` RPC. | Called only after the publication check passes, and swallows its own errors so a failed counter can never fail a render. |
>
> **Public images are rendered `unoptimized`, and that is a Principle II decision.** Next's image
> optimiser caches derived bytes keyed on the source URL, with a lifetime taken from the upstream
> response — and upstream is a 302 into Supabase Storage, whose cache headers this project does
> not control (`minimumCacheTTL` is a floor, not a ceiling). An optimised tile could therefore
> keep being served after `/img` itself began answering 404: the public-bucket defect again, one
> layer up, and invisible to T060 because T060 asserts against the `/img` URL. Unoptimised means
> the browser re-requests `/img` every load, so revocation is immediate. Blur placeholders and
> reserved dimensions are unaffected, so SC-012 still holds.
>
> ### ✓ `/img` amendment — resolved 2026-07-27
>
> The US2 increment closed with a flagged debt: `/img` redirected to the single stored display
> variant (longest edge 2048px) regardless of the width in its path, so the width parameter was
> decorative and a 640px grid tile downloaded a 2048px file — a live risk to SC-004's 3-second
> LCP budget. It was flagged rather than fixed because the remedy amends a decision recorded in
> [plan.md](./plan.md) Complexity Tracking and [research.md](./research.md) D11.
>
> **Amended and implemented.** `/img` now reads the object and returns the bytes, resized to the
> requested width (`lib/images/deliver.ts`). The same change applies to `/studio/img` and
> `/img/profile`, so **no signed URL is issued anywhere in the system** — which is why this is a
> Principle II improvement rather than a performance trade. The previous design accepted a
> 60-second residual window in which an already-issued signature kept working after its design was
> unpublished; that window is now zero.
>
> Verified against a production build: 320 → 320px, 640 → 640px, 1080 → 1080px, and 1920 → the
> stored 1536px bytes returned untouched (the fast path skips re-encoding and never upscales). No
> `Location` header on any response. A matching `If-None-Match` gives 304 — and **the same header
> after unpublishing gives 404, not 304**, because the publication check runs ahead of conditional
> handling. `tests/e2e/view-only.spec.ts` asserts all of it; 22/22 specs pass on both engines.
>
> **A second defect surfaced while verifying this one.** `playwright.config.ts` had
> `reuseExistingServer: !process.env.CI`, so a leftover `next start` from an earlier session was
> silently reused and the whole suite ran against **stale code** — the amended route was already
> written and the tests still saw the old 302. The failure mode that matters is the reverse: T060
> or T061 passing green against a build that no longer exists. The production path now refuses to
> reuse a server, turning a silent wrong answer into a loud port conflict.
>
> Follow-up if T079 shows the per-request CPU is a problem: pre-generated per-width variants, with
> **flat** filenames — `deleteDesignFiles` sweeps with a non-recursive `list(designId)`, so
> variants in nested folders would never be found and FR-019 would regress silently.

**Checkpoint**: the storefront is live and every Principle II gate is enforced by CI.

---

## Phase 5: User Story 3 — Visitors inquire about a piece (P3)

**Goal**: A visitor sends the designer a message about a specific piece without an account, and the
designer receives it — even when email delivery is broken.

**Independent test**: With one published design, submit the inquiry form with no session and confirm the
designer is notified with the correct design named. Submit a malformed email and confirm rejection. Break
delivery deliberately and confirm the dashboard banner surfaces the lead. Attempt a direct data-layer
insert with the anon key and confirm rejection.

- [X] T064 [US3] Migration for the `inquiry` table — `on delete set null`, `design_title_snapshot`, `delivery_state` enum, `read` flag (v1.1-facing, never written in v1), `(sender_hash, created_at)` index (FR-038, FR-043, FR-044) — in `supabase/migrations/0012_inquiry.sql`
- [X] T065 [US3] Migration for inquiry RLS: owner-only read/update/delete, **no anonymous `INSERT` and no anonymous `SELECT`** (FR-041c, FR-046), in `supabase/migrations/0013_inquiry_rls.sql`
- [X] T066 [US3] Build the inquiry form with name, email, optional message, and the hidden honeypot field (FR-036, FR-041a) in `components/public/InquiryForm.tsx`
- [X] T067 [P] [US3] Implement email-format validation with field-level errors (FR-037) in `lib/inquiries/validate.ts`
- [X] T068 [P] [US3] Implement the rate limit — 5/hour, 20/day against a **server-computed** salted `sender_hash` (FR-041) — in `lib/inquiries/rate-limit.ts`
- [X] T069 [US3] Build the submit route in the contract's order — honeypot → rate limit → validate → **server-side insert** → respond → deliver — in `app/(public)/d/[slug]/inquire/route.ts`
- [X] T070 [US3] Implement Resend delivery inside `after()` with 3 attempts and backoff (FR-040a) in `lib/inquiries/deliver.ts`
- [X] T071 [US3] Migration for the `pg_cron` sweep running **every 2 minutes**, retrying `pending` rows and marking exhausted ones `undelivered` (FR-040b, SC-006), in `supabase/migrations/0014_delivery_sweep.sql`
- [X] T072 [US3] Build the undelivered-inquiry banner with visitor details readable inline (FR-040b) in `components/studio/UndeliveredBanner.tsx`
- [X] T073 [US3] Build the acknowledge route that clears the banner without deleting the record (FR-040c) in `app/(designer)/studio/inquiries/[id]/acknowledge/route.ts`
- [X] T074 [P] [US3] Integration test: rate limit rejects the 6th submission; a filled honeypot is indistinguishable from success and stores nothing; **a direct anon-key insert against the data layer is rejected** (FR-041c, SC-016), in `tests/integration/inquiry-abuse.test.ts`
- [X] T075 [US3] E2E test: successful inquiry, **and** the delivery-failure path — visitor still confirmed, record persists, banner appears (SC-015) — in `tests/e2e/inquiry.spec.ts`

> **T069's ordering is the requirement, not an implementation preference.** The visitor's confirmation
> must not depend on email delivery: US3 scenario 5 requires a normal confirmation while email is down.
<!-- -->
> **T065 is why T074's direct-insert assertion matters.** With anonymous `INSERT` granted, a bot could
> POST straight to the data layer and skip the honeypot and rate limit entirely — the checks would apply
> only to clients that chose to cooperate.
<!-- -->
> ### ✓ US3 verified (2026-07-27)
>
> All 12 tasks implemented. `typecheck`, `lint`, `build`, **16/16 integration tests** and **38/38
> end-to-end specs** pass on both engines, across two consecutive full runs. The public-surface
> review was re-run as **Run 4**, which finally closes the two items that had been N/A since Run 1
> — they described code that did not exist until now.
>
> **The delivery-failure path is the default locally, not an edge case.** `RESEND_API_KEY` is
> unset, so every send fails and US3 scenario 5 is exercised on every run: the visitor still sees
> a normal confirmation, the record still persists, and the banner still surfaces it. A design
> that coupled the visitor's confirmation to the email would pass a happy-path test and lose
> messages silently in production. The specs skip loudly rather than fail confusingly if a real
> key is ever configured.
>
> **The `pg_cron` sweep was verified functionally, not merely scheduled.** Marking it "active" in
> `cron.job` proves nothing about what it does. Given three rows — pending and 5 minutes old,
> pending and fresh, already delivered — it swept exactly one: the stranded row became
> `undelivered`, the fresh one was left alone to finish retrying, and the delivered one was
> untouched.
>
> | Design point | Why it is that way |
> | --- | --- |
> | Sweep marks rows; it does not send email | Retry with backoff (FR-040a) lives in `after()` where there is an HTTP client and a key. `pg_net` is installed and *could* POST to Resend, but that would put notification logic in two languages with two credential paths. Principle V. |
> | Sweep threshold 3 min, cadence 2 min | `after()` finishes in seconds, so 3 minutes pending means stranded. 3 + 2 = 5 worst case, which is SC-006's budget exactly. |
> | Rate limit fails **open** on a database error | The choice is between allowing an extra submission and dropping a real one. FR-040 is unambiguous, and an inquiry is a person waiting for a reply. |
> | Salt falls back to a per-process random value | A fixed fallback would keep the limit working while making every stored IP hash reversible; a random one costs only that counting windows reset on restart. The service-role key was the first choice and `no-service-key.test.ts` correctly rejected it. |
>
> **Two test defects were caught and fixed here.** A vacuous assertion — `expect(grants).toBeNull()`
> against an RPC that does not exist — was replaced with real coverage of the rate limiter against
> the live table. And the suite shared one `sender_hash` across every test, so the hourly limit was
> consumed between them; each visitor context now carries its own `x-forwarded-for`, randomised
> across three octets because a per-process counter restarts every run while the window is an hour
> long.

**Checkpoint**: all three user stories complete; the feature is functionally whole.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T076 Implement the accessibility pass — visible focus indication, contrast, keyboard operability, form labelling and error association across both surfaces (FR-012c) — in `app/globals.css` and the affected components
- [X] T077 [P] E2E accessibility test: zero axe-core WCAG 2.1 AA violations on storefront, detail, and dashboard (SC-013) in `tests/e2e/accessibility.spec.ts`
- [X] T078 [P] E2E test: a keyboard-only visitor can browse, open a design, and inquire (SC-014) in `tests/e2e/keyboard.spec.ts`
- [X] T079 [P] Seed 50 designs averaging 3 photos and measure LCP at a 400 kbps / 400 ms RTT profile, filter/sort latency, and cumulative layout shift (SC-004, SC-009, SC-012) in ~~`tests/perf/seed-and-measure.ts`~~ — *split across `tests/perf/seed.ts` and `tests/e2e/storefront.perf.spec.ts`; see Phase 8 for the results and the reason for the path change*
- [X] T080 Create the public-surface review checklist that any change touching a public route, public view, or the `published` flag must pass before merge (constitution Quality Gates) in `specs/001-designer-portfolio-storefront/checklists/public-surface-review.md`
- [X] T081 Disable public sign-up and provision the single owner account, recording the steps in `supabase/config.toml` — *hosted provisioning runbook in `quickstart.md`; the hosted half is done by hand and is not satisfied by the local config alone*
- [ ] T082 Exercise every designer-facing flow at mobile viewport width, **timing the capture-to-publish flow (SC-001) and counting taps from homepage to detail (SC-005)**, and tick off the smoke checklist in `specs/001-designer-portfolio-storefront/quickstart.md`

> **T076 must precede T077 and T078.** Ordering the accessibility tests before any implementation task
> would leave them failing with no owner for the fixes — the previous task list had exactly that gap.
<!-- -->
> ### ✓ T076 — the accessibility pass (2026-07-27)
>
> Measured before changing anything. axe-core (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) over eleven
> surfaces — storefront, detail, the inquiry form in its **error** state, the not-found page, sign-in,
> dashboard, new design, categories, settings, design edit, and the delete dialog **while open** —
> returned **zero violations before any fix**. The incremental work through Phases 3–5 had already
> covered labelling, contrast and error association.
>
> **One real defect, which axe cannot see and which every static check passes: the skip link bypassed
> nothing.** `href="#main"` pointed at a `<div>` in the root layout. A browser scrolls to a
> non-focusable anchor target but leaves focus on `<body>`, so the next Tab resumed at the top of the
> document — measurably, on the studio surface the Tab after activating "Skip to content" landed on
> `Studio`, the first nav link. The wrapper also enclosed the studio header, so it was the wrong target
> even in principle. Fixed by moving `id="main"` onto each page's own `<main>` with `tabIndex={-1}`; the
> Tab after skipping now reaches `Add a design`. That before/after is the assertion T078 inherits.
>
> Verified as already correct, so left alone: focus indicators resolve to `2px solid rgb(17, 24, 39)` on
> both text inputs and dark primary buttons; the delete dialog opens from the keyboard, moves focus
> inside, closes on Escape and restores focus to its trigger (native `<dialog>` earning its keep); the
> photo pickers keep a focusable `sr-only` input rather than `hidden`, so a keyboard user can reach
> them. Studio form errors stay form-level with `role="alert"` — they describe the whole operation
> ("Some photos were not used"), and tying those to a single field would be wrong; per-field
> `aria-invalid`/`aria-describedby` lives where per-field validation does, in the inquiry form.
<!-- -->
> **The canonicaliser was hardened in the same pass, and not incidentally.** A full run failed
> `filter-leakage.spec.ts` on two responses that were identical in content: React had packed the `8:`
> metadata record alongside a module record in one and flushed it separately in the other, and
> `canonicalizeBody` sorted whole `push()` calls, which cannot reconcile that. It now splits the flight
> payload into records first, so packing and ordering are both irrelevant. `tests/integration/canonical.test.ts`
> pins the behaviour in both directions — a leaked record and differing markup must still fail — and
> three of its eight cases fail against the previous implementation, which is why it is worth having.
> A privacy gate that fails at random gets re-run until green, and that is indistinguishable from
> re-running until a real leak is waved through.
<!-- -->
> **T080 closes the one constitutional gate with no artifact.** The constitution mandates a
> public-surface review on every change touching a public route or the `published` flag, but nothing
> existed to perform it; `checklists/requirements.md` is a spec-quality checklist, not this gate.
>
> *Completed ahead of its phase, in Phase 4.* The gate is not something that can be built after the
> public surface it governs — Phase 4 introduced the storefront, which is the first change requiring
> the review, so waiting for Phase 6 would have meant merging the public routes with the mandated
> check unperformed. The checklist has since been run four times (Runs 1–4: storefront, the `/img`
> amendment, session lifecycle, and the inquiry surface), and each run is recorded in the file.
<!-- -->
> **T082 is required, not optional.** The constitution requires designer-facing flows to be exercised at
> mobile width before a feature counts as done, and SC-001 and SC-005 are otherwise never measured.
<!-- -->
> ### ✓ T077 and T078 — the accessibility tests (2026-07-27)
>
> `accessibility.spec.ts` scans storefront, detail, dashboard, new design, categories, settings and
> design edit, plus two states a page-by-page sweep never reaches: the **inquiry form displaying a
> validation error**, and the **delete dialog while open**. Error association and modal semantics do not
> exist until they are on screen. Alt text is asserted separately from axe rather than through it: axe's
> `image-alt` rule accepts `alt=""` as correct marking for a decorative image, and on this site no
> photograph is decorative — FR-012b's title-and-position fallback exists so none can be announced as
> nothing.
>
> **Both specs guard against passing vacuously.** Every scan is preceded by an assertion that the
> content under test rendered — an empty storefront and an empty dashboard both pass a WCAG sweep
> trivially, and would keep passing while the real grid regressed.
>
> `keyboard.spec.ts` uses no mouse at all. `click()` focuses and activates an element whether or not a
> keyboard could reach it, so a clicking test passes against a control that is unreachable by Tab,
> unlabelled once reached, or absent from the tab order — which is exactly how the skip link shipped
> broken past axe, lint and review. It also asserts the **honeypot is never a tab stop**: `_website` is
> `sr-only` rather than `display:none`, one forgotten `tabIndex={-1}` away from being tabbable, and a
> keyboard user who typed into it would have their message discarded in silence behind a normal
> confirmation (FR-041a is right for bots and catastrophic for a person).
>
> Verified adversarially: stripping `tabIndex={-1}` from the nine `<main>` elements makes
> `keyboard.spec.ts` fail with *"activating the skip link must move focus into &lt;main&gt;"*. The test
> catches the defect it was written for.
<!-- -->
> **`keyboard.spec.ts` runs on Chromium only, and the gap is real rather than cosmetic.** WebKit omits
> links from the tab order unless the user has enabled Safari's Full Keyboard Access; measured, the
> first Tab on the storefront lands on the Category `<select>`, skipping the skip link and every header
> link. On WebKit these assertions would be testing a Safari preference, and no markup change could
> make them pass. **Link-based keyboard navigation is therefore unverified on WebKit.** Form controls
> are in the tab order on every engine, so the inquiry form is still exercised on both projects by
> `accessibility.spec.ts` and `inquiry.spec.ts`.

---

## Phase 7: Session lifecycle and cross-surface navigation (FR-001a, FR-002a)

Added 2026-07-27. Both requirements came from **using** the application rather than from analysis, and
both concern the designer's movement in and out of the authenticated surface — which the spec covered on
the way in (FR-001) and not at all on the way out or back. See spec Clarifications, Session 2026-07-27.

Independent of Phase 5 and Phase 6; can be done at any point after Phase 4.

- [X] T083 Build sign-out (FR-001a): a server action calling `supabase.auth.signOut()`, a control in `app/(designer)/studio/layout.tsx` so it is reachable from every studio page, and a redirect to `/` afterwards
- [X] T084 Build the owner-only return affordance on public pages (FR-002a) in `components/public/OwnerBar.tsx`, rendered from `app/(public)/page.tsx` and `app/(public)/d/[slug]/page.tsx`
- [X] T085 [P] E2E test: signing out ends the session server-side — `/studio` redirects to sign-in afterwards, and the browser's retained cookies do not restore access (FR-001a)
- [X] T086 [P] E2E test: the owner bar is absent for an unauthenticated request, and the anonymous response body is **unchanged** by the feature's existence (FR-002a constraints 1–3)

> **T084's cost falls on visitors unless it is written carefully.** Public routes are deliberately
> excluded from the middleware matcher so that no session work happens on a visitor's request. Calling
> `getUser()` unconditionally during a public render would undo that for everyone, and `getUser()`
> validates against the auth server rather than reading a cookie.
>
> So: check for the presence of a Supabase auth cookie first, and only resolve the session when one
> exists. A visitor carries no such cookie and therefore pays nothing — which is also what makes
> constraint 3 (an unauthenticated response is unchanged) true by construction rather than by care.
<!-- -->
> **T086 is the constitutional guard for this phase**, in the same sense T060 and T061 are for Phase 4.
> FR-002a is a deliberate, narrow exception to "the public surface shows nothing about authentication",
> and the only thing keeping it narrow is an assertion that an anonymous request sees no difference. The
> existing draft-invisibility and view-only specs already make every assertion with no session, so they
> measure the right surface — T086 adds the explicit before/after comparison.
<!-- -->
> ### ✓ Phase 7 verified (2026-07-27)
>
> All 4 tasks implemented; `typecheck`, `lint`, `build` and **32/32 end-to-end specs** pass on both
> engines. The public-surface review was re-run as **Run 3** — required, because FR-002a puts a session
> read on a public page for the first time. One existing item gained a new reason, three items were
> added.
>
> **FR-002a's exception stays narrow because of one property, and it is tested rather than asserted.**
> `session-lifecycle.spec.ts` captures the anonymous response, signs in, confirms the response *does*
> change for her, signs out, and requires the anonymous response to come back **byte-identical**. A real
> before/after inside one run, rather than a comparison against a build that no longer exists.
>
> **Two ordering rules are load-bearing here**, both for the same reason — nothing about who is asking
> may reach a response that is refusing to say whether something exists:
>
> | Rule | What breaks without it |
> | --- | --- |
> | `isOwnerViewing()` runs **after** the not-found gate on `/d/{slug}` | The designer's 404 would carry an owner bar and a visitor's would not, so FR-023's "draft, deleted and nonexistent are indistinguishable" would quietly narrow to "…for anonymous requests only". Tested. |
> | The cookie is checked **before** any session is resolved | `getUser()` validates against the auth server, so calling it unconditionally would put a network round trip on every visitor's request — undoing the middleware exclusion that keeps public routes session-free, on the very path SC-004 measures. |
>
> **A vacuous assertion was caught and fixed during this phase.** The sign-out test first read the
> session from `localStorage`; `@supabase/ssr` stores it in a **cookie**, so the lookup returned null,
> the revocation check sat behind an `if` that never executed, and the test passed having verified
> nothing — the exact failure the control in T061 exists to prevent, reproduced by its own author. It
> now reads the cookie and asserts extraction succeeded before using it. Checked adversarially: the
> refresh token returns **200 before** sign-out and **400 after**, so sign-out revokes server-side and
> the assertion can genuinely fail.

**Checkpoint**: the designer can end her session, and can move between the two surfaces in both
directions, with no change to what a visitor receives.

---

## Phase 8: Performance evidence and deployment (T087–T094)

Added 2026-07-27, when T079 stopped being a confirmation exercise. Six of eighteen success criteria
had no evidence at all, and the `/img` amendment had since moved image resizing onto the request
path. Deployment target is **Netlify**, which changes the calculus: `/img` sends `Cache-Control:
private` by design, so no CDN may cache it and every tile is a function invocation.

- [X] T087 Fix the perf-test wiring: `testIgnore` for `*.perf.spec.ts` on the `mobile` and `desktop` projects, so a perf spec runs **once, throttled**, in `playwright.config.ts`
- [X] T079a Launch-scale fixture — 50 published designs averaging 3 photos, created through the real upload route, idempotent, with prefix-swept teardown — in `tests/perf/seed.ts`
- [X] T079b Measurement spec: LCP (and **which element**), CLS, filter latency, byte accounting, server-side image cost — in `tests/e2e/storefront.perf.spec.ts`
- [X] T079c Measure and record the baseline
- [X] T088 One eager grid image instead of four (`components/public/PublicGrid.tsx`)
- [X] T089 Hand-rolled `srcset` over the widths `/img` already allows, in `lib/data/public-designs.ts`, `components/DesignGrid.tsx` and `app/(public)/d/[slug]/page.tsx`
- [X] T090 Width-aware encode quality in `lib/images/deliver.ts`
- [X] T092 `RATE_LIMIT_SALT` production guard in `lib/inquiries/rate-limit.ts`
- [X] T081 `[auth.email] enable_signup = false`, verified by probe; hosted owner-account runbook in `quickstart.md`
- [X] T093 `netlify.toml` with a build-time HEIC gate; environment runbook in `quickstart.md`
- [X] T082 Mobile pass — tap count, flow timing, viewport usability — in `tests/e2e/mobile-flow.spec.ts`

> **T079's real finding was not a number, it was which element the number described.**
>
> The first measurement reported **LCP 1,100 ms against a 3,000 ms budget** and would have been
> recorded as a comfortable pass. It was not one. Adding the LCP element's identity to the observer
> showed the element was a **`<p>`** — the designer's bio — while the storefront was still
> transferring **8.5 MB across 55 tiles** and took **179 seconds** to finish. Chrome was right; the
> criterion was met; and no photograph had appeared.
>
> That is the whole reason the plan called for identifying the element rather than trusting the
> figure. A performance test that reports a passing number for the wrong element is worse than none,
> because it retires the question.
>
> Two other instrumentation defects were caught the same way. Byte accounting from `content-length`
> reported the streamed HTML as **0 KB**, so the one resource gating everything else was invisible —
> replaced with the Resource Timing API. And the filter measurement first read **18,371 ms**, which
> turned out to be contention with the previous page's unfinished image load rather than anything
> about filtering; from a settled state it is **572 ms**.

<!-- -->
> **The fixtures are synthetic but not flattering, and that took deliberate work.** The rest of the
> suite uses `makeJpeg`, a flat block of one colour — right there, catastrophic here: a solid colour
> encodes to a couple of kilobytes at any size, so fifty of them would clear a 3-second budget while
> proving nothing. `tests/perf/seed.ts` synthesises photographic entropy instead, and the spec
> asserts a **floor on the mean delivered image size**. If the fixtures ever become trivially
> compressible again, the run fails as *unrealistic* rather than passing as fast.

<!-- -->
> **Two production risks surfaced from the deployment work, neither visible locally.**
>
> `RATE_LIMIT_SALT` unset falls back to a salt generated **once per process**. On one long-lived
> server that merely resets the counting window on restart, which is the trade the code documented.
> On Lambda the process is an instance — many, short-lived, concurrent — so a visitor's requests hash
> to different senders, counts never accumulate, and **FR-041 and SC-016 stop being enforced with
> nothing visibly broken**. It now logs an error in production and still accepts the submission,
> because FR-040 says a real message must survive a misconfiguration.
>
> `maxDuration = 60` on both upload routes **cannot be honoured on Netlify** (10s free, 26s Pro), so
> a large multi-photo HEIC upload can be cut off mid-processing. Recorded in `quickstart.md` rather
> than patched, because the fix — moving image processing off the request path — is a design change
> and should be chosen deliberately.

<!-- -->
> ### Results (2026-07-27, 50 designs, 400 kbps / 400 ms, cold cache)
>
> | | Baseline | +T088/T089 | +T090 | Budget |
> | --- | --- | --- | --- | --- |
> | LCP | 1,284 ms | 1,256 ms | **1,256 ms** | < 3,000 ms (SC-004) |
> | CLS | 0 | 0 | **0** | ≤ 0.01 (SC-012) |
> | Filter response | 572 ms | 633 ms | **585 ms** | < 1,000 ms (SC-009) |
> | Storefront images | 8,513 KB | 2,998 KB | **2,386 KB** | recorded |
> | Mean image | 154.8 KB | 54.5 KB | **43.4 KB** | recorded |
> | Fully loaded | 179.3 s | 66.2 s | **53.6 s** | recorded |
>
> **SC-004, SC-009 and SC-012 are met.** Image weight fell **72%** and time-to-fully-loaded **70%**.
>
> **`sizes` had been inert since T054, and nothing would have revealed that except measuring.** The
> prop was passed, looked correct, and did nothing: `unoptimized` makes `next/image` drop `srcSet`
> entirely, so every device downloaded one fixed 640px width. Desktop renders each tile at ~240 CSS
> px — about seven times the pixels it could display. The fix required replacing `next/image` with a
> plain `<img>` on both public surfaces; the blur placeholder is the only casualty and it is
> recovered as a CSS background, which needs no client JavaScript to swap out because the real
> photograph paints over it. CLS stayed at exactly 0 across all three changes.
>
> Worth recording against intuition: the phone was **not** the oversized case. An iPhone at DPR 3
> genuinely needs ~561px, so 640 was about right there. The waste was on desktop.

<!-- -->
> ### T091 (lazy derived-variant cache) — **measured, and deliberately not built**
>
> research D11 records pre-generated variants as the follow-up "if T079 shows the per-request CPU is
> a problem". Measured, unthrottled, over 12 distinct images: **mean 184 ms, slowest 532 ms, and a
> repeat request via the ETag path 12 ms**.
>
> That is not a bottleneck. The storefront is network-bound by an order of magnitude — 53.6 s of
> transfer against roughly 9 s of aggregate compute spread across 50 parallel requests — and a
> returning visitor pays 12 ms or, inside the 60-second `max-age`, nothing at all.
>
> So the cache is not built. It would place a byte cache immediately beside the publication gate,
> introducing a way for withdrawn bytes to outlive their authorisation, and would require the
> single-photo removal path (`lib/data/designer-designs.ts:551`) to sweep derived files or silently
> orphan them. Real risk against no measured benefit is exactly what Principle V refuses.
>
> **The trigger condition is retained rather than discarded.** 184 ms was measured against a local
> Supabase, so it is a floor: on Netlify the storage download crosses a region boundary and cold
> starts add more. Re-measure after deploy, and if per-image cost approaches the low seconds, build
> the cache — with **flat** `{designId}/{photoId}-{width}.webp` names, so the existing non-recursive
> `deleteDesignFiles` sweep still finds them and FR-019 does not regress.

---

## Dependencies

```text
Phase 1: Setup  (T009, T010 are gates — resolve before T027 and T071)
    ↓
Phase 2: Foundational  ←── blocks everything
    ↓
    ├─────────────┬──────────────┐
    ↓             ↓              ↓
Phase 3 (US1)  Phase 4 (US2)  Phase 5 (US3)
  P1 · MVP       P2             P3
                  ↑              ↑
                  └── needs published designs to browse
                                 └── needs a published design to inquire about
    ↓             ↓              ↓
    └─────────────┴──────────────┘
                  ↓
        Phase 6: Polish  (T076 → T077, T078)
```

**Story independence**: US1 stands alone as a private catalogue. US2 and US3 are testable in isolation
against seeded data — neither requires US1's *interface*, only its data. Building P1→P2→P3 is
recommended because each story makes the next demonstrable.

**Within Phase 2**: T011 → T012 → T013 (foreign keys) → T014–T019 (need the tables). T020–T031 are
parallel once the schema lands, except **T022 depends on T018 and T020** (it reads `public_photos` and
signs objects in a private bucket) and **T024 depends on T023**.

---

## Parallel execution examples

**Phase 1** — T002, T003, T004, T006, T007, T008 run together after T001; T009 and T010 are independent
of all of them and should start immediately.

**Phase 2** — after the migration chain (T011–T019):

```text
T020  buckets           T025  public data access   T029  layout + grid
T021  seed              T026  owner data access    T030  alt-text resolver
                        T027  image pipeline       T031  service-key test
                        T028  storage helpers
```

Then T022 (needs T018 + T020), then T023 → T024.

**Phase 3** — T033, T036, T041, T042, T043, T045, T046, T047, T048, T049 are independent files.

**Phase 4** — T053, T056, T057, T062, T063 are independent of the main page work.

**Phase 5** — T067, T068, T074 are independent of the route and delivery work.

**Phase 6** — T077, T078, T079 are parallel after T076; T080 and T081 are independent of everything.

---

## Implementation strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1)** — 50 tasks. A working private archive: capture, organize,
and retrieve from any device. Useful shipped alone, which is why it is P1.

**Increment 2 — add Phase 4 (US2)**: the storefront goes live. This increment carries every Principle II
gate (T060, T061, T062, T063); none may be deferred to Phase 6.

**Increment 3 — add Phase 5 (US3)**: the storefront can produce an outcome for the designer.

**Then Phase 6**: accessibility implementation and tests, performance, the review checklist, and the
manual verifications.

**Resolve T009 and T010 during Phase 1**, before the image pipeline and the cron sweep are written. Both
are cheap now and expensive to discover late.

---

## Summary

| Phase | Tasks | Count |
| --- | --- | --- |
| 1 — Setup | T001–T010 | 10 |
| 2 — Foundational | T011–T031 | 21 |
| 3 — US1 (P1, MVP) | T032–T050 | 19 |
| 4 — US2 (P2) | T051–T063 | 13 |
| 5 — US3 (P3) | T064–T075 | 12 |
| 6 — Polish | T076–T082 | 7 |
| 7 — Session lifecycle & navigation | T083–T086 | 4 |
| **Total** | | **86** |
