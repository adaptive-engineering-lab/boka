# Fashion Designer Portfolio App — MVP Spec

## 1. Overview
A mobile-friendly web app that works like an online store — except there's nothing to buy. The designer uploads and organizes her designs; anyone who visits the site can browse them publicly, like walking through a storefront. No login, no cart, no checkout — purely a public showcase.

**Users:**
- **Designer (owner):** full access — upload, edit, organize, delete, publish/unpublish
- **Public visitor:** anyone who visits the site. No account needed. Can browse all published designs, view details/photos, filter/sort — but cannot buy, comment, or edit anything.

**Storage:** Persistent, built into the app (not device-local, not third-party cloud). Designs must be accessible from any device she logs into.

---

## 2. Core Features (v1)

### 2.1 Upload
- Upload photo(s) from camera or photo library (mobile-first)
- Multiple photos per design (e.g. front, back, detail)
- Basic upload progress indicator
- Supported formats: JPEG, PNG, HEIC (auto-converted to JPEG/PNG on upload)

### 2.2 Organize
- Each design is a **record** with:
  - Title/name
  - Photo(s)
  - Category (e.g. Dress, Outerwear, Accessory — simple dropdown, editable list)
  - Collection/season (free text or tag, e.g. "Spring 2027")
  - Notes (free text — fabric, measurements, inspiration)
  - Date created (auto-set on upload)
- Designer can view all designs in a grid (mobile: 2-column; desktop: 4+ column)
- Filter/sort by category, collection, or date
- Edit or delete any design record
- Reorder designs within a collection (drag-to-reorder — stretch goal if time allows, not blocking for v1)

### 2.3 Public Storefront (visitor-facing)
- The main site itself IS the storefront — no separate link needed per design
- Public homepage shows a browsable grid of all **published** designs (like a store's catalog page)
- Visitors can:
  - Browse the full grid
  - Filter/sort by category or collection
  - Tap into a design to see all its photos and any public-facing notes (e.g. fabric, description)
- Visitors CANNOT: buy, comment, favorite, edit, or upload — purely view-only
- No account or login required for visitors

### 2.4 Publish Control
- Each design has a **published / draft** toggle
- Only "published" designs appear on the public storefront
- Draft designs are visible only to the designer (useful for works-in-progress or unfinished uploads)

### 2.5 Inquire (visitor-facing)
- Each published design has an **"Inquire"** button — no account/login needed
- Tapping it opens a simple contact form: visitor's name, email, optional message
- On submit, the designer receives the inquiry (e.g. email notification) with a reference to which design it's about
- This is the only action a visitor can take beyond browsing — still no buying, no cart, no checkout
- No in-app inquiry inbox needed for v1 — email notification is sufficient (an inquiry log/dashboard is a v2 candidate)

### 2.6 Homepage & About the Designer
- Public homepage includes a brief **designer bio/blurb** and optional profile photo, above or alongside the design grid
- Gives visitors context on whose storefront this is before they start browsing
- Designer can edit this text/photo from her account settings

### 2.7 Image Handling
- Uploaded photos are automatically resized/compressed for fast mobile loading (full-size original retained for the designer's own reference if needed)
- Lightweight placeholder (blur or skeleton) shown while images load on the public storefront
- Goal: fast-loading grid even on slow mobile connections

### 2.8 Empty States
- **Public storefront, no published designs yet:** friendly placeholder message (e.g. "New designs coming soon") instead of a blank page
- **Designer dashboard, no designs uploaded yet:** onboarding prompt guiding her to upload her first design

### 2.9 Authentication
- Designer: simple login (email/password, or magic link) — required to access upload/edit/organize screens
- Public visitors: no account, no login — the storefront is open to anyone with the URL

---

## 3. User Flows

**Upload flow (designer, on phone):**
1. Open app → tap "+ New Design"
2. Take photo or choose from library (repeat for multiple angles)
3. Add title, category, collection, notes
4. Save → design appears in main grid

**Publish flow (designer):**
1. Open a design (new or existing)
2. Toggle "Published" on when ready for the public to see it
3. Design now appears on the public storefront automatically

**Browse flow (public visitor):**
1. Visitor opens the site URL (no login)
2. Sees grid of all published designs, can filter by category/collection
3. Taps a design → sees full photos and public-facing details
4. No buy button, no account, no edit controls anywhere

**Inquire flow (public visitor):**
1. Visitor taps "Inquire" on a design
2. Fills in name, email, optional message
3. Submits → designer gets notified (email) with the visitor's info and which design it was about

---

## 4. Data Model (simplified)

**Design**
- id
- owner_id
- title
- category
- collection
- notes (designer-only notes, e.g. measurements — not shown publicly)
- public_description (optional, shown to visitors — e.g. fabric, story)
- photos (array of image references, stored in compressed + original variants)
- published (boolean — controls storefront visibility)
- view_count (integer — for basic analytics)
- seo_title (optional, defaults to design title)
- seo_description (optional, defaults to public_description)
- created_at
- updated_at

**Inquiry**
- id
- design_id
- visitor_name
- visitor_email
- message
- read (boolean — for in-app inquiry inbox)
- created_at

**User (Designer)**
- id
- email
- name
- bio (shown on public homepage)
- profile_photo (optional)

---

## 5. v1.1 Features (Fast Follow, Not Blocking Launch)

### 5.1 Inquiry Inbox (In-App)
- A simple list view inside the designer's dashboard showing all inquiries received
- Read/unread status per inquiry
- Grouped or filterable by design
- Reduces reliance on email as the only record of inquiries

### 5.2 Basic Analytics
- View counter per design (already tracked via `view_count` in v1 data model, surfaced in UI in v1.1)
- Simple "most viewed" sort/highlight on the designer's dashboard
- No advanced analytics (traffic sources, demographics, etc.) — just view counts

### 5.3 Social Sharing
- Share button on each design's public page (e.g. copy link, share to social/messaging apps)
- Enables word-of-mouth discovery — visitors can send a specific design to someone else
- No login required to share

### 5.4 SEO Basics
- Each design's public page gets a page title and meta description (from `seo_title`/`seo_description` fields, defaulting to the design's title/public_description)
- Enables designs to be discoverable via Google/Google Images search
- No advanced SEO tooling (sitemaps, structured data) needed for v1.1 — basic tags only

---

## 6. Explicitly Out of Scope for v1
(Candidates for v2+, listed earlier: status tracking, team collaboration/comments, search, version history, offline capture.)
- Multi-user team editing
- Comments/feedback threads
- Status workflow (sketch → sample → final)
- Search
- Offline mode / sync
- Version history per design

---

## 7. Resolved Decisions
- **Private notes vs. public info:** Strictly separate. The `notes` field is always private (designer-only); anything shown publicly must go through `public_description`. No per-design override.
- **Branding:** Minimal/simple for v1 — no logo or custom color system. Clean default styling only. Custom branding is a candidate for a later version if needed.
- **Scale:** Small — under 50 designs at launch. No special storage/performance planning needed beyond the standard image compression already in the spec.
- **Inquiry notifications:** Sent to her personal email (the `email` field on her User record) — no dedicated app-managed address needed for v1.
