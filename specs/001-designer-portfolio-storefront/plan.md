# Implementation Plan: Designer Portfolio Storefront

**Branch**: `001-designer-portfolio-storefront` (directory identifier — this workspace is not a git repository) | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-designer-portfolio-storefront/spec.md`

## Summary

A public fashion-design portfolio that behaves like a storefront with nothing to buy. One designer
uploads and organizes her work from a phone; anyone with the URL browses what she has chosen to
publish, and may send exactly one kind of message — an inquiry about a piece.

The technical approach is a single full-stack Next.js application over Supabase, chosen so that the
specification's two non-negotiable requirements are enforced by structure rather than by discipline:
Row Level Security plus a column-restricted `public_designs` view make it impossible for a draft design
or a private note to reach a visitor, rather than merely unlikely. Everything else follows from
mobile-first performance on a photo-only product and from keeping the infrastructure count at one.

## Technical Context

Resolved in [research.md](./research.md); no NEEDS CLARIFICATION remain.

**Language/Version**: TypeScript 5.x on Node.js 20 LTS

**Primary Dependencies**: Next.js 15 (App Router), React 19, Supabase (Postgres / Auth / Storage), `sharp`, Resend, Tailwind CSS

**Storage**: Supabase Postgres with RLS on every table; Supabase Storage — `originals/` (private), `display/` (public)

**Testing**: Vitest (unit/integration), Playwright + axe-core (end-to-end, accessibility)

**Target Platform**: Mobile-first responsive web; evergreen browsers with iOS Safari as a first-class target

**Project Type**: Web application — single full-stack Next.js project

**Performance Goals**: First meaningful storefront content < 3s on 3G-class connections (SC-004); filter response < 1s at 50 designs (SC-009); zero cumulative layout shift (SC-012)

**Constraints**: No visitor authentication (Principle I); no private field reachable publicly (Principle II); WCAG 2.1 AA (FR-012c); Node runtime required for `sharp`

**Scale/Scope**: 1 designer, < 50 designs averaging 3 photos, low inquiry volume

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates derived from `.specify/memory/constitution.md` v1.0.0.

### Initial evaluation (pre-research)

| Gate | Result | Basis |
|---|---|---|
| I. Public View-Only Storefront | **PASS** | Spec FR-002/FR-032 forbid every non-inquiry visitor action; no design decision contests this. |
| II. Private-By-Default Data Separation | **PASS** | FR-022–FR-025 and Clarification Q1 fix the boundary; the approach must enforce it structurally. |
| III. Mobile-First Performance | **PASS** | FR-009/FR-011 and SC-004/SC-012 give measurable targets. |
| IV. Device-Independent Persistence | **PASS** | FR-020 requires server-side persistence for all durable state. |
| V. Scope Discipline & Simplicity | **PASS with a flagged risk** | FR-040a/FR-040b require retry-then-surface, which implies scheduled work. Carried into research as a possible deviation. |

### Post-design re-evaluation

| Gate | Result | Evidence |
|---|---|---|
| I. Public View-Only Storefront | **PASS** | [public-surface.md](./contracts/public-surface.md): every route unauthenticated; no login prompt on any public path. Inquiry submission is the only visitor action, and the write is server-mediated (FR-041c). |
| II. Private-By-Default Data Separation | **PASS** | Four column-listed, published-gated views; **zero anonymous grants on any base table**; both storage buckets private with per-request publication checks on `/img`. Draft and nonexistent yield zero rows everywhere, making the identical-404 structural rather than conditional. |
| III. Mobile-First Performance | **PASS** | `next/image` with stored `width`/`height` and a `blur_placeholder` per photo row; compressed variants only. Layouts specified mobile-first throughout the contracts. |
| IV. Device-Independent Persistence | **PASS** | All entities in Postgres, all files in Supabase Storage. No device-local state is a system of record. |
| V. Scope Discipline & Simplicity | **PASS with one recorded deviation** | One deployable, one managed service, no cache, no queue, no pagination, no theming. Rate limiting counts rows in Postgres rather than adding Redis. The `pg_cron` retry sweep is recorded below. |

### Re-evaluation after `/speckit-analyze` (2026-07-26)

The first post-design pass recorded PASS on Principle II. **That was wrong**, and analysis caught three
defects in the design it had approved:

| Defect | Why the first pass missed it |
|---|---|
| The `display` bucket was **public**, so a photograph stayed downloadable forever once its design had been published — unpublishing removed the design from the storefront but not the image. | The check reasoned about RLS on the `photo` *table* and never asked what governed the storage *object*. Table-level correctness was mistaken for end-to-end correctness. |
| Anonymous `SELECT` was granted directly on `category` and `photo`, returning `owner_id` and `original_path`, and letting a visitor enumerate categories belonging only to drafts. | Principle II's "select public fields explicitly" was applied to designs and then assumed to be satisfied everywhere, rather than checked per entity. |
| Anonymous `INSERT` on `inquiry` meant a bot could POST straight to the data layer and skip the honeypot and rate limit entirely. | The checks were verified to exist in the route, without asking whether the route was the only way in. |

All three are fixed in [data-model.md](./data-model.md) and recorded as research D11 and D12. The gate now
reads PASS on the corrected design, and the lesson is written into the gate itself: **Principle II must be
evaluated per reachable surface — table, view, route, and stored object — not per table.**

**No gate fails on the current design.** The single Principle V deviation is justified in Complexity
Tracking rather than waived.

## Project Structure

### Documentation (this feature)

```text
specs/001-designer-portfolio-storefront/
├── plan.md              # This file
├── spec.md              # Feature specification (5 clarifications resolved)
├── research.md          # Phase 0 output — D1–D10 technology decisions
├── data-model.md        # Phase 1 output — schema, RLS, state transitions
├── quickstart.md        # Phase 1 output — setup and validation guide
├── contracts/           # Phase 1 output
│   ├── public-surface.md
│   └── designer-surface.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
app/
├── (public)/                    # Visitor surface — no auth, server-rendered
│   ├── page.tsx                 # Storefront grid + designer bio (FR-027, FR-028)
│   └── d/[slug]/
│       ├── page.tsx             # Design detail (FR-031)
│       ├── not-found.tsx        # Identical 404 for draft/deleted/nonexistent (FR-023)
│       └── inquire/route.ts     # Submission route — server-side write (FR-036, FR-041c)
├── img/[photoId]/[width]/       # Publication-gated image delivery (FR-009a)
│   └── route.ts
├── (designer)/studio/           # Authenticated surface
│   ├── page.tsx                 # Dashboard + undelivered banner (FR-040b)
│   ├── designs/
│   │   ├── new/page.tsx         # Create (FR-013, FR-013a)
│   │   └── [id]/page.tsx        # Edit / publish / delete (FR-019, FR-026)
│   ├── settings/page.tsx        # Bio and profile photo (FR-029)
│   ├── categories/page.tsx      # Editable category list (FR-015)
│   └── inquiries/[id]/acknowledge/route.ts   # Clear banner (FR-040c)
├── auth/sign-in/page.tsx        # Sign-in (FR-001)
└── layout.tsx

