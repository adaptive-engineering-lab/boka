# Quickstart: Designer Portfolio Storefront

**Feature**: `001-designer-portfolio-storefront`

How to stand the feature up locally and prove it works. Interface details live in
[contracts/](./contracts/), schema in [data-model.md](./data-model.md), technology rationale in
[research.md](./research.md).

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 20 LTS | Node runtime required — not Edge. `sharp` needs native binaries. |
| Supabase project | Local via `supabase start`, or a hosted project |
| Supabase CLI | For migrations and local stack |
| Resend account | API key + a verified sending domain (research D6) |
| `sharp` with libheif | **Verify before building anything** — see below |

### Verify HEIC support first

FR-007 requires HEIC uploads to work, and this is the assumption in the plan most likely to fail on a
given deployment target (research D5). Confirm `sharp` can decode HEIC on both your machine *and* your
deploy target before writing the upload flow. If it cannot, switch to the client-side WebAssembly
fallback described in D5 — discovering this after the pipeline is built is an expensive rewrite.

---

## Setup

```bash
npm install
cp .env.example .env.local          # fill in the values below
supabase start                      # local Postgres, Auth, Storage
supabase db reset                   # apply migrations + seed
npm run dev                         # http://localhost:3000
```

**Environment**

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server-side anon access (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. **Never import into a client component** — it bypasses RLS, which is the whole of Principle II. |
| `RESEND_API_KEY`, `INQUIRY_FROM_EMAIL` | Inquiry notifications (FR-039) |
| `RATE_LIMIT_SALT` | Salt for `sender_hash` (research D7) |

### One-time configuration

1. **Disable public sign-up** in Supabase Auth. The product has exactly one account; leaving sign-up open contradicts Principle I's premise that there is no visitor role.
2. **Seed the owner account** and its `designer` row.
3. **Confirm buckets**: `originals` **private**, `display` **public** (FR-009, FR-010).
4. **Seed categories**: Dress, Outerwear, Accessory.

---

## Validating the feature

Run in priority order — the first two are mandatory before any release under the constitution's
Quality Gates.

### 1. Draft invisibility (FR-023, SC-002) — MANDATORY

```bash
npm run test:e2e -- draft-invisibility
```

With one published and one draft design, an unauthenticated client must get **identical** 404s for the
draft slug, a deleted slug, and a nonsense slug, and the draft must be absent from `GET /`. Any
difference in status, body, or headers between those three fails the gate — a visitor able to tell them
apart can detect that unpublished work exists.

### 2. Private notes never leak (FR-024, SC-003) — MANDATORY

```bash
npm run test:e2e -- notes-privacy
```

Seed a published design whose `notes` contain a unique sentinel string. Fetch `/` and `/d/{slug}` with
no session and assert the sentinel appears nowhere in the HTML, the metadata, or any embedded JSON.

> Assert against the **raw response body**, not the rendered DOM. A field serialized into a hydration
> payload but not displayed is still a leak, and is exactly the failure mode this test exists to catch.

### 3. Designer round-trip (US1, SC-008)

Sign in, upload a design with three photos (including one HEIC) and full metadata, publish it, then
sign in from a second browser profile and confirm the archive is identical.

### 4. Public browse (US2)

With no session, load `/`, filter by category and collection, open a design, and confirm all photos and
the public description render. Check the empty state by unpublishing everything (FR-033).

### 5. Inquiry, including the failure path (US3, SC-015)

Submit an inquiry and confirm the designer receives an email naming the correct design.

Then **break delivery deliberately** — point `RESEND_API_KEY` at an invalid value — and submit again.
The visitor must still see a normal confirmation, the record must persist, and the dashboard must show
the undelivered banner with the visitor's details readable inline (FR-040b). This path is easy to skip
and is the one most likely to be broken in production, since it only runs when email is already failing.

### 6. Rate limiting (FR-041, SC-016)

Submit 6 inquiries within an hour from one client: the sixth is rejected with an explanation. Submit
once with the `_website` honeypot filled: the response is indistinguishable from success and nothing is
stored.

### 7. Accessibility (FR-012c, SC-013, SC-014)

```bash
npm run test:e2e -- accessibility
```

axe-core reports zero WCAG 2.1 AA violations on the storefront, a design detail page, and the
dashboard. Every `<img>` has non-empty alt text. Separately, complete a full browse-and-inquire journey
using only the keyboard.

### 8. Performance and layout stability (SC-004, SC-009, SC-012)

With 50 designs averaging 3 photos, throttle to 3G-class and confirm meaningful content within 3s,
filtering within 1s, and **zero cumulative layout shift** as images load. Verify public pages request
the `display/` bucket and never `originals/`.

### 9. Mobile verification — required before "done"

The constitution requires every designer-facing flow to be exercised at mobile viewport width, not only
desktop. Run the upload flow on a real phone or an accurate device emulation. It is where the product
is actually used.

---

## Manual smoke checklist

- [ ] Public sign-up disabled; the app has exactly one account
- [ ] `originals` bucket private, `display` bucket public
- [ ] Service-role key absent from every client bundle
- [ ] Draft designs invisible and indistinguishable from missing ones
- [ ] `notes` absent from all public output, including hydration payloads
- [ ] No buy/cart/checkout/comment/edit control on any public page (FR-032)
- [ ] Renaming a design leaves its public URL working (FR-023b)
- [ ] Deleting a design keeps its inquiries, with the title snapshot intact (FR-044)
- [ ] Empty states render on both the storefront and the dashboard (FR-033)
- [ ] Every photo has alt text, authored or fallback (FR-012b)
