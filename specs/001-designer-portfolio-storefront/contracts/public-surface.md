# Contract: Public Surface

**Audience**: unauthenticated visitors. **Governed by**: Principles I and II.

Every route here is reachable with a URL alone — no session, no account, no interstitial (FR-002).
All data on this surface comes from one of the four public views — `public_designs`,
`public_designer_profile`, `public_categories`, `public_photos` — each published-gated with an explicit
column list. **No base table is ever queried by a public route, and no base table is anonymously
writable** (FR-025a, and see [data-model.md](../data-model.md)).

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
| Design grid | For each published design: `slug`, `title`, `collection`, `category.name`, and its first photo from `public_photos` — image URL, `blur_placeholder`, `width`, `height`, resolved `alt_text` |
| Filter options | Category names from `public_categories`; collection names distinct across `public_designs`. **Published designs only** (FR-030a) — a category or collection used solely by drafts must not appear |

**Query parameters** (FR-030):

| Parameter | Values | Behaviour |
|---|---|---|
| `?category=<name>` | any published category | filter |
| `?collection=<name>` | any published collection | filter |
| `?sort=` | `newest` (default), `oldest`, `title` | sort |

Filters and sorts are independent and combinable. Unknown values yield the empty-result state or the
default sort, never an error.

**States**

- **Populated** — grid renders 2 columns at mobile width, 4+ at desktop (FR-017).
- **No published designs** — friendly "new designs coming soon" message (FR-033). Never a blank page.
- **Filter matches nothing** — "nothing matches" with a route back to the unfiltered grid.

**Guarantees**

- Contains no buy, cart, checkout, comment, favourite, upload, edit, or delete control (FR-032).
- Draft designs are absent — enforced at the view, not by view-layer filtering (FR-022).
- Every `<img>` carries non-empty alt text (FR-012b).
- Every image slot reserves its final dimensions before loading (SC-012).
- Largest Contentful Paint under 3s at a 400 kbps / 400 ms RTT throttle profile (SC-004).

---

## `GET /d/{slug}` — Design detail

**Path parameter**: `slug` — title-derived with a random suffix, e.g. `midnight-gown-7f3a` (FR-023a).

**Returns**: `slug`, `title`, `collection`, `category.name`, `public_description`, `created_at`, and
all photos from `public_photos` ordered by `position` — image URL, `blur_placeholder`, `width`, `height`,
resolved `alt_text`. **Never `original_path`** (FR-010).

**Side effect**: calls `increment_design_view(slug)` (FR-034). The count is recorded and **not
displayed** in v1 — FR-034 defers display to v1.1.

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

## `GET /img/{photo_id}/{width}` — Image delivery

Every visitor-facing image is fetched through this route. Both storage buckets are private, so there is
no other way to reach a file (FR-009a, research D11).

**Per-request behaviour** — the order is the contract:

1. Look up `photo_id` in `public_photos`, which is gated on the parent design being published.
2. **No row → 404**, identical for a draft's photo, a deleted design's photo, and a nonexistent id.
3. Row found → **only now** consider `If-None-Match`; a matching `ETag` of `"{photo_id}-{width}"` → 304.
4. Otherwise read the display object and return its **bytes, resized to `{width}`**, as `image/webp` with
   `Cache-Control: private, max-age=60, must-revalidate`.

| Requested | Response |
|---|---|
| Photo of a published design | **200 with resized `image/webp` bytes** |
| Same, with a matching `If-None-Match` | 304 |
| **Photo of a draft design** | **404** — including when `If-None-Match` matches |
| Photo of a deleted design | 404 |
| Nonexistent photo id | 404 |
| Width not in the allowed set | 404 |
| Any original-resolution file | **404 — no route exposes originals** |

> **This route exists because publication state changes after URLs are handed out.** Serving display
> variants from a public bucket meant a photograph stayed downloadable forever once its design had been
> published — unpublishing removed the design from the storefront while leaving the image retrievable by
> anyone who had saved the link. Checking publication on every request makes withdrawal actually withdraw.
>
> **The route returns bytes rather than redirecting to a signed URL** (research D11, amended 2026-07-27).
> An issued signature is an address that outlives its own authorisation — it kept working for its full
> lifetime even if the design was unpublished a second later — and the redirect ignored the `{width}` in
> the path, so a 640px grid tile fetched the stored 2048px variant. Serving the bytes closes both: there
> is no residual window at all, and the width is honoured.
>
> **Step 3 must stay after step 1.** Answering 304 to a stale `ETag` before the publication check would
> confirm to anyone holding one that a withdrawn image still exists — exactly the inference FR-023
> forbids.

