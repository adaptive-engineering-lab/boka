import Link from 'next/link';

/**
 * T084 — the designer's way back to the studio (FR-002a).
 *
 * ============================================================================
 * The only thing on a public page that depends on who is asking, and it is bounded by four
 * constraints from FR-002a. Three of them are about what this must NOT do:
 *
 *   1. It does not render for an unauthenticated request. The caller decides that, via
 *      `isOwnerViewing()`; this component is only ever mounted when the answer is yes.
 *   2. It offers no sign-in control and says nothing that would tell a visitor an
 *      authenticated surface exists. A "Designer login" link here would be a soft login wall,
 *      which Principle I calls a violation rather than a trade-off.
 *   3. It changes nothing about the response a visitor receives.
 *   4. It changes nothing about what data the page reads. The storefront reads published,
 *      public fields for everyone, including for her.
 *
 * The wording follows from that. It says "your storefront", not "admin" or "editing" — she is
 * looking at the same page a visitor sees, and the bar's job is to say so and offer the way
 * back, not to imply she has entered some privileged mode.
 * ============================================================================
 */
export function OwnerBar() {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
      <p className="text-gray-700">
        You are viewing your storefront as a visitor sees it.
      </p>
      <Link href="/studio" className="font-medium underline hover:no-underline">
        Back to the studio
      </Link>
    </div>
  );
}
