---
description: "Task list for Designer Portfolio Storefront implementation"
---

# Tasks: Designer Portfolio Storefront

**Input**: Design documents from `/specs/001-designer-portfolio-storefront/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks are included here, but not because TDD was requested. The constitution's Quality
Gates *mandate* automated coverage for exactly two things — that unpublished designs are unreachable
publicly (T050) and that `notes` never appears in a public response (T051) — and SC-013 requires an
automated accessibility check before release (T065). Those three are non-negotiable. The remaining test
tasks cover behaviour that is genuinely hard to verify by hand, chiefly the delivery-failure path.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3, matching spec.md
- File paths are exact

---

## Phase 1: Setup

- [ ] T001 Initialize Next.js 15 App Router project with TypeScript at repository root (`package.json`, `tsconfig.json`, `next.config.ts`)
- [ ] T002 [P] Configure Tailwind with the **default** theme — no custom palette, per Principle V — in `tailwind.config.ts` and `app/globals.css`
- [ ] T003 [P] Initialize the local Supabase stack in `supabase/config.toml`
- [ ] T004 [P] Create `.env.example` with every variable listed in `specs/001-designer-portfolio-storefront/quickstart.md`
- [ ] T005 Create Supabase client factories in `lib/supabase/client.ts` (browser, anon) and `lib/supabase/server.ts` (server, anon + service-role isolated)
- [ ] T006 [P] Configure Vitest for integration tests in `vitest.config.ts` targeting `tests/integration/`
- [ ] T007 [P] Configure Playwright with axe-core in `playwright.config.ts` and scaffold `tests/e2e/`
- [ ] T008 [P] Configure ESLint and Prettier in `eslint.config.mjs` and `.prettierrc`

---

## Phase 2: Foundational

**Blocking**: every user story depends on this phase. The schema and its policies are where Principle II
is actually enforced, so this phase is not a formality — get T013 and T014 wrong and every later gate
fails.

- [ ] T009 Migration for `designer` and `category` tables with constraints from data-model.md in `supabase/migrations/0001_designer_category.sql`
- [ ] T010 Migration for the `design` table — including `published boolean not null default false` (FR-021) and the indexes on `slug`, `(owner_id, created_at)`, `(published, created_at)` — in `supabase/migrations/0002_design.sql`
- [ ] T011 Migration for the `photo` table with non-null `width`/`height`/`blur_placeholder` and cascade-on-design-delete in `supabase/migrations/0003_photo.sql`
- [ ] T012 Migration for the BEFORE INSERT slug trigger — generate once, never on UPDATE (FR-023a/b), retry suffix on unique violation — in `supabase/migrations/0004_slug_trigger.sql`
- [ ] T013 Migration for RLS policies on `designer`, `category`, `design`, `photo` — owner-scoped grants and **no anonymous policy on `design`** (FR-003, FR-022) — in `supabase/migrations/0005_rls.sql`
- [ ] T014 Migration for the `public_designs` and `public_designer_profile` views, omitting `notes` and `email` from their column lists (FR-024, FR-028), in `supabase/migrations/0006_public_views.sql`
- [ ] T015 Migration for the `increment_design_view(slug)` SECURITY DEFINER function, published-rows-only (FR-034), in `supabase/migrations/0007_view_count.sql`
- [ ] T016 [P] Seed the owner account and starter categories (Dress, Outerwear, Accessory) in `supabase/seed.sql`
- [ ] T017 [P] Create storage buckets — `originals` **private**, `display` **public** (FR-009, FR-010) — in `supabase/migrations/0008_storage.sql`
- [ ] T018 Build the sign-in page in `app/auth/sign-in/page.tsx` (FR-001)
- [ ] T019 Add session middleware protecting all `/studio` routes in `middleware.ts` (FR-001)
- [ ] T020 [P] Build the image pipeline — HEIC conversion, resize to display variants, LQIP generation, EXIF orientation (FR-007, FR-009, FR-011) — in `lib/images/pipeline.ts`
- [ ] T021 [P] Build the public data access module, reading `public_designs` **only** and never the `design` table, in `lib/data/public-designs.ts`
- [ ] T022 [P] Build the owner data access module in `lib/data/designer-designs.ts`
- [ ] T023 [P] Build the root layout and the mobile-first responsive grid primitive (2 columns mobile / 4+ desktop, FR-017) in `app/layout.tsx` and `components/DesignGrid.tsx`
- [ ] T024 [P] Build the alt-text resolver applying the title-plus-position fallback (FR-012b) in `lib/images/alt-text.ts`

**Checkpoint**: schema, policies, auth, and the image pipeline exist. User stories can begin.

---

## Phase 3: User Story 1 — Designer builds her design archive (P1) 🎯 MVP

**Goal**: The designer signs in, uploads designs with photos and metadata from her phone, organizes
them, and finds the identical archive from any other device.

**Independent test**: Sign in on a phone, upload a design with three photos and full metadata, sign in
on a second device, confirm parity. Edit one field and delete a second design; both persist.

- [ ] T025 [US1] Build the dashboard grid of the owner's designs, draft and published visually distinct, in `app/(designer)/studio/page.tsx`
- [ ] T026 [P] [US1] Build the empty-archive onboarding prompt (FR-033) in `components/studio/EmptyState.tsx`
- [ ] T027 [US1] Build the new-design form with title, category, collection, notes, and public description in `app/(designer)/studio/designs/new/page.tsx`
- [ ] T028 [US1] Build the photo uploader with camera/library selection and progress indication (FR-005, FR-006, FR-008) in `components/studio/PhotoUploader.tsx`
- [ ] T029 [P] [US1] Build the optional per-photo alt-text input (FR-012a) in `components/studio/AltTextField.tsx`
- [ ] T030 [US1] Implement `createDesign` — persist record, run the image pipeline, store originals and display variants — in `lib/data/designer-designs.ts`
- [ ] T031 [US1] Build the edit page, with `slug` immutable on rename (FR-023b), in `app/(designer)/studio/designs/[id]/page.tsx`
- [ ] T032 [US1] Build delete with a confirmation that states inquiries will be kept (FR-044) in `components/studio/DeleteDesignDialog.tsx`
- [ ] T033 [P] [US1] Build filter and sort controls for category, collection, and date (FR-018) in `components/studio/FilterBar.tsx`
- [ ] T034 [P] [US1] Build category management, blocking deletion of a category still in use, in `app/(designer)/studio/categories/page.tsx`
- [ ] T035 [P] [US1] Build profile settings for name, bio, and profile photo (FR-029) in `app/(designer)/studio/settings/page.tsx`
- [ ] T036 [US1] Handle interrupted uploads — no broken record, retry without duplicating — in `lib/images/pipeline.ts`
- [ ] T037 [P] [US1] Reject unsupported file types with a message naming accepted formats (FR-012) in `lib/images/validate.ts`
- [ ] T038 [P] [US1] Warn on session expiry rather than silently discarding unsaved entries in `components/studio/SessionGuard.tsx`
- [ ] T039 [P] [US1] Integration test: slug is generated once and survives a rename, in `tests/integration/slug.test.ts`
- [ ] T040 [US1] E2E test: archive parity across two sessions (SC-008) in `tests/e2e/designer-archive.spec.ts`

> **The notes/description split is a UI responsibility.** T027 and T031 must label the two fields
> unmistakably — "Private notes — only you see this" against "Public description — visitors see this".
> FR-025 gives no per-design override, so the form is the only place this can be communicated, and
> getting it wrong is how private measurements reach the public internet.

**Checkpoint**: US1 is independently shippable as a private catalogue.

---

## Phase 4: User Story 2 — Visitors browse the public storefront (P2)

**Goal**: Anyone with the URL browses published designs with no account, filters them, opens a piece,
and can reach nothing the designer has not published.

**Independent test**: With seeded published and draft designs, open the site in a private window with no
session. Published designs browse and filter; drafts are absent from the grid and unreachable by direct
URL; no private note text appears anywhere in the page.

- [ ] T041 [US2] Build the published/draft toggle (FR-021, FR-026) in `components/studio/PublishToggle.tsx`
- [ ] T042 [US2] Build the storefront homepage — the grid *is* the homepage (FR-027) — in `app/(public)/page.tsx`
- [ ] T043 [P] [US2] Build the designer bio and profile photo header (FR-028) in `components/public/DesignerHeader.tsx`
- [ ] T044 [US2] Build the public grid using `next/image` with stored dimensions and blur placeholders (FR-011, SC-012) in `components/public/PublicGrid.tsx`
- [ ] T045 [US2] Build the design detail page rendering all photos in order plus `public_description` (FR-031) in `app/(public)/d/[slug]/page.tsx`
- [ ] T046 [P] [US2] Build public filter controls for category and collection (FR-030) in `components/public/PublicFilterBar.tsx`
- [ ] T047 [P] [US2] Build the "coming soon" and "nothing matches" states (FR-033) in `components/public/EmptyStorefront.tsx`
- [ ] T048 [US2] Implement the not-found path so draft, deleted, and nonexistent slugs return **byte-identical** 404s (FR-023) in `app/(public)/d/[slug]/not-found.tsx`
- [ ] T049 [US2] Call `increment_design_view` on detail render, storing without displaying (FR-034), in `app/(public)/d/[slug]/page.tsx`
- [ ] T050 [US2] **MANDATORY** E2E test: draft, deleted, and nonexistent slugs are indistinguishable, and drafts are absent from the grid (FR-023, SC-002), in `tests/e2e/draft-invisibility.spec.ts`
- [ ] T051 [US2] **MANDATORY** E2E test: a `notes` sentinel appears nowhere in the raw response body, metadata, or hydration payload (FR-024, SC-003), in `tests/e2e/notes-privacy.spec.ts`
- [ ] T052 [P] [US2] E2E test: no buy, cart, checkout, comment, favourite, or edit affordance on any public page (FR-032, SC-010) in `tests/e2e/view-only.spec.ts`

> **T051 must assert against the raw response body, not the rendered DOM.** A field serialized into a
> hydration payload but never displayed is still a leak, and is precisely the failure this gate exists
> to catch.

**Checkpoint**: the storefront is live and the two constitutional gates are enforced by CI.

---

## Phase 5: User Story 3 — Visitors inquire about a piece (P3)

**Goal**: A visitor sends the designer a message about a specific piece without an account, and the
designer receives it — even when email delivery is broken.

**Independent test**: With one published design, submit the inquiry form with no session and confirm the
designer is notified with the correct design named. Submit a malformed email and confirm rejection.
Break delivery deliberately and confirm the dashboard banner surfaces the lead.

- [ ] T053 [US3] Migration for the `inquiry` table — `on delete set null`, `design_title_snapshot`, `delivery_state` enum, `(sender_hash, created_at)` index (FR-043, FR-044) — in `supabase/migrations/0009_inquiry.sql`
- [ ] T054 [US3] Migration for inquiry RLS: anonymous `INSERT` only, no anonymous `SELECT` (FR-004, FR-046), in `supabase/migrations/0010_inquiry_rls.sql`
- [ ] T055 [US3] Build the inquiry form with name, email, optional message, and the hidden honeypot field (FR-036, FR-041a) in `components/public/InquiryForm.tsx`
- [ ] T056 [P] [US3] Implement email-format validation with field-level errors (FR-037) in `lib/inquiries/validate.ts`
- [ ] T057 [P] [US3] Implement the rate limit — 5/hour, 20/day against a salted `sender_hash` (FR-041) — in `lib/inquiries/rate-limit.ts`
- [ ] T058 [US3] Build the submit route in the contract's order: honeypot → rate limit → validate → persist → **respond** → deliver, in `app/(public)/d/[slug]/inquire/route.ts`
- [ ] T059 [US3] Implement Resend delivery inside `after()` with 3 attempts and backoff (FR-040a) in `lib/inquiries/deliver.ts`
- [ ] T060 [US3] Migration for the `pg_cron` sweep retrying `pending` rows and marking exhausted ones `undelivered` in `supabase/migrations/0011_delivery_sweep.sql`
- [ ] T061 [US3] Build the undelivered-inquiry banner with visitor details readable inline (FR-040b) in `components/studio/UndeliveredBanner.tsx`
- [ ] T062 [US3] Build the acknowledge route that clears the banner without deleting the record (FR-040c) in `app/(designer)/studio/inquiries/[id]/acknowledge/route.ts`
- [ ] T063 [P] [US3] Integration test: rate limit rejects the 6th submission; a filled honeypot is indistinguishable from success and stores nothing (SC-016), in `tests/integration/inquiry-abuse.test.ts`
- [ ] T064 [US3] E2E test: successful inquiry, **and** the delivery-failure path — visitor still confirmed, record persists, banner appears (SC-015) — in `tests/e2e/inquiry.spec.ts`

> **T058's ordering is the requirement, not an implementation preference.** The visitor's confirmation
> must not depend on email delivery: US3 scenario 5 requires a normal confirmation while email is down.
> Sending before responding fails that scenario even when the code "works".

> **T060 depends on `pg_cron` being available.** This is the plan's one recorded constitutional
> deviation. Verify availability on the target project *before* starting this task — if the extension
> is unavailable, FR-040a/b need a different mechanism and [plan.md](./plan.md) Complexity Tracking must
> be revised first.

**Checkpoint**: all three user stories complete; the feature is functionally whole.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T065 [P] E2E accessibility test: zero axe-core WCAG 2.1 AA violations on storefront, detail, and dashboard (FR-012c, SC-013) in `tests/e2e/accessibility.spec.ts`
- [ ] T066 [P] E2E test: a keyboard-only visitor can browse, open a design, and inquire (SC-014) in `tests/e2e/keyboard.spec.ts`
- [ ] T067 [P] Seed 50 designs averaging 3 photos and measure first-content, filter latency, and cumulative layout shift (SC-004, SC-009, SC-012) in `tests/perf/seed-and-measure.ts`
- [ ] T068 [P] Integration test asserting the service-role key appears in no client bundle, in `tests/integration/no-service-key.test.ts`
- [ ] T069 Disable public sign-up and provision the single owner account, recording the steps in `supabase/config.toml`
- [ ] T070 Verify `sharp` decodes HEIC on the deploy target and record the outcome in `specs/001-designer-portfolio-storefront/quickstart.md`
- [ ] T071 Exercise every designer-facing flow at mobile viewport width and tick off the smoke checklist in `specs/001-designer-portfolio-storefront/quickstart.md`

> **T070 is ordered last but should be done first.** It is listed here because it is verification rather
> than construction, but HEIC support is the assumption in this plan most likely to be wrong (research
> D5), and discovering it after T020 and T028 are built means rewriting the upload pipeline. Run it
> during Phase 1.

> **T071 is required, not optional.** The constitution requires designer-facing flows to be exercised at
> mobile width before a feature counts as done. It is where the product is actually used.

---

## Dependencies

```
Phase 1: Setup
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
        Phase 6: Polish
