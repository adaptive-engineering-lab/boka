import Link from 'next/link';

/**
 * T057 — the two public empty states (FR-033).
 *
 * The constitution is explicit that no primary surface renders blank, and that an empty
 * storefront shows a friendly "coming soon". The reason is not politeness: a blank page is
 * indistinguishable from a broken one, and a visitor who thinks the site is broken does not
 * come back to check.
 *
 * These two states must read differently. "Nothing published yet" and "your filter matched
 * nothing" are the same absence to the code and completely different situations to the
 * person reading them — and conflating them would tell a visitor the shop is empty when it
 * is only the Dresses shelf that is.
 */
export function ComingSoon() {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 px-6 py-16 text-center">
      <h2 className="text-lg font-medium">New designs coming soon</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">
        There is nothing here just yet. Do come back — this is where the work will be.
      </p>
    </div>
  );
}

/**
 * Filter matched nothing.
 *
 * The route back is the important part. Without it the visitor is left on an empty page
 * holding a filter they may not remember choosing, and the only obvious move is to leave.
 */
export function NoMatches({ clearHref = '/' }: { clearHref?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 px-6 py-16 text-center">
      <h2 className="text-lg font-medium">Nothing matches that combination</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">
        There is other work here — just not under these filters.
      </p>
      <Link
        href={clearHref}
        className="mt-6 inline-block rounded border border-gray-300 px-5 py-2.5 text-sm hover:bg-gray-50"
      >
        See everything
      </Link>
    </div>
  );
}