**Guarantees**: never serves an original (FR-010); never serves a draft's or deleted design's image
(FR-009a, FR-023); never hands a client a storage URL of any kind; returns no metadata that would
distinguish "unpublished" from "does not exist".

---

## `GET /img/profile` — Designer profile photo

**Returns**: the avatar referenced by `public_designer_profile.profile_photo_path`, as resized
`image/webp` bytes. 404 when no photo is set.

**No publication gate, deliberately.** The designer's `name`, `bio` and photo are public by definition
(FR-028) — there is nothing to withhold. The path still comes from the view, so `email` remains
unreachable. No `ETag`: unlike a design photo, the avatar is overwritten in place, so an identifier keyed
on the owner would survive a replacement and serve the old image.

---

## `POST /d/{slug}/inquire` — Submit an inquiry

The only submission an unauthenticated visitor may make (Principle I, FR-004). The **write itself is
performed by the server**, not by the client — anonymous clients have no insert permission on `inquiry`
(FR-041c, research D12).

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
4. **Persist.** Server-side insert with `design_title_snapshot`, `delivery_state = pending`, and a
   server-computed `sender_hash` (FR-043). The client never supplies these.
5. **Respond.** Confirmation to the visitor — *before* the email is attempted.
6. **Deliver.** In `after()`: send via Resend, up to 3 attempts with backoff (FR-040a). Success → `delivered`; exhausted → `undelivered`, surfacing on the designer's dashboard (FR-040b). A `pg_cron` sweep every 2 minutes retries anything left `pending`, keeping SC-006's 5-minute budget reachable.

**Steps 5 and 6 are ordered deliberately.** The visitor's confirmation does not depend on email
delivery — US3 scenario 5 requires a normal confirmation even when email is entirely down, and FR-040
requires the record to persist regardless.

**Steps 1–3 are unbypassable because step 4 is server-only.** If anonymous clients could insert
directly, a bot would skip this route entirely and the honeypot and rate limit would apply only to
clients that chose to cooperate.

**Responses**

| Outcome | Behaviour |
|---|---|
| Accepted | Confirmation message. No account, no session, no cookie (FR-004). |
| Honeypot triggered | Indistinguishable from accepted. Nothing stored. |
| Rate limited | Explains the limit (FR-041). A visitor inquiring about several pieces in one session never reaches it. |
| Validation failed | Field-level error; form retains entered values. |
| Direct write attempted against the data layer | Rejected — anonymous credentials carry no insert permission (FR-041c). |

**Guarantees**: never returns inquiry data, never reveals whether anyone else has inquired (FR-046),
never creates a session.

---

## Cross-cutting guarantees

Applies to every route above.

- **No authentication is ever requested.** No login prompt, no "sign in to continue", no soft wall (Principle I).
- **No private field is reachable.** `notes`, `owner_id`, `original_path`, `view_count`, `seo_*`, `updated_at`, designer `email`, and all inquiry data are absent from every response (Principle II).
- **No base table is read or written anonymously.** Every read goes through one of the four published-gated views; the only anonymous write is `increment_design_view` (FR-025a).
- **Images are compressed variants behind a publication gate.** Both buckets are private; `/img` re-checks publication per request and never serves an original (FR-009, FR-009a, FR-010).
- **WCAG 2.1 AA.** Keyboard-operable controls, visible focus, sufficient contrast (FR-012c). A keyboard-only visitor can browse, open a design, and inquire (SC-014).
- **Mobile-first.** Every layout is designed at mobile width and widened (Principle III).

## Test assertions required before release

These are mandated by the constitution's Quality Gates, not optional:

1. An unauthenticated client receives an identical 404 for a draft slug, a deleted slug, and a nonsense slug (FR-023, SC-002).
2. No public response body, rendered page, or metadata contains any `notes` content (FR-024, SC-003).
3. No public page contains a purchase, cart, checkout, comment, or edit affordance (FR-032, SC-010).
4. Every rendered `<img>` has non-empty alt text; axe-core reports zero AA violations (SC-013).
5. **An image URL captured while a design was published returns 404 after that design is moved to draft, and again after it is deleted** (FR-009a, SC-017). This is the assertion that would have caught the public-bucket defect.
6. No public surface exposes `original_path`, and no route serves an original-resolution file (FR-010).
7. A category used only by draft designs does not appear in any public filter control (FR-030a).
8. An anonymous client using publicly available credentials cannot insert an `inquiry` row directly against the data layer (FR-041c, SC-016).
