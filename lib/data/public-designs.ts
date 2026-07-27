import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { resolveAltText } from '@/lib/images/alt-text';

/**
 * The ONLY path from a visitor's request to design data (T025).
 *
 * Every function here reads a `public_*` view. **No function in this file may query a
 * base table** — not `design`, not `photo`, not `category`, not `designer`. That rule is
 * what makes Principle II reviewable by reading one file instead of auditing every
 * query in the app, and it is why public routes import from here and nowhere else.
 *
 * The views are published-gated and column-restricted, so:
 *   - a draft design produces zero rows, identically to one that does not exist (FR-023);
 *   - `notes`, `owner_id`, and `original_path` are not present to be leaked (FR-024, FR-010).
 *
 * If something you need is missing from a view, widen the view deliberately in a
 * migration. Do not reach past it.
 */

export type PublicSort = 'newest' | 'oldest' | 'title';

export interface PublicDesignFilters {
  category?: string;
  collection?: string;
  sort?: PublicSort;
}

export interface PublicPhoto {
  id: string;
  position: number;
  /** Route-relative image URL. Never a storage URL — see FR-009a. */
  src: string;
  blurDataURL: string;
  width: number;
  height: number;
  alt: string;
}

export interface PublicDesignSummary {
  slug: string;
  title: string;
  collection: string | null;
  categoryName: string | null;
  coverPhoto: PublicPhoto | null;
}

export interface PublicDesignDetail extends PublicDesignSummary {
  publicDescription: string | null;
  createdAt: string;
  photos: PublicPhoto[];
}

export interface PublicFilterOptions {
  categories: string[];
  collections: string[];
}

/**
 * Builds the route-relative image URL. Deliberately not a storage URL: images are
 * served through /img so publication can be re-checked on every request (FR-009a).
 */
function imageUrl(photoId: string, width: number): string {
  return `/img/${photoId}/${width}`;
}

const GRID_WIDTH = 640;
const DETAIL_WIDTH = 1280;

interface RawPhoto {
  id: string;
  design_id: string;
  position: number;
  blur_placeholder: string;
  alt_text: string | null;
  width: number;
  height: number;
}

function toPublicPhoto(
  raw: RawPhoto,
  designTitle: string,
  totalPhotos: number,
  renderWidth: number,
): PublicPhoto {
  return {
    id: raw.id,
    position: raw.position,
    src: imageUrl(raw.id, renderWidth),
    blurDataURL: raw.blur_placeholder,
    width: raw.width,
    height: raw.height,
    alt: resolveAltText({
      altText: raw.alt_text,
      designTitle,
      position: raw.position,
      totalPhotos,
    }),
  };
}

/**
 * Storefront grid (FR-027, FR-030). Filters and sorts are independent and combinable.
 */
export async function listPublishedDesigns(
  filters: PublicDesignFilters = {},
): Promise<PublicDesignSummary[]> {
  const supabase = await createClient();

  // Category filter arrives as a name; public_categories is the published-gated
  // lookup, so a draft-only category resolves to nothing rather than filtering by it.
  let categoryId: string | null = null;
  if (filters.category) {
    const { data } = await supabase
      .from('public_categories')
      .select('id')
      .eq('name', filters.category)
      .maybeSingle();
    if (!data) return [];
    categoryId = data.id;
  }

  let query = supabase
    .from('public_designs')
    .select('id, slug, title, collection, category_id, created_at');

  if (categoryId) query = query.eq('category_id', categoryId);
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
  if (error || !designs || designs.length === 0) return [];

  const [photosByDesign, categoryNames] = await Promise.all([
    fetchPhotos(designs.map((d) => d.id)),
    fetchCategoryNames(),
  ]);

  return designs.map((d) => {
    const photos = photosByDesign.get(d.id) ?? [];
    const cover = photos[0];
    return {
      slug: d.slug,
      title: d.title,
      collection: d.collection,
      categoryName: d.category_id ? (categoryNames.get(d.category_id) ?? null) : null,
      coverPhoto: cover ? toPublicPhoto(cover, d.title, photos.length, GRID_WIDTH) : null,
    };
  });
}

/**
 * Design detail (FR-031).
 *
 * Returns null for a draft, a deleted design, and a slug that never existed — all three
 * indistinguishable, because `public_designs` yields zero rows for each (FR-023). The
 * caller renders one not-found response and never has to branch.
 */
