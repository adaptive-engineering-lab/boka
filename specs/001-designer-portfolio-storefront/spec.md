# Feature Specification: Designer Portfolio Storefront

**Feature Branch**: `001-designer-portfolio-storefront`

**Created**: 2026-07-26

**Status**: Planned — clarified, planned, and analyzed; ready for implementation

**Input**: User description: "against fashion-designer-app-spec.md to turn it into a numbered feature spec"

**Source**: Derived from `fashion-designer-app-spec.md` (Fashion Designer Portfolio App — MVP Spec) and
governed by `.specify/memory/constitution.md` v1.0.0.

## Clarifications

### Session 2026-07-26

- Q: How should a design be identified in its public URL? → A: Title-derived slug plus a random suffix
  (e.g. `midnight-gown-7f3a`), so URLs stay readable and shareable while remaining non-enumerable.
- Q: What accessibility commitment does v1 make for design photos? → A: Optional designer-authored alt
  text per photo, falling back to the design title and photo position when blank, on a WCAG 2.1 AA
  baseline.
- Q: What happens to inquiry records when a design is deleted, and how long is visitor contact data
  kept? → A: The inquiry survives, storing a snapshot of the design's title, and is retained until the
  designer deletes it; no automatic expiry in v1.
- Q: What mechanism and threshold should protect the inquiry form from abuse? → A: Per-sender rate
  limiting at 5 inquiries per hour and 20 per day, combined with a hidden honeypot field. No
  third-party service and no visitor-facing challenge.
- Q: When an inquiry notification email fails to send, how does the designer find out? → A: Retry with
  backoff, then flag the inquiry as undelivered and show a dashboard banner with the visitor's details
  readable inline.

### Session 2026-07-26 (post-analysis)

Five gaps surfaced by `/speckit-analyze` that the spec genuinely did not settle. These were decided by
**default rather than asked**, so they are recorded here to be challenged rather than discovered later.

- Q: Can the designer delete an inquiry in v1? → A: **No.** FR-042 forbids an inquiry inbox, so v1 has
  no delete affordance. FR-045 is reworded: no automatic expiry in v1; manual deletion arrives with the
  v1.1 inbox.
- Q: What happens to a design whose photos all fail to upload? → A: **It is never created.** A design
  requires at least one successfully processed photo (FR-013a), which removes the zero-photo state
  entirely rather than handling it at render time.
- Q: What is the maximum upload size per photo? → A: **25 MB**, comfortably above a high-resolution
  phone photo and below anything that would stall a mobile upload (FR-012).
- Q: How is "meaningful content within 3 seconds on a 3G-class connection" measured? → A: **Largest
  Contentful Paint under 3s at a 400 kbps / 400 ms RTT throttle profile** (SC-004).
- Q: Which dimensions are filters and which are sorts? → A: **Filter** by category and collection;
  **sort** by date and title. "Sort by category" had no defined meaning (FR-018, FR-030).

### Session 2026-07-27 (session lifecycle and cross-surface navigation)

Two gaps found by using the built application rather than by analysis. Both concern the designer's
movement in and out of the authenticated surface, which the spec covered on the way in (FR-001) and not
at all on the way out or back.

- Q: How does the designer end her session? → A: **She cannot** — there is no sign-out control anywhere
  in v1, and the spec never asked for one. Sessions refresh indefinitely, so signing in on a borrowed or
  shared device leaves the archive open to whoever opens the browser next. Added as **FR-001a**.
- Q: How does the signed-in designer get from the storefront back to the studio? → A: **By retyping the
  URL.** The studio links out to the storefront ("View storefront") and nothing points back. Added as
  **FR-002a**, deliberately narrow.
- Q: Does an owner-only affordance on a public page violate Principle I? → A: **No, provided it is
  additive and invisible to visitors.** Principle I forbids requiring a visitor to identify themselves
  before browsing; it does not forbid showing something extra to someone already authenticated. The line
  FR-002a draws is that an unauthenticated response must be unchanged — so the guarantee stays testable
  by simply making the request without a session, which is exactly what the existing gates already do.