middleware.ts                    # Session gate on /studio (FR-001)

components/
├── DesignGrid.tsx               # Shared mobile-first grid primitive (FR-017)
├── public/                      # Storefront: header, grid, filters, empty states, inquiry form
└── studio/                      # Dashboard: uploader, alt-text, filters, publish toggle, banner

lib/
├── data/
│   ├── public-designs.ts        # Reads the four public_* views ONLY — never a base table
│   └── designer-designs.ts      # Owner-scoped reads/writes
├── images/                      # sharp pipeline, validation, alt-text, signed URLs (FR-007–FR-012)
├── inquiries/                   # Validation, honeypot, rate limit, delivery (FR-037–FR-041c)
├── supabase/                    # Client factories; service-role isolated server-side
└── auth/

supabase/
├── migrations/                  # Tables, RLS, four public views, triggers, functions, cron sweep
└── seed.sql                     # Owner account, starter categories

tests/
├── integration/                 # Slug, rate limiting, image pipeline, service-key isolation
├── perf/                        # Seeded 50-design measurement (SC-004, SC-009, SC-012)
└── e2e/
    ├── draft-invisibility.spec.ts   # MANDATORY (FR-023, SC-002) — includes image-URL revocation
    ├── notes-privacy.spec.ts        # MANDATORY (FR-024, SC-003)
    ├── view-only.spec.ts            # FR-032, SC-010
    ├── inquiry.spec.ts              # US3 incl. delivery-failure path
    ├── accessibility.spec.ts        # SC-013
    └── keyboard.spec.ts             # SC-014
