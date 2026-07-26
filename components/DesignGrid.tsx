import Image from 'next/image';
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
 *   3. `placeholder="blur"` with a stored LQIP means the first paint already has
 *      something in the box, with no extra request.
 *
 * `src` always points at the /img route, never at storage — that is what keeps image
 * access revocable when a design is unpublished (FR-009a).
 */
export function DesignGridTile({
  photo,
  sizes = '(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, 50vw',
  priority = false,
  unoptimized = false,
}: {
  photo: GridPhoto | null;
  sizes?: string;
  priority?: boolean;
  /**
   * Required for the studio's `/studio/img` source, not an optimisation choice.
   *
   * Next's image optimiser fetches `src` server-side, without the visitor's cookies. That
   * is fine for the public `/img` route, which is deliberately unauthenticated — but the
   * studio route requires a session, so an optimised fetch would arrive anonymous and 404.
   * Unoptimised means the browser requests it directly, with cookies, and the blur
   * placeholder and reserved dimensions still work.
   */
  unoptimized?: boolean;
}) {
  if (!photo) {
    // FR-013a makes a photoless design impossible, so this is defence in depth rather
    // than an expected state. It must still never render a broken image.
    return <div className="aspect-square w-full rounded bg-gray-100" aria-hidden="true" />;
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded bg-gray-100">
      <Image
        src={photo.src}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        sizes={sizes}
        placeholder="blur"
        blurDataURL={photo.blurDataURL}
        priority={priority}
        unoptimized={unoptimized}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