- Q: Should visitors get a breadcrumb trail through the storefront? → A: **Not now.** Considered and
  declined to keep this change to the one problem observed. The detail page's "All designs" link is the
  only wayfinding v1 offers, and no one has reported it as insufficient.

### Session 2026-07-27 (email notifications deferred)

- Q: Can SC-006 — an email notification within 5 minutes — be deferred, given the designer sees every
  inquiry in the dashboard banner when she signs in? → A: **Yes, deferred to v1.1**, with the trade
  stated rather than glossed. SC-006 already names the banner as the guarantee during a provider
  outage; this extends that from "the provider is down" to "no provider is configured yet". Nothing in
  the code changes — `RESEND_API_KEY` simply stays unset, every send fails, and FR-040b's banner
  carries the load, which is the path the system was built to survive.
- Q: What does that actually cost? → A: **Response latency becomes a function of how often the
  designer signs in, not of minutes.** A visitor who writes on Friday waits until she next opens the
  studio. For a one-person portfolio at launch scale this is a judgement call about her habits rather
  than a technical risk, and it is reversible in the time it takes to set two environment variables —
  the delivery path is built, tested and unchanged.
- Q: What had to be true before accepting it? → A: **That the banner works in production**, not just
  in tests. Verified 2026-07-27 by submitting a real inquiry to the deployed site: the visitor received
  a normal confirmation, the record persisted with `delivery_state = 'undelivered'` and the correct
  `design_title_snapshot`, so it reaches the banner immediately rather than waiting on the sweep. This
  mattered because the banner stops being a *fallback* under this decision and becomes the **only**
  channel — and because the same day proved that local and production can diverge in ways no local
  test can see (see T095).
- Q: Does anything become unverifiable? → A: **SC-006 alone.** SC-007 (every inquiry recorded) and
  SC-015 (the designer learns of it despite a failed send) are now verified against production rather
  than only locally, which is stronger evidence than they had before this decision.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Designer builds her design archive (Priority: P1)

The designer signs in on her phone, photographs a finished piece from several angles, and saves it as a
record with a title, category, collection, and private notes. She returns later from a laptop and finds
the same archive waiting, where she can edit details, add photos, or delete a record. She can narrow a
growing grid by category, collection, or date to find a specific piece.

**Why this priority**: Nothing else in the product exists without content. On its own this is already a
useful private catalogue — a searchable replacement for a camera roll full of unlabelled photos — and it
is the only story that must be built before any other can be demonstrated.

**Independent Test**: Sign in as the designer on a phone, upload a design with three photos and full
metadata, sign in on a second device, and confirm the design and all its photos appear with metadata
intact. Edit a field and delete a second design to confirm both operations persist across devices.

**Acceptance Scenarios**:

1. **Given** the designer is signed in with an empty archive, **When** she opens the dashboard, **Then**
   she sees an onboarding prompt guiding her to upload her first design rather than a blank screen.
2. **Given** the designer is on the new-design screen, **When** she selects three photos from her camera
   or photo library and saves with a title, **Then** progress is shown during upload and the design
   appears in her grid with all three photos.
3. **Given** the designer uploads a HEIC photo, **When** the upload completes, **Then** the photo is
   viewable in the app in a widely supported format without her taking any conversion step.
4. **Given** the designer has designs in several categories and collections, **When** she filters by a
   category and sorts by date, **Then** only matching designs are shown in the requested order.
5. **Given** the designer saved a design on her phone, **When** she signs in on a different device,
   **Then** the same design, photos, and metadata are present.
6. **Given** the designer opens an existing design, **When** she edits the title, category, collection,
   notes, or public description and saves, **Then** the change persists and is visible on reload.
7. **Given** the designer deletes a design and confirms, **Then** it is removed from her grid and from
   any public surface it appeared on.
8. **Given** the designer is viewing her dashboard on a phone, **Then** the grid renders two columns;
   on a desktop-width screen it renders four or more columns.
9. **Given** the designer adds photos to a design, **When** she writes alt text for one and leaves
   another blank, **Then** the first photo carries her wording and the second carries the design title
   with its position (for example, "Midnight Gown, photo 2 of 3").

---

### User Story 2 - Visitors browse the public storefront (Priority: P2)

