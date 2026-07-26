/**
 * T041 — dashboard filter and sort controls (FR-018).
 *
 * FR-018 asks for filtering **and** sorting as independent dimensions, which is easy to
 * get wrong by building one "Newest / Dresses / A–Z" dropdown. That collapses two
 * questions into one and makes "dresses, oldest first" unreachable. So: two filter selects
 * and one sort select, combinable, each preserving the others.
 *
 * A plain GET form, no JavaScript. The state lives in the URL, which means it survives a
 * reload, can be bookmarked, works before hydration on a slow phone, and needs no client
 * bundle. The submit button is not a fallback — it is the control.
 */
export function FilterBar({
  categories,
  collections,
  active,
  action = '/studio',
}: {
  categories: Array<{ id: string; name: string }>;
  collections: string[];
  active: { category?: string; collection?: string; sort?: string };
  action?: string;
}) {
  const hasFilters = Boolean(active.category || active.collection);

  return (
    <form
      method="get"
      action={action}
      aria-label="Filter and sort designs"
      className="flex flex-wrap items-end gap-3 rounded border border-gray-200 p-3"
    >
      <div className="min-w-[8rem] flex-1">
        <label htmlFor="filter-category" className="block text-xs font-medium text-gray-700">
          Category
        </label>
        <select
          id="filter-category"
          name="category"
          defaultValue={active.category ?? ''}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-2 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-[8rem] flex-1">
        <label htmlFor="filter-collection" className="block text-xs font-medium text-gray-700">
          Collection
        </label>
        <select
          id="filter-collection"
          name="collection"
          defaultValue={active.collection ?? ''}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-2 text-sm"
        >
          <option value="">All collections</option>
          {collections.map((collection) => (
            <option key={collection} value={collection}>
              {collection}
            </option>
          ))}
        </select>
      </div>

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
        <button type="submit" className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800">
          Apply
        </button>
        {hasFilters ? (
          <a
            href={action}
            className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            Clear
          </a>
        ) : null}
      </div>
    </form>
  );
}
