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
- [X] T022 Build the publication-gated image route: look up `public_photos`, return an identical 404 when absent, else redirect to a 60-second signed URL (FR-009a) in `app/img/[photoId]/[width]/route.ts`
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
> |---|---|---|
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

- [ ] T051 [US2] Build the published/draft toggle (FR-021, FR-026) in `components/studio/PublishToggle.tsx`
- [ ] T052 [US2] Build the storefront homepage — the grid *is* the homepage (FR-027) — in `app/(public)/page.tsx`
- [ ] T053 [P] [US2] Build the designer bio and profile photo header from `public_designer_profile` (FR-028) in `components/public/DesignerHeader.tsx`
- [ ] T054 [US2] Build the public grid using `next/image` against the `/img` route, with stored dimensions and blur placeholders (FR-011, SC-012) in `components/public/PublicGrid.tsx`
- [ ] T055 [US2] Build the design detail page rendering all photos in order plus `public_description` (FR-031) in `app/(public)/d/[slug]/page.tsx`
- [ ] T056 [P] [US2] Build public filter controls (category, collection — sourced from `public_categories` so draft-only values never appear) and sort controls (newest, oldest, title) (FR-030, FR-030a) in `components/public/PublicFilterBar.tsx`
- [ ] T057 [P] [US2] Build the "coming soon" and "nothing matches" states (FR-033) in `components/public/EmptyStorefront.tsx`
- [ ] T058 [US2] Implement the not-found path so draft, deleted, and nonexistent slugs return **byte-identical** 404s (FR-023) in `app/(public)/d/[slug]/not-found.tsx`
- [ ] T059 [US2] Call `increment_design_view` on detail render, storing without displaying (FR-034), in `app/(public)/d/[slug]/page.tsx`
- [ ] T060 [US2] **MANDATORY** E2E test: draft, deleted, and nonexistent slugs are indistinguishable; drafts absent from the grid; **and an image URL captured while published returns 404 after unpublish and after delete** (FR-023, FR-009a, SC-002, SC-017), in `tests/e2e/draft-invisibility.spec.ts`
- [ ] T061 [US2] **MANDATORY** E2E test: a `notes` sentinel appears nowhere in the raw response body, metadata, or hydration payload (FR-024, SC-003), in `tests/e2e/notes-privacy.spec.ts`
- [ ] T062 [P] [US2] E2E test: no buy, cart, checkout, comment, favourite, or edit affordance on any public page; no `original_path` in any response (FR-032, FR-010, SC-010) in `tests/e2e/view-only.spec.ts`
- [ ] T063 [P] [US2] E2E test: a category used only by drafts is absent from the public filter control (FR-030a) in `tests/e2e/filter-leakage.spec.ts`

> **T061 must assert against the raw response body, not the rendered DOM.** A field serialized into a
> hydration payload but never displayed is still a leak, and is precisely the failure this gate exists
> to catch.

> **T060's image-revocation assertion is the one that would have caught the original defect.** The first
> design served display variants from a public bucket, so a photograph stayed downloadable forever once
> its design had been published. Nothing in the previous test plan would have noticed.

**Checkpoint**: the storefront is live and every Principle II gate is enforced by CI.

---

## Phase 5: User Story 3 — Visitors inquire about a piece (P3)

**Goal**: A visitor sends the designer a message about a specific piece without an account, and the
designer receives it — even when email delivery is broken.

**Independent test**: With one published design, submit the inquiry form with no session and confirm the
designer is notified with the correct design named. Submit a malformed email and confirm rejection. Break
delivery deliberately and confirm the dashboard banner surfaces the lead. Attempt a direct data-layer
insert with the anon key and confirm rejection.

