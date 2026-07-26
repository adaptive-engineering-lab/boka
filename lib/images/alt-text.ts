/**
 * Alt-text resolution (T030, FR-012b).
 *
 * The designer may author alt text per photo, but it is optional. What is NOT optional
 * is alt text appearing on the page: no photo may ever render without it.
 *
 * The fallback is computed here at read time rather than stored, so it stays correct
 * after the design is renamed or its photos are reordered. Storing it would go stale
 * silently, which is the worst kind of accessibility bug — invisible to everyone who
 * isn't relying on it.
 */

export interface AltTextInput {
  /** Designer-authored alt text, if any. */
  altText: string | null | undefined;
  /** Design title, used for the fallback. */
  designTitle: string;
  /** Zero-based position of this photo within its design. */
  position: number;
  /** Total number of photos on the design. */
  totalPhotos: number;
}

/**
 * Returns the alt text to render. Never returns an empty string.
 *
 * Authored text wins. Otherwise: "Midnight Gown, photo 2 of 3" — which tells a
 * screen-reader user which garment they are on and that there are others, the two
 * things the position alone conveys.
 */
export function resolveAltText({
  altText,
  designTitle,
  position,
  totalPhotos,
}: AltTextInput): string {
  const authored = altText?.trim();
  if (authored) return authored;

  const title = designTitle.trim() || 'Design';

  // A single-photo design gains nothing from "photo 1 of 1".
  if (totalPhotos <= 1) return title;

  return `${title}, photo ${position + 1} of ${totalPhotos}`;
}
