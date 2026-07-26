/**
 * T045 — photo acceptance rules (FR-012).
 *
 * Deliberately isomorphic: no `server-only`, no `sharp`, no Supabase. The same rules
 * run in the browser (so the designer hears about a 40 MB video before spending three
 * minutes uploading it on a phone connection) and again on the server (because the
 * browser check is a courtesy, not a control).
 *
 * Two rules FR-012 asks for and one it implies:
 *   1. Accept JPEG, PNG, HEIC. Reject everything else.
 *   2. Reject anything over 25 MB.
 *   3. The message must name the accepted formats AND the limit — "unsupported file" tells
 *      the designer nothing she can act on while standing in a studio holding a phone.
 *
 * Rejection is always per-file. One bad photo must not take the rest of the upload with
 * it, which is why this returns a result per file rather than throwing.
 */

/** FR-012. The `originals` bucket carries a 30 MiB backstop above this (migration 0010). */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** Extensions, lower-case, without the dot. */
export const ACCEPTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif'] as const;

export const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
] as const;

/** For `accept` on a file input. HEIC is listed by extension because Safari reports an
 *  empty MIME type for it often enough that a MIME-only accept list hides the designer's
 *  own photos from the picker. */
export const FILE_INPUT_ACCEPT = 'image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif';

export const ACCEPTED_FORMATS_LABEL = 'JPEG, PNG, or HEIC';

/** The one sentence every rejection ends with, so the designer always learns both rules. */
export const LIMITS_SENTENCE = `Photos must be ${ACCEPTED_FORMATS_LABEL} and no larger than 25 MB.`;

export interface PhotoCandidate {
  name: string;
  size: number;
  /** Browser-reported MIME type. Frequently empty for HEIC — see `extensionOf`. */
  type?: string;
}

export type PhotoValidation = { ok: true } | { ok: false; reason: string };

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return '';
  return filename.slice(dot + 1).toLowerCase();
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Validates one candidate photo.
 *
 * The type check accepts a match on EITHER the MIME type or the extension rather than
 * requiring both. iOS reports HEIC files with an empty `type` often enough that requiring
 * a MIME match would reject the phone photos this product exists to receive; requiring an
 * extension match would reject files pasted from a clipboard, which arrive named
 * `image.png` with a correct type but sometimes no extension at all.
 */
export function validatePhotoFile(file: PhotoCandidate): PhotoValidation {
  const extension = extensionOf(file.name);
  const mime = (file.type ?? '').toLowerCase();

  const mimeOk = (ACCEPTED_MIME_TYPES as readonly string[]).includes(mime);
  const extensionOk = (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension);

  if (!mimeOk && !extensionOk) {
    return {
      ok: false,
      reason: `“${file.name}” is not a supported image. ${LIMITS_SENTENCE}`,
    };
  }

  if (file.size <= 0) {
    return { ok: false, reason: `“${file.name}” is empty. ${LIMITS_SENTENCE}` };
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      reason: `“${file.name}” is ${formatSize(file.size)}. ${LIMITS_SENTENCE}`,
    };
  }

  return { ok: true };
}

/**
 * Splits a batch into what may be processed and what was refused.
 *
 * FR-012 requires a rejection to leave the other photos in the same upload alone, so the
 * caller gets both halves and proceeds with the accepted ones.
 */
export function partitionPhotoFiles<T extends PhotoCandidate>(
  files: readonly T[],
): { accepted: T[]; rejected: Array<{ file: T; reason: string }> } {
  const accepted: T[] = [];
  const rejected: Array<{ file: T; reason: string }> = [];

  for (const file of files) {
    const result = validatePhotoFile(file);
    if (result.ok) accepted.push(file);
    else rejected.push({ file, reason: result.reason });
  }

  return { accepted, rejected };
}