Anyone with the site URL arrives at a homepage introducing the designer — a short bio and optional
profile photo — above a browsable grid of her published work. No sign-up, no login, no interstitial.
Visitors filter by category or collection, tap into a piece to see every photo and its public
description, and see nothing anywhere that lets them buy, comment, or edit. Work the designer has not
finished stays invisible until she decides otherwise.

**Why this priority**: This is the purpose of the product — the storefront that has nothing to sell. It
carries the publish/draft gate, which is what makes the designer willing to upload unfinished work in
the first place, so the two ship together.

**Independent Test**: With a seeded archive containing both published and draft designs, open the site
URL in a private browser window with no session. Confirm the published designs are browsable and
filterable, the draft designs are absent from the grid and unreachable by their direct URL, and no
private note text appears anywhere in the page.

**Acceptance Scenarios**:

1. **Given** a visitor with no account and no session, **When** they open the site URL, **Then** the
   homepage loads with the designer's bio and a grid of published designs, with no login prompt.
2. **Given** a design is toggled to published, **When** a visitor reloads the storefront, **Then** that
   design appears in the public grid.
3. **Given** a design is in draft, **When** a visitor loads the storefront or requests that design's
   direct URL, **Then** the design does not appear in the grid and the direct URL does not reveal it.
4. **Given** a design has private notes and a public description, **When** a visitor opens its detail
   page, **Then** the public description is shown and the private notes appear nowhere in the page,
   including in link previews and page metadata.
5. **Given** a visitor is on the storefront, **When** they filter by category or collection, **Then**
   only matching published designs are shown.
6. **Given** a visitor is anywhere on the public site, **Then** no buy, cart, checkout, comment,
   favorite, upload, edit, or delete control is present.
7. **Given** the designer has published nothing yet, **When** a visitor opens the storefront, **Then**
   they see a friendly "new designs coming soon" message rather than an empty page.
8. **Given** a visitor on a slow mobile connection, **When** the grid loads, **Then** each image slot
   shows a lightweight placeholder that is replaced by the image without the layout shifting.
9. **Given** a published design is switched back to draft, **When** a visitor reloads its detail page,
   **Then** the design is no longer reachable.
10. **Given** a published design's public link has been shared, **When** the designer later renames the
    design, **Then** the shared link still resolves to that design.
11. **Given** a visitor knows one design's public URL, **When** they alter it to guess at neighbouring
    identifiers, **Then** no unpublished design is revealed and the responses do not distinguish a
    draft from one that does not exist.
12. **Given** a visitor saved the image URL of a published design, **When** the designer moves that
    design to draft or deletes it, **Then** the saved image URL no longer returns the image.
13. **Given** a category or collection is used only by draft designs, **When** a visitor opens the
    public filter controls, **Then** that category or collection is not offered.

---

### User Story 3 - Visitors inquire about a piece (Priority: P3)

A visitor sees a piece they want to ask about and taps "Inquire". They give their name, email, and an
optional message, and submit — no account, no login. The designer receives the inquiry by email at her
own address, and the message makes clear which design it concerns.

**Why this priority**: This is the only outcome the storefront can produce for the designer, but it is
worthless without published work to inquire about, so it follows the storefront. It is a small, cleanly
separable slice.

**Independent Test**: With one published design, open its page with no session, submit the inquiry form,
and confirm the designer receives a notification identifying the visitor and the specific design. Submit
with a malformed email and confirm the form rejects it before submission.

**Acceptance Scenarios**:

1. **Given** a visitor on a published design's page, **When** they tap "Inquire", **Then** a form opens
   asking for name, email, and an optional message, with no account required.
2. **Given** a visitor completes the form with a valid email, **When** they submit, **Then** they see a
   confirmation that the inquiry was sent.
3. **Given** an inquiry is submitted, **Then** the designer is notified at the email address on her
   account, and the notification identifies the visitor's name, email, message, and which design the
   inquiry is about.
4. **Given** a visitor submits an inquiry, **Then** the inquiry is recorded in the system regardless of
   whether the notification is successfully delivered.
