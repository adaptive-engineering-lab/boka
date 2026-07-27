'use client';

import { useState } from 'react';

/**
 * T051 — the publish toggle (FR-021, FR-026).
 *
 * This is the single control that moves a design across the boundary Principle II protects,
 * so it is built to be impossible to press by accident and impossible to misread:
 *
 *   - It states the **current** state and what pressing it **will do**, separately. A
 *     control labelled just "Publish" is ambiguous about which side it is on.
 *   - It says where the change lands — the storefront, on the visitor's next load — because
 *     "published" means nothing to the designer unless she knows what visitors now see.
 *   - Unpublishing explains that the design's URL starts returning the same "not found" as a
 *     design that never existed (FR-023). That is surprising if you have shared the link,
 *     and it is exactly what the requirement demands, so it has to be said out loud.
 *
 * There is no confirmation dialog. Both directions are instant and reversible at any time,
 * and a modal in front of a reversible action trains people to dismiss modals.
 */
export function PublishToggle({
  published,
  action,
}: {
  published: boolean;
  /** Server action flipping `published`. */
  action: (next: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  return (
    <div className="rounded border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">
            {published ? 'Live on your storefront' : 'Not on your storefront'}
          </p>
          <p className="mt-1 max-w-sm text-sm text-gray-600">
            {published
              ? 'Anyone with the link can see this design, its photos and its public description.'
              : 'Only you can see this. Visitors cannot reach it, even with the exact address.'}
          </p>
        </div>

        <form
          action={async () => {
            setPending(true);
            await action(!published);
            setPending(false);
          }}
        >
          <button
            type="submit"
            disabled={pending}
            className={
              published
                ? 'rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60'
                : 'rounded bg-green-700 px-4 py-2 text-sm text-white hover:bg-green-800 disabled:opacity-60'
            }
          >
            {pending ? 'Saving…' : published ? 'Unpublish' : 'Publish'}
          </button>
        </form>
      </div>

      <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-600">
        {published
          ? 'Unpublishing takes it down on the next page load, and its address starts returning “not found” — the same response a design that never existed gets. Its photos stop loading too.'
          : 'Publishing puts it on your storefront on the next page load. You can take it down again at any time.'}
      </p>
    </div>
  );
}
