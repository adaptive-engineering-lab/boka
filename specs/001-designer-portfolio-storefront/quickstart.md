# Quickstart: Designer Portfolio Storefront

**Feature**: `001-designer-portfolio-storefront`

How to stand the feature up locally and prove it works. Interface details live in
[contracts/](./contracts/), schema in [data-model.md](./data-model.md), technology rationale in
[research.md](./research.md).

---

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js 20 LTS | Node runtime required — not Edge. `sharp` needs native binaries. |
| Supabase project | Local via `supabase start`, or a hosted project |
| Supabase CLI | For migrations and local stack |
| Resend account | API key + a verified sending domain (research D6) |
| `sharp` with libheif | **Verify before building anything** — see below |

### Verification status (recorded 2026-07-26)

| Gate | Status |
| --- | --- |
| **T009 — HEIC decode** | **PASS** on darwin/arm64: `sharp` 0.35.3, libvips 8.18.3, HEIF decode available. Run `npm run verify:heic` on the **deploy target** too — that half is still unverified. |
| **T010 — `pg_cron`** | **PASS** locally: present in `pg_available_extensions`. Confirm on the hosted project before T071. |
| Migrations applied | **PASS.** All 11 applied cleanly from an empty database, plus seed. |
| Principle II enforcement | **VERIFIED** — see below. |
| Owner access (FR-003) | **PASS** as of migration `0011` — see the correction below. It did **not** pass before it. |
| US1 end-to-end | **PASS** on desktop Chromium *and* iPhone 14 WebKit: `tests/e2e/designer-archive.spec.ts`, 3 specs. |

#### What was actually exercised against a live database

All four base tables return `permission denied` for `anon`; the four public views return published
rows only; `notes` and `original_path` are absent from the views entirely; a draft-only category does
not appear in `public_categories`; `anon` cannot insert into `design`.

The `/img` gate was tested over HTTP with a real file in the bucket:

| Request | Result |
| --- | --- |
| Published photo | `200 image/webp`, bytes resized to the requested width |
| **Same URL after unpublishing** | **`404`** ← this is the N1 fix |
| Same URL after republishing | `200` again |
| Draft photo, nonexistent id, bad width, malformed id | `404`, and the draft and nonexistent responses are **byte-identical** |
| Storage object fetched directly, unsigned | `400` (bucket is private) |

> **Amended 2026-07-27** — `/img` used to answer `302` with a 60-second signed URL. It now returns the
> bytes itself, resized (research D11). Re-verified against a production build:
>
> | Requested width | Status | Bytes | Actual width | `Location` |
> | --- | --- | --- | --- | --- |
> | 320 | 200 | 320 | 320px | none |
> | 640 | 200 | 1,058 | 640px | none |
> | 1080 | 200 | 2,862 | 1080px | none |
> | 1920 | 200 | 5,666 | 1536px | none |
>
> The 1920 row is the stored variant returned untouched — the fast path skips re-encoding and never
> upscales, so the byte count matches the stored object exactly. Conditional requests were checked too:
> a matching `If-None-Match` gives `304`, and **the same header after unpublishing gives `404`, not
> `304`** — the publication gate runs ahead of conditional handling.

Also confirmed: `updated_at` advances on update while `created_at` is preserved; a slug survives a
rename; `increment_design_view` increments a published design and silently ignores a draft slug
without revealing which it was.

#### Correction found while building US1 (2026-07-26)

The verification above is accurate and it was **not sufficient**. It established that anonymous
callers are refused and that the public views are gated — the two things the design was worried
about. Nobody asked the opposite question, and the answer was that the designer could not read or
write a single row of her own archive.

`authenticated` and `service_role` held no `SELECT`, `INSERT`, `UPDATE` or `DELETE` on any base
table. Supabase's permissive default privileges are registered `FOR ROLE supabase_admin`, but
migrations run as `postgres`, whose `public`-schema defaults grant only `TRUNCATE`, `REFERENCES` and
`TRIGGER`. RLS policies were in place and could do nothing, because **a policy filters rows a caller
is already privileged to touch — it cannot grant a privilege that was never given.**

Fixed in `0011_grants_authenticated.sql`, which asserts both directions: `anon` still holds no DML,
**and** the owner does. To re-check by hand:

```sh
docker exec supabase_db_Boka psql -U postgres -d postgres -c \
  "select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
     from information_schema.role_table_grants
    where table_name in ('designer','category','design','photo')
      and grantee in ('anon','authenticated','service_role')
    group by table_name, grantee order by table_name, grantee;"
```

