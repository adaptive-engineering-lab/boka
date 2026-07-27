import { afterAll, describe, expect, it } from 'vitest';

import {
  DISPLAY_BUCKET,
  ORIGINALS_BUCKET,
  deleteDesignFiles,
  displayPath,
  originalPath,
} from '@/lib/images/storage';
import { adminClient, deleteDesign, hasLocalStack, insertDesign, warnIfSkipped } from './helpers/db';

/**
 * T049 — deleting a design removes both storage prefixes (FR-019).
 *
 * ============================================================================
 * The bug this catches leaves no trace anywhere else.
 *
 * `photo.design_id` cascades, so deleting a design removes its rows and the application
 * looks entirely correct: the design is gone from the dashboard, gone from the storefront,
 * gone from the database. **A row cascade does not touch object storage.** The photographs
 * stay in the bucket indefinitely, referenced by nothing — and since no row remains, nothing
 * will ever find them to clean up. They are unreachable through the application, but they are
 * still the designer's private work sitting in storage she believes she emptied.
 *
 * There is no user-visible symptom, which is exactly why it needs a test rather than a
 * code-review habit.
 * ============================================================================
 */

const createdDesigns: string[] = [];

/** A minimal byte payload. Content is irrelevant — the buckets check the declared MIME
 *  type, and this test is about deletion, not decoding. */
const BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

describe.skipIf(!hasLocalStack)('storage cleanup on design delete', () => {
  warnIfSkipped('storage-cleanup');

  afterAll(async () => {
    if (!hasLocalStack) return;
    const supabase = adminClient();
    for (const id of createdDesigns) {
      await deleteDesign(supabase, id);
      await deleteDesignFiles(id);
    }
  });

  it('removes every object under both prefixes', async () => {
    const supabase = adminClient();

    const design = await insertDesign(supabase, { title: 'Storage Cleanup Subject' });
    createdDesigns.push(design.id);

    const photoIds = [crypto.randomUUID(), crypto.randomUUID()];

    for (const photoId of photoIds) {
      const original = originalPath(design.id, photoId, 'jpg');
      const display = displayPath(design.id, photoId);

      const { error: originalError } = await supabase.storage
        .from(ORIGINALS_BUCKET)
        .upload(original, BYTES, { contentType: 'image/jpeg', upsert: true });
      expect(originalError).toBeNull();

      const { error: displayError } = await supabase.storage
        .from(DISPLAY_BUCKET)
        .upload(display, BYTES, { contentType: 'image/webp', upsert: true });
      expect(displayError).toBeNull();

      const { error: rowError } = await supabase.from('photo').insert({
        id: photoId,
        design_id: design.id,
        position: photoIds.indexOf(photoId),
        original_path: original,
        display_path: display,
        blur_placeholder: 'data:image/webp;base64,AAAA',
        width: 800,
        height: 1200,
      });
      expect(rowError).toBeNull();
    }

    // Both prefixes populated before the delete.
    const { data: originalsBefore } = await supabase.storage.from(ORIGINALS_BUCKET).list(design.id);
    const { data: displayBefore } = await supabase.storage.from(DISPLAY_BUCKET).list(design.id);
    expect(originalsBefore?.length).toBe(2);
    expect(displayBefore?.length).toBe(2);

    // The row delete — which cascades the photo rows and, on its own, leaves every file
    // in place. That is the defect.
    const { error: deleteError } = await supabase.from('design').delete().eq('id', design.id);
    expect(deleteError).toBeNull();

    const { count: remainingRows } = await supabase
      .from('photo')
      .select('id', { count: 'exact', head: true })
      .eq('design_id', design.id);
    expect(remainingRows ?? 0).toBe(0);

    // The explicit step. Without it the assertions below fail while everything the
    // designer can see looks correct.
    const result = await deleteDesignFiles(design.id);
    expect(result.errors).toEqual([]);
    expect(result.removed).toBe(4);

    const { data: originalsAfter } = await supabase.storage.from(ORIGINALS_BUCKET).list(design.id);
    const { data: displayAfter } = await supabase.storage.from(DISPLAY_BUCKET).list(design.id);

    expect(originalsAfter ?? []).toHaveLength(0);
    expect(displayAfter ?? []).toHaveLength(0);
  });

  it('is safe to call for a design that stored nothing', async () => {
    // The abandon path calls this after a create fails, when there may be no files at all.
    // Reporting an error there would mask the real reason the design was abandoned.
    const result = await deleteDesignFiles(crypto.randomUUID());

    expect(result.errors).toEqual([]);
    expect(result.removed).toBe(0);
  });
});
