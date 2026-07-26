<!--
SYNC IMPACT REPORT
==================
Version change: TEMPLATE (unversioned placeholders) → 1.0.0
Bump rationale: MAJOR — initial ratification. All five principle slots and both
free-form sections defined for the first time; no prior governance to supersede.

Principles defined (all new):
  - [PRINCIPLE_1_NAME] → I. Public View-Only Storefront (NON-NEGOTIABLE)
  - [PRINCIPLE_2_NAME] → II. Private-By-Default Data Separation (NON-NEGOTIABLE)
  - [PRINCIPLE_3_NAME] → III. Mobile-First Performance
  - [PRINCIPLE_4_NAME] → IV. Device-Independent Persistence
  - [PRINCIPLE_5_NAME] → V. Scope Discipline & Simplicity

Sections defined:
  - [SECTION_2_NAME] → Additional Constraints
  - [SECTION_3_NAME] → Development Workflow & Quality Gates

Removed sections: none.

Templates / artifacts:
  ✅ .specify/templates/plan-template.md — Constitution Check gates replaced with
     the five concrete principle gates
  ✅ .specify/templates/spec-template.md — reviewed; scope/requirements structure
     already compatible, no mandatory-section changes required
  ✅ .specify/templates/tasks-template.md — reviewed; task categorization is
     user-story-driven and principle-agnostic, no change required
  ✅ .specify/templates/checklist-template.md — reviewed; no constitution refs
  ✅ CLAUDE.md — reviewed; managed SPECKIT block is generic, no principle refs
  ✅ .specify/extensions/agent-context/commands/*.md — reviewed; no outdated or
     agent-specific principle references

Deferred TODOs: none.
-->

# Boka Constitution

Boka is a public fashion-design portfolio: a storefront with nothing to buy. One designer
publishes; anyone may look. Every principle below protects that shape.

## Core Principles

### I. Public View-Only Storefront (NON-NEGOTIABLE)

The public surface MUST be reachable with a URL alone — no account, no login, no interstitial.
Visitors MUST be able to browse, filter, sort, open a design, and submit an inquiry. Visitors
MUST NOT be able to buy, add to a cart, check out, comment, favorite, upload, edit, or delete.
Inquiry submission is the single write a visitor may perform, and it MUST NOT create an account
or a session.

Any feature that would require a visitor to identify themselves before browsing is a violation,
not a trade-off. Rationale: the product's value is that it behaves like walking past a shop
window. Login walls and commerce affordances destroy that, and every such affordance also drags
in payments, accounts, and moderation obligations the project has explicitly refused.

### II. Private-By-Default Data Separation (NON-NEGOTIABLE)

Designer-private data and public data live in separate fields and MUST NOT be merged, aliased, or
conditionally exposed:

- `notes` is always private (fabric, measurements, inspiration). It MUST NOT be serialized into
  any public response, page, meta tag, or image payload.
- `public_description` is the only free-text field visitors may see.
- Only designs with `published == true` appear on any public surface. Draft designs MUST NOT be
  reachable by guessing a URL or ID.
- There is no per-design override that promotes private data to public.

Public endpoints MUST select public fields explicitly rather than returning a record and stripping
fields afterward. Rationale: exclusion-by-omission fails silently the moment a field is added,
whereas explicit selection fails safely. Leaking a measurement or an unfinished design is the
worst outcome this app can produce.

### III. Mobile-First Performance

The designer uploads from a phone and visitors browse from one, frequently on a slow connection.
Therefore:

- Every layout MUST be designed at mobile width first, then widened (grid: 2 columns mobile,
  4+ desktop).
- Uploaded images MUST be resized and compressed for delivery; the original MUST be retained for
  the designer's own reference and MUST NOT be what the public grid loads.
- Public image loads MUST show a lightweight placeholder (blur or skeleton) — never a blank box or
  a layout shift.
- Uploads MUST show progress. JPEG, PNG, and HEIC MUST be accepted, with HEIC converted on upload.

Rationale: a portfolio that loads slowly is not browsed, and a grid that jumps while loading reads
as broken.

### IV. Device-Independent Persistence

Designs, inquiries, and profile data MUST persist server-side in storage owned by the application.
Device-local storage MUST NOT be the system of record for anything the designer would be upset to
lose. Signing in from any device MUST surface the same designs. Rationale: the designer's archive
is the product; it cannot be hostage to one phone.

### V. Scope Discipline & Simplicity

Build the smallest thing that satisfies the spec, and treat the spec's exclusions as binding:

- Out of scope until explicitly re-opened: multi-user team editing, comment/feedback threads, a
  status workflow (sketch → sample → final), search, offline mode/sync, and per-design version
  history.
- Styling for v1 is clean and default. No logo system, no custom color system, no theming layer.
- Expected scale is under 50 designs. Caching layers, sharding, background job queues, and
  pagination machinery MUST NOT be introduced for hypothetical scale; they require a demonstrated
  need recorded in the plan's Complexity Tracking section.
- Deferred work is deferred, not pre-built. v1.1 items (inquiry inbox, surfaced view counts,
  social sharing, SEO tags) MAY have their data fields present in v1 where the spec says so, but
  MUST NOT ship UI in v1.

Rationale: this is a one-person portfolio with a known ceiling. Premature infrastructure is the
most likely way for it to fail to ship.

## Additional Constraints

**Authentication.** Exactly one authenticated role exists: the designer (owner). Authentication is
email/password or magic link. There is no visitor role to authenticate, no role hierarchy, and no
permission matrix — a request is either the owner's or the public's.

**Authorization.** Every mutation of a design, inquiry-read state, or profile MUST verify the
acting user owns the record (`owner_id`). Ownership checks MUST be enforced server-side; hiding a
control in the UI is not an authorization mechanism.

**Data model integrity.** The entities in the spec — Design, Inquiry, User — are the vocabulary.
Adding an entity or a field to a public-facing entity requires stating, in the plan, which side of
the public/private boundary in Principle II it falls on.

**Inquiry handling.** Inquiry submission MUST notify the designer at the email on her User record
and MUST include which design the inquiry concerns. The submission path MUST be resilient to a
failed notification: a lost email must not mean a lost inquiry record.

**Empty states.** No primary surface may render blank. An empty public storefront shows a friendly
"coming soon" message; an empty designer dashboard shows an upload prompt.

## Development Workflow & Quality Gates

**Constitution Check.** Every `plan.md` MUST pass the Constitution Check gate before research
begins, and MUST be re-checked after design. A gate failure is resolved by changing the design or
by recording an explicit, justified entry in Complexity Tracking — never by ignoring the gate.

**Public-surface review.** Any change that touches a public route, a public serializer, or the
`published` flag MUST be reviewed specifically against Principles I and II before merge. The
reviewer MUST confirm that no private field and no unpublished design became reachable.

**Testing.** Tests are not mandated across the board. They ARE mandated for the two
non-negotiables: there MUST be automated coverage asserting that (a) unpublished designs are not
reachable from public surfaces, and (b) `notes` never appears in a public response. These tests
MUST exist before the corresponding feature is considered complete.

**Manual verification.** Before a feature is marked done, the designer-facing flow it touches MUST
be exercised at mobile viewport width, not only desktop.

## Governance

This constitution supersedes ad-hoc practice. Where a plan, task list, or code review conflicts
with it, the constitution wins and the conflicting artifact is amended.

**Amendment procedure.** Amendments MUST be proposed as an edit to this file that includes: the
principle text being added, changed, or removed; the rationale; the new version number; and an
updated Sync Impact Report. Dependent templates flagged in that report MUST be updated in the same
change.

**Versioning policy.** Semantic versioning applies to governance, not to the product:

- MAJOR — a principle is removed or redefined in a way that permits what it previously forbade.
- MINOR — a principle or section is added, or existing guidance is materially expanded.
- PATCH — clarification, wording, or typo fixes that do not change what is permitted.

**Compliance review.** The Constitution Check in `plan-template.md` is the enforcement point for
new work. Standing exemptions do not exist; a justified violation is scoped to the single feature
that recorded it in Complexity Tracking.

**Runtime guidance.** `CLAUDE.md` and the active feature's `plan.md` carry implementation-level
guidance (stack, structure, commands). They MUST NOT contradict this file.

**Version**: 1.0.0 | **Ratified**: 2026-07-26 | **Last Amended**: 2026-07-26
