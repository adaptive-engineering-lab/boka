# Phase 0 Research: Designer Portfolio Storefront

**Feature**: `001-designer-portfolio-storefront`
**Date**: 2026-07-26
**Input**: [spec.md](./spec.md), [constitution.md](../../.specify/memory/constitution.md) v1.0.0

The specification is deliberately technology-free, so every entry in Technical Context began as
NEEDS CLARIFICATION. This document resolves each one. Decisions are driven by the five constitutional
principles rather than by familiarity — where a principle forced a choice, it is named.

> **The stack choice below is the single highest-leverage decision in this plan.** It was made here
> rather than asked, because the workflow resolves unknowns in research and because every option
> considered satisfies the spec. If you disagree with the framework or the backend, say so now — it
> is cheap to change before `/speckit-tasks` and expensive after.

---

## D1. Application framework

**Decision**: Next.js 15 (App Router) with TypeScript, deployed as a single application on a Node.js
runtime.

**Rationale**:

- **Principle II wants a server boundary.** Public pages must select public fields explicitly. Server
  Components let every public page fetch through a narrow server-side data function, so no client
  bundle ever receives a Design row that it then filters. A client-side SPA would fetch rows into the
  browser and hide fields in the view layer — exactly the strip-after-fetch pattern the constitution
  forbids.
- **Principle III wants image machinery we do not write.** `next/image` provides responsive `srcset`
  generation, lazy loading, explicit width/height to reserve layout space (SC-012, no layout shift),
  and a native `placeholder="blur"` prop (FR-011). Building this by hand is the largest avoidable
  cost in the feature.
- **v1.1 needs server-rendered HTML.** The deferred SEO and social-sharing work (spec §Out of Scope)
  requires real `<title>`/`<meta>` tags in the initial response. Server rendering now costs nothing
  and makes that fast-follow a metadata function rather than a re-architecture.
- **Principle V wants one deployable.** A single app with route handlers avoids a separate API
  service, its own deployment, and cross-origin auth.

**Alternatives considered**:

| Option | Why rejected |
|---|---|
| Vite + React SPA with a separate API | Two deployables and no server-rendered HTML. Public pages would ship JSON to the browser, weakening the Principle II boundary and forfeiting the v1.1 SEO path. |
| Remix / React Router 7 | Comparable server-first model and a legitimate choice. Rejected only because it lacks a built-in image pipeline equivalent to `next/image`, which is disproportionately valuable for a photo-only product. |
| Astro | Excellent for the public storefront, weaker for the authenticated dashboard's interactive upload flow. Would likely mean two rendering models in one project. |
| SvelteKit | Strong server-first story. Rejected on ecosystem depth for image handling and the team's likely React familiarity; revisit if that assumption is wrong. |

---

## D2. Database, authentication, and file storage

**Decision**: Supabase — Postgres for data, Supabase Auth for the designer's session, Supabase Storage
for image files. Row Level Security enabled on every table.

**Rationale**:

- **RLS turns Principle II from a discipline into a mechanism.** The constitution's hardest
  requirement is that drafts and private notes never leak. Application-layer checks depend on every
  future query being written correctly. A database policy denying anonymous reads of unpublished rows
  fails closed by default — a new query written next year inherits the protection automatically. This
  is the decisive reason for Supabase over a plain Postgres instance with an ORM.
- **One service covers three needs.** Auth, relational data, and blob storage in a single managed
  product keeps the infrastructure count at one, which Principle V rewards.
- **Postgres suits the shape of the data.** Designs, photos, and inquiries are relational with strict
  ownership. At the launch scale of ~50 designs, no caching or read-replica story is needed.

**Critical configuration**: Public sign-up MUST be disabled in the Supabase Auth settings. The product
has exactly one owner account (spec Assumptions), seeded manually. Leaving sign-up open would let
anyone create an account, which violates Principle I's premise that there is no visitor role.

**Alternatives considered**:

