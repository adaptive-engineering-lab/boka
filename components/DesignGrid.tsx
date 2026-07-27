import type { ReactNode } from 'react';

/**
 * T029 — the shared responsive grid primitive (FR-017).
 *
 * Mobile-first, per Principle III: two columns at phone width, widening to four and
 * beyond. The designer photographs and browses on a phone, so that is the width the
 * layout is designed at rather than adapted to.
 */
export function DesignGrid({ children }: { children: ReactNode }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">{children}</ul>
  );
}

export interface GridPhoto {
  src: string;
  /** Candidate widths, as a `srcset` value. Optional: the studio grid has one width. */
  srcSet?: string;
  blurDataURL: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * A single image tile.
 *
 * Three details carry the no-layout-shift guarantee (SC-012), and all three are easy to
 * drop by accident:
 *
 *   1. `width`/`height` come from the database and are never optional — they reserve the
 *      box before the bytes arrive.
 *   2. `aspect-square` on the wrapper fixes the tile's height independently of the
 *      image's intrinsic ratio.
 *   3. The stored LQIP is painted as the wrapper's background, so the first paint already
 *      has something in the box with no extra request.
 *
 * `src` always points at the /img route, never at storage — that is what keeps image
 * access revocable when a design is unpublished (FR-009a).
 *
 * ============================================================================
 * **A plain `<img>`, not `next/image`, and that is forced rather than preferred.**
 *
 * Every image here is `unoptimized` — on the public grid because an optimiser cache can
 * outlive the publication check (see `PublicGrid.tsx`), and on the studio grid because the
 * optimiser fetches server-side without cookies and would get a 404. But `unoptimized` also
 * makes `next/image` drop `srcSet` entirely, which meant the `sizes` prop below was **inert**:
 * every device downloaded one fixed width.
 *
 * T079 measured what that cost. Desktop Chrome renders each tile at ~240 CSS px and was being
 * sent 640px — about seven times the pixels it could show — while an iPhone at DPR 3 genuinely
 * needed ~561px. The storefront transferred 8.5 MB across 55 tiles and took three minutes to
 * finish on a 400 kbps connection.
 *
 * The blur placeholder is the only thing lost by dropping `next/image`, and it is recovered as
 * a CSS background on the wrapper. That is arguably better here: it needs no client JavaScript
 * to swap out, because the real image simply paints over it.
 * ============================================================================
 */
export function DesignGridTile({
  photo,
  sizes = '(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, 50vw',
  priority = false,
}: {
  photo: GridPhoto | null;
  /** Only consulted when the photo carries a `srcSet`; without candidates it means nothing. */
  sizes?: string;
  priority?: boolean;
}) {
  if (!photo) {
    // FR-013a makes a photoless design impossible, so this is defence in depth rather
    // than an expected state. It must still never render a broken image.
    return <div className="aspect-square w-full rounded bg-gray-100" aria-hidden="true" />;
  }

  return (
    <div
      className="relative aspect-square w-full overflow-hidden rounded bg-gray-100"
      // The LQIP, painted immediately from the markup. The real photograph paints over it,
      // so there is nothing to swap and no JavaScript involved.
      style={{
        backgroundImage: `url(${photo.blurDataURL})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* See the note above: `unoptimized` strips srcSet from next/image, and srcSet is the
          entire point of this element. */}
      <img
        src={photo.src}
        srcSet={photo.srcSet}
        sizes={photo.srcSet ? sizes : undefined}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        // `priority` means "above the fold": fetch it eagerly and tell the browser it matters.
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        className="relative h-full w-full object-cover"
      />
    </div>
  );
}