5. **Given** email delivery is failing, **When** a visitor submits an inquiry and retries are
   exhausted, **Then** the visitor still sees a normal confirmation, and the designer sees a dashboard
   banner on her next visit showing the visitor's name, email, message, and the design concerned.
6. **Given** a visitor enters a malformed email address, **When** they attempt to submit, **Then** the
   form explains the problem and does not submit.
7. **Given** an inquiry has been submitted, **Then** the visitor gains no account, session, or ability
   to act further on the site.
8. **Given** a script submits the inquiry form more than 5 times in an hour from the same sender,
   **Then** further submissions are rejected with an explanation, while a visitor inquiring about
   several designs in one session is unaffected.

---

### Edge Cases

- **Draft URL guessing**: A visitor requests the direct URL of a design that is in draft, or of a design
  that has been deleted. The response must not distinguish "draft" from "does not exist" — both are
  treated as not found, so absence of a design cannot be inferred.
- **Unpublished after sharing**: A visitor bookmarked or was sent a link to a design that the designer
  later moved back to draft. The link stops working and shows a not-found treatment rather than an error.
- **Upload interrupted**: The designer loses connection or closes the app mid-upload. Partially uploaded
  photos must not leave a broken design record in her grid; she can retry without duplicating the design.
- **Unsupported or oversized file**: The designer selects a file that is not JPEG, PNG, or HEIC, or one
  larger than 25 MB. She is told which formats are accepted and what the size limit is, and the other
  photos in the same upload are unaffected (FR-012).
- **Session expiry mid-edit**: The designer's session expires while a design form is open. She is
  prompted to sign in again and her unsaved entries are not silently discarded without warning.
- **Deleting a design with inquiries**: A design that has received inquiries is deleted. Each inquiry
  survives with the visitor's contact details intact and identifies its subject by the design title
  snapshot captured at submission, presented as referring to a design that no longer exists.
- **Inquiry notification failure**: The email notification cannot be delivered even after retries. The
  inquiry record is still saved, marked undelivered, and raised to the designer as a dashboard banner
  carrying the visitor's details, so the lead survives an email outage rather than vanishing into logs.
- **Inquiry spam**: An automated agent submits the inquiry form repeatedly. It is stopped by the
  honeypot field or by the per-sender rate limit, without any visitor being asked to create an account
  or solve a challenge. A genuine visitor who inquires about several pieces in one session stays well
  inside the limit.
- **Empty filter result**: The designer or a visitor filters to a combination with no matches. They see
  a clear "nothing matches" state with a way back to the full grid, not a blank page.
- **Design with no photos**: Cannot occur. A design is not created until at least one photo has been
  successfully processed (FR-013a), so the zero-photo state is eliminated rather than handled at render
  time. If every photo in an upload fails, the designer is told and no record is left behind.
- **Image URL retained after unpublish**: A visitor saved a design's image URL while it was published,
  then the designer moved the design to draft or deleted it. The image stops being retrievable (FR-009a);
  a stored file is never addressable independently of its design's published state.
- **Very long text**: A very long title, collection name, or public description does not break the grid
  or detail layout at mobile width.

## Requirements *(mandatory)*

### Functional Requirements

#### Authentication and access

- **FR-001**: System MUST require the designer to authenticate before reaching any upload, edit,
  organize, or publish control.
- **FR-001a**: System MUST provide the designer with a way to end her session, reachable from every
  authenticated page, and MUST return her to a public page once it has ended. Ending the session MUST
  invalidate it server-side, not merely clear the interface.

  *Rationale*: FR-001 governs getting in and said nothing about getting out, so v1 shipped with no way
  out at all. Sessions refresh indefinitely, which makes a borrowed laptop or a shared studio machine a
  standing exposure of the entire archive — including every private note — to whoever opens the browser
  next. This is the one authentication gap a designer cannot work around herself.

- **FR-002**: System MUST allow visitors to reach every public surface with a URL alone — no account,
  no session, no interstitial.