- [ ] T064 [US3] Migration for the `inquiry` table — `on delete set null`, `design_title_snapshot`, `delivery_state` enum, `read` flag (v1.1-facing, never written in v1), `(sender_hash, created_at)` index (FR-038, FR-043, FR-044) — in `supabase/migrations/0012_inquiry.sql`
- [ ] T065 [US3] Migration for inquiry RLS: owner-only read/update/delete, **no anonymous `INSERT` and no anonymous `SELECT`** (FR-041c, FR-046), in `supabase/migrations/0013_inquiry_rls.sql`
- [ ] T066 [US3] Build the inquiry form with name, email, optional message, and the hidden honeypot field (FR-036, FR-041a) in `components/public/InquiryForm.tsx`
- [ ] T067 [P] [US3] Implement email-format validation with field-level errors (FR-037) in `lib/inquiries/validate.ts`
- [ ] T068 [P] [US3] Implement the rate limit — 5/hour, 20/day against a **server-computed** salted `sender_hash` (FR-041) — in `lib/inquiries/rate-limit.ts`
- [ ] T069 [US3] Build the submit route in the contract's order — honeypot → rate limit → validate → **server-side insert** → respond → deliver — in `app/(public)/d/[slug]/inquire/route.ts`
- [ ] T070 [US3] Implement Resend delivery inside `after()` with 3 attempts and backoff (FR-040a) in `lib/inquiries/deliver.ts`
- [ ] T071 [US3] Migration for the `pg_cron` sweep running **every 2 minutes**, retrying `pending` rows and marking exhausted ones `undelivered` (FR-040b, SC-006), in `supabase/migrations/0014_delivery_sweep.sql`
- [ ] T072 [US3] Build the undelivered-inquiry banner with visitor details readable inline (FR-040b) in `components/studio/UndeliveredBanner.tsx`
- [ ] T073 [US3] Build the acknowledge route that clears the banner without deleting the record (FR-040c) in `app/(designer)/studio/inquiries/[id]/acknowledge/route.ts`
- [ ] T074 [P] [US3] Integration test: rate limit rejects the 6th submission; a filled honeypot is indistinguishable from success and stores nothing; **a direct anon-key insert against the data layer is rejected** (FR-041c, SC-016), in `tests/integration/inquiry-abuse.test.ts`
- [ ] T075 [US3] E2E test: successful inquiry, **and** the delivery-failure path — visitor still confirmed, record persists, banner appears (SC-015) — in `tests/e2e/inquiry.spec.ts`

> **T069's ordering is the requirement, not an implementation preference.** The visitor's confirmation
> must not depend on email delivery: US3 scenario 5 requires a normal confirmation while email is down.

> **T065 is why T074's direct-insert assertion matters.** With anonymous `INSERT` granted, a bot could
> POST straight to the data layer and skip the honeypot and rate limit entirely — the checks would apply
> only to clients that chose to cooperate.

**Checkpoint**: all three user stories complete; the feature is functionally whole.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T076 Implement the accessibility pass — visible focus indication, contrast, keyboard operability, form labelling and error association across both surfaces (FR-012c) — in `app/globals.css` and the affected components
- [ ] T077 [P] E2E accessibility test: zero axe-core WCAG 2.1 AA violations on storefront, detail, and dashboard (SC-013) in `tests/e2e/accessibility.spec.ts`
- [ ] T078 [P] E2E test: a keyboard-only visitor can browse, open a design, and inquire (SC-014) in `tests/e2e/keyboard.spec.ts`
- [ ] T079 [P] Seed 50 designs averaging 3 photos and measure LCP at a 400 kbps / 400 ms RTT profile, filter/sort latency, and cumulative layout shift (SC-004, SC-009, SC-012) in `tests/perf/seed-and-measure.ts`
- [ ] T080 Create the public-surface review checklist that any change touching a public route, public view, or the `published` flag must pass before merge (constitution Quality Gates) in `specs/001-designer-portfolio-storefront/checklists/public-surface-review.md`
- [ ] T081 Disable public sign-up and provision the single owner account, recording the steps in `supabase/config.toml`
- [ ] T082 Exercise every designer-facing flow at mobile viewport width, **timing the capture-to-publish flow (SC-001) and counting taps from homepage to detail (SC-005)**, and tick off the smoke checklist in `specs/001-designer-portfolio-storefront/quickstart.md`

> **T076 must precede T077 and T078.** Ordering the accessibility tests before any implementation task
> would leave them failing with no owner for the fixes — the previous task list had exactly that gap.

> **T080 closes the one constitutional gate with no artifact.** The constitution mandates a
> public-surface review on every change touching a public route or the `published` flag, but nothing
> existed to perform it; `checklists/requirements.md` is a spec-quality checklist, not this gate.

> **T082 is required, not optional.** The constitution requires designer-facing flows to be exercised at
> mobile width before a feature counts as done, and SC-001 and SC-005 are otherwise never measured.

---

## Dependencies

```
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

```
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
|---|---|---|
| 1 — Setup | T001–T010 | 10 |
| 2 — Foundational | T011–T031 | 21 |
| 3 — US1 (P1, MVP) | T032–T050 | 19 |
| 4 — US2 (P2) | T051–T063 | 13 |
| 5 — US3 (P3) | T064–T075 | 12 |
| 6 — Polish | T076–T082 | 7 |
| **Total** | | **82** |