| Option | Why rejected |
|---|---|
| Postgres + Prisma + Auth.js + S3 | Four moving parts to assemble and secure, and authorization would live entirely in application code. More control than this feature needs, at the cost of the fail-closed property. |
| Firebase / Firestore | Document model fits the data less well, and security rules are harder to reason about than SQL policies for the draft-visibility requirement. |
| SQLite + local disk | Violates Principle IV: file-backed storage on one host is not device-independent persistence, and image files would not survive a redeploy. |

---

## D3. Enforcing the public/private boundary (Principle II)

**Decision**: Two-layer enforcement — a restrictive RLS policy on `designs`, plus a dedicated
`public_designs` database view that physically omits private columns. All public reads go through the
view; the base table is unreachable anonymously.

**Rationale**: FR-024 requires that `notes` never reach a public surface, and the constitution requires
explicit field selection rather than post-fetch stripping. A view whose column list excludes `notes`
makes the leak structurally impossible: there is no code path where an anonymous caller holds a row
containing the column. Adding a private field to `designs` later does not widen the view. The RLS
policy is the second layer, ensuring that even a mistaken direct query returns nothing for drafts.

FR-023 additionally requires that a draft be indistinguishable from a non-existent design. A view that
filters on `published = true` produces zero rows for both cases, so the "not found" response is
identical without any conditional logic.

**Alternatives considered**: A single RLS policy with application-side column selection was rejected —
it satisfies draft invisibility but leaves `notes` exposure dependent on every query being written
correctly forever.

---

## D4. Public design identifiers

**Decision**: A `slug` column, unique, generated once at insert as a kebab-case rendering of the title
plus a 4-character suffix from a URL-safe alphabet. Never regenerated on rename.

**Rationale**: Resolves spec Clarification Q1 (FR-023a, FR-023b). The suffix supplies the
non-enumerability FR-023 demands; a sequential integer or a bare title slug would let a visitor probe
for unpublished work. Generating once and freezing it satisfies FR-023b so shared links survive
renames. Collisions are handled by regenerating the suffix on unique-constraint violation — at 50
designs the probability is negligible, and the retry loop is three lines.

**Note on suffix length**: 4 characters from a 32-character alphabet gives ~1M combinations per title
slug. Against a catalogue of 50 designs this is not a secret worth attacking, but it comfortably
defeats the enumeration FR-023 is actually written against.

---

## D5. Image pipeline

**Decision**: Upload the original to Supabase Storage; generate compressed display variants server-side
with `sharp`; serve through `next/image` with a blur placeholder derived from a tiny inline base64
thumbnail stored on the photo row. **Both storage buckets are private**; images reach visitors through a
publication-gated application route (see D11).

**Rationale**:

- FR-009 requires that public surfaces serve compressed variants, never originals. FR-010 requires the
  original be retained. Two storage paths (`originals/`, `display/`) express this directly.
- FR-011 requires a placeholder that reserves layout space. Storing a ~20-byte-per-side base64 LQIP on
  the photo row means the blur is available in the initial server render with no extra request — this
  is what makes SC-012 (no layout shift) achievable rather than aspirational.
- `sharp` handles resize, re-encode, and EXIF orientation correction in one pass.

**HEIC handling (FR-007)** is the genuine risk here. iOS usually converts HEIC to JPEG when a photo is
chosen through a file input, but this depends on a device setting and is not guaranteed. **Decision**:
convert server-side with `sharp` compiled with libheif support, and validate at deploy time that HEIC
decoding works. If the deployment target cannot provide libheif, the fallback is client-side conversion
via a WebAssembly decoder before upload. This must be verified early — it is the one assumption in this
plan most likely to be wrong in practice, and it is called out again in `quickstart.md`.

**Alternatives considered**: Supabase Storage image transformations (less control over the HEIC path and
adds per-request transformation latency); client-side compression only (unreliable across devices and
leaves the server trusting client output).

---

## D6. Inquiry notification delivery

**Decision**: Record the inquiry, respond to the visitor immediately, then send via **Resend** inside
Next.js's `after()` hook with up to 3 attempts and exponential backoff. A `pg_cron` sweep **every 2
minutes** retries anything still `pending` and marks exhausted rows `undelivered`.