- **FR-002a**: System MUST give the signed-in designer a way back to her authenticated surface from
  public pages. That affordance is bound by four constraints, and all four are testable:

  1. It MUST NOT appear for an unauthenticated request.
  2. It MUST NOT prompt for authentication, offer a sign-in control, or otherwise disclose to a visitor
     that an authenticated surface exists.
  3. It MUST NOT change the response an unauthenticated request receives.
  4. It MUST NOT change which data the page reads. Public pages continue to read published, public
     fields only, and MUST still render completely for a request carrying no session.

  *Rationale*: the studio links out to the storefront and nothing links back, so the designer's only
  route home is retyping a URL. Principle I forbids making a **visitor** identify themselves before
  browsing; it does not forbid showing something extra to someone who already has. Constraint 3 is what
  keeps that distinction honest and enforceable — the existing draft-invisibility and view-only gates
  already make their assertions with no session, so they measure exactly the surface this must not
  disturb.
- **FR-003**: System MUST verify record ownership on the server for every create, edit, delete, or
  publish action; hiding a control in the interface MUST NOT be the only barrier.
- **FR-004**: System MUST NOT create an account or session for a visitor as a result of any action
  available to them, including inquiry submission.

#### Upload and image handling

- **FR-005**: System MUST allow the designer to add photos from a device camera or photo library.
- **FR-006**: System MUST accept multiple photos per design, so a piece can be shown from several angles.
- **FR-007**: System MUST accept JPEG, PNG, and HEIC, converting HEIC to a widely supported format on
  upload without designer intervention.
- **FR-008**: System MUST display upload progress while photos are transferring.
- **FR-009**: System MUST generate compressed, resized variants for display, and MUST serve those
  variants — not the originals — on the public storefront.
- **FR-009a**: System MUST gate every image request on the parent design's published state at request
  time. A display variant belonging to a design that has been moved to draft or deleted MUST stop being
  retrievable, including by a visitor who recorded the image URL while the design was published. Stored
  image files MUST NOT be publicly addressable independently of this gate.
- **FR-010**: System MUST retain the original uploaded file for the designer's own reference, and MUST
  never expose an original to a visitor under any circumstance.
- **FR-011**: System MUST show a lightweight placeholder (blur or skeleton) in each image slot while
  images load, reserving the final layout space so content does not shift.
- **FR-012**: System MUST reject any upload that is not JPEG, PNG, or HEIC, or that exceeds 25 MB per
  photo, with a message naming the accepted formats and the size limit. A rejected file MUST NOT affect
  the other photos in the same upload.
- **FR-012a**: System MUST offer the designer an optional alt-text field for each photo at upload and
  edit time.
- **FR-012b**: System MUST render alt text for every displayed photo, falling back to the design title
  and the photo's position within the design (for example, "Midnight Gown, photo 2 of 3") whenever the
  designer has left the field blank. No photo may render without alt text.
- **FR-012c**: System MUST meet WCAG 2.1 Level AA for the public storefront and the designer dashboard,
  covering at minimum keyboard operability of every interactive control, visible focus indication, and
  text contrast.

#### Design records and organization

- **FR-013**: System MUST let the designer record, for each design: title, one or more photos, category,
  collection/season, private notes, and an optional public description.
- **FR-013a**: System MUST require at least one successfully processed photo before a design record
  exists. A design whose photos all fail to upload MUST NOT be created, so no design can render as a
  broken image on any surface.
- **FR-014**: System MUST set the creation date automatically on upload, and MUST update the
  last-updated time on every subsequent modification of the record.
- **FR-015**: System MUST offer categories as a selectable list that the designer can extend.
- **FR-016**: System MUST accept collection/season as free text (for example, "Spring 2027").
- **FR-017**: System MUST display the designer's designs in a grid — two columns at mobile width, four
  or more at desktop width.
- **FR-018**: Designer MUST be able to **filter** her designs by category and by collection, and to
  **sort** them by date (newest or oldest first) and by title (A–Z). Filters and sorts are independent
  dimensions and MUST be combinable.
- **FR-019**: Designer MUST be able to edit or delete any of her design records. Deleting a design MUST
  also delete its stored image files, both originals and display variants.
- **FR-020**: System MUST persist all designs, photos, inquiries, and profile data server-side, such
  that signing in from any device surfaces the same archive.

#### Publish control and data separation