```

**Structure Decision**: A single full-stack Next.js project, not the backend/frontend split. Principle V
rewards one deployable, and Next.js route handlers cover every server need this feature has — a separate
API service would add a deployment, a CORS story, and cross-service auth for no benefit at this scale.

The one structural rule that carries real weight is the split inside `lib/data/`: **public routes import
`public-designs.ts` and nothing else.** That module is the sole path from a visitor's request to design
data, which makes Principle II reviewable by reading one file rather than auditing every query. The two
mandatory end-to-end specs are named in the tree because the constitution requires them to exist before
their features count as complete.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Scheduled `pg_cron` sweep (every 2 minutes) to retry pending inquiry notifications (Principle V discourages background job machinery) | FR-040a requires retry with backoff and FR-040b requires exhausted retries to be marked `undelivered` and surfaced. `after()` covers the common case, but a serverless freeze or a crash mid-retry would strand an inquiry in `pending` forever — invisible to the designer and contradicting SC-015. The sweep is the durability backstop. The 2-minute cadence is set by SC-006's 5-minute notification budget; the original 15-minute draft silently broke it. | **Synchronous send with no retry** cannot satisfy FR-040a. **Inline retry before responding** adds seconds to the visitor's only available action and still dies with the request. **A dedicated queue** (Inngest, QStash, Redis + worker) is real infrastructure for a site expecting a handful of inquiries a week — strictly worse under Principle V than a scheduled query against a table that already exists. The deviation is correctness-driven, not scale-driven, which is the distinction Principle V actually draws. |
| Image requests traverse the application (`/img` route) rather than hitting object storage directly, **and are resized there** | FR-009a requires image access to be revoked when a design is unpublished or deleted. A public bucket cannot do this — the URL keeps working forever. Re-checking publication per request is the only arrangement where withdrawal actually withdraws. Resizing in the same request is what makes the width in the path mean anything, and it removes the last address a client could hold. | **Public bucket** fails FR-023 outright. **Long-lived signed URLs generated at render** make the TTL the revocation window, so an hour-long TTL means an hour of access to withdrawn work. **Short-lived signed URLs with a redirect** — the original form of this decision, now superseded; see below. **Moving objects on unpublish** turns every publish toggle into a storage mutation that can partially fail, leaving rows and objects disagreeing. **Pre-generated per-width variants** keep the redirect and the residual window, need a backfill for existing photos, and would silently break FR-019 unless variant filenames stay flat — `deleteDesignFiles` sweeps with a **non-recursive** `list(designId)`, so nested variant folders would never be found. At 50 designs the CPU is immaterial and repeat views are 304s. |

### Amendment (2026-07-27) — `/img` serves bytes; it no longer redirects

The row above originally read "redirect to a 60-second signed URL". That was implemented, verified, and
shipped in the US2 increment, and it had two defects that only became visible once the storefront existed:

1. **The width in the path was ignored.** One display variant is stored, longest edge 2048px, so a 640px
   grid tile downloaded a 2048px file. Nothing failed — it was merely slow, which is why it survived a
   whole phase — but at 50 designs averaging 3 photos it was a live risk to SC-004's 3-second LCP budget
   on a 400 kbps connection.
2. **A signed URL is an address that outlives its own authorisation.** Once issued it kept working for its
   full lifetime even if the design was unpublished a second later. The original decision accepted this as
   a 60-second residual window and called it the only residual exposure.

`/img` now reads the object and returns the bytes, resized to the requested width
(`lib/images/deliver.ts`). Both defects close at once, and the second one closing is what justifies the
churn: **no signed URL is issued anywhere in the system**, so the residual window is gone rather than
merely short. This amendment *tightens* Principle II — it is not a privacy-for-performance trade.

The cost moves from a CDN hop to CPU per request. That is the same trade this row already made when it
chose to route images through the application at all; an `ETag` of `{photoId}-{width}` makes repeat views
304s, and a request at or above the stored width returns the stored bytes untouched rather than
re-encoding. Measured in T079.

**One ordering rule is load-bearing and must survive any future edit**: the publication check runs
*before* conditional-request handling. Answering `304` to a stale `If-None-Match` ahead of the gate would
confirm to anyone holding an old ETag that a withdrawn image still exists — the exact inference FR-023
forbids. There is a test for it.

## Phase status

- [x] **Phase 0** — [research.md](./research.md): D1–D12, all NEEDS CLARIFICATION resolved
- [x] **Phase 1** — [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md), agent context updated
- [x] **Phase 2** — [tasks.md](./tasks.md) via `/speckit-tasks`
- [x] **Analysis** — `/speckit-analyze` run 2026-07-26; 25 findings, all remediated. Two CRITICAL Principle II
  defects (public display bucket, anonymous table grants) and one HIGH (bypassable abuse checks) required
  schema and storage changes before implementation.
