import 'server-only';

import { randomUUID } from 'node:crypto';

import { createClient } from '@/lib/supabase/server';
import { deleteDesignFiles, deleteStoredObjects, profilePhotoPath } from '@/lib/images/storage';
import {
  discardProcessedPhotos,
  processPhotoBatch,
  type PhotoInput,
  type ProcessedPhotoWithSource,
} from '@/lib/images/pipeline';
import { partitionPhotoFiles } from '@/lib/images/validate';

/**
 * T026 — owner-scoped data access.
 *
 * Everything here goes through the session-bound client, so RLS scopes it to
 * `owner_id = auth.uid()` (FR-003). No function needs to remember to filter by owner,
 * and none should try to: if a query returns nothing, the policy is doing its job.
 *
 * Unlike `public-designs.ts`, this module reads base tables — that is correct, because
 * the designer is entitled to her own drafts and private notes. The two modules are kept
 * separate precisely so that "does a public route touch a base table?" is answerable by
 * checking imports.
 */

export type DesignerSort = 'newest' | 'oldest' | 'title';

export interface DesignerFilters {
  category?: string;
  collection?: string;
  sort?: DesignerSort;
}

export interface DesignerCoverPhoto {
  id: string;
  width: number;
  height: number;
  blurPlaceholder: string;
  altText: string | null;
  /** Needed by the alt-text fallback, which reads "photo 1 of 3" (FR-012b). */
  totalPhotos: number;
}

export interface DesignerDesignSummary {
  id: string;
  slug: string;
  title: string;
  collection: string | null;
  categoryId: string | null;
  published: boolean;
  createdAt: string;
  coverPhotoId: string | null;
  cover: DesignerCoverPhoto | null;
}

// `cover` is a grid concern — the detail view has every photo, so a designated cover would
// just be `photos[0]` under another name.
export interface DesignerDesignDetail extends Omit<DesignerDesignSummary, 'cover'> {
  /** PRIVATE. Never pass this to a public surface (FR-024). */
  notes: string | null;
  publicDescription: string | null;
  photos: Array<{
    id: string;
    position: number;
    altText: string | null;
    width: number;
    height: number;
    blurPlaceholder: string;
  }>;
}

/** Dashboard list, drafts included (FR-018). */
export async function listOwnDesigns(
  filters: DesignerFilters = {},
): Promise<DesignerDesignSummary[]> {
  const supabase = await createClient();

  let query = supabase
    .from('design')
    .select('id, slug, title, collection, category_id, published, created_at');

  if (filters.category) query = query.eq('category_id', filters.category);
  if (filters.collection) query = query.eq('collection', filters.collection);

  switch (filters.sort) {
    case 'oldest':
      query = query.order('created_at', { ascending: true });
      break;
    case 'title':
      query = query.order('title', { ascending: true });
      break;
    default:
      query = query.order('created_at', { ascending: false });
  }

  const { data: designs, error } = await query;
  if (error || !designs) return [];

  const { data: photos } = await supabase
    .from('photo')
    .select('id, design_id, position, width, height, blur_placeholder, alt_text')
    .in(
      'design_id',
      designs.map((d) => d.id),
    )
    .order('position', { ascending: true });

  // Dimensions and the blur placeholder travel with the cover, not fetched per tile:
  // they are what reserve the box before the bytes arrive, and a second round trip to
  // get them is a second chance to render a jumping grid (SC-012).
  const coverByDesign = new Map<string, DesignerCoverPhoto>();
  const countByDesign = new Map<string, number>();

  for (const photo of photos ?? []) {
    countByDesign.set(photo.design_id, (countByDesign.get(photo.design_id) ?? 0) + 1);
    if (coverByDesign.has(photo.design_id)) continue;

    coverByDesign.set(photo.design_id, {
      id: photo.id,
      width: photo.width,
      height: photo.height,
      blurPlaceholder: photo.blur_placeholder,
      altText: photo.alt_text,
      totalPhotos: 0,
    });
  }

  for (const [designId, cover] of coverByDesign) {
    cover.totalPhotos = countByDesign.get(designId) ?? 1;
  }

  return designs.map((d) => ({
    id: d.id,
    slug: d.slug,
    title: d.title,
    collection: d.collection,
    categoryId: d.category_id,
    published: d.published,
    createdAt: d.created_at,
    coverPhotoId: coverByDesign.get(d.id)?.id ?? null,
    cover: coverByDesign.get(d.id) ?? null,
  }));
}