- **FR-021**: System MUST give each design a published/draft state, defaulting to draft on creation.
- **FR-022**: System MUST show only published designs on every public surface.
- **FR-023**: System MUST make draft designs unreachable to visitors by any means, including direct URL
  or identifier guessing, and MUST NOT distinguish a draft from a non-existent design in its response.
  "Unreachable" includes the design's stored image files (FR-009a) and every derived surface — no
  attribute of an unpublished design may be retrieved through any route, view, table, or storage path.
- **FR-023a**: System MUST address each design publicly by a slug derived from its title plus a random
  suffix (for example, `midnight-gown-7f3a`), such that the identifier space cannot be enumerated and
  the existence of unpublished work cannot be discovered by probing predictable URLs.
- **FR-023b**: System MUST keep a design's slug stable once assigned, including when the designer later
  renames the design, so that previously shared links continue to resolve.
- **FR-024**: System MUST treat private notes as designer-only and MUST NOT expose them in any public
  page, response, page metadata, or link preview. No per-design setting may override this.
- **FR-025**: System MUST use the public description as the only free-text field visible to visitors.
- **FR-025a**: System MUST expose public data through explicit, published-gated projections that name
  their columns, rather than by retrieving whole records and removing fields afterward. This applies to
  every entity reachable from a public surface, not only to designs.
- **FR-026**: Designer MUST be able to change a design between published and draft at any time, with the
  public storefront reflecting the change on the visitor's next load.

#### Public storefront

- **FR-027**: System MUST present the public homepage as the storefront itself — a browsable grid of
  published designs, with no separate per-design link needed for a visitor to start browsing.
- **FR-028**: System MUST show the designer's bio and optional profile photo on the public homepage,
  above or alongside the grid.
- **FR-029**: Designer MUST be able to edit her bio and profile photo from her account settings.
- **FR-030**: Visitors MUST be able to **filter** the public grid by category and by collection, and to
  **sort** it by date (newest or oldest first) and by title (A–Z), in any combination.
- **FR-030a**: Filter options offered to visitors MUST be derived from published designs only. A category
  or collection used exclusively by draft designs MUST NOT appear in any public control.
- **FR-031**: Visitors MUST be able to open a published design and see all of its photos and its public
  description.
- **FR-032**: System MUST NOT present any buy, cart, checkout, comment, favorite, upload, edit, or
  delete affordance to a visitor.
- **FR-033**: System MUST show a friendly "coming soon" message on the public storefront when no designs
  are published, and an onboarding prompt on the designer's dashboard when she has uploaded none.
- **FR-034**: System MUST record a per-design view count in v1 without displaying it in the interface.
- **FR-035**: System MUST store an optional SEO title and description per design, defaulting to the
  design's title and public description, without rendering dedicated SEO output in v1.

#### Inquiries

- **FR-036**: System MUST present an "Inquire" control on every published design's detail page.
- **FR-037**: System MUST collect visitor name, visitor email, and an optional message, and MUST
  validate the email's format before accepting a submission.
- **FR-038**: System MUST record each inquiry against the design it concerns, with an unread/read state
  for later use.
- **FR-039**: System MUST notify the designer by email at the address on her account when an inquiry is
  submitted, identifying the visitor and the specific design.
- **FR-040**: System MUST persist the inquiry record even when the notification fails to send.
- **FR-040a**: System MUST retry a failed notification with backoff before treating it as undelivered.
- **FR-040b**: System MUST mark an inquiry as undelivered once retries are exhausted, and MUST show the
  designer a banner on her dashboard identifying how many inquiries could not be emailed, with each
  visitor's name, email, message, and subject design readable directly from that banner.
- **FR-040c**: System MUST clear the undelivered banner once the designer has acknowledged it, without
  deleting the underlying inquiry record.
- **FR-041**: System MUST limit inquiry submissions per sender to 5 per hour and 20 per day, rejecting
  submissions beyond that with a message explaining the limit.
- **FR-041a**: System MUST include a hidden honeypot field in the inquiry form and MUST silently reject
  any submission where it has been filled in.
- **FR-041b**: System MUST NOT require the visitor to solve a visible challenge or interact with a
  third-party service in order to submit an inquiry.
