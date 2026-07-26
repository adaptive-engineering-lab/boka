import { afterAll, describe, expect, it } from 'vitest';

import { adminClient, deleteDesign, hasLocalStack, insertDesign, warnIfSkipped } from './helpers/db';

/**
 * T047 — the slug is generated once and survives a rename (FR-023a, FR-023b).
 *
 * Two separate promises live in one trigger, and both are quiet when broken:
 *
 *   1. The slug is **non-enumerable**. A bare title slug or a sequential id would let a
 *      visitor probe for unpublished work by guessing neighbouring URLs, which is the
 *      thing FR-023 exists to prevent. The random suffix is what stops that, and nothing
 *      in the application would notice if it disappeared.
 *   2. The slug is **frozen after insert**. If a rename regenerated it, every link the
 *      designer had already shared would start returning the same 404 as a design that
 *      never existed — and she would have no way to tell that had happened.
 *
 * Both are enforced by a `BEFORE INSERT` trigger, so they are invisible in application
 * code. This is the only place they get checked.
 */

const created: string[] = [];

describe.skipIf(!hasLocalStack)('slug generation', () => {
  warnIfSkipped('slug');

  afterAll(async () => {
    if (!hasLocalStack) return;
    const supabase = adminClient();
    for (const id of created) await deleteDesign(supabase, id);
  });

  it('derives the slug from the title and appends a random suffix', async () => {
    const supabase = adminClient();
    const design = await insertDesign(supabase, { title: 'Midnight Silk Gown' });
    created.push(design.id);

    expect(design.slug).toMatch(/^midnight-silk-gown-[a-z2-9]{4}$/);
  });

  it('gives two designs with the same title different slugs', async () => {
    const supabase = adminClient();

    const first = await insertDesign(supabase, { title: 'Wool Coat' });
    const second = await insertDesign(supabase, { title: 'Wool Coat' });
    created.push(first.id, second.id);

    expect(first.slug).not.toBe(second.slug);
    expect(first.slug.startsWith('wool-coat-')).toBe(true);
    expect(second.slug.startsWith('wool-coat-')).toBe(true);
  });

  it('leaves the slug alone when the title changes', async () => {
    const supabase = adminClient();

    const design = await insertDesign(supabase, { title: 'Original Name' });
    created.push(design.id);

    const { data: renamed, error } = await supabase
      .from('design')
      .update({ title: 'A Completely Different Name' })
      .eq('id', design.id)
      .select('slug, title')
      .single();

    expect(error).toBeNull();
    expect(renamed?.title).toBe('A Completely Different Name');
    // The whole point. A regenerated slug here breaks every shared link silently.
    expect(renamed?.slug).toBe(design.slug);
  });

  it('produces a usable slug from a title made only of punctuation', async () => {
    const supabase = adminClient();
    const design = await insertDesign(supabase, { title: '!!! ???' });
    created.push(design.id);

    // Falls back to the `design` stem rather than producing a bare suffix or an empty
    // slug, which would collide across every such title.
    expect(design.slug).toMatch(/^design-[a-z2-9]{4}$/);
  });
});