export async function getPublishedDesignBySlug(slug: string): Promise<PublicDesignDetail | null> {
  const supabase = await createClient();

  const { data: design } = await supabase
    .from('public_designs')
    .select('id, slug, title, collection, category_id, public_description, created_at')
    .eq('slug', slug)
    .maybeSingle();

  if (!design) return null;

  const [photosByDesign, categoryNames] = await Promise.all([
    fetchPhotos([design.id]),
    fetchCategoryNames(),
  ]);

  const raw = photosByDesign.get(design.id) ?? [];
  const photos = raw.map((p) => toPublicPhoto(p, design.title, raw.length, DETAIL_WIDTH));

  return {
    slug: design.slug,
    title: design.title,
    collection: design.collection,
    categoryName: design.category_id ? (categoryNames.get(design.category_id) ?? null) : null,
    publicDescription: design.public_description,
    createdAt: design.created_at,
    coverPhoto: photos[0] ?? null,
    photos,
  };
}

/**
 * Filter options for the public controls (FR-030a).
 *
 * Sourced from `public_categories` and from published designs only. A category or
 * collection used exclusively by drafts must never appear here — offering it would let a
 * visitor infer that unreleased work exists.
 */
export async function getPublicFilterOptions(): Promise<PublicFilterOptions> {
  const supabase = await createClient();

  const [{ data: categories }, { data: designs }] = await Promise.all([
    supabase.from('public_categories').select('name').order('name'),
    supabase.from('public_designs').select('collection'),
  ]);

  const collections = [
    ...new Set((designs ?? []).map((d) => d.collection).filter((c): c is string => !!c)),
  ].sort();

  return {
    categories: (categories ?? []).map((c) => c.name),
    collections,
  };
}

/** Public bio and profile photo (FR-028). Never includes email. */
export async function getPublicDesignerProfile(): Promise<{
  name: string;
  bio: string | null;
  profilePhotoPath: string | null;
} | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('public_designer_profile')
    .select('name, bio, profile_photo_path')
    .maybeSingle();

  if (!data) return null;
  return { name: data.name, bio: data.bio, profilePhotoPath: data.profile_photo_path };
}

/**
 * The internal id and title of a **published** design, for server-side writes.
 *
 * Exists because the inquiry route needs `design_id` for its foreign key and
 * `design_title_snapshot` for FR-043, and neither may come from the client. It is separate
 * from `getPublishedDesignBySlug` on purpose: `PublicDesignDetail` has no `id` field, so the
 * internal identifier is never serialized into a page, a `<meta>` tag or a hydration payload.
 * Widening that type to avoid this function would put the id on every detail page in exchange
 * for saving one query.
 *
 * Reads `public_designs` like everything else here, so the publication gate is unchanged and
 * still lives in exactly one place: an inquiry about a draft finds nothing, identically to a
 * slug that never existed.
 */
export async function getPublishedDesignRef(
  slug: string,
): Promise<{ id: string; title: string } | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('public_designs')
    .select('id, title')
    .eq('slug', slug)
    .maybeSingle();

  return data ? { id: data.id, title: data.title } : null;
}

/**
 * T059 — record a view (FR-034).
 *
 * The only write an anonymous caller may perform against `design`, and it is deliberately
 * incapable of anything else: `increment_design_view` is `SECURITY DEFINER`, takes a slug,
 * touches one counter on a **published** row, and returns nothing. It cannot be used to
 * modify a design, and — because it returns nothing either way — it cannot be used to probe
 * whether a draft exists.
 *
 * Errors are swallowed on purpose. A failed counter increment must never turn into a failed
 * page render: the count is a v1.1 feature that is merely being *recorded* now (FR-034), and
 * a visitor being shown an error because a statistic did not save would be absurd.
 */
export async function incrementDesignView(slug: string): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.rpc('increment_design_view', { design_slug: slug });
  } catch {
    // Intentionally silent. See above.
  }
}

/**
 * Look up one photo for the /img route (FR-009a).
 *
 * Reads `public_photos`, so a photo belonging to a draft or deleted design returns null
 * and the route answers 404. This is the publication re-check that makes image access
 * revocable.
 */
export async function getPublicPhotoForDelivery(
  photoId: string,
): Promise<{ displayPath: string } | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('public_photos')
    .select('display_path')
    .eq('id', photoId)
    .maybeSingle();

  if (!data) return null;
  return { displayPath: data.display_path };
}

// --- internals ---------------------------------------------------------------

async function fetchPhotos(designIds: string[]): Promise<Map<string, RawPhoto[]>> {
  const grouped = new Map<string, RawPhoto[]>();
  if (designIds.length === 0) return grouped;

  const supabase = await createClient();
  const { data } = await supabase
    .from('public_photos')
    .select('id, design_id, position, blur_placeholder, alt_text, width, height')
    .in('design_id', designIds)
    .order('position', { ascending: true });

  for (const photo of data ?? []) {
    const list = grouped.get(photo.design_id) ?? [];
    list.push(photo);
    grouped.set(photo.design_id, list);
  }
  return grouped;
}

async function fetchCategoryNames(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from('public_categories').select('id, name');
  return new Map((data ?? []).map((c) => [c.id, c.name]));
}