- **FR-041c**: System MUST enforce the honeypot and rate-limit checks on a path that a client cannot
  bypass. Inquiry records MUST NOT be writable directly by an anonymous client using publicly available
  credentials; the only write path is the server-mediated submission route that performs these checks
  first.
- **FR-042**: System MUST NOT provide an in-app inquiry inbox in v1. The undelivered-inquiry banner in
  FR-040b is an exception surface for failed deliveries only, not a browsable list of all inquiries.
- **FR-043**: System MUST store a snapshot of the design's title on each inquiry at submission time, so
  the inquiry remains meaningful independently of the design record.
- **FR-044**: System MUST preserve inquiry records when their associated design is deleted, retaining
  the visitor's name, email, message, and the design title snapshot.
- **FR-045**: System MUST NOT apply any automatic expiry or scheduled purge to inquiry records in v1.
  Records persist indefinitely; manual deletion is a v1.1 capability that arrives with the inquiry inbox,
  since FR-042 gives v1 no surface on which to offer it.
- **FR-046**: System MUST restrict inquiry records to the designer alone; no inquiry data may be
  reachable from any public surface, including the identity of anyone who has previously inquired.

### Key Entities *(include if feature involves data)*

- **Design**: A single piece of work. Carries a title, a stable public slug (title-derived with a random
  suffix, assigned once at creation), category, collection/season, private notes, an optional public
  description, an ordered set of photos, a published/draft state, a view count, optional SEO title and
  description, an owner reference, and creation/update timestamps. The published state is the sole gate
  on public visibility; private notes and public description are permanently separate fields.
- **Photo**: An image belonging to exactly one design, held as both a retained original and one or more
  compressed display variants. Carries optional designer-authored alt text. Ordering within a design is
  meaningful (front, back, detail) and is used to generate fallback alt text when none is authored.
- **Inquiry**: A visitor's message about one specific design. Carries the visitor's name and email, an
  optional message, an unread/read state, a notification delivery state (pending, delivered, or
  undelivered-after-retries) with an acknowledged flag, a reference to the design, a snapshot of the
  design's title taken at submission, and a creation time. Outlives the design it references — if the design is deleted
  the inquiry remains, identified by the title snapshot. Submitted by an unauthenticated visitor but
  written only by the server after the honeypot and rate-limit checks (FR-041c); readable
  only by the designer, and never surfaced publicly.
- **Designer (User)**: The single owner account. Carries an email (which is also where inquiry
  notifications are sent), a name, a public bio, and an optional profile photo. Owns every design.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The designer can photograph a piece, add its details, and publish it from her phone in
  under 3 minutes, in a single sitting, without assistance.
- **SC-002**: 100% of draft designs are unreachable from every public surface — page, direct URL, filter
  control, and stored image URL — verified by automated check before each release.
- **SC-003**: Private notes appear in zero public responses or pages, verified by automated check before
  each release.
- **SC-004**: The storefront reaches Largest Contentful Paint in under 3 seconds at a 400 kbps downlink
  / 400 ms round-trip throttle profile, measured on the grid page with a cold cache.
- **SC-005**: A visitor can go from the homepage to a specific design's full detail in two taps or fewer.
- **SC-006** *(DEFERRED to v1.1 — see Clarifications, Session 2026-07-27)*: When the email provider is
  available, the designer receives an inquiry notification within 5 minutes of submission, identifying
  the correct design in 100% of cases. During a provider outage this budget does not apply and
  FR-040b's dashboard banner is the guarantee instead. **No provider is configured at launch**, so the
  banner is the only channel; response latency depends on how often the designer signs in. The delivery
  code is built and tested — setting `RESEND_API_KEY` and `INQUIRY_FROM_EMAIL` reactivates this
  criterion with no code change.
- **SC-007**: 100% of submitted inquiries are recorded, including those whose notification failed to send.
- **SC-008**: The designer's full archive is identical across two different devices immediately after
  signing in on the second.
- **SC-009**: At the launch scale of 50 designs averaging 3 photos each, the storefront grid meets the
  SC-004 Largest Contentful Paint budget, and applying a filter or sort returns an updated grid within
  1 second at the same throttle profile.