/** Single design for the edit form. Returns null when RLS says it is not hers. */
export async function getOwnDesign(id: string): Promise<DesignerDesignDetail | null> {
  const supabase = await createClient();

  const { data: design } = await supabase
    .from('design')
    .select(
      'id, slug, title, collection, category_id, published, created_at, notes, public_description',
    )
    .eq('id', id)
    .maybeSingle();

  if (!design) return null;

  const { data: photos } = await supabase
    .from('photo')
    .select('id, position, alt_text, width, height, blur_placeholder')
    .eq('design_id', id)
    .order('position', { ascending: true });

  return {
    id: design.id,
    slug: design.slug,
    title: design.title,
    collection: design.collection,
    categoryId: design.category_id,
    published: design.published,
    createdAt: design.created_at,
    notes: design.notes,
    publicDescription: design.public_description,
    coverPhotoId: photos?.[0]?.id ?? null,
    photos: (photos ?? []).map((p) => ({
      id: p.id,
      position: p.position,
      altText: p.alt_text,
      width: p.width,
      height: p.height,
      blurPlaceholder: p.blur_placeholder,
    })),
  };
}

/**
 * Publish / unpublish (FR-026).
 *
 * No storage work is needed in either direction. Image access is gated by the /img route
 * re-checking publication per request (FR-009a), not by where the file lives — so a
 * publish toggle can never leave rows and objects disagreeing about visibility.
 */
export async function setPublished(id: string, published: boolean): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.from('design').update({ published }).eq('id', id);
  return !error;
}

/**
 * Delete a design (FR-019).
 *
 * Three things happen, and the third is the one that gets forgotten:
 *   1. `photo` rows cascade via the foreign key;
 *   2. inquiries do NOT — they survive with `design_id` null and their title snapshot
 *      intact, because a real lead must outlive the piece (FR-044);
 *   3. **storage objects must be deleted explicitly.** A row cascade does not touch
 *      object storage, so without this the photographs would sit in the bucket
 *      indefinitely — finding C2.
 *
 * Files are removed after the row, not before: if the row delete fails on a policy the
 * images are still needed.
 */
export async function deleteOwnDesign(
  id: string,
): Promise<{ ok: boolean; filesRemoved: number; warnings: string[] }> {
  const supabase = await createClient();

  const { error } = await supabase.from('design').delete().eq('id', id);
  if (error) return { ok: false, filesRemoved: 0, warnings: [error.message] };

  const { removed, errors } = await deleteDesignFiles(id);
  return { ok: true, filesRemoved: removed, warnings: errors };
}

// ---------------------------------------------------------------------------
// T037 — creating a design
// ---------------------------------------------------------------------------

/** One candidate photo as it arrives from the form. Shaped to satisfy `PhotoCandidate`
 *  so it can go straight through `partitionPhotoFiles` without a mapping step. */
export interface CreateDesignPhoto {
  name: string;
  size: number;
  type: string;
  bytes: Buffer;
  /** Optional designer-authored alt text (FR-012a). */
  altText: string | null;
}

export interface CreateDesignInput {
  /**
   * Supplied by the form, not generated here, and used as the primary key.
   *
   * This is the idempotency key (FR-013a: "a retry must not produce a duplicate design").
   * The form mints one uuid when it loads and re-sends it on every retry, so a submission
   * whose response was lost lands on a primary-key conflict rather than creating a second
   * design. A fresh uuid is minted only after a create is confirmed.
   */
  designId: string;
  title: string;
  categoryId: string | null;
  collection: string | null;
  /** PRIVATE (FR-024). Never reaches a public view. */
  notes: string | null;
  publicDescription: string | null;
  photos: CreateDesignPhoto[];
}

