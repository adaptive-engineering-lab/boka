import { resolveAltText } from '@/lib/images/alt-text';

/**
 * T036 — optional per-photo alt text (FR-012a).
 *
 * The field is optional; alt text on the page is not (FR-012b). So the help text shows the
 * exact fallback that will be used if this is left blank, rather than saying "a default
 * will be used" — the designer can then decide whether the default is good enough for this
 * particular photo, which is the only decision she is actually being asked to make.
 */
export function AltTextField({
  name,
  id,
  defaultValue,
  designTitle,
  position,
  totalPhotos,
}: {
  name: string;
  id: string;
  defaultValue?: string | null;
  designTitle: string;
  position: number;
  totalPhotos: number;
}) {
  const fallback = resolveAltText({
    altText: null,
    designTitle: designTitle || 'Untitled',
    position,
    totalPhotos,
  });

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        Describe this photo{' '}
        <span className="font-normal text-gray-500">(optional)</span>
      </label>
      <input
        id={id}
        name={name}
        type="text"
        maxLength={250}
        defaultValue={defaultValue ?? ''}
        aria-describedby={`${id}-help`}
        placeholder={fallback}
        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />
      <p id={`${id}-help`} className="mt-1 text-xs text-gray-500">
        Read aloud to visitors using a screen reader. Left blank, it reads “{fallback}”.
      </p>
    </div>
  );
}
