import Link from 'next/link';

import { DesignGrid, DesignGridTile } from '@/components/DesignGrid';
import type { PublicDesignSummary } from '@/lib/data/public-designs';

/**
 * T054 — the storefront grid (FR-011, FR-017, SC-012).
 *
 * ============================================================================
 * Images are rendered **unoptimised**, and that is a Principle II decision rather than a
 * performance one. It deserves the explanation.
 *
 * Next's image optimiser fetches `src` server-side and caches the derived bytes, keyed on
 * the URL. `minimumCacheTTL` sets a floor on that lifetime, not a ceiling.
 *
 * So an optimised tile could keep being served from `/_next/image?url=/img/...` after
 * `/img/...` itself has started answering 404. That is the public-bucket defect again, one
 * layer up: a photograph that outlives the withdrawal of its design. It would also be
 * invisible to T060, which asserts against the `/img` URL — the URL that *does* revoke
 * immediately.
 *
 * Unoptimised means the browser requests `/img/{photo}/{width}` itself, on every load, so
 * publication is re-checked every time and unpublishing takes effect at once. The blur
 * placeholder and the reserved dimensions are unaffected, so SC-012 still holds.
 *
 * **And it now costs nothing.** `/img` used to ignore the width in its path and redirect to
 * the single stored 2048px variant, so skipping the optimiser meant oversized tiles and a
 * live risk to SC-004. That is fixed at the source: the route resizes to the requested width
 * and serves the bytes itself (`lib/images/deliver.ts`, research D11 as amended). The
 * optimiser has nothing left to add here except a cache in front of the gate, which is the
 * one thing it must not do.
 * ============================================================================
 */
export function PublicGrid({ designs }: { designs: PublicDesignSummary[] }) {
  return (
    <DesignGrid>
      {designs.map((design, index) => (
        <li key={design.slug}>
          <Link href={`/d/${design.slug}`} className="group block rounded">
            <DesignGridTile
              photo={design.coverPhoto}
              /*
               * One eager image, not four (T088).
               *
               * `priority` sets `fetchPriority="high"` and disables lazy loading, so four of
               * them at 400 kbps do not arrive four times sooner — they share one pipe and all
               * four arrive late, the LCP candidate included. Marking a single image high
               * priority lets it win the race it is supposed to win. The rest are lazy and the
               * browser schedules them.
               */
              priority={index === 0}
            />
            <div className="mt-2">
              <p className="truncate text-sm font-medium group-hover:underline">{design.title}</p>
              {design.categoryName || design.collection ? (
                <p className="truncate text-xs text-gray-500">
                  {[design.categoryName, design.collection].filter(Boolean).join(' · ')}
                </p>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </DesignGrid>
  );
}