```

**Story independence**: US1 stands alone as a private catalogue. US2 and US3 are testable in isolation
against seeded data — neither requires US1's *interface* to exist, only its data. Building in P1→P2→P3
order is recommended because each story makes the next demonstrable.

**Within Phase 2**: T009 → T010 → T011 (foreign keys) → T012, T013, T014, T015 (all depend on the tables
existing). T016–T024 are parallel once the schema lands.

---

## Parallel execution examples

**Phase 1** — T002, T003, T004, T006, T007, T008 all run together after T001.

**Phase 2** — after the migration chain (T009–T015) completes:
```
T016  seed              T020  image pipeline     T023  layout + grid
T017  storage buckets   T021  public data access T024  alt-text resolver
                        T022  owner data access
```

**Phase 3** — T026, T029, T033, T034, T035, T037, T038, T039 are independent files.

**Phase 4** — T043, T046, T047, T052 are independent of the main page work.

**Phase 6** — T065, T066, T067, T068 are fully parallel.

---

## Implementation strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1)** — 40 tasks. This delivers a working private archive: the
designer can capture, organize, and retrieve her work from any device. It is genuinely useful shipped
alone, which is why it is P1, and it is the only phase that must exist before anything else can be
demonstrated.

**Increment 2 — add Phase 4 (US2)**: the storefront goes live and the product becomes what it is for.
This increment carries both constitutional gates (T050, T051); neither may be deferred to Phase 6.

**Increment 3 — add Phase 5 (US3)**: the storefront can now produce an outcome for the designer.

**Then Phase 6**: accessibility, performance, and the manual verifications.

**Two things to pull forward out of order**: run **T070** (HEIC verification) during Phase 1, before the
image pipeline is built, and confirm `pg_cron` availability before committing to **T060**. Both are
cheap now and expensive to discover late.

---

## Summary

| Phase | Tasks | Count |
|---|---|---|
| 1 — Setup | T001–T008 | 8 |
| 2 — Foundational | T009–T024 | 16 |
| 3 — US1 (P1, MVP) | T025–T040 | 16 |
| 4 — US2 (P2) | T041–T052 | 12 |
| 5 — US3 (P3) | T053–T064 | 12 |
| 6 — Polish | T065–T071 | 7 |
| **Total** | | **71** |
