# Contract: Public Surface

**Audience**: unauthenticated visitors. **Governed by**: Principles I and II.

Every route here is reachable with a URL alone — no session, no account, no interstitial (FR-002).
All design data on this surface comes from the `public_designs` view; the `design` table is never
queried by a public route (see [data-model.md](../data-model.md) D3).

> **The field lists below are the contract.** A field absent from a response shape must not appear in
> the rendered HTML, in page metadata, or in any embedded JSON payload. `notes` appears nowhere in this
> document, and that is deliberate.

---

## `GET /` — Storefront home

Server-rendered. The homepage *is* the storefront (FR-027).

**Returns**

| Section | Fields |
|---|---|
| Designer profile | `name`, `bio`, `profile_photo_path` — from `public_designer_profile` (FR-028). **Never `email`.** |
| Design grid | For each published design: `slug`, `title`, `collection`, `category.name`, first photo's `display_path`, `blur_placeholder`, `width`, `height`, resolved `alt_text` |
| Filter options | Distinct category names and collection names across published designs only |

**Query parameters**: `?category=<name>` and `?collection=<name>` (FR-030). Unknown values yield the
empty-result state, not an error.

**States**

- **Populated** — grid renders 2 columns at mobile width, 4+ at desktop (FR-017).
- **No published designs** — friendly "new designs coming soon" message (FR-033). Never a blank page.
- **Filter matches nothing** — "nothing matches" with a route back to the unfiltered grid.

**Guarantees**

- Contains no buy, cart, checkout, comment, favourite, upload, edit, or delete control (FR-032).
- Draft designs are absent — enforced at the view, not by view-layer filtering (FR-022).
- Every `<img>` carries non-empty alt text (FR-012b).
- Every image slot reserves its final dimensions before loading (SC-012).
- First meaningful content within 3s on a 3G-class connection (SC-004).

---

## `GET /d/{slug}` — Design detail

**Path parameter**: `slug` — title-derived with a random suffix, e.g. `midnight-gown-7f3a` (FR-023a).

**Returns**: `slug`, `title`, `collection`, `category.name`, `public_description`, `created_at`, and
all photos ordered by `position` with `display_path`, `blur_placeholder`, `width`, `height`, resolved
`alt_text`.

**Side effect**: calls `increment_design_view(slug)` (FR-034). The count is recorded and **not
displayed** in v1 (FR-035 defers display to v1.1).

**Not-found behaviour** — this is a constitutional requirement, not an error-handling detail:

| Requested | Response |
|---|---|
| Published design | 200 with the design |
| **Draft design** | **404, identical to below** |
| Deleted design | 404 |
| Nonexistent slug | 404 |

The three 404s MUST be byte-identical. Any difference in status, body, timing, or headers would let a
visitor infer that unpublished work exists (FR-023). The `public_designs` view produces zero rows for
all three cases, so no branching logic is written — the sameness is structural.

**Guarantees**: `notes` appears nowhere, including in `<meta>` tags and link previews (FR-024). Only
`public_description` is rendered as free text (FR-025).

---

## `POST /d/{slug}/inquire` — Submit an inquiry

The **only** write an unauthenticated visitor may perform (Principle I, FR-004).

**Request**

| Field | Rules |
|---|---|
| `visitor_name` | required, 1–120 chars |
| `visitor_email` | required, format-validated (FR-037) |
| `message` | optional, ≤ 2000 chars |
| `_website` | **honeypot** — hidden, must be empty (FR-041a) |

**Processing order** — the sequence matters:

1. **Honeypot check.** Non-empty → respond as if successful, record nothing (FR-041a). A bot learns nothing.
2. **Rate limit.** > 5 in the last hour or > 20 in the last day for this `sender_hash` → reject with an explanation (FR-041).
3. **Validate.** Malformed email → field-level error, no submission (FR-037).
4. **Persist.** Insert with `design_title_snapshot`, `delivery_state = pending` (FR-043).
5. **Respond.** Confirmation to the visitor — *before* the email is attempted.
6. **Deliver.** In `after()`: send via Resend, up to 3 attempts with backoff (FR-040a). Success → `delivered`; exhausted → `undelivered`, surfacing on the designer's dashboard (FR-040b).

**Steps 5 and 6 are ordered deliberately.** The visitor's confirmation does not depend on email
delivery — US3 scenario 5 requires a normal confirmation even when email is entirely down, and FR-040
requires the record to persist regardless.

**Responses**

| Outcome | Behaviour |
|---|---|
| Accepted | Confirmation message. No account, no session, no cookie (FR-004). |
| Honeypot triggered | Indistinguishable from accepted. Nothing stored. |
| Rate limited | Explains the limit (FR-041). A visitor inquiring about several pieces in one session never reaches it. |
| Validation failed | Field-level error; form retains entered values. |

**Guarantees**: never returns inquiry data, never reveals whether anyone else has inquired (FR-046),
never creates a session.

---

## Cross-cutting guarantees

Applies to every route above.

- **No authentication is ever requested.** No login prompt, no "sign in to continue", no soft wall (Principle I).
- **No private field is reachable.** `notes`, `owner_id`, `view_count`, `seo_*`, `updated_at`, designer `email`, and all inquiry data are absent from every response (Principle II).
- **Images are compressed variants.** Public routes reference the `display/` bucket only; the `originals/` bucket is private (FR-009, FR-010).
- **WCAG 2.1 AA.** Keyboard-operable controls, visible focus, sufficient contrast (FR-012c). A keyboard-only visitor can browse, open a design, and inquire (SC-014).
- **Mobile-first.** Every layout is designed at mobile width and widened (Principle III).

## Test assertions required before release

These are mandated by the constitution's Quality Gates, not optional:

1. An unauthenticated client receives an identical 404 for a draft slug, a deleted slug, and a nonsense slug (FR-023, SC-002).
2. No public response body, rendered page, or metadata contains any `notes` content (FR-024, SC-003).
3. No public page contains a purchase, cart, checkout, comment, or edit affordance (FR-032, SC-010).
4. Every rendered `<img>` has non-empty alt text; axe-core reports zero AA violations (SC-013).