export type CreateDesignResult =
  | {
      ok: true;
      id: string;
      slug: string;
      /** Photos refused by validation or processing. The design was still created from the
       *  ones that worked — FR-012 forbids one bad file from taking the rest with it. */
      rejected: Array<{ filename: string; reason: string }>;
      /** True when this was a retry of a submission that had already succeeded. */
      alreadyExisted: boolean;
    }
  | { ok: false; error: string; rejected: Array<{ filename: string; reason: string }> };

/**
 * Creates a design (FR-013, FR-013a).
 *
 * The ordering is the requirement, not a preference. **Photos are stored before the design
 * row exists**, because the storage path contains the design id — and that is what makes
 * "no zero-photo design" enforceable at creation rather than papered over at render time:
 *
 *   1. validate the files (server-side; the browser's check is a courtesy);
 *   2. process and store whatever survives;
 *   3. **if nothing survived, stop — and leave no record behind** (FR-013a);
 *   4. only then insert the design, with `published` left at its `false` default (FR-021);
 *   5. insert the photo rows.
 *
 * Every failure after step 2 removes the stored objects again. Files written for a design
 * that will never exist are invisible orphans — no row references them, so nothing will
 * ever find them to clean up.
 */
export async function createDesign(input: CreateDesignInput): Promise<CreateDesignResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in and try again.', rejected: [] };

  const title = input.title.trim();
  if (!title) return { ok: false, error: 'A title is required.', rejected: [] };
  if (title.length > 120) {
    return { ok: false, error: 'Titles are limited to 120 characters.', rejected: [] };
  }

  // Idempotency check first, before spending time on image processing. A retry of an
  // already-successful submission should cost nothing and change nothing.
  const existing = await getOwnDesign(input.designId);
  if (existing) {
    return { ok: true, id: existing.id, slug: existing.slug, rejected: [], alreadyExisted: true };
  }

  const { accepted, rejected } = partitionPhotoFiles(input.photos);
  const rejections = rejected.map(({ file, reason }) => ({ filename: file.name, reason }));

  if (accepted.length === 0) {
    return {
      ok: false,
      error: 'A design needs at least one photo, and none of these could be used.',
      rejected: rejections,
    };
  }

  const inputs: PhotoInput[] = accepted.map((p) => ({ bytes: p.bytes, filename: p.name }));
  const { processed, failures } = await processPhotoBatch(input.designId, inputs);
  rejections.push(...failures);

  // FR-013a. Not "create it and show a placeholder" — no record at all.
  if (processed.length === 0) {
    return {
      ok: false,
      error: 'None of the photos could be processed, so the design was not created.',
      rejected: rejections,
    };
  }

  const { data: design, error: insertError } = await supabase
    .from('design')
    .insert({
      id: input.designId,
      owner_id: user.id,
      title,
      category_id: input.categoryId,
      collection: input.collection?.trim() || null,
      notes: input.notes?.trim() || null,
      public_description: input.publicDescription?.trim() || null,
      // `published` and `slug` are deliberately absent. The column default keeps the
      // design a draft (FR-021) and the BEFORE INSERT trigger assigns the slug once
      // (FR-023a) — sending either here would override a guarantee the schema owns.
    })
    .select('id, slug')
    .single();

  if (insertError || !design) {
    // 23505 on the primary key means a concurrent retry won the race. That is a success,
    // not a failure: the design exists. Drop this attempt's files and return the winner.
    if (insertError?.code === '23505') {
      await discardProcessedPhotos(processed);
      const winner = await getOwnDesign(input.designId);
      if (winner) {
        return { ok: true, id: winner.id, slug: winner.slug, rejected: rejections, alreadyExisted: true };
      }
    }

    await discardProcessedPhotos(processed);
    return {
      ok: false,
      error: insertError?.message ?? 'The design could not be saved.',
      rejected: rejections,
    };
  }

  const photoRows = processed.map((photo, position) => ({
    id: photo.photoId,
    design_id: design.id,
    position,
    original_path: photo.originalPath,
    display_path: photo.displayPath,
    blur_placeholder: photo.blurPlaceholder,
    alt_text: accepted[photo.sourceIndex]?.altText?.trim() || null,
    width: photo.width,
    height: photo.height,
  }));

  const { error: photoError } = await supabase.from('photo').insert(photoRows);

  if (photoError) {
    // A design with no photo rows is exactly the state FR-013a forbids, so unwind rather
    // than leave it. Deleting the row first means a storage failure below cannot resurrect
    // a half-built design.
    await supabase.from('design').delete().eq('id', design.id);
    await discardProcessedPhotos(processed);
    return { ok: false, error: photoError.message, rejected: rejections };
  }

  return { ok: true, id: design.id, slug: design.slug, rejected: rejections, alreadyExisted: false };
}