`anon` must not appear in the output at all.

A second local-only defect surfaced at the same time: the seed inserted `auth.users` with NULL token
columns, so every sign-in failed with a 500 and the message `Database error querying schema`. GoTrue
reads those columns into Go strings, which cannot hold NULL. `seed.sql` now writes `''` for all
eight. This only affects hand-written `auth.users` inserts — the hosted account provisioned in T081
goes through GoTrue and is unaffected.

**Local port note**: the 543xx defaults were taken by another Supabase project, so this stack runs on
**55321** (API), 55322 (db), 55323 (Studio). See `supabase/config.toml`.

Local sign-in: `designer@boka.local` / `boka-local-dev`.

**Running the tests locally**: integration tests read `.env.local` themselves and skip with a warning
if no stack is configured. End-to-end tests need browsers (`npx playwright install chromium webkit`)
and start `npm run dev` themselves.

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

### Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server-side anon access (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. **Never import into a client component** — it bypasses RLS, which is the whole of Principle II. |
| `RESEND_API_KEY`, `INQUIRY_FROM_EMAIL` | Inquiry notifications (FR-039) |
| `RATE_LIMIT_SALT` | Salt for `sender_hash` (research D7) |

### One-time configuration

1. **Disable public sign-up** in Supabase Auth. The product has exactly one account; leaving sign-up open contradicts Principle I's premise that there is no visitor role.
2. **Seed the owner account** and its `designer` row.
3. **Confirm both buckets are private** — `originals` *and* `display` (FR-009a). A public `display` bucket is the defect analysis found: it leaves a photograph downloadable forever once its design has been published, even after unpublishing.
4. **Confirm `pg_cron` is enabled**; the 2-minute delivery sweep depends on it.
5. **Seed categories**: Dress, Outerwear, Accessory.

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

This spec also covers **image-access revocation** (SC-017): capture a published design's image URL, move
the design to draft, and assert the URL now 404s; then delete the design and assert it still 404s. Run
this assertion deliberately — it is the one that catches a display bucket accidentally left public, and
nothing else in the suite would notice.

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

Then attempt an insert **directly against the data layer** using the public anon key, bypassing the
route. It must be rejected (FR-041c). Without this, the honeypot and rate limit apply only to clients
that choose to cooperate — a bot reading the anon key out of the page bundle would skip both.

### 7. Accessibility (FR-012c, SC-013, SC-014)

```bash
npm run test:e2e -- accessibility
```

axe-core reports zero WCAG 2.1 AA violations on the storefront, a design detail page, and the
dashboard. Every `<img>` has non-empty alt text. Separately, complete a full browse-and-inquire journey
using only the keyboard.

### 8. Performance and layout stability (SC-004, SC-009, SC-012)

```bash
PORT=3100 npx playwright test --project=throttled
```

Seeds 50 published designs averaging 3 photos, throttles to **400 kbps down / 400 ms RTT** with a cold
cache, and asserts **LCP under 3s**, filter response within 1s, and no visible layout shift. The
fixture is idempotent and is removed afterwards through the real delete path, so storage is swept too.

Two guards make the numbers trustworthy, and both fail the run rather than flattering it:

- The fixtures carry **photographic entropy**, not flat colour. A storefront of solid-colour tiles
  compresses to almost nothing and would clear a 3s budget while proving nothing, so the spec asserts
  a floor on the mean delivered image size. Below it, the run fails as *unrealistic*.
- Each measurement uses a **fresh context with a cleared cache**. A warm second load measures the
  browser cache rather than the site.

Also verify by eye that every image request goes through `/img/…` and that no response references an
`originals/` path.

### 9. Mobile verification — required before "done"

The constitution requires every designer-facing flow to be exercised at mobile viewport width, not only
desktop. Run the upload flow on a real phone or an accurate device emulation. It is where the product
is actually used.

---

## Deploying to Netlify

`netlify.toml` sets the build to `npm run verify:heic && npm run build`, so **a deploy fails if the
platform's `sharp` cannot decode HEIC**. That is deliberate: FR-007 requires accepting iPhone uploads,
and research D5 named this the assumption most likely to be wrong on a given target. A red build
beats the designer discovering that half her photographs are rejected.

### Environment variables

