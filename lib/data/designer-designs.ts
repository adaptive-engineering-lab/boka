import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { deleteDesignFiles } from '@/lib/images/storage';

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

export interface DesignerDesignSummary {
  id: string;
  slug: string;
  title: string;
  collection: string | null;
  categoryId: string | null;
  published: boolean;
  createdAt: string;
  coverPhotoId: string | null;
}

export interface DesignerDesignDetail extends DesignerDesignSummary {
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
    .select('id, design_id, position')
    .in(
      'design_id',
      designs.map((d) => d.id),
    )
    .order('position', { ascending: true });

  const coverByDesign = new Map<string, string>();
  for (const photo of photos ?? []) {
    if (!coverByDesign.has(photo.design_id)) coverByDesign.set(photo.design_id, photo.id);
  }

  return designs.map((d) => ({
    id: d.id,
    slug: d.slug,
    title: d.title,
    collection: d.collection,
    categoryId: d.category_id,
    published: d.published,
    createdAt: d.created_at,
    coverPhotoId: coverByDesign.get(d.id) ?? null,
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
