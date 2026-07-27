import Link from 'next/link';

/**
 * T058 — one 404 for every reason a design is not here (FR-023, SC-002).
 *
 * ============================================================================
 * This component is deliberately **static and slug-blind**.
 *
 * It renders for a draft design, a deleted design, and a slug that never existed, and it
 * must be impossible to tell which. So it takes no props, reads no params, and performs no
 * lookup — there is nothing here that could vary with what was requested.
 *
 * The wording matters too. "This design is not available" hints that a design exists;
 * "no longer available" says one used to. Both leak. The text below commits to nothing about
 * whether anything was ever at this address.
 *
 * Things that would break this, all of which look like improvements:
 *   - showing the requested slug ("we couldn't find midnight-gown-7f3a");
 *   - "did you mean…?" suggestions, which confirm neighbouring slugs exist;
 *   - a different message for a design that used to be published;
 *   - anything async, whose timing would differ between a real row and a miss.
 * ============================================================================
 */
export default function DesignNotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6 sm:py-24">
      <h1 className="text-2xl font-medium">Nothing here</h1>
      <p className="mt-3 text-gray-600">
        There is no design at this address. It may have moved, or the link may be incomplete.
      </p>
      <Link
        href="/"
        className="mt-8 inline-block rounded bg-gray-900 px-5 py-2.5 text-white hover:bg-gray-800"
      >
        See the designs
      </Link>
    </main>
  );
}