Set these in **Site configuration → Environment variables**. The first four are the same as
`.env.example`; the last two are the ones a working local setup lets you forget.

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The hosted project, not `127.0.0.1`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Subject to RLS; safe in the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses RLS entirely.** Never prefix `NEXT_PUBLIC_`. |
| `RESEND_API_KEY`, `INQUIRY_FROM_EMAIL` | Without these every notification fails and every inquiry lands in the dashboard banner instead (FR-040b). Correct behaviour, but not the intended one. |
| `RATE_LIMIT_SALT` | **Required in production.** See below. |

### Two things that will not announce themselves

**`RATE_LIMIT_SALT` is not optional on serverless.** Unset, `lib/inquiries/rate-limit.ts` falls back
to a salt generated once per process. On one long-lived server that merely resets the counting window
on restart. On Netlify the "process" is a Lambda instance — many, short-lived, concurrent — so a
visitor's requests hash to different senders, counts never accumulate, and FR-041 and SC-016 stop
being enforced. Nothing breaks visibly; the app logs an error and keeps accepting inquiries, because
FR-040 says a real message must survive a misconfiguration. Set it.

**`maxDuration = 60` on the upload routes cannot be honoured.** `app/(designer)/studio/designs/route.ts`
and `.../[id]/photos/route.ts` both request 60 seconds. Netlify's synchronous function limit is 10s on
free and 26s on Pro, so a large multi-photo HEIC upload from a phone on a slow connection can be cut
off mid-processing. Watch the first real uploads. If this bites, the fix is to move image processing
off the request path (background function or a queued job), which is a design change, not a config
tweak — decide it deliberately rather than by retry.

### Provisioning the owner account

`supabase/seed.sql` does not run against a hosted project, so the single account is created by hand:

1. Apply migrations: `supabase link --project-ref <ref>` then `supabase db push`.
2. **Authentication → Providers → Email**: confirm *Enable email signup* is **off**. `config.toml`
   sets this locally; the hosted project has its own setting and does not inherit it. This is T081.
3. **Authentication → Users → Add user**, with *Auto Confirm* on. This is the only account that will
   ever exist.
4. Insert the matching `designer` row with that user's id as `owner_id`, plus the starter categories —
   see `supabase/seed.sql` for the exact shape.
5. Confirm `pg_cron` is enabled (**Database → Extensions**) and that `0014_delivery_sweep.sql` applied:
   `select jobname, schedule from cron.job;` must show `boka-delivery-sweep` at `*/2 * * * *`.

### After the first deploy

- Sign in at `/auth/sign-in`; there is deliberately no link to it from the storefront (Principle I).
- Send one real inquiry and confirm the email arrives within 5 minutes naming the right design
  (SC-006). Every automated test to date exercises the *failure* path, which is the harder half but
  not the whole claim.
- Re-run the public-surface review checklist against the deployed site.

---

## Manual smoke checklist

- [ ] Public sign-up disabled; the app has exactly one account
- [ ] **Both** buckets private — `originals` and `display` (FR-009a)
- [ ] Service-role key absent from every client bundle
- [ ] Draft designs invisible and indistinguishable from missing ones
- [ ] A published design's image URL stops working after unpublish and after delete (SC-017)
- [ ] `notes` absent from all public output, including hydration payloads
- [ ] No public response references an `originals/` path (FR-010)
- [ ] No anonymous grant on any base table; all public reads go through the four `public_*` views
- [ ] A direct anon-key insert into `inquiry` is rejected (FR-041c)
- [ ] A category used only by drafts is absent from public filter controls (FR-030a)
- [ ] No buy/cart/checkout/comment/edit control on any public page (FR-032)
- [ ] Renaming a design leaves its public URL working (FR-023b)
- [ ] Deleting a design removes both storage prefixes (FR-019)
- [ ] Deleting a design keeps its inquiries, with the title snapshot intact (FR-044)
- [ ] `updated_at` advances on edit; `created_at` does not (FR-014)
- [ ] Empty states render on both the storefront and the dashboard (FR-033)
- [ ] Every photo has alt text, authored or fallback (FR-012b)
- [ ] Capture-to-publish timed under 3 min on a phone (SC-001); homepage → detail in ≤2 taps (SC-005)
- [ ] `RATE_LIMIT_SALT` set in the production environment — without it the rate limit is off (FR-041)
- [ ] Hosted Supabase: email signup disabled in the dashboard, not only in `config.toml` (T081)
- [ ] `cron.job` shows `boka-delivery-sweep` at `*/2 * * * *` on the hosted project (T010, SC-006)
- [ ] One real inquiry email received within 5 minutes, naming the right design (SC-006)