**On the 2-minute cadence**: the first draft specified 15 minutes, which silently broke SC-006's
5-minute notification budget — any inquiry whose in-request attempts failed would arrive up to 15
minutes late. At 2 minutes, a submission whose `after()` attempts fail is retried well inside the
budget. The sweep is a single indexed query against a table holding a handful of rows a week, so the
cadence costs nothing. SC-006 has also been scoped to exclude sustained provider outages, during which
no cadence could meet a 5-minute promise and FR-040b's banner is the real guarantee.

**Rationale**: FR-040 requires the record to survive a send failure, FR-040a requires retry with
backoff, and FR-040b requires exhausted retries to surface on the dashboard. Sending inside the request
would either block the visitor's confirmation for seconds or lose the retry on a serverless freeze.
`after()` lets the visitor's response go out first (US3 scenario 5: "the visitor still sees a normal
confirmation") while the send continues.

**This is a recorded constitutional deviation.** Principle V says background job machinery "requires a
demonstrated need recorded in the plan's Complexity Tracking section." The need is demonstrated by
FR-040a/FR-040b, and it is correctness-driven, not scale-driven. See Complexity Tracking in
[plan.md](./plan.md).

**Alternatives considered**:

| Option | Why rejected |
|---|---|
| Synchronous send, no retry | Cannot satisfy FR-040a. A transient DNS blip loses a real lead. |
| Inline retry with backoff before responding | Adds seconds to the visitor's submit. Poor experience for the one action a visitor can take. |
| Dedicated queue (Inngest, QStash, Redis+worker) | Genuine infrastructure for a site expecting a handful of inquiries a week. Disproportionate under Principle V. |
| Retry opportunistically on dashboard load | No new infrastructure, but delivery would depend on the designer visiting — unacceptable for a lead. |

**Email provider**: Resend, for a minimal API and straightforward domain verification. Postmark and SES
are equivalent; the integration is small and isolated behind one module, so switching later is cheap.

---

## D7. Rate limiting (FR-041)

**Decision**: Count rows in Postgres over a time window, keyed by a salted hash of the client IP,
enforced **inside the submission route which is the only writer** (see D12). No Redis, no third-party
service.

**Rationale**: The limits are 5/hour and 20/day. At this volume a `count(*)` over an indexed
`(sender_hash, created_at)` pair is trivially fast and needs no additional infrastructure, which
Principle V requires. Hashing the IP with a server-side secret means raw addresses are not retained
alongside the visitor PII the inquiry already holds — a small privacy improvement that costs nothing.

**Alternatives considered**: Redis or Upstash (new infrastructure for a trivial counting problem);
in-memory counters (lost on every serverless cold start, so effectively no limit).

---

## D8. View counting (FR-034)

**Decision**: A `SECURITY DEFINER` Postgres function that increments `view_count` for a published
design, callable by anonymous users. No other write path is exposed to anonymous callers.

**Rationale**: FR-034 requires counting views in v1 while Principle I forbids visitor writes in general
and RLS denies anonymous writes to `designs`. A narrowly scoped function that can only increment a
counter on an already-published row is the smallest possible exception, and it cannot be repurposed to
modify anything else.

---

## D9. Styling and accessibility

**Decision**: Tailwind CSS used as a utility layer with the default palette and no custom theme,
`@tailwindcss/forms` for accessible form defaults, and `axe-core` wired into the end-to-end tests.

**Rationale**: Principle V forbids a custom colour system or theming machinery in v1; using Tailwind's
defaults without extending the theme honours that while avoiding hand-written CSS. FR-012c commits to
WCAG 2.1 AA and SC-013 requires an automated check with zero violations before release, which needs a
real assertion in CI rather than a manual review.

---

## D10. Testing approach

**Decision**: Vitest for unit and integration tests, Playwright for end-to-end. Two test suites are
mandatory per the constitution's Quality Gates; the rest is judgement.

**Rationale**: The constitution mandates automated coverage for exactly two things — that unpublished
designs are unreachable publicly, and that `notes` never appears in a public response — and explicitly
declines to mandate blanket coverage. Playwright is required rather than optional because both
mandatory assertions are about what an unauthenticated HTTP client can see, which is precisely what an
end-to-end test observes and what a unit test cannot.

