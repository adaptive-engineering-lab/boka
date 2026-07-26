import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Storage helpers (T028, FR-009a, FR-010, FR-019).
 *
 * Both buckets are private. Nothing here should ever produce a durable public URL —
 * if you find yourself reaching for `getPublicUrl`, the design has regressed to the
 * defect described in migration 0010.
 */

export const ORIGINALS_BUCKET = 'originals';
export const DISPLAY_BUCKET = 'display';

/** Default 60s. Short on purpose: this is the residual window during which an image
 *  remains reachable after its design is unpublished. */
function signedUrlTtlSeconds(): number {
  const raw = process.env.IMAGE_SIGNED_URL_TTL_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 60;
  // Cap it. A long TTL quietly converts the publication gate into a delay.
  return Math.min(parsed, 300);
}

export function originalPath(designId: string, photoId: string, ext: string): string {
  return `${designId}/${photoId}.${ext.replace(/^\./, '')}`;
}

export function displayPath(designId: string, photoId: string): string {
  return `${designId}/${photoId}.webp`;
}

/**
 * The designer's profile photo (FR-029).
 *
 * Lives in the `display` bucket under a reserved `profile/` prefix, keyed by owner id so a
 * replacement overwrites rather than accumulates. The prefix cannot collide with a design's
 * folder — design folders are named by uuid, and `deleteDesignFiles` lists by that uuid, so
 * deleting a design can never sweep the avatar away with it.
 */
export function profilePhotoPath(ownerId: string): string {
  return `profile/${ownerId}.webp`;
}

/**
 * Signs a display-variant object for delivery.
 *
 * **Callers must have already confirmed the parent design is published.** This function
 * deliberately does not check — it cannot, since it only sees a path. The publication
 * gate lives in the /img route, which consults `public_photos` first (FR-009a). Calling
 * this without that check would reintroduce N1.
 */
export async function signDisplayUrl(path: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin.storage
    .from(DISPLAY_BUCKET)
    .createSignedUrl(path, signedUrlTtlSeconds());

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Removes specific objects from both buckets.
 *
 * Used on the abandon path when a create fails after files were written, and when a single
 * photo is removed from an existing design. Deleting a design as a whole uses
 * `deleteDesignFiles` below, which sweeps the prefix rather than naming each object —
 * that one must not depend on the `photo` rows, since they have already cascaded away.
 */
export async function deleteStoredObjects(
  originalPaths: readonly string[],
  displayPaths: readonly string[],
): Promise<{ removed: number; errors: string[] }> {
  const admin = createAdminClient();
  const errors: string[] = [];
  let removed = 0;

  for (const [bucket, paths] of [
    [ORIGINALS_BUCKET, originalPaths],
    [DISPLAY_BUCKET, displayPaths],
  ] as const) {
    if (paths.length === 0) continue;

    const { error } = await admin.storage.from(bucket).remove([...paths]);
    if (error) {
      errors.push(`${bucket}: ${error.message}`);
      continue;
    }
    removed += paths.length;
  }

  return { removed, errors };
}

/**
 * Deletes every stored file for a design — both buckets (FR-019).
 *
 * The `photo` rows cascade when the design is deleted, but **a row cascade does not
 * touch object storage**. Without this, a deleted design's photographs would sit in the
 * bucket indefinitely: a silent privacy debt, and finding C2.
 *
 * Returns the number of objects removed so callers can log it. Failures are reported
 * rather than thrown: the design row is already gone, and a storage hiccup should not
 * leave the caller believing the delete failed entirely.
 */
export async function deleteDesignFiles(
  designId: string,
): Promise<{ removed: number; errors: string[] }> {
  const admin = createAdminClient();
  const errors: string[] = [];
  let removed = 0;

  for (const bucket of [ORIGINALS_BUCKET, DISPLAY_BUCKET]) {
    const { data: listed, error: listError } = await admin.storage.from(bucket).list(designId);

    if (listError) {
      errors.push(`${bucket}: list failed — ${listError.message}`);
      continue;
    }
    if (!listed || listed.length === 0) continue;

    const paths = listed.map((entry) => `${designId}/${entry.name}`);
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);

    if (removeError) {
      errors.push(`${bucket}: remove failed — ${removeError.message}`);
      continue;
    }
    removed += paths.length;
  }

  return { removed, errors };
}
