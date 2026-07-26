# Contract: Designer Surface

**Audience**: the single authenticated owner. **Governed by**: Principles III, IV, V.

Every route requires an authenticated session (FR-001). Every mutation re-verifies ownership
server-side through RLS — the absence of a control in the interface is never the only barrier (FR-003).
Public sign-up is disabled; the one account is provisioned out of band (research D2).

---

## `GET /studio` — Dashboard

**Returns**: the owner's designs — published and draft — with `title`, `slug`, `published`,
`category`, `collection`, `created_at`, and first-photo thumbnail. Draft and published are visually
distinguishable at a glance.

**Query parameters** (FR-018) — filters and sorts are independent dimensions and combinable:

| Parameter | Values | Kind |
|---|---|---|
| `?category=<name>` | any of her categories | filter |
| `?collection=<name>` | any of her collections | filter |
| `?sort=` | `newest` (default), `oldest`, `title` | sort |

**Undelivered-inquiry banner** (FR-040b): when any inquiry has `delivery_state = 'undelivered'` and
`acknowledged = false`, a banner reports the count and lists each visitor's name, email, message, and
subject design **inline**.

> This banner is not the v1.1 inquiry inbox (FR-042). It surfaces only inquiries whose email failed,
> and it disappears once acknowledged. It exists because email is the very channel that just broke —
> without it, a failed notification would be visible only in server logs, which is not "observable" in
> any sense that helps the designer (SC-015).

**States**: populated grid (2 columns mobile / 4+ desktop, FR-017); **no designs** → onboarding prompt
to upload the first design, never a blank screen (FR-033); **filter matches nothing** → clear empty
state with a route back.

---

## `GET /studio/designs/new` · `POST /studio/designs`

**Create a design.** Photo selection offers camera and photo library (FR-005), accepts multiple files
(FR-006), and shows progress while transferring (FR-008).

**Accepted formats**: JPEG, PNG, HEIC, **max 25 MB per photo**. HEIC is converted server-side with no
action from the designer (FR-007). Anything else — wrong type or oversized — is rejected with a message
naming the accepted formats and the size limit, without affecting the other photos in the same upload
(FR-012).

**Per-photo fields**: an optional `alt_text` input (FR-012a). Left blank, it falls back at render time
to `"{title}, photo {n} of {total}"` (FR-012b) — the field is optional, alt text on the page is not.

**Design fields**: `title` (required), `category_id`, `collection` (free text, FR-016), `notes`
(**private**), `public_description` (**public**).

> The form must make the notes/description split unmistakable — a label like "Private notes — only you
> see this" against "Public description — visitors see this". FR-025 gives the designer no per-design
> override, so the interface is the only place this distinction can be communicated, and getting it
> wrong is how private measurements end up on the public internet.

**On create**: `published` is `false` (FR-021); `slug` is generated once and frozen (FR-023a/b); each
photo is stored as a retained original plus compressed display variants with a blur placeholder and
recorded dimensions (FR-009, FR-010, FR-011).

**Minimum one photo** (FR-013a): a design is not created until at least one photo has been fully uploaded
and processed. If every photo in the upload fails, the designer is told and **no record is left behind** —
this is what eliminates the zero-photo design rather than handling it at render time. A retry must not
produce a duplicate design.

---

## `GET|PATCH /studio/designs/{id}` · `DELETE /studio/designs/{id}`

**Edit**: `title`, `category_id`, `collection`, `notes`, `public_description`, `published`, per-photo
`alt_text`, and photo add/remove (FR-019).

**`slug` is immutable.** Renaming a design does not change its public URL, so links already shared
continue to resolve (FR-023b). Worth surfacing in the UI when the title changes.

**Publish toggle** (FR-026): flips `published` in either direction at any time. The storefront reflects
it on the visitor's next load. Unpublishing makes the design's URL return the same 404 as a design that
never existed (FR-023).

**Delete** (FR-019): removes the design, cascades the `photo` rows, and **explicitly deletes both storage
prefixes** — `originals/{design_id}/` and `display/{design_id}/`. The row cascade does not touch object
storage, so without that explicit step a deleted design's photographs would sit in the bucket
indefinitely.

**Inquiries are not deleted** — they survive with `design_id` set to null and their title snapshot intact
(FR-044). The confirmation dialog should say so, because "delete this design" reasonably reads as "delete
everything about it" and the leads are the one thing worth keeping.

**Unpublishing needs no storage change.** Access is gated by the `/img` route re-checking publication per
request (FR-009a), not by where the file lives — so a publish/unpublish cycle never mutates storage and
cannot leave rows and objects disagreeing.

**Session expiry mid-edit** (edge case): the designer is prompted to re-authenticate and unsaved entries
are not silently discarded without warning.

---

## `GET|PATCH /studio/settings` — Profile

**Editable**: `name`, `bio` (≤ 2000 chars), `profile_photo` (FR-029). All three render on the public
homepage (FR-028).

**`email` is not editable in v1.** It is the identity for authentication *and* the destination for
inquiry notifications (FR-039); changing it safely requires a verification flow that v1 does not have.

---

## `GET|POST|DELETE /studio/categories` — Category list

Add and remove categories (FR-015), seeded with Dress, Outerwear, Accessory.

**Deletion is blocked** while any design still uses the category; the designer reassigns those designs
first. Silently orphaning a design's category would be a worse outcome than the friction.

---

## `POST /studio/inquiries/{id}/acknowledge`

Sets `acknowledged = true`, clearing the undelivered banner (FR-040c). **Does not delete the inquiry** —
the record persists for the v1.1 inbox (FR-045).

Acknowledging is the only inquiry mutation v1 offers. There is deliberately **no delete affordance**:
FR-042 gives v1 no inbox on which to put one, so FR-045 promises no automatic expiry rather than manual
deletion, and manual deletion arrives with the inbox in v1.1.

---

## Cross-cutting guarantees

- **Authentication required.** Every route redirects to sign-in when unauthenticated (FR-001).
- **Server-side authorization.** Every read and write is scoped by RLS to `owner_id = auth.uid()` (FR-003).
- **Device independence.** All state is server-side; signing in elsewhere surfaces the identical archive (FR-020, SC-008).
- **Mobile-first.** The upload flow is designed for one hand on a phone — it is where the product is actually used (Principle III).
- **WCAG 2.1 AA** applies to the dashboard as well as the storefront (FR-012c).
- **No v1 surfaces** for view counts, SEO fields, or a full inquiry list — those fields are stored, not shown (FR-034, FR-035, FR-042). The `read` flag and both `seo_*` columns exist but nothing in v1 writes them.
- **Deleting a design deletes its files.** Row cascades never suffice for object storage (FR-019).
