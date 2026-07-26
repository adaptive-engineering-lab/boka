import Link from 'next/link';

import { DesignGrid, DesignGridTile } from '@/components/DesignGrid';
import { EmptyState, NoMatchesState } from '@/components/studio/EmptyState';
import { FilterBar } from '@/components/studio/FilterBar';
import {
  listOwnCategories,
  listOwnCollections,
  listOwnDesigns,
  type DesignerSort,
} from '@/lib/data/designer-designs';
import { resolveAltText } from '@/lib/images/alt-text';

/**
 * T032 — the dashboard (FR-017, FR-018, FR-021, FR-033).
 *
 * The one thing this screen must never do is let the designer mistake a draft for a
 * published piece, or the reverse. Getting that wrong in either direction is a Principle II
 * problem wearing a UI costume: she publishes something unfinished, or believes a piece is
 * live when the storefront has never shown it.
 *
 * So the distinction is carried three ways, not one:
 *   - a text badge, because colour alone fails WCAG 1.4.1 and fails anyone colour-blind;
 *   - a border treatment, for a glance across the grid;
 *   - the badge text is in the accessible name of the link, so a screen-reader user hears
 *     "Midnight Gown, draft" rather than having to infer it from a decorative element.
 */

// Drafts and publication state change under the designer's hands; a cached dashboard would
// show her yesterday's archive.
export const dynamic = 'force-dynamic';

function parseSort(value: string | undefined): DesignerSort {
  return value === 'oldest' || value === 'title' ? value : 'newest';
}

export default async function StudioDashboard({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; collection?: string; sort?: string }>;
}) {
  const { category, collection, sort } = await searchParams;

  const [designs, categories, collections] = await Promise.all([
    listOwnDesigns({ category, collection, sort: parseSort(sort) }),
    listOwnCategories(),
    listOwnCollections(),
  ]);

  const filtered = Boolean(category || collection);
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <main>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-medium">Your designs</h1>
        <Link
          href="/studio/designs/new"
          className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
        >
          Add a design
        </Link>
      </div>

      {/* The filter bar is hidden only when there is nothing at all to filter — showing
          it above the onboarding prompt would bury the one action that matters. */}
      {designs.length > 0 || filtered ? (
        <div className="mb-6">
          <FilterBar
            categories={categories}
            collections={collections}
            active={{ category, collection, sort }}
          />
        </div>
      ) : null}

      {designs.length === 0 ? (
        filtered ? (
          <NoMatchesState clearHref="/studio" />
        ) : (
          <EmptyState />
        )
      ) : (
        <DesignGrid>
          {designs.map((design, index) => {
            const state = design.published ? 'Published' : 'Draft';

            return (
              <li key={design.id}>
                <Link
                  href={`/studio/designs/${design.id}`}
                  className="group block rounded focus-visible:outline-none"
                >
                  <div
                    className={
                      design.published
                        ? 'rounded ring-1 ring-gray-200'
                        : // Dashed, so the difference survives greyscale and low vision.
                          'rounded ring-1 ring-dashed ring-amber-400'
                    }
                  >
                    <DesignGridTile
                      photo={
                        design.cover
                          ? {
                              // The studio route, not /img: /img is published-gated by
                              // design, so a draft's thumbnail would 404 there.
                              src: `/studio/img/${design.cover.id}/640`,
                              blurDataURL: design.cover.blurPlaceholder,
                              width: design.cover.width,
                              height: design.cover.height,
                              alt: resolveAltText({
                                altText: design.cover.altText,
                                designTitle: design.title,
                                position: 0,
                                totalPhotos: design.cover.totalPhotos,
                              }),
                            }
                          : null
                      }
                      priority={index < 4}
                      unoptimized
                    />
                  </div>

                  <div className="mt-2 space-y-1">
                    <p className="truncate text-sm font-medium group-hover:underline">
                      {design.title}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span
                        className={
                          design.published
                            ? 'rounded bg-green-100 px-1.5 py-0.5 font-medium text-green-900'
                            : 'rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900'
                        }
                      >
                        {state}
                      </span>
                      {design.categoryId ? (
                        <span className="text-gray-500">{categoryNames.get(design.categoryId)}</span>
                      ) : null}
                      {design.collection ? (
                        <span className="text-gray-500">· {design.collection}</span>
                      ) : null}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </DesignGrid>
      )}
    </main>
  );
}
