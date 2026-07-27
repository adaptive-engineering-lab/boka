/**
 * T053 — the storefront header (FR-028).
 *
 * Renders `name`, `bio` and the profile photo, which is the complete set of fields
 * `public_designer_profile` exposes. **`email` is not in that view**, and this component
 * receives no props that could carry it — the designer's address is the destination for
 * inquiry notifications (FR-039), not public contact information. A visitor who wants to
 * reach her uses the inquiry form.
 *
 * The photo is optional and its absence is not an error state: a designer who has not
 * uploaded one gets a header with her name and bio, not a broken image or a grey circle
 * where a face should be.
 */
export function DesignerHeader({
  name,
  bio,
  hasPhoto,
}: {
  name: string;
  bio: string | null;
  hasPhoto: boolean;
}) {
  return (
    <header className="mb-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
      {hasPhoto ? (
        // Plain <img> against the /img route: the source is a 302 to a short-lived signed
        // URL, so there is nothing stable for an optimiser to cache. Width and height are
        // set so the text does not reflow when it arrives (SC-012).
        <img
          src="/img/profile"
          alt={`${name}, portrait`}
          width={96}
          height={96}
          className="h-24 w-24 flex-none rounded-full bg-gray-100 object-cover"
        />
      ) : null}

      <div>
        <h1 className="text-2xl font-medium sm:text-3xl">{name}</h1>
        {bio ? (
          // `whitespace-pre-line` so paragraph breaks the designer typed survive. The bio
          // is capped at 2000 characters in the schema, which is what keeps this header
          // from pushing the grid off a phone screen.
          <p className="mt-2 max-w-prose whitespace-pre-line text-gray-700">{bio}</p>
        ) : null}
      </div>
    </header>
  );
}