// ---------------------------------------------------------------------------
// T038 — editing
// ---------------------------------------------------------------------------

export interface UpdateDesignInput {
  title: string;
  categoryId: string | null;
  collection: string | null;
  notes: string | null;
  publicDescription: string | null;
}

/**
 * Updates the editable fields of a design.
 *
 * **`slug` is not among them, and must never be** (FR-023b). Renaming a design leaves its
 * public URL alone so links already shared keep resolving. The database trigger only
 * assigns a slug on INSERT, so the protection is structural — but sending `slug` here
 * would override it, which is why the column is absent from this object rather than
 * merely unused.
 */
export async function updateOwnDesign(
  id: string,
  input: UpdateDesignInput,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const title = input.title.trim();
  if (!title) return { ok: false, error: 'A title is required.' };

  const { error } = await supabase
    .from('design')
    .update({
      title,
      category_id: input.categoryId,
      collection: input.collection?.trim() || null,
      notes: input.notes?.trim() || null,
      public_description: input.publicDescription?.trim() || null,
    })
    .eq('id', id);

  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Per-photo alt text (FR-012a). Blank clears it, restoring the render-time fallback. */
export async function updatePhotoAltText(
  designId: string,
  entries: Array<{ photoId: string; altText: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  for (const entry of entries) {
    const { error } = await supabase
      .from('photo')
      .update({ alt_text: entry.altText.trim() || null })
      .eq('id', entry.photoId)
      .eq('design_id', designId);

    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}

/** Adds photos to an existing design, appending after the current last position. */
export async function addPhotosToDesign(
  designId: string,
  photos: CreateDesignPhoto[],
): Promise<{ ok: boolean; added: number; rejected: Array<{ filename: string; reason: string }>; error?: string }> {
  const supabase = await createClient();

  const { accepted, rejected } = partitionPhotoFiles(photos);
  const rejections = rejected.map(({ file, reason }) => ({ filename: file.name, reason }));

  if (accepted.length === 0) return { ok: false, added: 0, rejected: rejections, error: 'No usable photos.' };

  // Confirm ownership before writing anything to storage. RLS would reject the row insert
  // anyway, but only after the files had been uploaded.
  const { data: design } = await supabase.from('design').select('id').eq('id', designId).maybeSingle();
  if (!design) return { ok: false, added: 0, rejected: rejections, error: 'Design not found.' };

  const { data: last } = await supabase
    .from('photo')
    .select('position')
    .eq('design_id', designId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const startPosition = (last?.position ?? -1) + 1;

  const { processed, failures } = await processPhotoBatch(
    designId,
    accepted.map((p) => ({ bytes: p.bytes, filename: p.name })),
  );
  rejections.push(...failures);

  if (processed.length === 0) {
    return { ok: false, added: 0, rejected: rejections, error: 'None of the photos could be processed.' };
  }

  const rows = processed.map((photo: ProcessedPhotoWithSource, index) => ({
    id: photo.photoId,
    design_id: designId,
    position: startPosition + index,
    original_path: photo.originalPath,
    display_path: photo.displayPath,
    blur_placeholder: photo.blurPlaceholder,
    alt_text: accepted[photo.sourceIndex]?.altText?.trim() || null,
    width: photo.width,
    height: photo.height,
  }));

  const { error } = await supabase.from('photo').insert(rows);
  if (error) {
    await discardProcessedPhotos(processed);
    return { ok: false, added: 0, rejected: rejections, error: error.message };
  }

  return { ok: true, added: rows.length, rejected: rejections };
}

/**
 * Removes one photo, files included.
 *
 * Refuses to remove the last one. FR-013a makes a photoless design impossible at creation;
 * allowing it to be reached by deletion instead would just move the hole, and the public
 * grid has no sensible tile to render for a design with nothing to show.
 */
export async function removeOwnPhoto(
  designId: string,
  photoId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: photos } = await supabase
    .from('photo')
    .select('id, original_path, display_path')
    .eq('design_id', designId);

  if (!photos || photos.length === 0) return { ok: false, error: 'Photo not found.' };
  if (photos.length === 1) {
    return { ok: false, error: 'A design must keep at least one photo. Add another before removing this one.' };
  }

  const target = photos.find((p) => p.id === photoId);
  if (!target) return { ok: false, error: 'Photo not found.' };

  const { error } = await supabase.from('photo').delete().eq('id', photoId).eq('design_id', designId);
  if (error) return { ok: false, error: error.message };

  // Row first, files second: if the row delete is refused the image is still needed.
  await deleteStoredObjects([target.original_path], [target.display_path]);
  return { ok: true };
}

/** Distinct collections in use, for the dashboard filter control (FR-018). */
export async function listOwnCollections(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('design').select('collection').not('collection', 'is', null);

  const unique = new Set<string>();
  for (const row of data ?? []) if (row.collection) unique.add(row.collection);
  return [...unique].sort((a, b) => a.localeCompare(b));
}

/**
 * A photo the owner is entitled to see, for the studio's own image route.
 *
 * The public `/img` route reads `public_photos`, which is published-gated — so it returns
 * nothing for a draft, which is exactly right for a visitor and useless for the dashboard.
 * This reads the base table through the session client instead, so RLS answers the
 * ownership question (FR-003).
 */
export async function getOwnPhotoForDelivery(
  photoId: string,
): Promise<{ displayPath: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('photo')
    .select('display_path')
    .eq('id', photoId)
    .maybeSingle();

  return data ? { displayPath: data.display_path } : null;
}

// ---------------------------------------------------------------------------
// T042 — categories
// ---------------------------------------------------------------------------

/** Categories for the dropdown (FR-015). */
export async function listOwnCategories(): Promise<Array<{ id: string; name: string }>> {
  const supabase = await createClient();
  const { data } = await supabase.from('category').select('id, name').order('name');
  return data ?? [];
}

/**
 * Delete a category, refusing while any design still uses it.
 *
 * The FK is `on delete restrict`, so the database refuses too. This check exists to turn
 * that into a message the designer can act on rather than a raw constraint error.
 */
export async function deleteOwnCategory(id: string): Promise<{ ok: boolean; inUse: number }> {
  const supabase = await createClient();

  const { count } = await supabase
    .from('design')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id);

  if ((count ?? 0) > 0) return { ok: false, inUse: count ?? 0 };

  const { error } = await supabase.from('category').delete().eq('id', id);
  return { ok: !error, inUse: 0 };
}

/** Adds a category (FR-015). Duplicate names are refused by the unique constraint. */
export async function createOwnCategory(name: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'A category needs a name.' };
  if (trimmed.length > 50) return { ok: false, error: 'Category names are limited to 50 characters.' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in and try again.' };

  const { error } = await supabase.from('category').insert({ owner_id: user.id, name: trimmed });

  if (error) {
    return {
      ok: false,
      error: error.code === '23505' ? `You already have a category called “${trimmed}”.` : error.message,
    };
  }
  return { ok: true };
}

/**
 * Categories with the number of designs using each.
 *
 * The count is what turns the delete refusal into something actionable — "in use by 3
 * designs" tells the designer how much reassigning stands between her and removing it,
 * where a bare constraint error tells her nothing.
 */
export async function listOwnCategoriesWithUsage(): Promise<
  Array<{ id: string; name: string; designCount: number }>
> {
  const supabase = await createClient();

  const [{ data: categories }, { data: designs }] = await Promise.all([
    supabase.from('category').select('id, name').order('name'),
    supabase.from('design').select('category_id'),
  ]);

  const counts = new Map<string, number>();
  for (const row of designs ?? []) {
    if (row.category_id) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }

  return (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    designCount: counts.get(c.id) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// T043 — profile (FR-029)
// ---------------------------------------------------------------------------

export interface DesignerProfile {
  id: string;
  /** PRIVATE — the inquiry notification destination (FR-039), shown to the owner only and
   *  omitted from `public_designer_profile`. Not editable in v1. */
  email: string;
  name: string;
  bio: string | null;
  profilePhotoPath: string | null;
}

export async function getOwnProfile(): Promise<DesignerProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('designer')
    .select('id, email, name, bio, profile_photo_path')
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    bio: data.bio,
    profilePhotoPath: data.profile_photo_path,
  };
}

export async function updateOwnProfile(input: {
  name: string;
  bio: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'A name is required — it heads the public homepage.' };
  if (name.length > 120) return { ok: false, error: 'Names are limited to 120 characters.' };

  const bio = input.bio?.trim() || null;
  if (bio && bio.length > 2000) {
    return { ok: false, error: 'The bio is limited to 2000 characters.' };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in and try again.' };

  const { error } = await supabase.from('designer').update({ name, bio }).eq('id', user.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Replaces the profile photo (FR-029).
 *
 * Reuses the design pipeline so the avatar gets the same treatment as every other image —
 * HEIC decoded, EXIF orientation corrected, compressed. The stored path is keyed by owner
 * id, so a replacement overwrites in place and no orphan accumulates.
 */
export async function updateOwnProfilePhoto(
  photo: CreateDesignPhoto,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const { accepted, rejected } = partitionPhotoFiles([photo]);
  if (accepted.length === 0) return { ok: false, error: rejected[0]?.reason ?? 'Unsupported image.' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in and try again.' };

  // The pipeline keys storage paths on a design id; the profile photo has no design, so a
  // scratch id carries the upload and the result is copied to the reserved profile path.
  const scratchId = randomUUID();
  const { processed, failures } = await processPhotoBatch(scratchId, [
    { bytes: photo.bytes, filename: photo.name },
  ]);

  const uploaded = processed[0];
  if (!uploaded) {
    return { ok: false, error: failures[0]?.reason ?? 'The photo could not be processed.' };
  }

  const target = profilePhotoPath(user.id);
  const { error: moveError } = await supabase.storage
    .from('display')
    .move(uploaded.displayPath, target);

  // `move` fails when the target already exists, which is the normal case on replacement.
  if (moveError) {
    await supabase.storage.from('display').remove([target]);
    const { error: retryError } = await supabase.storage
      .from('display')
      .move(uploaded.displayPath, target);
    if (retryError) {
      await discardProcessedPhotos(processed);
      return { ok: false, error: retryError.message };
    }
  }

  // The original was retained under the scratch id and is not wanted — the avatar is not
  // an archived work, and FR-010's retention rule is about designs.
  await deleteStoredObjects([uploaded.originalPath], []);

  const { error } = await supabase
    .from('designer')
    .update({ profile_photo_path: target })
    .eq('id', user.id);

  return error ? { ok: false, error: error.message } : { ok: true };
}
