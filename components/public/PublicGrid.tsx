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
 * the URL. The cache lifetime is taken from the upstream response — and upstream here is a
 * 302 into Supabase Storage, whose signed URLs carry cache headers this project does not
 * control. `minimumCacheTTL` sets a floor, not a ceiling.
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
 * **The cost is real and is not yet paid off.** `/img` currently redirects to the single
 * stored display variant (longest edge 2048px) regardless of the width in the path, so a
 * grid tile downloads a larger file than it needs. That is a live risk to SC-004's 3s LCP
 * budget and is measured in T079. The fix is to store per-width variants at upload or to
 * resize inside `/img` — not to reintroduce a cache in front of the gate.
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
              // The first row is above the fold at every width, and its LCP is what SC-004
              // measures.
              priority={index < 4}
              unoptimized
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
