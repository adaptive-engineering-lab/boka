import { afterAll, describe, expect, it } from 'vitest';

import { adminClient, deleteDesign, hasLocalStack, insertDesign, warnIfSkipped } from './helpers/db';

/**
 * T048 — `updated_at` advances on update, `created_at` does not (FR-014).
 *
 * This exists because the failure is invisible. A `default now()` on `updated_at` fires on
 * INSERT only, so without the `BEFORE UPDATE` trigger the column holds a perfectly
 * plausible timestamp that simply never changes — the "last updated" the designer reads is
 * silently the creation time, forever. Nothing errors, nothing looks wrong, and the bug is
 * indistinguishable from a design that genuinely has not been touched.
 */

const created: string[] = [];

describe.skipIf(!hasLocalStack)('timestamps', () => {
  warnIfSkipped('timestamps');

  afterAll(async () => {
    if (!hasLocalStack) return;
    const supabase = adminClient();
    for (const id of created) await deleteDesign(supabase, id);
  });

  it('advances updated_at and preserves created_at on a design update', async () => {
    const supabase = adminClient();

    const design = await insertDesign(supabase, { title: 'Touch Trigger Subject' });
    created.push(design.id);

    // Postgres gives `now()` transaction-start semantics, so an update in a separate
    // statement already gets a later timestamp — but a real gap makes the assertion
    // readable when it fails.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const { data: updated, error } = await supabase
      .from('design')
      .update({ title: 'Touch Trigger Subject, revised' })
      .eq('id', design.id)
      .select('created_at, updated_at')
      .single();

    expect(error).toBeNull();
    expect(updated).not.toBeNull();

    expect(new Date(updated!.created_at).getTime()).toBe(new Date(design.created_at).getTime());
    expect(new Date(updated!.updated_at).getTime()).toBeGreaterThan(
      new Date(design.updated_at).getTime(),
    );
  });

  it('applies the same trigger to the designer profile', async () => {
    const supabase = adminClient();

    const { data: before } = await supabase
      .from('designer')
      .select('id, bio, updated_at')
      .limit(1)
      .single();

    expect(before).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 25));

    const { data: after, error } = await supabase
      .from('designer')
      .update({ bio: before!.bio })
      .eq('id', before!.id)
      .select('updated_at')
      .single();

    expect(error).toBeNull();
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(
      new Date(before!.updated_at).getTime(),
    );
  });
});
