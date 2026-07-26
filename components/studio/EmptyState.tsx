import Link from 'next/link';

/**
 * T033 — the empty archive (FR-033).
 *
 * The constitution is explicit that no primary surface may render blank, and an empty
 * dashboard shows an upload prompt. This is the first thing the designer ever sees in the
 * studio, so it does one job: put the next action in front of her.
 *
 * Deliberately distinct from the "your filter matched nothing" state below — the two look
 * identical from the code's point of view and are completely different problems for the
 * person reading them. One means "start here"; the other means "you have work, just not
 * this work".
 */
export function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center">
      <h2 className="text-lg font-medium">No designs yet</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">
        Add your first piece — a few photos, a title, and whatever notes you want to keep for
        yourself. Nothing is public until you publish it.
      </p>
      <Link
        href="/studio/designs/new"
        className="mt-6 inline-block rounded bg-gray-900 px-5 py-2.5 text-white hover:bg-gray-800"
      >
        Add your first design
      </Link>
    </div>
  );
}

/**
 * The other empty state: she has designs, this filter just does not match any.
 *
 * The route back matters. Without it the designer is left on a blank screen with a filter
 * she may not remember setting, and no obvious way out.
 */
export function NoMatchesState({ clearHref }: { clearHref: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center">
      <h2 className="text-lg font-medium">Nothing matches those filters</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">
        Your archive is not empty — this combination just has no designs in it yet.
      </p>
      <Link
        href={clearHref}
        className="mt-6 inline-block rounded border border-gray-300 px-5 py-2.5 hover:bg-gray-50"
      >
        Clear filters
      </Link>
    </div>
  );
}
