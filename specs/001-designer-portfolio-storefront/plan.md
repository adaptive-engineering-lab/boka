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
| I. Public View-Only Storefront | **PASS** | [public-surface.md](./contracts/public-surface.md): every route unauthenticated; the sole anonymous write is inquiry `INSERT`, backed by the only anonymous RLS insert policy in the schema. No login prompt on any public path. |
| II. Private-By-Default Data Separation | **PASS — strengthened** | Two independent layers: `public_designs` omits `notes` from its column list, so no anonymous code path can hold it; and `design` has *no* anonymous RLS policy, so a mistaken direct query returns zero rows. Draft and nonexistent both yield zero rows, making the identical-404 requirement structural rather than conditional. |
| III. Mobile-First Performance | **PASS** | `next/image` with stored `width`/`height` and a `blur_placeholder` on every photo row; public routes bound to the `display/` bucket only. Layouts specified mobile-first throughout the contracts. |
| IV. Device-Independent Persistence | **PASS** | All entities in Postgres, all files in Supabase Storage. No device-local state is a system of record. |
| V. Scope Discipline & Simplicity | **PASS with one recorded deviation** | One deployable, one managed service, no cache, no queue, no pagination, no theming. Rate limiting counts rows in Postgres rather than adding Redis. The `pg_cron` retry sweep is recorded below. |

**No gate failed.** The single deviation is justified in Complexity Tracking rather than waived.

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
│       └── inquire/route.ts     # The only anonymous write (FR-036)
├── (designer)/studio/           # Authenticated surface
│   ├── page.tsx                 # Dashboard + undelivered banner (FR-040b)
│   ├── designs/[id]/page.tsx    # Create / edit / publish (FR-019, FR-026)
│   ├── settings/page.tsx        # Bio and profile photo (FR-029)
│   └── categories/page.tsx      # Editable category list (FR-015)
├── auth/                        # Sign-in (FR-001)
└── layout.tsx

lib/
├── data/
│   ├── public-designs.ts        # Reads public_designs ONLY — never `design`
│   └── designer-designs.ts      # Owner-scoped reads/writes
├── images/                      # sharp pipeline: HEIC, variants, LQIP (FR-007–FR-011)
├── inquiries/                   # Validation, honeypot, rate limit, delivery (FR-037–FR-041)
└── auth/

supabase/
├── migrations/                  # Tables, RLS policies, public_designs view, slug trigger
└── seed.sql                     # Owner account, starter categories

tests/
├── integration/                 # Slug generation, rate limiting, image pipeline
└── e2e/
    ├── draft-invisibility.spec.ts   # MANDATORY (FR-023, SC-002)
    ├── notes-privacy.spec.ts        # MANDATORY (FR-024, SC-003)
    └── accessibility.spec.ts        # SC-013, SC-014
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
| Scheduled `pg_cron` sweep to retry pending inquiry notifications (Principle V discourages background job machinery) | FR-040a requires retry with backoff and FR-040b requires exhausted retries to be marked `undelivered` and surfaced. `after()` covers the common case, but a serverless freeze or a crash mid-retry would strand an inquiry in `pending` forever — invisible to the designer and contradicting SC-015. The sweep is the durability backstop. | **Synchronous send with no retry** cannot satisfy FR-040a. **Inline retry before responding** adds seconds to the visitor's only available action and still dies with the request. **A dedicated queue** (Inngest, QStash, Redis + worker) is real infrastructure for a site expecting a handful of inquiries a week — strictly worse under Principle V than a scheduled query against a table that already exists. The deviation is correctness-driven, not scale-driven, which is the distinction Principle V actually draws. |

## Phase status

- [x] **Phase 0** — [research.md](./research.md): D1–D10, all NEEDS CLARIFICATION resolved
- [x] **Phase 1** — [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md), agent context updated
- [ ] **Phase 2** — `tasks.md` via `/speckit-tasks` (not produced by this command)