- **SC-010**: Zero purchase, cart, checkout, comment, or edit affordances are reachable by a visitor,
  verified by review of every public surface before release.
- **SC-011**: No public grid or detail page renders a blank screen in any empty or no-match state.
- **SC-012**: Image loading causes no visible layout shift on the public grid.
- **SC-013**: 100% of displayed photos carry non-empty alt text, and the public storefront and designer
  dashboard pass an automated WCAG 2.1 AA check with zero violations before each release.
- **SC-014**: A visitor using only a keyboard can reach the storefront grid, open a design, and submit
  an inquiry without encountering an unreachable or unlabelled control.
- **SC-015**: When email delivery is unavailable, 100% of submitted inquiries reach the designer's
  attention through the dashboard banner, with zero inquiries discoverable only in server logs.
- **SC-016**: Automated inquiry submissions exceeding the FR-041 limits are rejected, while a genuine
  visitor inquiring about several designs in one session is never blocked. A submission attempted
  directly against the data layer with publicly available credentials, bypassing the submission route,
  is rejected outright (FR-041c).
- **SC-017**: A display-variant image URL captured while a design was published returns not-found once
  that design is moved to draft or deleted, verified by automated check before each release (FR-009a).
- **SC-018**: The designer completes the photograph → details → publish flow on a phone in under
  3 minutes (SC-001), and reaching a design's detail from the homepage takes two taps or fewer (SC-005);
  both are timed during the pre-release mobile pass rather than assumed.

## Assumptions

These were decided here because the source spec or the constitution resolves them, or because a
conventional default exists. They are recorded so they can be challenged rather than rediscovered.

- **Single owner account**: The product serves one designer. The ownership reference on each design is
  retained for data integrity and server-side authorization, not as a basis for multi-tenant sign-up.
  Multi-user team editing is out of scope per the source spec §6 and the constitution's Principle V.
- **Authentication method**: Email and password, listed first in the source spec §2.9. Magic-link sign-in
  is an acceptable substitute at plan time; it is not an additional requirement.
- **Drag-to-reorder is out of v1**: The source spec §2.2 marks it a stretch goal and explicitly
  non-blocking. Photo order within a design is still meaningful and is set at upload time.
- **View count and SEO fields are stored, not shown**: The source spec §5 places both in v1.1 for
  display while §4 places the fields in the v1 data model. v1 therefore captures the data and renders no
  interface for it.
- **Starter categories**: The category list begins with a small set such as Dress, Outerwear, and
  Accessory, and the designer can extend it. The source spec calls the list editable but does not fix it.
- **Draft and deleted are indistinguishable publicly**: Both produce a not-found treatment, so the
  existence of unpublished work cannot be inferred from responses.
- **Abuse protection thresholds**: The 5-per-hour and 20-per-day limits in FR-041 are set well above
  genuine visitor behaviour and can be tightened without changing the design. Sender identification for
  rate-limiting purposes is a plan-level concern.
- **Notification address**: Inquiries go to the email on the designer's own user record; no dedicated
  app-managed mailbox is provisioned, per the source spec §7.
- **Branding is default styling**: No logo system, custom colour system, or theming layer in v1, per the
  source spec §7 and the constitution's Principle V.
- **Scale**: Under 50 designs at launch, so no caching layer, pagination machinery, or background job
  infrastructure is assumed to be necessary.

## Out of Scope

Carried forward from the source spec §6 and binding under the constitution's Principle V. Re-opening any
of these requires an explicit decision, not an implementation choice.

- Multi-user team editing
- Comments or feedback threads
- Status workflow (sketch → sample → final)
- Search
- Offline mode or sync
- Version history per design
- Buying, cart, checkout, or payment of any kind
- In-app inquiry inbox, surfaced view counts, social sharing, and rendered SEO tags — all deferred to
  v1.1 as fast-follow work. The undelivered-inquiry banner (FR-040b) is not an inbox: it surfaces only
  the inquiries whose email failed, and disappears once acknowledged.
- Automatic expiry or scheduled purging of inquiry data (FR-045) — retention is manual in v1