---

## D11. Image delivery and access revocation

**Decision**: Both storage buckets are private. Visitors fetch images through `/img/{photo_id}/{width}`,
which looks the photo up in `public_photos`, returns an identical 404 when there is no row, and otherwise
redirects to a 60-second signed URL.

**Rationale**: This closes the most serious defect found in analysis. A public `display` bucket meant RLS
gated the `photo` *table* while the storage object stayed world-readable — so once a design had been
published, its photograph remained downloadable forever by anyone holding the URL, even after the design
was moved to draft or deleted. That directly contradicts Principle II ("drafts MUST NOT be reachable by
guessing a URL or ID") and FR-023, and it is invisible in testing unless you specifically re-request an
old image URL after unpublishing.

Re-checking publication per request makes revocation immediate. The 60-second signature is the only
residual window and cannot be renewed once the design is unpublished.

**Alternatives considered**:

| Option | Why rejected |
|---|---|
| Public bucket, accept the exposure | The original design. Fails FR-023 outright — an unpublished garment stays downloadable indefinitely. |
| Long-lived signed URLs generated at page render | Simpler and CDN-friendly, but the TTL becomes the revocation window; a 1-hour TTL means an hour of continued access to work the designer has withdrawn. |
| Move objects to a private prefix on unpublish | Immediate revocation, but every publish/unpublish becomes a storage mutation that can partially fail, leaving rows and objects disagreeing about where a file lives. |

**Cost**: image requests traverse the application rather than hitting the CDN directly. At 50 designs
this is immaterial (Principle V), and the route is cacheable with a short TTL.

## D12. Inquiry write path

**Decision**: Anonymous clients cannot write to `inquiry` at all. The submission route performs the
honeypot and rate-limit checks and then inserts using a server-side key.

**Rationale**: The original design granted anonymous `INSERT` with the checks living in the route. But the
anon key is necessarily published in the browser bundle, so a bot could POST directly to the data layer's
REST endpoint, bypass the route, and write unlimited inquiries with arbitrary `sender_hash`,
`delivery_state`, and `design_title_snapshot` values. FR-041 and FR-041a were enforced only against
clients that chose to cooperate — which is precisely the "disciplinary rather than structural" failure
this plan claims to avoid.

A `SECURITY DEFINER` RPC callable by anon does not fix it either: the rate limit keys on `sender_hash`,
which Postgres cannot derive on its own, so a caller supplying its own hash evades the limit by varying
it. Making the server the sole writer is the only arrangement where the checks cannot be routed around.

**Alternatives considered**: anon `INSERT` with a database-side trigger enforcing the rate limit (rejected
— still trusts a client-supplied sender identity); a signed submission token issued by the page (rejected
— adds a token lifecycle to protect one form, and the server-only write is simpler and stronger).

## Resolved Technical Context

| Field | Resolution |
|---|---|
| Language/Version | TypeScript 5.x on Node.js 20 LTS |
| Primary Dependencies | Next.js 15 (App Router), React 19, Supabase (Postgres/Auth/Storage), `sharp`, Resend, Tailwind CSS |
| Storage | Supabase Postgres with RLS; Supabase Storage buckets `originals/` and `display/` — **both private**, served via a publication-gated route (D11) |
| Testing | Vitest (unit/integration), Playwright + axe-core (end-to-end, accessibility) |
| Target Platform | Mobile-first responsive web; modern evergreen browsers, iOS Safari a first-class target |
| Project Type | Web application — single full-stack Next.js project |
| Performance Goals | Storefront LCP < 3s at a 400 kbps / 400 ms RTT throttle profile (SC-004); filter or sort response < 1s at 50 designs (SC-009) |
| Constraints | No visitor authentication (Principle I); no private field reachable publicly (Principle II); no layout shift on image load (SC-012); WCAG 2.1 AA (FR-012c) |
| Scale/Scope | 1 designer, < 50 designs averaging 3 photos, low inquiry volume |

No NEEDS CLARIFICATION markers remain.
