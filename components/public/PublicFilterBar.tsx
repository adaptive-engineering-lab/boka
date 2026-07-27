import type { PublicFilterOptions } from '@/lib/data/public-designs';

/**
 * T056 — public filter and sort controls (FR-030, FR-030a).
 *
 * ============================================================================
 * **The options handed to this component must come from published designs only.**
 *
 * That is FR-030a, and it is a Principle II requirement wearing filter-control clothing. A
 * category that exists solely on drafts, offered here, tells a visitor that unreleased work
 * exists in it — they can see "Bridal" in the dropdown, select it, and get an empty grid.
 * The absence of designs is the disclosure.
 *
 * The protection is structural rather than something this file remembers to do:
 * `public_categories` joins to published designs, and the collection list is derived from
 * `public_designs`. Both are enforced in the view. This component renders whatever
 * `getPublicFilterOptions()` returns and must never be given a wider source — that is what
 * T063 checks.
 * ============================================================================
 *
 * Filter and sort are separate dimensions and combinable (FR-030) — one merged "Newest /
 * Dresses / A–Z" control would make "dresses, oldest first" unreachable.
 *
 * A plain GET form with no JavaScript. State lives in the URL, so it survives a reload, can
 * be shared, and works before hydration on a slow phone — which is the connection Principle
 * III assumes.
 */
export function PublicFilterBar({
  options,
  active,
}: {
  options: PublicFilterOptions;
  active: { category?: string; collection?: string; sort?: string };
}) {
  // Nothing to filter by: one category and no collections is not a choice, it is noise.
  if (options.categories.length === 0 && options.collections.length === 0) return null;

  const hasFilters = Boolean(active.category || active.collection);

  return (
    <form
      method="get"
      action="/"
      aria-label="Filter and sort designs"
      className="mb-6 flex flex-wrap items-end gap-3"
    >
      {options.categories.length > 0 ? (
        <div className="min-w-[8rem] flex-1">
          <label htmlFor="category" className="block text-xs font-medium text-gray-700">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={active.category ?? ''}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-2 text-sm"
          >
            <option value="">All</option>
            {options.categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {options.collections.length > 0 ? (
        <div className="min-w-[8rem] flex-1">
          <label htmlFor="collection" className="block text-xs font-medium text-gray-700">
            Collection
          </label>
          <select
            id="collection"
            name="collection"
            defaultValue={active.collection ?? ''}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-2 text-sm"
          >
            <option value="">All</option>
            {options.collections.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="min-w-[8rem] flex-1">
        <label htmlFor="sort" className="block text-xs font-medium text-gray-700">
          Sort
        </label>
        <select
          id="sort"
          name="sort"
          defaultValue={active.sort ?? 'newest'}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-2 text-sm"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
        >
          Apply
        </button>
        {hasFilters ? (
          <a href="/" className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
            Clear
          </a>
        ) : null}
      </div>
    </form>
  );
}
