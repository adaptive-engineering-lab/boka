'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * T040 — delete confirmation (FR-019, FR-044).
 *
 * The sentence about inquiries is the reason this component exists rather than a
 * `confirm()` call. "Delete this design" reasonably reads as "delete everything about
 * it", and the one thing in that blast radius worth keeping is the leads — a visitor who
 * wrote asking about a piece is a real person waiting for a reply, and Clarification Q3
 * decided they survive. A designer who believes deleting the design also deletes the
 * enquiries will either avoid deleting things she wants gone, or delete them expecting a
 * cleanup that never happens. Both are worse than a longer dialog.
 *
 * `<dialog>` rather than a hand-rolled overlay: it gets focus trapping, Escape-to-close,
 * and inert background content from the platform, all of which SC-014 needs and all of
 * which are easy to get wrong by hand.
 */
export function DeleteDesignDialog({
  designTitle,
  action,
}: {
  designTitle: string;
  /** Server action performing the delete. */
  action: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50"
      >
        Delete design
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        aria-labelledby="delete-design-title"
        className="w-[min(28rem,calc(100vw-2rem))] rounded-lg p-0 backdrop:bg-black/40"
      >
        <div className="p-6">
          <h2 id="delete-design-title" className="text-lg font-medium">
            Delete “{designTitle}”?
          </h2>

          <div className="mt-3 space-y-2 text-sm text-gray-600">
            <p>
              The design and all of its photos will be removed, from the storefront and from
              storage. This cannot be undone.
            </p>
            <p className="rounded bg-gray-50 px-3 py-2 text-gray-700">
              <strong className="font-medium">Enquiries are kept.</strong> Anyone who wrote to
              you about this piece stays in your records, with the design&rsquo;s name saved
              alongside their message.
            </p>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            >
              Keep it
            </button>
            <form
              action={async () => {
                setPending(true);
                await action();
              }}
            >
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800 disabled:opacity-60"
              >
                {pending ? 'Deleting…' : 'Delete design'}
              </button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
